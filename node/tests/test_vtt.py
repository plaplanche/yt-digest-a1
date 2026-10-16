from pathlib import Path

from yt_digest_node.vtt import Cue, clean_paragraphs, parse_vtt

FIXTURES = Path(__file__).parent / "fixtures" / "vtt"


def load(name: str) -> list[Cue]:
    return parse_vtt((FIXTURES / f"{name}.vtt").read_text())


def cue(start: float, end: float, *lines: str) -> Cue:
    return Cue(start, end, lines)


def test_parse_manual_ignores_header_blocks_and_settings() -> None:
    cues = load("manual")
    assert [(c.start, c.end) for c in cues] == [
        (1.0, 3.0),
        (3.5, 5.0),
        (7.0, 9.0),
        (10.9, 12.3),
    ]
    assert cues[1].lines == ("<v Roger>Today we talk", "about parsing.</v>")


def test_manual_cleaning_and_paragraphs() -> None:
    assert clean_paragraphs(load("manual"), []) == [
        "Hello and welcome. Today we talk about parsing.",
        "A new paragraph starts here. Same paragraph after a 1.9 second gap.",
    ]


def test_auto_rolling_duplicates_and_inline_tags() -> None:
    assert clean_paragraphs(load("auto"), []) == [
        "hello everyone and welcome back to the channel"
    ]


def test_annotations_and_entities() -> None:
    assert clean_paragraphs(load("annotated"), []) == [
        "Tom & Jerry <3 cats It's fine now"
    ]


def test_gap_of_2_seconds_starts_paragraph_and_1_9_does_not() -> None:
    assert clean_paragraphs([cue(0, 1, "a"), cue(3.0, 4, "b")], []) == ["a", "b"]
    assert clean_paragraphs([cue(0, 1, "a"), cue(2.9, 4, "b")], []) == ["a b"]


def test_gap_is_measured_from_last_kept_cue() -> None:
    cues = [cue(0, 1, "a"), cue(1, 5, "[Musique]"), cue(5, 6, "b")]
    assert clean_paragraphs(cues, []) == ["a", "b"]


def test_duplicate_line_dropped_across_cues_only_when_adjacent() -> None:
    cues = [cue(0, 1, "a", "b"), cue(1, 2, "b", "a")]
    assert clean_paragraphs(cues, []) == ["a b a"]


def test_segments_drop_cues_by_midpoint() -> None:
    cues = [cue(0, 2, "a"), cue(2, 4, "b"), cue(4, 6, "c")]
    # midpoints 1, 3, 5; start inclusive, end exclusive
    assert clean_paragraphs(cues, [(3.0, 5.0)]) == ["a", "c"]
    assert clean_paragraphs(cues, [(1.0, 3.0)]) == ["b c"]


def test_empty_input() -> None:
    assert parse_vtt("WEBVTT\n") == []
    assert clean_paragraphs([], []) == []


def test_gap_of_exactly_2_seconds_parsed_from_text_with_fractions() -> None:
    text = (
        "WEBVTT\n\n00:00:00.300 --> 00:00:01.300\na\n\n"
        "00:00:03.300 --> 00:00:04.000\nb\n\n"
        "00:00:05.900 --> 00:00:06.000\nc\n"
    )
    assert clean_paragraphs(parse_vtt(text), []) == ["a", "b c"]


def test_malformed_timestamps_are_skipped() -> None:
    text = "WEBVTT\n\n0:01.000 --> 00:02.000\na\n\n00:75.000 --> 00:80.000\nb\n"
    assert parse_vtt(text) == []
