"""The `yt-digest-node work` command: a worker of the cluster (lot 2 section 9)."""

import signal
import threading
import time
import urllib.error
import urllib.request
from collections.abc import Callable
from dataclasses import dataclass
from importlib.metadata import version
from types import FrameType

from pydantic import BaseModel, ValidationError

from yt_digest_node.cli import run as run_pipeline
from yt_digest_node.contracts.log_event import LogEventName
from yt_digest_node.contracts.node_claim_request import NodeClaimRequest
from yt_digest_node.contracts.node_claim_response import Job, NodeClaimResponse
from yt_digest_node.contracts.node_heartbeat_request import NodeHeartbeatRequest
from yt_digest_node.contracts.node_heartbeat_response import NodeHeartbeatResponse
from yt_digest_node.contracts.node_job_ack import NodeJobAck
from yt_digest_node.contracts.node_release_request import NodeReleaseRequest
from yt_digest_node.contracts.node_result_request import NodeResultRequest, Outcome
from yt_digest_node.contracts.transcript_result import TranscriptResult
from yt_digest_node.log import emit

RETRY_DELAYS = (1, 2, 4)
TIMEOUT_SECONDS = 30


class Unauthorized(Exception):
    """The Worker answered 401: the daemon cannot go on."""


class CallFailed(Exception):
    """A request ended without a valid 2xx answer."""


@dataclass
class Config:
    url: str
    token: str
    batch: int
    poll: float
    heartbeat: float


def _number(env: dict[str, str], name: str, default: int, low: int, high: int) -> int:
    try:
        value = int(env[name])
    except (KeyError, ValueError):
        return default
    return value if low <= value <= high else default


def config_from(env: dict[str, str]) -> Config | None:
    """The configuration, or None when WORKER_URL or NODE_TOKEN is missing."""
    url, token = env.get("WORKER_URL", ""), env.get("NODE_TOKEN", "")
    if not url or not token:
        return None
    return Config(
        url=url.rstrip("/"),
        token=token,
        batch=_number(env, "CLAIM_BATCH", 3, 1, 10),
        poll=_number(env, "POLL_SECONDS", 10, 1, 86400),
        heartbeat=_number(env, "HEARTBEAT_SECONDS", 60, 1, 86400),
    )


class Daemon:
    def __init__(self, config: Config, env: dict[str, str], langs: list[str]) -> None:
        self.config = config
        self.env = env
        self.langs = langs
        self.stop = threading.Event()
        self.started = time.monotonic()
        self.last_heartbeat = float("-inf")
        self.in_progress = 0
        self.sleep: Callable[[float], None] = time.sleep

    def _call(
        self, endpoint: str, body: BaseModel, video_id: str | None = None
    ) -> tuple[int, bytes]:
        request = urllib.request.Request(
            f"{self.config.url}/node/{endpoint}",
            data=body.model_dump_json(exclude_unset=True).encode(),
            headers={
                "Authorization": f"Bearer {self.config.token}",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        started = time.monotonic()
        status, payload = 0, b""
        try:
            with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
                status, payload = response.status, response.read()
        except urllib.error.HTTPError as error:
            status = error.code
            try:
                payload = error.read()
            except OSError:
                payload = b""
        except (OSError, ValueError):
            pass  # network error: status stays 0
        emit(
            LogEventName.worker_call,
            attrs={
                "endpoint": endpoint,
                "status": status,
                "duration_ms": round((time.monotonic() - started) * 1000),
            },
            **({"video_id": video_id} if video_id is not None else {}),
        )
        if status == 401:
            raise Unauthorized
        return status, payload

    def _parsed[T: BaseModel](
        self,
        endpoint: str,
        body: BaseModel,
        model: type[T],
        video_id: str | None = None,
    ) -> T:
        status, payload = self._call(endpoint, body, video_id)
        if not 200 <= status < 300:
            raise CallFailed(endpoint)
        try:
            return model.model_validate_json(payload)
        except ValidationError as error:
            raise CallFailed(endpoint) from error

    def _retried(
        self, endpoint: str, body: BaseModel, video_id: str
    ) -> NodeJobAck | None:
        """Post a result or a release; retry a network error or a 5xx, never a 4xx."""
        for delay in (*RETRY_DELAYS, None):
            status, payload = self._call(endpoint, body, video_id)
            if status and status < 500:
                break
            if delay is not None:
                self.sleep(delay)
        else:
            return None
        if not 200 <= status < 300:
            return None
        try:
            return NodeJobAck.model_validate_json(payload)
        except ValidationError:
            return None

    def heartbeat(self) -> None:
        body = NodeHeartbeatRequest(
            version=version("yt-digest-node"),
            uptime_s=int(time.monotonic() - self.started),
            jobs_in_progress=self.in_progress,
        )
        self._parsed("heartbeat", body, NodeHeartbeatResponse)
        self.last_heartbeat = time.monotonic()

    def heartbeat_if_due(self) -> None:
        if time.monotonic() - self.last_heartbeat >= self.config.heartbeat:
            try:
                self.heartbeat()
            except CallFailed:
                self.last_heartbeat = time.monotonic()

    def claim(self) -> list[Job]:
        body = NodeClaimRequest(max_jobs=self.config.batch)
        return self._parsed("claim", body, NodeClaimResponse).jobs

    def process(self, job: Job) -> None:
        try:
            result: TranscriptResult | None = run_pipeline(
                job.video_id, self.langs, self.env, None
            )
        except Exception:  # noqa: BLE001 (any pipeline failure is an `error` outcome)
            outcome, result = Outcome.error, None
        else:
            assert result is not None
            outcome = Outcome(result.status.value)
            if outcome is not Outcome.ok:
                result = None
        body = NodeResultRequest(
            lease_id=job.lease_id, outcome=outcome, transcript=result
        )
        self._retried("result", body, job.video_id)

    def release(self, job: Job) -> None:
        self._retried(
            "release", NodeReleaseRequest(lease_id=job.lease_id), job.video_id
        )

    def work(self, jobs: list[Job]) -> None:
        """Run the jobs in order; once stopped, release those not started."""
        pending = list(jobs)
        self.in_progress = len(pending)
        while pending:
            job = pending[0]
            if self.stop.is_set():
                self.release(job)
            else:
                self.heartbeat_if_due()
                self.process(job)
            pending.pop(0)
            self.in_progress = len(pending)

    def run(self, once: bool) -> int:
        try:
            if once:
                self.heartbeat()
                self.work(self.claim())
                return 0
            while not self.stop.is_set():
                self.heartbeat_if_due()
                try:
                    jobs = self.claim()
                except CallFailed:
                    jobs = []
                self.work(jobs)
                if not jobs:
                    self.stop.wait(self.config.poll)
            return 0
        except CallFailed:
            return 1
        except Unauthorized:
            return 1


def work(env: dict[str, str], langs: list[str], once: bool) -> int:
    config = config_from(env)
    if config is None:
        print("WORKER_URL and NODE_TOKEN are required")
        return 2
    emit(LogEventName.service_started, attrs={"version": version("yt-digest-node")})
    daemon = Daemon(config, env, langs)

    def on_signal(signum: int, frame: FrameType | None) -> None:
        daemon.stop.set()

    signal.signal(signal.SIGTERM, on_signal)
    signal.signal(signal.SIGINT, on_signal)
    return daemon.run(once)
