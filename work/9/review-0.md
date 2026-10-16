# Review 0

- Reviewed commit: `fd6cb662c9d36633a77161f55262da90bd197334`
- Reviewer model: claude-opus-5-5
- Verdict: **no-go** (the reviewer answered no-go)

## Findings

- **blocking** (`docs/decisions.md:24`) decisions.md does not match the code, and some open choices are not written down

  Line 24 lists the 'unavailable' markers as "private video", "your age", "age-restricted", "removed", "unavailable", "terminated". But `_UNAVAILABLE_MARKERS` (extractors.py:16-25) also has "age restricted" and "does not exist". Some choices the spec leaves open are not recorded at all: (a) a missing or null yt-dlp `duration` silently becomes 0 (extractors.py:117, `float(info.get("duration") or 0)`); (b) failures while downloading a subtitle (`ydl.urlopen`, which raises yt-dlp networking errors, not `DownloadError`) are not mapped and escape as raw exceptions; (c) the extra `quiet: True` option. The project rule says every open choice gets a dated line, and the third definition-of-done item requires it.

- **minor** (`node/src/yt_digest_node/extractors.py:60`) Fake extractor crashes on a .vtt file with a single dot

  `lang, kind, _ = path.name.rsplit(".", 2)` raises ValueError for a name like `notes.vtt`, because rsplit returns only 2 parts. decisions.md:25 says files that are not `<lang>.<manual|auto>.vtt` are ignored. No test covers this; the test's `notes.txt` is skipped by the `*.vtt` glob, so it never reaches this line.

- **minor** (`node/src/yt_digest_node/extractors.py:22`) The 'unavailable' substring is too broad

  Plain substring matching on "unavailable" also catches transient failures. For example, `HTTP Error 503: Service Unavailable` would be reported as the video being `unavailable`. YouTube's rate-limit message ("Video unavailable. This content isn't available, try again later") is a block, but it would map to `unavailable` instead of `blocked`. Consider checking the bot or rate-limit markers first and tightening the generic marker.

- **minor** (`node/src/yt_digest_node/extractors.py:113`) Subtitle download errors are neither mapped nor tested

  Only `ytdlp.utils.DownloadError` is caught. An HTTP 429 or 403 from `ydl.urlopen` while fetching a track (a common bot-block symptom) escapes with an exception type the caller does not expect, and no stub test covers this path.

- **minor** (`node/tests/test_extractors.py:67`) `make_extractor` default path and `YT_DELAY_SECONDS` wiring are not tested

  No test checks that `make_extractor` passes `YT_DELAY_SECONDS` (or the `2-5` default) to `YtDlpExtractor`. The ticket also asks for a delay of 0 with the fake extractor, and no test asserts that either; today it holds only because `FakeExtractor` has no sleep at all.

- **blocking** Definition of done not met: Every choice the spec leaves open is written down in docs/decisions.md.

  Six lines were added (decisions.md:21-26), but line 24's marker list does not match the code: "age restricted" and "does not exist" are missing. Three choices are not recorded: the duration fallback to 0, how subtitle download errors are handled, and the extra `quiet` option.

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

  extractors.py covers everything in section 5.2. The extractor interface returns a Failure or an Extraction. FakeExtractor reads FAKE_YTDLP_DIR/<id>/meta.json and the track files. YtDlpExtractor passes the four required options without cookies, waits a random delay and maps errors. choose_track tries manual tracks in language order, then auto tracks. Truncation, pages and the command are not touched. Extras are small: `quiet: True` and fetching only the requested languages, the latter documented in decisions.md:21.

- met: The change is covered by tests that fail without it.

  test_extractors.py is new and imports the new module, so it fails without the change. It covers every acceptance case: a missing directory gives unavailable; meta status blocked gives blocked; with fr.auto and en.manual and languages fr,en the English manual track wins; only de.manual gives None (no_transcript); the stub checks the options and the absence of cookies; private video gives unavailable; the bot check gives blocked. Gaps: the single-dot .vtt file, subtitle download errors, and the make_extractor delay wiring.

- **not met**: Every choice the spec leaves open is written down in docs/decisions.md.

  Six lines were added (decisions.md:21-26), but line 24's marker list does not match the code: "age restricted" and "does not exist" are missing. Three choices are not recorded: the duration fallback to 0, how subtitle download errors are handled, and the extra `quiet` option.

## Proposed learnings (not decided)

- When decisions.md lists constants such as error markers, check the list against the code; it drifts easily.
- Parsing fixture file names with `rsplit` plus tuple unpacking crashes on names with fewer parts; guard the part count when the documented behaviour is to ignore such files.
- Mapping errors by substring needs the more specific markers (bot check, rate limit) checked before broad ones like 'unavailable', and transient HTTP errors kept apart from permanent ones.
- Wrapping a library with a stub only catches the one exception type the stub raises; secondary calls such as `urlopen` can raise other types.
