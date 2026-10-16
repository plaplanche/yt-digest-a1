# Review 1

- Reviewed commit: `2f0525b778c5211556ba22705798c7476780c600`
- Reviewer model: claude-opus-5-5
- Verdict: **no-go** (the reviewer answered no-go)

## Findings

- **blocking** (`node/src/yt_digest_node/sponsorblock.py:35`) Some 200 bodies raise an exception instead of returning `error`, and no `sponsorblock.call` line is logged

  `_parse` only catches ValueError, TypeError, KeyError and IndexError. A 200 body such as `[{"segment": [1000…0 (400 digits), 2]}]` parses as a Python int, and `float()` on it raises OverflowError. A deeply nested body such as `[[[[…` makes `json.loads` raise RecursionError. Neither exception is caught in `_parse` or in `fetch_segments`, so the exception escapes `fetch_segments` before `emit` runs. Spec 5.3 says anything other than a valid 200 or a 404 gives no segments and state `error`, that the result is otherwise produced normally, and that each call logs `sponsorblock.call`. docs/decisions.md line 16 also says a 200 whose body is not a list of `segment` pairs is an `error`. The body comes from a remote service, so it must not be able to crash the pipeline. Fix: also catch OverflowError and RecursionError (or any parse exception) in `_parse`, and add a test for each.

- **minor** (`node/src/yt_digest_node/sponsorblock.py:34`) Badly shaped segments are accepted

  `float(i["segment"][0])` accepts `{"segment": "12"}` (read as (1.0, 2.0)), `{"segment": ["1", "2"]}`, `[true, false]` and segments with more than two items. Decision line 16 says a body that is not a list of `segment` pairs is an `error`. Check that `segment` is a list of exactly two numbers that are not booleans.

- **minor** (`node/src/yt_digest_node/sponsorblock.py:57`) A malformed base URL raises an exception instead of returning `error`

  `urlopen` raises ValueError ("unknown url type") when `SPONSORBLOCK_URL` has no scheme. That error is not caught, so it propagates and nothing is logged. Spec 5.3 expects a failed call to give `error` while the result is still produced. This is a configuration error, but either catch it or reject the value explicitly when the configuration is read.

- **minor** (`node/src/yt_digest_node/sponsorblock.py:62`) HTTPError response is never closed

  The `HTTPError` caught for 404 or 500 holds the open response, and it is never closed. Close it with `error.close()` to avoid a ResourceWarning and a socket that stays open until garbage collection.

- **minor** (`node/src/yt_digest_node/sponsorblock.py:85`) The midpoint rule rounds SponsorBlock bounds to milliseconds

  SponsorBlock returns bounds with sub-millisecond precision, such as 12.3451. `in_segment` rounds them to whole milliseconds, so a cue whose midpoint is 12.345 counts as inside a segment that starts at 12.3451. That contradicts 'start inclusive' in spec 5.4 step 2. The behaviour comes from the existing vtt.py and is recorded in decisions.md line 15, so this is only a note. Comparing 2× the cue midpoint (in ms) with the unrounded bounds × 2000 would be exact.

- **minor** (`node/tests/test_sponsorblock.py:96`) Some error-path tests do not check the log line

  `test_200_with_unusable_segments_is_error` does not check the log line at all. The 404 and 500 tests do not check `event`. The ticket asks that each case give the right log line. Check `event`, `status` and `segments` everywhere.

- **minor** (`node/tests/test_sponsorblock.py:134`) Connection-refused test can be flaky

  The test binds a free port, closes it and then connects to it. Another process could take the port in between. The risk is low, but a port known to be closed, or a socket that refuses connections, would be deterministic.

- **blocking** Definition of done not met: The change does what the ticket and spec/lot-1.md say, and nothing more.

  The URL, categories, 10 s timeout, ok/none/error states, `sponsorblock.call` attrs, midpoint rule and ratio all match spec 5.3 and 5.4 step 2. The scope stays within the ticket: vtt.py now reuses the shared helper and does nothing new. However, some untrusted 200 bodies (a huge integer bound, deeply nested JSON) raise OverflowError or RecursionError out of `fetch_segments` without logging, which breaks 'Anything else … error … Each call logs `sponsorblock.call`' (sponsorblock.py:35).

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

  The URL, categories, 10 s timeout, ok/none/error states, `sponsorblock.call` attrs, midpoint rule and ratio all match spec 5.3 and 5.4 step 2. The scope stays within the ticket: vtt.py now reuses the shared helper and does nothing new. However, some untrusted 200 bodies (a huge integer bound, deeply nested JSON) raise OverflowError or RecursionError out of `fetch_segments` without logging, which breaks 'Anything else … error … Each call logs `sponsorblock.call`' (sponsorblock.py:35).

- met: The change is covered by tests that fail without it.

  node/tests/test_sponsorblock.py imports a new module and tests, against a local HTTPServer, the 200, 404, 500, connection-refused, invalid-body and truncated-body cases, the 10 s timeout, both midpoint edges, the union of overlapping segments, clipping past the end and rounding. Without the change, all of them fail on import. The existing test_vtt.py still covers the refactored vtt.py. test-node passes.

- met: Every choice the spec leaves open is written down in docs/decisions.md.

  Lines 16–19 of docs/decisions.md record the client signature and states, the invalid 200 body, logging at `info`, the ratio for a non-positive duration, network failure as status 0, redirects, non-finite or reversed segments, and the shared `to_ms` helper.

## Proposed learnings (not decided)

- When parsing a body from the network, catch every exception the parser can raise (OverflowError from float(int), RecursionError from json.loads), not just ValueError, TypeError, KeyError and IndexError, or route it all through one 'invalid body' path.
- A client whose spec says 'each call logs' should emit the log in a finally block or after a catch-all, so unexpected exceptions still produce the log line.
- urllib's HTTPError holds an open response; close it when you catch it.
