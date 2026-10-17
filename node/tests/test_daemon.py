import json
import os
import signal
import subprocess
import sys
import threading
import time
from collections.abc import Iterator
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from typing import Any

import pytest
from yt_digest_node import daemon
from yt_digest_node.cli import main

TOKEN = "ytd_node_secrettokensecrettokensecrettoken123"
LEASE = "lease-0123456789abcdef"


class Fake:
    """A local fake Worker: records requests, answers from per-endpoint scripts."""

    def __init__(self) -> None:
        self.requests: list[tuple[str, dict[str, Any], str]] = []
        self.replies: dict[str, list[tuple[int, Any]]] = {}
        self.jobs: list[str] = []

    def reply(self, endpoint: str) -> tuple[int, Any]:
        scripted = self.replies.get(endpoint, [])
        if scripted:
            return scripted.pop(0) if len(scripted) > 1 else scripted[0]
        if endpoint == "heartbeat":
            return 200, {
                "node_id": "n1",
                "state": "healthy",
                "hourly_budget": 10,
                "directive": "run",
            }
        if endpoint == "claim":
            return 200, {
                "jobs": [
                    {
                        "video_id": v,
                        "lease_id": f"{LEASE}-{v}",
                        "lease_expires_at": "2026-10-16T07:00:01.123Z",
                    }
                    for v in self.jobs
                ]
            }
        return 200, {"video_id": "x", "status": "done"}


@pytest.fixture
def fake() -> Iterator[tuple[Fake, str]]:
    state = Fake()

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self) -> None:
            body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            endpoint = self.path.rsplit("/", 1)[1]
            state.requests.append((endpoint, body, self.headers["Authorization"]))
            status, payload = state.reply(endpoint)
            data = json.dumps(payload).encode()
            self.send_response(status)
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def log_message(self, format: str, *args: Any) -> None:
            pass

    httpd = HTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    yield state, f"http://127.0.0.1:{httpd.server_port}"
    httpd.shutdown()
    httpd.server_close()


@pytest.fixture
def fixtures() -> Path:
    return Path(__file__).parent / "fixtures" / "cli"


@pytest.fixture(autouse=True)
def no_sleep(monkeypatch: pytest.MonkeyPatch) -> list[float]:
    slept: list[float] = []
    monkeypatch.setattr(time, "sleep", slept.append)
    return slept


def env(fixtures: Path, url: str, **extra: str) -> dict[str, str]:
    return {
        "FETCHER_FAKE_YTDLP": "1",
        "FAKE_YTDLP_DIR": str(fixtures),
        "SPONSORBLOCK_URL": url + "/sb",
        "WORKER_URL": url,
        "NODE_TOKEN": TOKEN,
        **extra,
    }


def work(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
    environment: dict[str, str],
) -> tuple[int, list[dict[str, Any]], str]:
    for name in ("WORKER_URL", "NODE_TOKEN"):
        monkeypatch.delenv(name, raising=False)
    for name, value in environment.items():
        monkeypatch.setenv(name, value)
    code = main(["work", "--once"])
    captured = capsys.readouterr()
    return code, [json.loads(line) for line in captured.err.splitlines()], captured.err


def sent(state: Fake, endpoint: str) -> list[dict[str, Any]]:
    return [body for name, body, _ in state.requests if name == endpoint]


