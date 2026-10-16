# Review 2

- Reviewed commit: `992e781229eba1e3f1425349b1c338339ae94bf2`
- Reviewer model: claude-opus-5-5
- Verdict: **go**

## Findings

- **minor** (`node/src/yt_digest_node/sponsorblock.py:72`) The 10 s timeout applies to each socket operation, not to the whole call

  `urlopen(url, timeout=10)` sets a timeout on each blocking socket operation (connect, each recv). A server that sends a byte every few seconds, or a chain of redirects, can keep the call running well past 10 s. Spec 5.3 only says "timeout 10 s", and the per-operation reading is the simplest one. It is not recorded in docs/decisions.md, though, and the timeout test only checks that the argument is 10.

- **minor** (`node/src/yt_digest_node/vtt.py:5`) The VTT cleaner now imports the network client module

  `vtt.py` imports `in_segment` and `to_ms` from `sponsorblock.py`, so the pure parsing and cleaning module depends on a module that imports urllib and the logger. Reusing the code is fine. A small shared helper module, or keeping the pure functions apart from the HTTP client, would keep the layers separate. The removed comment explaining why integer milliseconds are used now lives only in the `in_segment` docstring, which is acceptable.

- **minor** (`docs/decisions.md:20`) The decision lines repeat each other

  Lines 16 and 20 both define what counts as a valid 200 body, and line 19 adds more rules about the same thing. The project rule asks for one dated line per choice. Merging them into one line per decision would make the log easier to read. All of the content is correct and matches the code.

- **minor** (`node/tests/test_sponsorblock.py:56`) The test does not check that the categories list is URL-encoded on the wire

  `parse_qs` decodes the query before the assertion, so the test would also pass if the raw `["sponsor",...]` were sent unencoded. The implementation uses `urlencode`, so it behaves correctly. An assertion on the raw `REQUESTS[0]` (for example that it contains `%5B%22sponsor%22`) would lock in the encoding spec 5.3 requires.

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

  `fetch_segments` calls `{base}/api/skipSegments?videoID=..&categories=["sponsor","selfpromo","interaction"]` (URL-encoded) with timeout=10. It maps 200 to ok, 404 to none, and anything else or a network error to error with status 0, and it logs `sponsorblock.call` with status/segments/duration_ms (spec 5.3 and the log table). `in_segment` applies the midpoint rule with start inclusive and end exclusive (5.4 step 2). `sponsor_ratio` unions the segments, clips them to [0, duration], rounds to 3 decimals and returns 0 without segments. There are no extractors, truncation, pages or command. The only extra work is moving the existing midpoint and ms helper out of vtt.py so it is shared; behaviour is unchanged.

- met: The change is covered by tests that fail without it.

  node/tests/test_sponsorblock.py imports the new module, so every test fails without it. It runs a local HTTPServer for 200 with segments (plus URL path and query checks), 404, 500 and invalid or truncated bodies, and uses a bound but non-listening socket for connection refused. Each test asserts state, segments and the log line. There are midpoint tests at both edges and ratio tests with overlap, a segment past the end and rounding. test-node passed. The existing VTT tests cover the vtt.py refactor.

- met: Every choice the spec leaves open is written down in docs/decisions.md.

  Five dated lines cover: the function signature and state values, invalid 200 bodies as error, the log level, `in_segment` placement, ratio 0 when duration <= 0, network failures as status 0, redirects, non-finite or inverted bounds, the shared `to_ms`, and a malformed base URL. The only small gap is that per-operation timeout semantics are not noted (minor finding).

## Proposed learnings (not decided)

- `urllib` timeout is per socket operation; when a spec says "timeout N s", record whether it is per operation or an overall deadline.
- When testing URL encoding, assert on the raw request path, because `parse_qs` decodes and hides missing encoding.
- Keep pure helpers (ms conversion, interval rules) out of modules that do network I/O so parsers do not depend on clients.
