# Review 2

- Reviewed commit: `90748bc2562a2ce01deb9136747078dfc521295d`
- Reviewer model: claude-opus-5-5
- Verdict: **go**

## Findings

- **minor** (`node/src/yt_digest_node/extractors.py:112`) Auto-translated captions count as auto tracks in the requested language

  Real yt-dlp lists a machine translation in `automatic_captions` for almost every language. The code matches language keys exactly, so with the default `fr,en` order, an English video that only has ASR captions gets the French auto-translation ('fr') instead of the original English ASR. The spec's literal rule ('auto tracks in the order of the languages') allows this, and decisions.md touches on it ('instead of every auto-translation'). It doesn't state the outcome, though: translations win over the original language. Regional manual keys like `en-US` also never match `en`. This is worth an explicit decision line, or a later fix that prefers the `-orig` or original-language track.

- **minor** (`node/src/yt_digest_node/extractors.py:70`) parse_delay accepts invalid or negative ranges

  Values like `-1` or `abc` reach `float()` or `time.sleep` and raise an unhandled ValueError at request time, not at configuration time. The spec doesn't define this case and nothing documents or tests it. Low risk.

- **minor** (`node/src/yt_digest_node/extractors.py:15`) Error mapping goes beyond the spec's list and relies on substring heuristics

  The spec names private, age-restricted and removed (unavailable) and bot check (blocked). The change adds 'terminated', 'does not exist', 'video unavailable' (unavailable) and 429/403/'try again later' (blocked). 'video unavailable' is YouTube's catch-all message, and geo-blocked videos also produce it, so they would map to unavailable. Every extension is written down in decisions.md and tested, so this is acceptable. The yt-dlp path is still only checked against a stub.

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

  extractors.py contains the Extractor protocol returning `unavailable`/`blocked` or Extraction(duration, tracks); FakeExtractor reading `$FAKE_YTDLP_DIR/<id>/` (missing dir means unavailable, meta status returned as is, `<lang>.<manual|auto>.vtt` tracks); YtDlpExtractor with the 5.2 options, no cookies, a random `YT_DELAY_SECONDS` delay before each request and error mapping; choose_track tries manual then auto in language order and returns None for no_transcript. Truncation, pages and the command are left out, as the ticket says. The extras (`quiet`, extra error markers, the `langs` argument) fill gaps the spec leaves open and each one is documented.

- met: The change is covered by tests that fail without it.

  node/tests/test_extractors.py is new and imports the new module, so every test fails without it. It covers all acceptance criteria: missing dir gives unavailable; meta blocked gives blocked; fr.auto plus en.manual with fr,en chooses the English manual track; de.manual only gives None; stub tests check the options passed (and that no cookie options are set), private video maps to unavailable and the bot check maps to blocked. It also tests delay count and range, delay parsing and wiring, subtitle-download HTTP errors and unmapped errors. The CI checks test-node and lint pass.

- met: Every choice the spec leaves open is written down in docs/decisions.md.

  There are 11 new dated lines: the extractor signature with langs, yt-dlp as a dependency and how it is injected, when the delay applies, the error markers and their precedence, meta.json being required, ignored files, importlib loading, null duration becoming 0, which exception types are mapped, the quiet option, and choose_track returning None. The precedence of auto-translations over the original-language ASR is only implied (see minor finding).

## Proposed learnings (not decided)

- When a stub replaces yt-dlp, check the real yt-dlp data shapes too: `automatic_captions` holds auto-translations in about 100 languages plus `<lang>-orig` keys, and manual subtitle keys can be regional (`en-US`).
- yt-dlp networking errors (`HTTPError`, `RequestError`) derive from `yt_dlp.utils.YoutubeDLError`, not `OSError`, so one except clause on YoutubeDLError covers both metadata and subtitle-download failures.
- Mapping errors by substring is fragile. Pin the precedence with tests (e.g. the 'Video unavailable ... try again later' rate-limit message should map to blocked).
