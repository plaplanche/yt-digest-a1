"""Extractors (fake and yt-dlp) and the choice of the subtitle track."""

import importlib
import json
import random
import time
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal, Protocol

Kind = Literal["manual", "auto"]
Failure = Literal["unavailable", "blocked"]

_BLOCKED_MARKERS = ("not a bot", "try again later", "http error 429", "http error 403")
_UNAVAILABLE_MARKERS = (
    "private video",
    "your age",
    "age-restricted",
    "age restricted",
    "removed",
    "video unavailable",
    "terminated",
    "does not exist",
)


@dataclass(frozen=True)
class Track:
    lang: str
    kind: Kind
    text: str


@dataclass(frozen=True)
class Extraction:
    duration: float
    tracks: list[Track]


class Extractor(Protocol):
    def extract(
        self, video_id: str, langs: Sequence[str] = ()
    ) -> Extraction | Failure: ...


class FakeExtractor:
    def __init__(self, root: Path) -> None:
        self.root = root

    def extract(self, video_id: str, langs: Sequence[str] = ()) -> Extraction | Failure:
        directory = self.root / video_id
        if not directory.is_dir():
            return "unavailable"
        meta = json.loads((directory / "meta.json").read_text(encoding="utf-8"))
        if meta.get("status") in ("unavailable", "blocked"):
            return meta["status"]  # type: ignore[no-any-return]
        tracks = []
        for path in sorted(directory.glob("*.vtt")):
            parts = path.name.split(".")
            if len(parts) != 3:
                continue
            lang, kind, _ = parts
            if kind in ("manual", "auto"):
                tracks.append(Track(lang, kind, path.read_text(encoding="utf-8")))  # type: ignore[arg-type]
        return Extraction(float(meta["duration"]), tracks)


def parse_delay(value: str) -> tuple[float, float]:
    """Parse `YT_DELAY_SECONDS`: `a-b` or a single number."""
    low, _, high = value.partition("-")
    return float(low), float(high or low)


class YtDlpExtractor:
    """yt-dlp as a library; `ytdlp` is the module, replaced by a stub in tests."""

    def __init__(
        self,
        ytdlp: Any,
        delay: tuple[float, float] = (2.0, 5.0),
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        self.ytdlp = ytdlp
        self.delay = delay
        self.sleep = sleep

    def _wait(self) -> None:
        self.sleep(random.uniform(*self.delay))

    def extract(self, video_id: str, langs: Sequence[str] = ()) -> Extraction | Failure:
        options = {
            "skip_download": True,
            "writesubtitles": True,
            "writeautomaticsub": True,
            "subtitlesformat": "vtt",
            "quiet": True,
        }
        try:
            with self.ytdlp.YoutubeDL(options) as ydl:
                self._wait()
                info = ydl.extract_info(
                    f"https://www.youtube.com/watch?v={video_id}", download=False
                )
                tracks = []
                for kind, key in (
                    ("manual", "subtitles"),
                    ("auto", "automatic_captions"),
                ):
                    for lang in langs:
                        url = _vtt_url((info.get(key) or {}).get(lang, []))
                        if url is not None:
                            self._wait()
                            try:
                                text = ydl.urlopen(url).read().decode("utf-8")
                            except (OSError, self.ytdlp.utils.DownloadError) as error:
                                return _map_error(str(error))
                            tracks.append(Track(lang, kind, text))  # type: ignore[arg-type]
        except self.ytdlp.utils.DownloadError as error:
            return _map_error(str(error))
        return Extraction(float(info.get("duration") or 0), tracks)


def _vtt_url(formats: list[dict[str, Any]]) -> str | None:
    for item in formats:
        if item.get("ext") == "vtt" and item.get("url"):
            return str(item["url"])
    return None


def _map_error(message: str) -> Failure:
    lowered = message.lower()
    if any(marker in lowered for marker in _BLOCKED_MARKERS):
        return "blocked"
    if any(marker in lowered for marker in _UNAVAILABLE_MARKERS):
        return "unavailable"
    raise RuntimeError(f"unmapped yt-dlp error: {message}")


def choose_track(tracks: Sequence[Track], langs: Sequence[str]) -> Track | None:
    """Manual tracks in language order, then auto tracks in language order."""
    for kind in ("manual", "auto"):
        for lang in langs:
            for track in tracks:
                if track.kind == kind and track.lang == lang:
                    return track
    return None


def make_extractor(env: dict[str, str]) -> Extractor:
    """The fake extractor when `FETCHER_FAKE_YTDLP=1`, else yt-dlp with the configured delay."""
    if env.get("FETCHER_FAKE_YTDLP") == "1":
        directory = env.get("FAKE_YTDLP_DIR")
        if not directory:
            raise ValueError("FAKE_YTDLP_DIR is required when FETCHER_FAKE_YTDLP=1")
        return FakeExtractor(Path(directory))
    yt_dlp = importlib.import_module("yt_dlp")
    return YtDlpExtractor(yt_dlp, parse_delay(env.get("YT_DELAY_SECONDS", "2-5")))
