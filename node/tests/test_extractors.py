import json
from pathlib import Path
from types import SimpleNamespace
from typing import Any, Self

import pytest
from yt_digest_node.extractors import (
    Extraction,
    FakeExtractor,
    Track,
    YtDlpExtractor,
    choose_track,
    make_extractor,
    parse_delay,
)


def video(
    root: Path, files: dict[str, str], meta: dict[str, Any] | None = None
) -> None:
    directory = root / "abc"
    directory.mkdir()
    (directory / "meta.json").write_text(json.dumps(meta or {"duration": 90}))
    for name, text in files.items():
        (directory / name).write_text(text)


def test_missing_directory_is_unavailable(tmp_path: Path) -> None:
    assert FakeExtractor(tmp_path).extract("abc") == "unavailable"


@pytest.mark.parametrize("status", ["blocked", "unavailable"])
def test_meta_status_is_returned(tmp_path: Path, status: str) -> None:
    video(tmp_path, {"en.manual.vtt": "x"}, {"duration": 1, "status": status})
    assert FakeExtractor(tmp_path).extract("abc") == status


def test_tracks_and_duration(tmp_path: Path) -> None:
    video(tmp_path, {"fr.auto.vtt": "A", "en.manual.vtt": "B", "notes.txt": "C"})
    result = FakeExtractor(tmp_path).extract("abc")
    assert isinstance(result, Extraction)
    assert result.duration == 90
    assert sorted(result.tracks, key=lambda t: t.lang) == [
        Track("en", "manual", "B"),
        Track("fr", "auto", "A"),
    ]


def test_manual_english_beats_auto_french(tmp_path: Path) -> None:
    video(tmp_path, {"fr.auto.vtt": "A", "en.manual.vtt": "B"})
    result = FakeExtractor(tmp_path).extract("abc")
    assert isinstance(result, Extraction)
    assert choose_track(result.tracks, ["fr", "en"]) == Track("en", "manual", "B")


def test_auto_follows_language_order() -> None:
    tracks = [Track("en", "auto", "E"), Track("fr", "auto", "F")]
    assert choose_track(tracks, ["fr", "en"]) == Track("fr", "auto", "F")


def test_only_other_language_is_no_track(tmp_path: Path) -> None:
    video(tmp_path, {"de.manual.vtt": "D"})
    result = FakeExtractor(tmp_path).extract("abc")
    assert isinstance(result, Extraction)
    assert choose_track(result.tracks, ["fr", "en"]) is None


def test_make_extractor_fake_and_missing_dir(tmp_path: Path) -> None:
    env = {"FETCHER_FAKE_YTDLP": "1", "FAKE_YTDLP_DIR": str(tmp_path)}
    assert isinstance(make_extractor(env), FakeExtractor)
    with pytest.raises(ValueError):
        make_extractor({"FETCHER_FAKE_YTDLP": "1"})


def test_parse_delay() -> None:
    assert parse_delay("2-5") == (2.0, 5.0)
    assert parse_delay("3") == (3.0, 3.0)


class DownloadError(Exception):
    pass


class StubYtDlp:
    """Stands in for the yt_dlp module."""

    utils = SimpleNamespace(DownloadError=DownloadError)

    def __init__(self, info: dict[str, Any] | None = None, error: str | None = None):
        self.info = info
        self.error = error
        self.options: dict[str, Any] = {}
        self.urls: list[str] = []

    def YoutubeDL(self, options: dict[str, Any]) -> "StubYtDlp":
        self.options = options
        return self

    def __enter__(self) -> Self:
        return self

    def __exit__(self, *args: object) -> None:
        pass

    def extract_info(self, url: str, download: bool) -> dict[str, Any]:
        assert download is False
        if self.error:
            raise DownloadError(self.error)
        assert self.info is not None
        return self.info

    def urlopen(self, url: str) -> SimpleNamespace:
        self.urls.append(url)
        return SimpleNamespace(read=lambda: f"text of {url}".encode())


def test_ytdlp_options_and_tracks() -> None:
    info = {
        "duration": 120,
        "subtitles": {"en": [{"ext": "vtt", "url": "u-en"}]},
        "automatic_captions": {"fr": [{"ext": "vtt", "url": "u-fr"}], "de": []},
    }
    stub = StubYtDlp(info)
    delays: list[float] = []
    result = YtDlpExtractor(stub, (2, 5), delays.append).extract("abc", ["fr", "en"])
    assert stub.options["skip_download"] is True
    assert stub.options["writesubtitles"] is True
    assert stub.options["writeautomaticsub"] is True
    assert stub.options["subtitlesformat"] == "vtt"
    assert "cookiefile" not in stub.options and "cookiesfrombrowser" not in stub.options
    assert result == Extraction(
        120,
        [Track("en", "manual", "text of u-en"), Track("fr", "auto", "text of u-fr")],
    )
    assert len(delays) == 3 and all(2 <= d <= 5 for d in delays)


@pytest.mark.parametrize(
    ("message", "expected"),
    [
        (
            "ERROR: [youtube] abc: Private video. Sign in if you've been granted access",
            "unavailable",
        ),
        ("ERROR: Sign in to confirm your age", "unavailable"),
        ("ERROR: Video unavailable. This video has been removed", "unavailable"),
        ("ERROR: [youtube] abc: Sign in to confirm you’re not a bot", "blocked"),
    ],
)
def test_ytdlp_errors_are_mapped(message: str, expected: str) -> None:
    extractor = YtDlpExtractor(StubYtDlp(error=message), (0, 0), lambda _: None)
    assert extractor.extract("abc") == expected


def test_ytdlp_unmapped_error_propagates() -> None:
    extractor = YtDlpExtractor(StubYtDlp(error="HTTP 500"), (0, 0), lambda _: None)
    with pytest.raises(RuntimeError):
        extractor.extract("abc")
