# Review 0

- Reviewed commit: `68344401357d3b4718580dd83f8dcaaad3097e97`
- Reviewer model: claude-opus-5-5
- Verdict: **no-go** (the reviewer answered no-go)

## Findings

- **blocking** (`node/src/yt_digest_node/vtt.py:85`) Paragraph gap is compared in floating-point seconds, so some exact 2.000 s gaps do not start a paragraph

  `_seconds` turns timestamps into floats (`int(seconds) + int(millis) / 1000`). `clean_paragraphs` then checks `cue.start - previous_end >= PARAGRAPH_GAP`. With a previous cue ending at 00:00:01.300 and the next starting at 00:00:03.300, the gap is exactly 2.000 s. But 3.3 - 1.3 evaluates to 1.9999999999999998 in IEEE doubles, so no new paragraph starts. That breaks spec 5.4 step 5 ('at least 2.0 s') on the boundary the ticket names explicitly. The test passes only because it uses 1 and 3.0, which subtract exactly. The step 2 midpoint comparison against segment bounds has the same kind of fragility at its edges. Fix: keep times in integer milliseconds, or compare rounded milliseconds (e.g. `round((start - end) * 1000) >= 2000`). Add a test with non-integer timestamps such as 1.3/3.3 that is parsed from VTT text.

- **minor** (`node/tests/test_vtt.py:43`) The 1.9 s gap is tested only on synthetic cues, not on a fixture

  The acceptance criteria ask for each rule to be shown 'on the fixtures'. The 2.0 s gap does appear in manual.vtt (5.0 → 7.0). No fixture has a 1.9 s gap; it is checked only with hand-built `Cue` objects whose float values happen to be exact. Adding a 1.9 s gap to a fixture would also exercise the parser's timestamp conversion.

- **minor** (`node/src/yt_digest_node/vtt.py:10`) Timestamp pattern is laxer than VTT

  The pattern accepts one-digit minutes (`\d{1,2}`), and the minutes and seconds fields are not range-checked (e.g. 00:75.000 is accepted). docs/decisions.md records this leniency only partly. It does no harm for YouTube tracks, but the decision line should state it or the pattern should be tightened.

- **blocking** Definition of done not met: The change does what the ticket and spec/lot-1.md say, and nothing more.

  Scope is correct: there is a parser, a clean_paragraphs function with a segments input (step 2 by midpoint, start inclusive, end exclusive), the three fixtures and the tests, with no SponsorBlock/extractor/truncation work. However, step 5 ('at least 2.0 s') is wrong for exact 2.000 s gaps whose float subtraction rounds down, e.g. 1.300 → 3.300 (vtt.py:85).

## Definition of done

- met: check lint passes

  Replayed by Ariane: exit 0.

- met: check contracts passes

  Replayed by Ariane: exit 0.

- met: check test-node passes

  Replayed by Ariane: exit 0.

- met: check test-worker passes

  Replayed by Ariane: exit 0.

- **not met**: The change does what the ticket and spec/lot-1.md say, and nothing more.

  Scope is correct: there is a parser, a clean_paragraphs function with a segments input (step 2 by midpoint, start inclusive, end exclusive), the three fixtures and the tests, with no SponsorBlock/extractor/truncation work. However, step 5 ('at least 2.0 s') is wrong for exact 2.000 s gaps whose float subtraction rounds down, e.g. 1.300 → 3.300 (vtt.py:85).

- met: The change is covered by tests that fail without it.

  node/tests/test_vtt.py imports the new module yt_digest_node.vtt, so every test fails without the change. The tests cover header/NOTE/STYLE/REGION/settings, inline tags, entities, [Musique]/[Applause], rolling duplicates, 2.0 vs 1.9 s gaps and segment midpoints. The float boundary case is not covered.

- met: Every choice the spec leaves open is written down in docs/decisions.md.

  Three dated lines record the segment and return types, the meaning of 'kept cue' and where the gap is measured from, and the parser leniency (mm:ss, cue identifiers, invalid blocks skipped, one tag pattern). The numeric representation of time is not recorded as a decision, but that belongs to the blocking bug rather than to an open choice.

## Proposed learnings (not decided)

- Compare VTT/subtitle times in integer milliseconds: float subtraction of millisecond timestamps (e.g. 3.3 - 1.3 = 1.9999999999999998) breaks 'at least N s' thresholds.
- Boundary tests should use values parsed from text, with non-integer timestamps, not only integer-friendly literals that subtract exactly.
