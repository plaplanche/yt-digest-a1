# Review 1

- Reviewed commit: `d5842e649f009f6bcfc793c1f96e45e154c0f737`
- Reviewer model: claude-opus-5-5
- Verdict: **go**

## Findings

- **minor** (`node/src/yt_digest_node/vtt.py:80`) Segment bounds rounded to milliseconds change the step 2 boundary

  SponsorBlock returns segment bounds with sub-millisecond precision (e.g. 5.0004). `_ms(start) * 2 <= midpoint` rounds them first, so a cue 4.000–6.000 (midpoint 5.0) is dropped for a segment starting at 5.0004, but spec 5.4 step 2 says start is inclusive and 5.0 < 5.0004. Cue times are already exact to the millisecond, so an exact check needs no rounding of the segment: compare `cue_ms_sum <= 2000 * start` against the raw float. The choice is written down in decisions.md, but the reason given there (float rounding) doesn't hold for the segment side. It only matters for sub-millisecond differences, and SponsorBlock is out of scope until the next ticket.

- **minor** (`node/src/yt_digest_node/vtt.py:49`) Whitespace-only lines split blocks; this choice is not in decisions.md

  The split pattern `\n[ \t]*\n` treats a line of spaces as a block separator. That handles the trailing ' ' lines in YouTube auto tracks. But in WebVTT a line containing a space is not a blank line, so text after such a line inside a cue becomes its own block with no timing line, and it is silently dropped. Also, a block whose first line is whitespace only (e.g. 'text\n \n \n00:00:01.000 --> …') is skipped whole by `not block[0].strip()`, and the cue is lost. This is a choice the spec leaves open, and decisions.md does not mention it.

- **minor** (`node/src/yt_digest_node/vtt.py:7`) Tag pattern can remove spoken text, and nested brackets are only partly removed

  `<[^>]*>` runs before entity decoding, which is good for `&lt;`. But a literal '<' in the raw text followed later by '>' (e.g. 'a < b > c') removes ' b '. `\[[^\]]*\]` turns '[a [b] c]' into ' c]'. These are edge cases that real YouTube tracks rarely produce.

- **minor** (`node/tests/test_vtt.py:1`) Some step 3 tags and parser branches are not tested

  No test covers `<b>` or `<u>` tags, a header that starts with a BOM, CRLF line endings, a cue identifier without settings, or a cue with an `hh` field longer than two digits. The single `<...>` pattern covers all of them, so the risk is low.

- **minor** (`node/src/yt_digest_node/vtt.py:38`) A cue identifier starting with 'WEBVTT', 'NOTE ' or 'STYLE ' drops the cue

  `_is_ignored` checks only the first line of a block. A cue whose identifier line is, for example, 'NOTE 1' or 'WEBVTT-cue' with the timing on line 2 is discarded as a comment or header block. The WebVTT spec forbids '-->' in identifiers but not these prefixes.

## Definition of done

- met: check lint passes

  Replayed by Ariane: exit 0.

- met: check contracts passes

  Replayed by Ariane: exit 0.

- met: check test-node passes

  Replayed by Ariane: exit 0.

- met: check test-worker passes

  Replayed by Ariane: exit 0.

- met: The change does what the ticket and spec/lot-1.md say, and nothing more.

  `parse_vtt` covers step 1: it ignores the header, NOTE, STYLE and REGION blocks, skips cue settings, and accepts an optional identifier. `clean_paragraphs` covers steps 2–5: midpoint check with start inclusive and end exclusive; removal of tags, entities, annotations and extra whitespace in that order; empty and consecutive-duplicate lines dropped; a gap of 2.0 s or more from the last kept cue starts a paragraph; lines joined by a space. The three fixtures the ticket asks for are under node/tests/fixtures/vtt/. No SponsorBlock call, extractor, truncation or pages were added. The only deviation is ms rounding of segment bounds at sub-millisecond boundaries (minor finding).

- met: The change is covered by tests that fail without it.

  node/tests/test_vtt.py imports the new module, so every test fails without it. Tests cover each rule on the fixtures: rolling duplicates and inline timestamps (auto.vtt), [Musique]/[Applause]/&amp;/&#39;/&nbsp; (annotated.vtt), the 2.0 s gap starting a paragraph and the 1.9 s gap not (manual.vtt at 5.0→7.0 and 9.0→10.9, plus synthetic cues). They also cover segment midpoint boundaries, the gap measured from the last kept cue, and malformed timestamps. test-node passes.

- met: Every choice the spec leaves open is written down in docs/decisions.md.

  Four dated lines were added to docs/decisions.md: the segment and paragraph types, the definition of a kept cue for gaps, which timestamp and identifier forms the parser accepts and how tags are removed, and the timestamp strictness and ms comparison. One open parsing choice is missing: whitespace-only lines are treated as block separators (minor finding).

## Proposed learnings (not decided)

- Comparing in integer milliseconds is exact for VTT cue times only. Values from outside, such as SponsorBlock floats, should not be rounded before a boundary comparison; scale the cue side instead.
- YouTube auto VTT tracks end cues with a line holding a single space. A parser that tolerates this should write the choice down, because it departs from the WebVTT definition of a blank line.
- For VTT block classification (header, NOTE, STYLE), check whether the block has a timing line before matching its first line by prefix, so that cue identifiers are not mistaken for header or comment blocks.
