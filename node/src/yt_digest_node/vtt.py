import html
import re
from dataclasses import dataclass

PARAGRAPH_GAP = 2.0

_TAG = re.compile(r"<[^>]*>")
_ANNOTATION = re.compile(r"\[[^\]]*\]")
_SPACES = re.compile(r"\s+")
_TIMESTAMP = re.compile(r"(?:(\d+):)?(\d{1,2}):(\d{2})\.(\d{3})")
_IGNORED_BLOCKS = ("NOTE", "STYLE", "REGION")


@dataclass(frozen=True)
class Cue:
    start: float
    end: float
    lines: tuple[str, ...]


def _seconds(stamp: str) -> float | None:
    match = _TIMESTAMP.fullmatch(stamp)
    if match is None:
        return None
    hours, minutes, seconds, millis = match.groups()
    return (
        int(hours or 0) * 3600 + int(minutes) * 60 + int(seconds) + int(millis) / 1000
    )


def _is_ignored(block: list[str]) -> bool:
    first = block[0]
    if first.startswith("WEBVTT") and "-->" not in first:
        return True
    return any(
        first == word or first.startswith(word + " ") for word in _IGNORED_BLOCKS
    )


def parse_vtt(text: str) -> list[Cue]:
    """Parse VTT text into cues, ignoring header, NOTE/STYLE/REGION blocks and cue settings."""
    cues: list[Cue] = []
    blocks = re.split(
        r"\n[ \t]*\n", text.replace("\r\n", "\n").replace("\r", "\n").lstrip("﻿")
    )
    for raw in blocks:
        block = raw.strip("\n").split("\n")
        if not block[0].strip() or _is_ignored(block):
            continue
        timing = next((i for i, line in enumerate(block) if "-->" in line), None)
        if timing is None or timing > 1:
            continue
        left, _, right = block[timing].partition("-->")
        settings = right.split()
        start = _seconds(left.strip())
        end = _seconds(settings[0]) if settings else None
        if start is None or end is None:
            continue
        cues.append(Cue(start, end, tuple(block[timing + 1 :])))
    return cues


def clean_line(line: str) -> str:
    line = html.unescape(_TAG.sub("", line))
    return _SPACES.sub(" ", _ANNOTATION.sub("", line)).strip()


def clean_paragraphs(cues: list[Cue], segments: list[tuple[float, float]]) -> list[str]:
    """Apply steps 2 to 5 of section 5.4; return the paragraphs."""
    paragraphs: list[list[str]] = []
    previous_line: str | None = None
    previous_end: float | None = None
    for cue in cues:
        midpoint = (cue.start + cue.end) / 2
        if any(start <= midpoint < end for start, end in segments):
            continue
        kept: list[str] = []
        for line in map(clean_line, cue.lines):
            if line and line != previous_line:
                kept.append(line)
                previous_line = line
        if not kept:
            continue
        if previous_end is None or cue.start - previous_end >= PARAGRAPH_GAP:
            paragraphs.append([])
        paragraphs[-1].extend(kept)
        previous_end = cue.end
    return [" ".join(lines) for lines in paragraphs]
