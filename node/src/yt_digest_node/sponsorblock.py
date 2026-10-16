import http.client
import json
import math
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Literal

from yt_digest_node.contracts.log_event import LogEventName
from yt_digest_node.log import emit

TIMEOUT_SECONDS = 10
CATEGORIES = ["sponsor", "selfpromo", "interaction"]

Segment = tuple[float, float]
State = Literal["ok", "none", "error"]


@dataclass(frozen=True)
class SponsorBlockResult:
    segments: list[Segment]
    state: State


def to_ms(seconds: float) -> int:
    return round(seconds * 1000)


def _parse(body: bytes) -> list[Segment] | None:
    try:
        items = json.loads(body)
        segments = [(float(i["segment"][0]), float(i["segment"][1])) for i in items]
    except (ValueError, TypeError, KeyError, IndexError):
        return None
    if any(not (math.isfinite(s) and math.isfinite(e) and s <= e) for s, e in segments):
        return None
    return segments


def fetch_segments(
    base_url: str, video_id: str, request_id: str | None = None
) -> SponsorBlockResult:
    """Call SponsorBlock (section 5.3) and log `sponsorblock.call`."""
    query = urllib.parse.urlencode(
        {
            "videoID": video_id,
            "categories": json.dumps(CATEGORIES, separators=(",", ":")),
        }
    )
    url = f"{base_url.rstrip('/')}/api/skipSegments?{query}"
    started = time.monotonic()
    status = 0
    result = SponsorBlockResult([], "error")
    try:
        with urllib.request.urlopen(url, timeout=TIMEOUT_SECONDS) as response:
            status = response.status
            segments = _parse(response.read()) if status == 200 else None
            if segments is not None:
                result = SponsorBlockResult(segments, "ok")
    except urllib.error.HTTPError as error:
        status = error.code
        if status == 404:
            result = SponsorBlockResult([], "none")
    except (urllib.error.URLError, OSError, http.client.HTTPException):
        status = 0
    fields = {"request_id": request_id} if request_id is not None else {}
    emit(
        LogEventName.sponsorblock_call,
        video_id=video_id,
        attrs={
            "status": status,
            "segments": len(result.segments),
            "duration_ms": round((time.monotonic() - started) * 1000),
        },
        **fields,
    )
    return result


def in_segment(start: float, end: float, segments: list[Segment]) -> bool:
    """Midpoint rule of step 2: start inclusive, end exclusive, in integer milliseconds."""
    midpoint = to_ms(start) + to_ms(end)  # twice the midpoint
    return any(to_ms(s) * 2 <= midpoint < to_ms(e) * 2 for s, e in segments)


def sponsor_ratio(segments: list[Segment], duration: float) -> float:
    """Length of the union of the segments, clipped to [0, duration], over the duration."""
    if not segments or duration <= 0:
        return 0.0
    covered = 0.0
    last_end = 0.0
    for start, end in sorted(segments):
        start, end = max(start, last_end, 0.0), min(end, duration)
        if end > start:
            covered += end - start
        last_end = max(last_end, end)
    return round(covered / duration, 3)
