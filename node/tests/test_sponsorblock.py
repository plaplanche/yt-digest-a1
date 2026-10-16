import json
import threading
from collections.abc import Iterator
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Any
from urllib.parse import parse_qs, urlparse

import pytest
from yt_digest_node.sponsorblock import fetch_segments, in_segment, sponsor_ratio

REQUESTS: list[str] = []
REPLY: dict[str, Any] = {}


class Handler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        REQUESTS.append(self.path)
        body = REPLY.get("body", b"")
        self.send_response(REPLY["status"])
        self.send_header("Content-Length", str(REPLY.get("length", len(body))))
        self.end_headers()
        self.wfile.write(body)
        if "length" in REPLY:
            self.close_connection = True

    def log_message(self, format: str, *args: Any) -> None:
        pass


@pytest.fixture
def server() -> Iterator[str]:
    REQUESTS.clear()
    REPLY.clear()
    httpd = HTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{httpd.server_port}"
    httpd.shutdown()
    httpd.server_close()


def log_line(capsys: pytest.CaptureFixture[str]) -> dict[str, Any]:
    line: dict[str, Any] = json.loads(capsys.readouterr().err)
    return line


def test_200_returns_segments(server: str, capsys: pytest.CaptureFixture[str]) -> None:
    REPLY.update(
        status=200,
        body=json.dumps([{"segment": [1, 2.5]}, {"segment": [10, 20]}]).encode(),
    )
    result = fetch_segments(server, "abc", "r1")
    assert result.state == "ok"
    assert result.segments == [(1.0, 2.5), (10.0, 20.0)]
    url = urlparse(REQUESTS[0])
    assert url.path == "/api/skipSegments"
    query = parse_qs(url.query)
    assert query["videoID"] == ["abc"]
    assert json.loads(query["categories"][0]) == ["sponsor", "selfpromo", "interaction"]
    line = log_line(capsys)
    assert line["event"] == "sponsorblock.call"
    assert line["video_id"] == "abc"
    assert line["request_id"] == "r1"
    assert line["attrs"]["status"] == 200
    assert line["attrs"]["segments"] == 2
    assert line["attrs"]["duration_ms"] >= 0


def test_404_is_none(server: str, capsys: pytest.CaptureFixture[str]) -> None:
    REPLY.update(status=404, body=b"Not Found")
    result = fetch_segments(server, "abc")
    assert (result.state, result.segments) == ("none", [])
    attrs = log_line(capsys)["attrs"]
    assert (attrs["status"], attrs["segments"]) == (404, 0)


def test_500_is_error(server: str, capsys: pytest.CaptureFixture[str]) -> None:
    REPLY.update(status=500, body=b"")
    result = fetch_segments(server, "abc")
    assert (result.state, result.segments) == ("error", [])
    attrs = log_line(capsys)["attrs"]
    assert (attrs["status"], attrs["segments"]) == (500, 0)


def test_200_with_invalid_body_is_error(
    server: str, capsys: pytest.CaptureFixture[str]
) -> None:
    REPLY.update(status=200, body=b"not json")
    result = fetch_segments(server, "abc")
    assert (result.state, result.segments) == ("error", [])
    assert log_line(capsys)["attrs"]["status"] == 200


@pytest.mark.parametrize(
    "body", [b"[[1, 2]]", b'[{"segment": [5, 1]}]', b'[{"segment": [NaN, 1]}]']
)
def test_200_with_unusable_segments_is_error(
    server: str, body: bytes, capsys: pytest.CaptureFixture[str]
) -> None:
    REPLY.clear()
    REPLY.update(status=200, body=body)
    result = fetch_segments(server, "abc")
    assert (result.state, result.segments) == ("error", [])


def test_truncated_body_is_error(
    server: str, capsys: pytest.CaptureFixture[str]
) -> None:
    REPLY.clear()
    REPLY.update(status=200, body=b"[", length=100)
    result = fetch_segments(server, "abc")
    assert (result.state, result.segments) == ("error", [])
    line = log_line(capsys)
    assert line["event"] == "sponsorblock.call"
    assert (line["attrs"]["status"], line["attrs"]["segments"]) == (0, 0)


def test_timeout_is_ten_seconds(monkeypatch: pytest.MonkeyPatch) -> None:
    seen: list[float] = []

    def fake(url: str, timeout: float) -> Any:
        seen.append(timeout)
        raise TimeoutError

    monkeypatch.setattr("urllib.request.urlopen", fake)
    assert fetch_segments("http://unused", "abc").state == "error"
    assert seen == [10]


def test_connection_refused_is_error(capsys: pytest.CaptureFixture[str]) -> None:
    httpd = HTTPServer(("127.0.0.1", 0), Handler)
    port = httpd.server_port
    httpd.server_close()
    result = fetch_segments(f"http://127.0.0.1:{port}", "abc")
    assert (result.state, result.segments) == ("error", [])
    attrs = log_line(capsys)["attrs"]
    assert (attrs["status"], attrs["segments"]) == (0, 0)


def test_midpoint_start_inclusive() -> None:
    assert in_segment(9.0, 11.0, [(10.0, 20.0)])  # midpoint 10.0
    assert not in_segment(8.9, 11.0, [(10.0, 20.0)])  # midpoint 9.95


def test_midpoint_end_exclusive() -> None:
    assert not in_segment(19.0, 21.0, [(10.0, 20.0)])  # midpoint 20.0
    assert in_segment(18.9, 21.0, [(10.0, 20.0)])  # midpoint 19.95


def test_ratio_without_segment_is_zero() -> None:
    assert sponsor_ratio([], 100) == 0


def test_ratio_unions_overlapping_segments() -> None:
    assert sponsor_ratio([(0, 10), (5, 15), (12, 20), (50, 60)], 100) == 0.3


def test_ratio_clips_segment_past_the_end() -> None:
    assert sponsor_ratio([(90, 200), (300, 400)], 100) == 0.1


def test_ratio_rounds_to_three_decimals() -> None:
    assert sponsor_ratio([(0, 1)], 3) == 0.333
