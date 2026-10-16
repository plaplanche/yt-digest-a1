# Review 1

- Reviewed commit: `06d4746b887f16c2d55fcf057776b504880f1b3c`
- Reviewer model: claude-opus-5-5
- Verdict: **go**

## Findings

- **minor** (`node/src/yt_digest_node/cli.py:69`) Unexpected extractor errors crash the command with exit 1 and no fetch.transcript line

  `make_extractor` raises ValueError when FAKE_YTDLP_DIR is missing, and `_map_error` raises RuntimeError for any unmapped yt-dlp error (for example HTTP 503). `run` does not catch either one. The command then exits 1 with a Python traceback on stderr: that is not a JSON log line, there is no `fetch.transcript` line (section 5.7 asks for one per command), and section 5 only names exit codes 0 and 2. The project accepted propagating the error in an earlier ticket, but how the command behaves on this path is neither tested nor written down in docs/decisions.md.

- **minor** (`node/src/yt_digest_node/pages.py:14`) MAX_WORDS=1 produces a page holding only the marker

  With MAX_WORDS=1, half is 0, so `truncate` returns only `[…]`. `paginate` then outputs `["[…]"]` with word_count 0 and truncated true. That page has no words, which goes against the spirit of section 5.6's 'No page is empty'. This edge case is not tested or documented.

- **minor** (`node/tests/test_cli.py:55`) The `yt-digest-node` console script is never exercised

  The end-to-end tests run `python -m yt_digest_node.cli`. Nothing runs the `[project.scripts]` entry point (`yt_digest_node.cli:entry`) that section 5 names (`uv run --project node yt-digest-node transcript ...`). A typo in pyproject.toml or in `entry` would not be caught.

- **minor** (`node/src/yt_digest_node/cli.py:103`) Usage errors write non-JSON text to stderr

  On exit 2, argparse prints its usage and error message to stderr as plain text. Section 4.2 says logs are one JSON object per line. Nothing sensitive leaks (only the bad argument), but the choice is not mentioned in decisions.md.

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

  pages.py implements 5.5: first and last MAX_WORDS//2 words, inner paragraph breaks kept, a `[…]` paragraph, and the marker is not counted as a word. It implements 5.6: whole paragraphs are grouped, an over-long paragraph is cut at word boundaries, pages are joined by `\n\n`, and word_count leaves out the marker. cli.py adds the `transcript` subcommand with --langs and --request-id, reads the 5.1 environment variables with their defaults, and runs the pipeline: extract, choose a track, SponsorBlock, clean, truncate, paginate. It validates the result against the TranscriptResult model, prints it to stdout, writes service.started then fetch.transcript to stderr, exits 0 on every status, and exits 2 on a bad argument or an invalid id without printing a result. Nothing from the daemon, /health or the Worker was added. The only gap is the unhandled-exception path (minor finding).

- met: The change is covered by tests that fail without it.

  test_pages.py covers the ticket's cases: MAX_WORDS=10 on 25 words gives 5+[…]+5, truncated, word_count 10; PAGE_WORDS=5 grouping; a 12-word paragraph is cut and word order is kept; the marker counts as 0 words; no paragraphs give no pages. test_cli.py runs the command as a subprocess with the fake extractor and a local HTTP SponsorBlock. It covers: ok with a sponsor cut (ratio 0.133, sponsor cue dropped), no_transcript, unavailable, blocked, invalid ids (exit 2, empty stdout), the SponsorBlock error path, MAX_WORDS/PAGE_WORDS/TRANSCRIPT_LANGS from the environment, and log lines that hold no transcript words. pages.py and cli.py are new modules, so all of these tests fail without the change. Ariane reports all four checks green.

- met: Every choice the spec leaves open is written down in docs/decisions.md.

  Eight dated lines were added. They cover: the entry point and how argparse gives exit 2; truncation at word level and how the marker is weighed and placed in pages; the page-splitting policy; SponsorBlock only being called when a track was chosen, with sponsorblock=none; request_id on service.started and the version source; fallback for invalid limits; parsing of the language list; null attrs in fetch.transcript. Two smaller choices are not written down: the behaviour on unexpected extractor exceptions and the plain-text argparse usage on stderr (both minor findings).

## Proposed learnings (not decided)

- When a lower layer is documented as propagating unexpected errors, check that the top-level command defines (and documents) its exit code and logging on that path.
- End-to-end tests that run `python -m pkg.module` do not prove the `[project.scripts]` entry point named by the spec works; run the installed script at least once.
- Check truncation and pagination at degenerate limits (MAX_WORDS=1, PAGE_WORDS=1) against the 'no empty page' rule.
