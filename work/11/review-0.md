# Review 0

- Reviewed commit: `6fb01746c959ac381f27183b080e06271bab566b`
- Reviewer model: claude-opus-5-5
- Verdict: **no-go** (the reviewer answered no-go)

## Findings

- **blocking** (`node/tests/test_cli.py:97`) Rules of 5.1 and 5.7 that no test checks: TRANSCRIPT_LANGS and the service.started version

  Spec section 6 says every rule of section 5 must be covered by a test that fails without it. Two rules in this change are not. (1) TRANSCRIPT_LANGS (5.1): cli.py:100 reads it, but no test sets it. If `env.get("TRANSCRIPT_LANGS", "fr,en")` were replaced by a hard-coded "fr,en", every test would still pass. (2) The `service.started` line must carry the package version (5.7). test_ok_with_sponsor_cuts only checks `started["event"]`. The log contract types `attrs` as a free dict, so dropping `attrs={"version": ...}` from cli.py:105 would also pass. Fix: add an end-to-end test that runs `notrackvi_1` with `TRANSCRIPT_LANGS=de` and expects `ok` with lang `de`, and assert `started["attrs"]["version"]` equals `importlib.metadata.version("yt-digest-node")`.

- **minor** (`node/tests/test_cli.py:51`) Fake-extractor fixtures are built in tmp_path, not kept under node/tests/fixtures/

  Spec section 6 says fixtures live under `node/tests/fixtures/`. The end-to-end fixtures (meta.json files and VTT tracks) are written into tmp_path at run time. test_extractors.py already does the same, so this is an existing pattern, but it still departs from the quality bar.

- **minor** (`node/src/yt_digest_node/cli.py:67`) Bad MAX_WORDS / PAGE_WORDS values crash the command

  `int(env.get("MAX_WORDS", ...))` and `int(env.get("PAGE_WORDS", ...))` raise a traceback (exit 1, no result) on a non-integer value. `PAGE_WORDS=0` makes `range(..., 0)` in paginate raise ValueError. A negative value gives odd results. The spec does not cover invalid configuration, but this behaviour is neither handled nor written down in docs/decisions.md.

- **minor** (`node/src/yt_digest_node/log.py:36`) Null attributes of fetch.transcript may vanish from the log line

  The decision says `fetch.transcript` logs `sponsor_ratio` null and `source` null. emit serialises with `model_dump_json(exclude_none=True)`, and depending on how pydantic applies that to the values of the `attrs` dict, these keys may be dropped instead of written as null. No test pins either behaviour: test_no_transcript and test_langs_option_and_sponsorblock_error never look at `attrs.source` or `attrs.sponsor_ratio`. Add an assertion so the documented behaviour is enforced.

- **minor** (`node/src/yt_digest_node/cli.py:98`) Undocumented handling of the language list

  The command strips spaces around languages, drops empty entries, and treats an empty `--langs ""` as absent, so it falls back to TRANSCRIPT_LANGS. These are choices the spec leaves open. None is recorded in docs/decisions.md and none is tested.

- **blocking** Definition of done not met: The change is covered by tests that fail without it.

  test_pages.py covers the ticket's unit criteria: 25 words with MAX_WORDS=10, PAGE_WORDS=5 grouping, a 12-word paragraph cut, and order preserved. test_cli.py runs the command as a subprocess and covers ok with sponsor cuts, no_transcript, unavailable, blocked, an invalid id (exit 2) and logs without transcript text. Not covered: TRANSCRIPT_LANGS (hard-coding the default still passes) and the service.started version attribute (removing it still passes).

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

  pages.py follows 5.5: it keeps the first and last MAX_WORDS//2 words, keeps the paragraph breaks inside them, inserts a `[…]` paragraph that counts as 0 words, and sets truncated. It follows 5.6: whole paragraphs are grouped, long ones are cut at word boundaries, and no page is empty. cli.py adds the `transcript` subcommand with --langs and --request-id. It reads the 5.1 variables, runs the pipeline, validates the result with TranscriptResult, prints it on stdout, logs service.started, sponsorblock.call and fetch.transcript on stderr, and exits 0, or 2 through argparse on an invalid id. The only addition is a `python -m` entry point, which is documented. The daemon, /health and the Worker are untouched.

- **not met**: The change is covered by tests that fail without it.

  test_pages.py covers the ticket's unit criteria: 25 words with MAX_WORDS=10, PAGE_WORDS=5 grouping, a 12-word paragraph cut, and order preserved. test_cli.py runs the command as a subprocess and covers ok with sponsor cuts, no_transcript, unavailable, blocked, an invalid id (exit 2) and logs without transcript text. Not covered: TRANSCRIPT_LANGS (hard-coding the default still passes) and the service.started version attribute (removing it still passes).

- met: Every choice the spec leaves open is written down in docs/decisions.md.

  Five dated lines were added. They cover the entry point and exit 2, where truncation cuts and the marker's weight in pages, how long paragraphs and their chunks are paginated, SponsorBlock being skipped when there is no track (sponsorblock=none), and the request_id and version on service.started. Smaller choices are not recorded: stripping and emptying languages, and invalid MAX_WORDS/PAGE_WORDS values (see the minor findings).

## Proposed learnings (not decided)

- For each configuration variable in spec 5.1, check that at least one test sets it to a non-default value; checking only the defaults does not catch hard-coded values.
- When the log contract types `attrs` as a free dict, the schema cannot catch a missing or renamed attribute, so tests must assert each attribute the spec requires (e.g. service.started version).
- emit uses exclude_none=True, so when a decision says an attribute is logged as null, a test should assert whether the key is present as null or absent.
