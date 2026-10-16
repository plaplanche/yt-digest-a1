2026-10-16 Python is pinned to 3.12 only (`>=3.12,<3.13`) and the node package is built with hatchling, the simplest build backend for a src layout.
2026-10-16 ESLint uses the flat config with `typescript-eslint` recommended rules; the worker is an ES module package and `tsc` only type-checks (`noEmit`).
2026-10-16 `lint` runs mypy from `node/` so it uses `node/pyproject.toml`; shellcheck runs on every `*.sh` under `scripts/`.
2026-10-16 `contracts` passes with a message while `scripts/contracts.sh` does not exist.
2026-10-16 Generators are dev tools pinned by lockfiles: `json-schema-to-typescript` (npm) and `datamodel-code-generator` (uv dev group); `ajv` (runtime dependency of the worker) and `pydantic` (runtime dependency of the node) validate at runtime.
2026-10-16 In the log schema the catalogue is a `$defs/LogEventName` enum, so it becomes the TS union `LogEventName` and the Python `StrEnum` `LogEventName`; `attrs` is a free object (per-event attrs are not validated in lot 1).
2026-10-16 Optional `request_id` and `video_id` are omitted from the log line when absent; `service` is fixed by each logger (`node`, `worker`) and `ts` is set by the logger.
2026-10-16 `contracts.sh` honours `CONTRACTS_ROOT` (default: the repository) so the staleness tests can run `--check` on a copy of the tree.
2026-10-16 The TS logger writes with `console.error` (standard error); `tsconfig` gains `resolveJsonModule` and `node` types for the schema import and the tests.
2026-10-16 Each check that needs the worker dependencies (`contracts`, `test-node`) runs `npm ci` itself; `ajv` is a `dependency` of the worker.
2026-10-16 The Python logger rejects `ts` and `service` overrides, unknown fields and null `request_id`/`video_id`, because the generated model accepts null where the schema does not.
2026-10-16 Segments are `(start, end)` tuples of seconds; paragraphs are returned as a list of strings (joining with `\n\n` is left to the caller).
2026-10-16 A "kept cue" (paragraph gap, step 5) is a cue that still has at least one line after steps 3 and 4; the gap is measured from the end of the last such cue.
2026-10-16 The VTT parser accepts `mm:ss.mmm` and `hh:mm:ss.mmm` timestamps, an optional cue identifier line, and skips blocks without a valid timing line; inline tags are removed with one `<...>` pattern, so voice tags lose only the tag, not the spoken text.
2026-10-16 Timestamps must be `mm:ss.mmm` or `hh:mm:ss.mmm` with two-digit minutes and minutes/seconds below 60 (stricter lines are skipped); paragraph gaps and segment bounds are compared in integer milliseconds to avoid float rounding.
2026-10-16 The SponsorBlock client is `fetch_segments(base_url, video_id, request_id=None)` returning segments and a state (`ok`, `none`, `error`); a 200 whose body is not a list of `segment` pairs is an `error`, and the call is logged at `info` whatever the state.
2026-10-16 The midpoint rule lives in `sponsorblock.in_segment` (reused by the VTT cleaner); `sponsor_ratio` is 0 when the duration is not positive.
2026-10-16 Any network failure (including `http.client.HTTPException` such as a truncated body, and a timeout while reading the body) is logged with status 0 and state `error`; redirects are followed by `urllib` and a redirect ending in 200 counts as `ok`.
2026-10-16 A 200 body with a non-finite segment bound or a segment with start > end is an invalid body (`error`); `to_ms` in `sponsorblock.py` is the single millisecond helper, shared with `vtt.py`.
2026-10-16 A 200 body is valid only if it is a JSON list of objects whose `segment` is a list of exactly two non-boolean numbers; any parse failure (including a huge integer or deeply nested JSON) is an `error`, and a base URL `urllib` rejects (`ValueError`) is a failed call with status 0.
2026-10-16 Extractors take `(video_id, langs)`; the fake one ignores `langs`, yt-dlp downloads only the tracks in the requested languages (exact language key) instead of every auto-translation.
2026-10-16 yt-dlp is a runtime dependency of the node; `YtDlpExtractor` receives the module as an argument (the stub in tests) and `make_extractor(env)` imports it only for the default extractor.
2026-10-16 The random delay (uniform in `YT_DELAY_SECONDS`, `a-b` or `a`) is applied before the metadata request and before each subtitle download; the fake extractor never waits.
2026-10-16 yt-dlp errors are mapped by message: "not a bot", "try again later", "http error 429" and "http error 403" give `blocked` (checked first); "private video", "your age", "age-restricted", "age restricted", "has been removed", "video unavailable", "terminated", "does not exist" give `unavailable` (so "HTTP Error 503: Service Unavailable" is unmapped); any other error propagates as `RuntimeError`.
2026-10-16 The fake extractor requires `meta.json` when the directory exists, and ignores files that are not `<lang>.<manual|auto>.vtt`.
2026-10-16 yt-dlp ships no type stubs, so `make_extractor` loads it with `importlib.import_module` instead of adding a stubs package.
2026-10-16 A missing or null yt-dlp `duration` becomes 0.
2026-10-16 Every `yt_dlp.utils.YoutubeDLError` (the base of `DownloadError` and of the networking errors such as `HTTPError`, which are not `OSError`) raised by the metadata request or a subtitle download is mapped with the same message rules.
2026-10-16 The yt-dlp options add `quiet: True` to the ones of section 5.2, to keep yt-dlp from writing on standard output.
2026-10-16 `choose_track` returns `None` when no track matches; turning `None` into the `no_transcript` status is left to the command.
2026-10-16 Besides the bot check, HTTP 429/403 and "try again later" are `blocked` (YouTube's usual way of refusing a client), as they are checked before the `unavailable` markers.
2026-10-16 The command is `yt_digest_node.cli:entry` (also runnable with `python -m yt_digest_node.cli`); argparse gives exit code 2 for a bad argument, and a video id is checked against the contract pattern.
2026-10-16 Truncation cuts at word level on paragraphs (a paragraph may be split between a kept half and the dropped middle); the `[…]` paragraph weighs 0 words in pages and is never cut, and a short page may start or end with it.
2026-10-16 A paragraph that does not fit the current page starts a new page; a paragraph longer than `PAGE_WORDS` is cut into chunks of `PAGE_WORDS` words, and the last chunk may take following paragraphs.
2026-10-16 SponsorBlock is only called when a track was chosen; otherwise `fetch.transcript` logs `sponsorblock` = `none` and `sponsor_ratio` null, and `source` is null when there is no source.
2026-10-16 `service.started` carries the `request_id` when given, and its `version` is read from the installed package metadata.
2026-10-16 A `MAX_WORDS` or `PAGE_WORDS` that is not a positive integer is ignored and the default is used.
2026-10-16 The language list is split on commas, spaces around each language are stripped and empty entries dropped; an empty `--langs` counts as absent and falls back to `TRANSCRIPT_LANGS` (default `fr,en`).
2026-10-16 In the `fetch.transcript` log line, `source` and `sponsor_ratio` are written as null (not omitted) when they have no value.
2026-10-16 A `$ref` to another schema file is generated as an import of that schema's type (TypeScript) or a module reference (Pydantic); the post-processing lives in `scripts/contracts.sh`.
2026-10-16 In `node-result-request`, `transcript` is `anyOf` the `$ref` and null, and the timestamp pattern of lot 1's log `ts` is reused for lot 2 timestamps.
