# Review 0

- Reviewed commit: `15b685e2cd5c511291218cd2b20928c888ba6dcd`
- Reviewer model: claude-opus-5-5
- Verdict: **no-go** (the reviewer answered no-go)

## Findings

- **blocking** (`node/src/yt_digest_node/sponsorblock.py:60`) Some network failures escape fetch_segments, so it raises and skips its log line

  The handler only catches `urllib.error.HTTPError`, `URLError` and `OSError`. `http.client.HTTPException` subclasses do not inherit from either: `IncompleteRead` (connection dropped partway through the body, raised by `response.read()`), `BadStatusLine` (a garbage status line other than `RemoteDisconnected`) and `LineTooLong`. When one of these happens, the exception reaches the caller and `sponsorblock.call` is never logged. Section 5.3 says a network error gives no segments, state `error`, "the result is otherwise produced normally", and "Each call logs `sponsorblock.call`". Fix: also catch `http.client.HTTPException` (log status 0, or the status already received, and write that choice down). Add a test where the local server sends a Content-Length larger than the body it writes and then closes the connection.

- **minor** (`node/src/yt_digest_node/sponsorblock.py:54`) Status logged for a body-read failure after a 200 is not specified or documented

  `status` is set to 200 before `response.read()`. If the read then times out (`TimeoutError`, an `OSError`), the line logs status 200 with state `error`. The spec says status is "HTTP status, or 0 on a network error". Either reset it to 0 in the `OSError` branch or record the choice in docs/decisions.md.

- **minor** (`node/src/yt_digest_node/sponsorblock.py:52`) Redirects are followed silently; not covered by any decision

  `urlopen` follows 3xx responses, so a redirect that ends in a 200 is treated as `ok`. Section 5.3 says "Anything else" (anything other than 200 or 404) is `error`. Following redirects may be the simplest reasonable behaviour, but it is a choice the spec leaves open and it is not in docs/decisions.md.

- **minor** (`node/src/yt_digest_node/sponsorblock.py:34`) Non-finite and reversed segments are accepted from the 200 body

  `json.loads` accepts `NaN`/`Infinity`, and segments with start > end pass `_parse`. `sponsor_ratio` happens to ignore reversed segments. A NaN, however, breaks `sorted` ordering and the comparisons in `in_segment`. Rejecting these as an invalid body (`error`), or documenting the behaviour, would make it explicit.

- **minor** (`node/src/yt_digest_node/sponsorblock.py:26`) `_ms` is duplicated between sponsorblock.py and vtt.py

  vtt.py keeps its own identical `_ms` for the paragraph gap, while sponsorblock.py defines another one. Sharing a single helper would avoid the two drifting apart.

- **minor** (`node/tests/test_sponsorblock.py:88`) Connection-refused test relies on a freed port staying free; timeout not asserted

  The test binds a port, closes it and reuses the number. In theory another process could grab it in between (low risk). Nothing checks that the 10 s timeout is actually passed to `urlopen`. Monkeypatching `urlopen` or using a server that never replies would cover that.

- **blocking** Definition of done not met: The change does what the ticket and spec/lot-1.md say, and nothing more.

  The URL, categories encoding, 200/404/other mapping, midpoint rule and union/clip/round ratio all match section 5.3 and step 2 of section 5.4. However, network failures of type http.client.HTTPException (for example IncompleteRead) escape fetch_segments without the error state or the sponsorblock.call log, which goes against "a network error: … result is otherwise produced normally" and "Each call logs sponsorblock.call". The vtt.py refactor to reuse in_segment is in scope (step 2) and recorded in decisions.md.

- **blocking** Definition of done not met: Every choice the spec leaves open is written down in docs/decisions.md.

  Two lines were added: the function signature, an invalid 200 body counting as error, info log level, in_segment being reused, and a zero ratio for a non-positive duration. Not recorded: following redirects (3xx → possibly ok), the status logged when the body read fails after a 200, and how non-finite or reversed segments are handled.

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

  The URL, categories encoding, 200/404/other mapping, midpoint rule and union/clip/round ratio all match section 5.3 and step 2 of section 5.4. However, network failures of type http.client.HTTPException (for example IncompleteRead) escape fetch_segments without the error state or the sponsorblock.call log, which goes against "a network error: … result is otherwise produced normally" and "Each call logs sponsorblock.call". The vtt.py refactor to reuse in_segment is in scope (step 2) and recorded in decisions.md.

- met: The change is covered by tests that fail without it.

  node/tests/test_sponsorblock.py is new and imports the new module, so every test fails without the change. A local HTTPServer covers 200 (checking segments, request path/query and the log line), 404, 500, an invalid 200 body and connection refused. The midpoint tests cover both edges, and the ratio tests cover overlap, a segment past the end and rounding. test-node passes. There is no test for a dropped connection or for the timeout.

- **not met**: Every choice the spec leaves open is written down in docs/decisions.md.

  Two lines were added: the function signature, an invalid 200 body counting as error, info log level, in_segment being reused, and a zero ratio for a non-positive duration. Not recorded: following redirects (3xx → possibly ok), the status logged when the body read fails after a 200, and how non-finite or reversed segments are handled.

## Proposed learnings (not decided)

- urllib's handlers for URLError/OSError do not cover http.client.HTTPException (IncompleteRead, BadStatusLine): an HTTP client that must never raise has to catch it as well.
- For HTTP clients, test a dropped connection (Content-Length larger than the body sent) alongside connection refused, not only status codes.
- urlopen follows redirects by default; when a spec maps "anything other than 200/404" to error, record redirect handling in decisions.md.
