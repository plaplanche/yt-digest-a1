"""The `yt-digest-node` commands: `transcript` and (in `daemon`) `work`."""

import argparse
import json
import os
import re
import sys
import time
from collections.abc import Sequence
from importlib.metadata import version
from typing import Any

from yt_digest_node.contracts.log_event import LogEventName
from yt_digest_node.contracts.transcript_result import TranscriptResult
from yt_digest_node.extractors import Extraction, choose_track, make_extractor
from yt_digest_node.log import emit
from yt_digest_node.pages import paginate, truncate, word_count
from yt_digest_node.sponsorblock import fetch_segments, sponsor_ratio
from yt_digest_node.vtt import clean_paragraphs, parse_vtt

_VIDEO_ID = re.compile(r"[A-Za-z0-9_-]{11}")


def _video_id(value: str) -> str:
    if not _VIDEO_ID.fullmatch(value):
        raise argparse.ArgumentTypeError(f"invalid video id: {value!r}")
    return value


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="yt-digest-node")
    commands = parser.add_subparsers(dest="command", required=True)
    transcript = commands.add_parser("transcript")
    transcript.add_argument("video_id", type=_video_id)
    transcript.add_argument("--langs")
    transcript.add_argument("--request-id")
    work = commands.add_parser("work")
    work.add_argument("--once", action="store_true")
    return parser


def _limit(env: dict[str, str], name: str, default: int) -> int:
    try:
        value = int(env[name])
    except (KeyError, ValueError):
        return default
    return value if value > 0 else default


def _empty(video_id: str, status: str) -> dict[str, Any]:
    return {
        "video_id": video_id,
        "status": status,
        "lang": None,
        "source": None,
        "word_count": 0,
        "truncated": False,
        "sponsor_ratio": None,
        "pages": [],
    }


def run(
    video_id: str, langs: Sequence[str], env: dict[str, str], request_id: str | None
) -> TranscriptResult:
    """Run the whole pipeline and log `fetch.transcript`."""
    started = time.monotonic()
    ids: dict[str, str] = {"request_id": request_id} if request_id is not None else {}
    result = _empty(video_id, "no_transcript")
    sponsorblock = "none"
    extraction = make_extractor(env).extract(video_id, langs)
    if not isinstance(extraction, Extraction):
        result["status"] = extraction
    elif (track := choose_track(extraction.tracks, langs)) is not None:
        base_url = env.get("SPONSORBLOCK_URL", "https://sponsor.ajay.app")
        found = fetch_segments(base_url, video_id, request_id)
        sponsorblock = found.state
        paragraphs = clean_paragraphs(parse_vtt(track.text), found.segments)
        paragraphs, cut = truncate(paragraphs, _limit(env, "MAX_WORDS", 60000))
        pages = paginate(paragraphs, _limit(env, "PAGE_WORDS", 12000))
        result.update(
            status="ok",
            lang=track.lang,
            source=track.kind,
            word_count=word_count(pages),
            truncated=cut,
            sponsor_ratio=None
            if found.state == "error"
            else sponsor_ratio(found.segments, extraction.duration),
            pages=pages,
        )
    model = TranscriptResult.model_validate(result)
    emit(
        LogEventName.fetch_transcript,
        video_id=video_id,
        attrs={
            "outcome": model.status.value,
            "source": model.source.value if model.source else None,
            "words": model.word_count,
            "pages": len(model.pages),
            "sponsor_ratio": model.sponsor_ratio,
            "sponsorblock": sponsorblock,
            "duration_ms": round((time.monotonic() - started) * 1000),
        },
        **ids,
    )
    return model


def main(argv: Sequence[str] | None = None) -> int:
    args = _parser().parse_args(argv)  # exits with 2 on a bad argument
    env = dict(os.environ)
    langs = [
        lang.strip()
        for lang in (
            getattr(args, "langs", None) or env.get("TRANSCRIPT_LANGS", "fr,en")
        ).split(",")
        if lang.strip()
    ]
    if args.command == "work":
        from yt_digest_node.daemon import work

        return work(env, langs, args.once)
    emit(
        LogEventName.service_started,
        attrs={"version": version("yt-digest-node")},
        **({"request_id": args.request_id} if args.request_id is not None else {}),
    )
    model = run(args.video_id, langs, env, args.request_id)
    print(json.dumps(model.model_dump(mode="json")))
    return 0


def entry() -> None:
    sys.exit(main())


if __name__ == "__main__":
    entry()