def test_once_heartbeat_claim_and_results(
    fake: tuple[Fake, str],
    fixtures: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    state, url = fake
    state.jobs = ["okokokokok1", "notrackvi_1", "blockedvid_"]
    code, lines, raw = work(monkeypatch, capsys, env(fixtures, url, CLAIM_BATCH="5"))
    assert code == 0
    assert [name for name, _, _ in state.requests] == [
        "heartbeat",
        "claim",
        "result",
        "result",
        "result",
    ]
    assert all(auth == f"Bearer {TOKEN}" for _, _, auth in state.requests)
    heartbeat = sent(state, "heartbeat")[0]
    assert set(heartbeat) == {"version", "uptime_s", "jobs_in_progress"}
    assert sent(state, "claim") == [{"max_jobs": 5}]
    ok, none, blocked = sent(state, "result")
    assert ok["lease_id"] == f"{LEASE}-okokokokok1"
    assert ok["outcome"] == "ok"
    assert ok["transcript"]["video_id"] == "okokokokok1"
    assert ok["transcript"]["status"] == "ok"
    assert (none["outcome"], none["transcript"]) == ("no_transcript", None)
    assert (blocked["outcome"], blocked["transcript"]) == ("blocked", None)
    assert lines[0]["event"] == "service.started"
    calls = [line for line in lines if line["event"] == "worker.call"]
    assert [c["attrs"]["endpoint"] for c in calls] == [
        "heartbeat",
        "claim",
        "result",
        "result",
        "result",
    ]
    assert all(c["attrs"]["status"] == 200 for c in calls)
    assert sum(line["event"] == "fetch.transcript" for line in lines) == 3
    assert TOKEN not in raw


def test_pipeline_exception_sends_error(
    fake: tuple[Fake, str],
    fixtures: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    state, url = fake
    state.jobs = ["okokokokok1"]

    def boom(*args: Any) -> None:
        raise RuntimeError("boom")

    monkeypatch.setattr(daemon, "run_pipeline", boom)
    code, _, _ = work(monkeypatch, capsys, env(fixtures, url))
    assert code == 0
    (result,) = sent(state, "result")
    assert (result["outcome"], result["transcript"]) == ("error", None)


def test_503_on_result_is_retried(
    fake: tuple[Fake, str],
    fixtures: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
    no_sleep: list[float],
) -> None:
    state, url = fake
    state.jobs = ["notrackvi_1"]
    state.replies["result"] = [
        (503, {}),
        (503, {}),
        (200, {"video_id": "notrackvi_1", "status": "done"}),
    ]
    code, lines, _ = work(monkeypatch, capsys, env(fixtures, url))
    assert code == 0
    assert len(sent(state, "result")) == 3
    assert no_sleep == [1, 2]
    statuses = [
        l["attrs"]["status"] for l in lines if l["attrs"].get("endpoint") == "result"
    ]
    assert statuses == [503, 503, 200]


def test_result_gives_up_after_three_retries(
    fake: tuple[Fake, str],
    fixtures: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
    no_sleep: list[float],
) -> None:
    state, url = fake
    state.jobs = ["notrackvi_1"]
    state.replies["result"] = [(503, {})]
    code, _, _ = work(monkeypatch, capsys, env(fixtures, url))
    assert code == 0
    assert len(sent(state, "result")) == 4
    assert no_sleep == [1, 2, 4]


def test_409_is_not_retried(
    fake: tuple[Fake, str],
    fixtures: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    state, url = fake
    state.jobs = ["notrackvi_1"]
    state.replies["result"] = [
        (409, {"error": {"code": "stale_lease", "message": "stale"}})
    ]
    code, _, _ = work(monkeypatch, capsys, env(fixtures, url))
    assert code == 0
    assert len(sent(state, "result")) == 1


def test_failed_claim_exits_1(
    fake: tuple[Fake, str],
    fixtures: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    state, url = fake
    state.replies["claim"] = [(500, {})]
    code, _, _ = work(monkeypatch, capsys, env(fixtures, url))
    assert code == 1


def test_failed_heartbeat_exits_1(
    fake: tuple[Fake, str],
    fixtures: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    state, url = fake
    state.replies["heartbeat"] = [(500, {})]
    code, _, _ = work(monkeypatch, capsys, env(fixtures, url))
    assert code == 1
    assert [n for n, _, _ in state.requests] == ["heartbeat"]


def test_unauthorized_exits_1(
    fake: tuple[Fake, str],
    fixtures: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    state, url = fake
    state.replies["heartbeat"] = [
        (401, {"error": {"code": "unauthorized", "message": "no"}})
    ]
    code, _, raw = work(monkeypatch, capsys, env(fixtures, url))
    assert code == 1
    assert TOKEN not in raw


def test_network_error_exits_1(
    fixtures: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    code, lines, _ = work(monkeypatch, capsys, env(fixtures, "http://127.0.0.1:1"))
    assert code == 1
    assert lines[-1]["attrs"] == {
        "endpoint": "heartbeat",
        "status": 0,
        "duration_ms": lines[-1]["attrs"]["duration_ms"],
    }


@pytest.mark.parametrize("missing", ["WORKER_URL", "NODE_TOKEN"])
def test_missing_variable_exits_2_without_request(
    missing: str,
    fake: tuple[Fake, str],
    fixtures: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    state, url = fake
    environment = env(fixtures, url)
    del environment[missing]
    code, _, raw = work(monkeypatch, capsys, environment)
    assert code == 2
    assert state.requests == []
    assert raw == ""


def test_sigterm_releases_unstarted_jobs(
    fake: tuple[Fake, str], fixtures: Path, tmp_path: Path
) -> None:
    state, url = fake
    state.jobs = ["okokokokok1", "notrackvi_1", "blockedvid_"]
    # a slow extractor lets the signal arrive while the first job runs
    driver = tmp_path / "driver.py"
    driver.write_text(
        "import sys, time\n"
        "import yt_digest_node.cli as cli\n"
        "inner = cli.make_extractor\n"
        "def make(env):\n"
        "    extractor = inner(env)\n"
        "    class Slow:\n"
        "        def extract(self, *args):\n"
        "            print('started', flush=True)\n"
        "            time.sleep(1.5)\n"
        "            return extractor.extract(*args)\n"
        "    return Slow()\n"
        "cli.make_extractor = make\n"
        "sys.exit(cli.main(['work']))\n"
    )
    process = subprocess.Popen(
        [sys.executable, str(driver)],
        env={**os.environ, **env(fixtures, url, POLL_SECONDS="1")},
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    assert process.stdout is not None
    assert process.stdout.readline().strip() == "started"
    process.send_signal(signal.SIGTERM)
    _, err = process.communicate(timeout=30)
    assert process.returncode == 0
    assert [n for n, _, _ in state.requests] == [
        "heartbeat",
        "claim",
        "result",
        "release",
        "release",
    ]
    assert sent(state, "result")[0]["lease_id"].endswith("okokokokok1")
    assert [b["lease_id"][-11:] for b in sent(state, "release")] == [
        "notrackvi_1",
        "blockedvid_",
    ]
    for line in err.splitlines():
        assert json.loads(line)["service"] == "node"
    assert TOKEN not in err
