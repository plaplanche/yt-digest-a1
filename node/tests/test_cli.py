import json
import os
import subprocess
import sys
import threading
from collections.abc import Iterator
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from typing import Any

import pytest
from yt_digest_node.contracts.transcript_result import TranscriptResult

VTT = """WEBVTT

00:00:01.000 --> 00:00:03.000
Hello and welcome.

00:00:10.000 --> 00:00:12.000
Buy this great product now.

00:00:20.000 --> 00:00:22.000
Back to the secret subject.
"""

REPLY: dict[str, Any] = {"status": 200, "body": b"[]"}


class Handler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        self.send_response(REPLY["status"])
        self.send_header("Content-Length", str(len(REPLY["body"])))
        self.end_headers()
        self.wfile.write(REPLY["body"])

    def log_message(self, format: str, *args: Any) -> None:
        pass


@pytest.fixture
def server() -> Iterator[str]:
    REPLY.update(status=200, body=b"[]")
    httpd = HTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{httpd.server_port}"
    httpd.shutdown()
    httpd.server_close()


@pytest.fixture
def fixtures(tmp_path: Path) -> Path:
    def video(name: str, meta: dict[str, Any], tracks: dict[str, str]) -> None:
        directory = tmp_path / name
        directory.mkdir()
        (directory / "meta.json").write_text(json.dumps(meta))
        for filename, text in tracks.items():
            (directory / filename).write_text(text)

    video("okokokokok1", {"duration": 30}, {"en.manual.vtt": VTT})
    video("notrackvi_1", {"duration": 30}, {"de.manual.vtt": VTT})
    video("blockedvid_", {"status": "blocked"}, {})
    return tmp_path


def run(
    fixtures: Path, server: str, *args: str, **env: str
) -> subprocess.CompletedProcess[str]:
    full = {
        **os.environ,
        "FETCHER_FAKE_YTDLP": "1",
        "FAKE_YTDLP_DIR": str(fixtures),
        "SPONSORBLOCK_URL": server,
        **env,
    }
    return subprocess.run(
        [sys.executable, "-m", "yt_digest_node.cli", *args],
        check=False,
        env=full,
        capture_output=True,
        text=True,
    )


def logs(process: subprocess.CompletedProcess[str]) -> list[dict[str, Any]]:
    return [json.loads(line) for line in process.stderr.splitlines()]


def test_ok_with_sponsor_cuts(fixtures: Path, server: str) -> None:
    REPLY["body"] = json.dumps([{"segment": [9, 13]}]).encode()
    process = run(fixtures, server, "transcript", "okokokokok1", "--request-id", "r1")
    assert process.returncode == 0
    result = TranscriptResult.model_validate_json(process.stdout)
    assert result.status.value == "ok"
    assert result.lang == "en"
    assert result.source is not None and result.source.value == "manual"
    assert result.pages == ["Hello and welcome.\n\nBack to the secret subject."]
    assert result.word_count == 8
    assert not result.truncated
    assert result.sponsor_ratio == pytest.approx(0.133)
    started, sponsor, fetched = logs(process)
    assert started["event"] == "service.started"
    assert sponsor["event"] == "sponsorblock.call"
    assert fetched["event"] == "fetch.transcript"
    assert fetched["request_id"] == "r1"
    assert fetched["video_id"] == "okokokokok1"
    assert fetched["attrs"]["outcome"] == "ok"
    assert fetched["attrs"]["words"] == 8
    assert fetched["attrs"]["pages"] == 1
    assert fetched["attrs"]["sponsorblock"] == "ok"
    for word in ("Hello", "welcome", "secret", "product"):
        assert word not in process.stderr


def test_truncation_and_pages_from_environment(fixtures: Path, server: str) -> None:
    process = run(
        fixtures, server, "transcript", "okokokokok1", MAX_WORDS="4", PAGE_WORDS="2"
    )
    result = TranscriptResult.model_validate_json(process.stdout)
    assert result.truncated
    assert result.word_count == 4
    assert result.pages == ["Hello and\n\n[…]", "secret subject."]


def test_langs_option_and_sponsorblock_error(fixtures: Path, server: str) -> None:
    REPLY["status"] = 500
    process = run(fixtures, server, "transcript", "notrackvi_1", "--langs", "de")
    result = TranscriptResult.model_validate_json(process.stdout)
    assert result.status.value == "ok"
    assert result.lang == "de"
    assert result.sponsor_ratio is None
    assert logs(process)[-1]["attrs"]["sponsorblock"] == "error"


def test_no_transcript(fixtures: Path, server: str) -> None:
    process = run(fixtures, server, "transcript", "notrackvi_1")
    assert process.returncode == 0
    result = TranscriptResult.model_validate_json(process.stdout)
    assert result.status.value == "no_transcript"
    assert result.pages == [] and result.lang is None and result.word_count == 0
    assert logs(process)[-1]["attrs"]["outcome"] == "no_transcript"


def test_unavailable(fixtures: Path, server: str) -> None:
    process = run(fixtures, server, "transcript", "missingvid_")
    assert process.returncode == 0
    assert json.loads(process.stdout)["status"] == "unavailable"


def test_blocked(fixtures: Path, server: str) -> None:
    process = run(fixtures, server, "transcript", "blockedvid_")
    assert process.returncode == 0
    assert json.loads(process.stdout)["status"] == "blocked"


@pytest.mark.parametrize("video_id", ["short", "has space 11", "waytoolongvideoid"])
def test_invalid_video_id(fixtures: Path, server: str, video_id: str) -> None:
    process = run(fixtures, server, "transcript", video_id)
    assert process.returncode == 2
    assert process.stdout == ""
