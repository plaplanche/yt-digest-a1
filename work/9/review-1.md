# Review 1

- Reviewed commit: `a05aa0fe55e60fd91a5b7dca7a9f075af7829285`
- Reviewer model: claude-opus-5-5
- Verdict: **no-go** (the reviewer answered no-go)

## Findings

- **blocking** (`node/src/yt_digest_node/extractors.py:116`) Real yt-dlp errors from subtitle downloads are not caught; the OSError assumption is likely wrong

  The subtitle download only catches `(OSError, self.ytdlp.utils.DownloadError)`, and docs/decisions.md says this is because "yt-dlp networking errors derive from OSError". In current yt-dlp, `YoutubeDL.urlopen` raises `yt_dlp.networking.exceptions.RequestError` subclasses (`HTTPError`, `TransportError`, `IncompleteRead`, ...). These derive from `yt_dlp.utils.YoutubeDLError`, which derives from `Exception`, so they are neither `OSError` nor `DownloadError`. A real HTTP 429 or 403 on a timedtext URL is the most common way YouTube blocks subtitle downloads. With this code it would escape `extract` as a raw yt-dlp exception: it would not be mapped to `blocked`, and it would not even become the documented `RuntimeError`. The test `test_ytdlp_subtitle_download_error_is_mapped` stubs `urlopen` to raise `OSError`, so it only checks the author's assumption, not the library's behaviour. I could not open the installed yt-dlp from the review worktree because there is no venv there, so the class hierarchy is from my knowledge of yt-dlp ≥2023.x. Fix: catch `self.ytdlp.utils.YoutubeDLError` (the common base of `DownloadError` and the networking errors), or `self.ytdlp.networking.exceptions.RequestError`. Also make the stub raise an error with that hierarchy, and correct the decision line.

- **minor** (`node/tests/test_extractors.py:85`) A test imports the real yt-dlp module

  `test_make_extractor_delay_wiring` calls `make_extractor({})`, which runs `importlib.import_module("yt_dlp")` on the real library. Spec 5.2 says the yt-dlp extractor "is never called by tests; unit tests replace yt-dlp with a stub". Nothing makes a network call, but this ties the unit tests to the real dependency. It would be cleaner to inject or monkeypatch the import.

- **minor** (`node/src/yt_digest_node/extractors.py:141`) choose_track returns None, not `no_transcript`

  The ticket says "none gives `no_transcript`". The function returns `None` and the tests check for `None`. Mapping `None` to the `no_transcript` status presumably belongs to the command, which is out of scope. That choice is not written in docs/decisions.md.

- **minor** (`docs/decisions.md:24`) `blocked` is mapped more broadly than the spec

  Spec 5.2 maps only the bot check to `blocked`. The change also treats "try again later", HTTP 429 and HTTP 403 as `blocked`, and checks them before the `unavailable` markers. So "Video unavailable ... try again later" gives `blocked`. This is documented, but it is an interpretation beyond the spec, and the broad `removed` marker could match unrelated messages.

- **blocking** Definition of done not met: The change does what the ticket and spec/lot-1.md say, and nothing more.

  The fake extractor, the options, the delay and choose_track follow section 5.2. But real yt-dlp networking errors (RequestError/HTTPError, not OSError) during a subtitle download are not mapped to `blocked`/`unavailable` and escape as raw exceptions (extractors.py:116). `blocked` also covers more than the spec's bot check (429/403/"try again later"); this is documented.

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

  The fake extractor, the options, the delay and choose_track follow section 5.2. But real yt-dlp networking errors (RequestError/HTTPError, not OSError) during a subtitle download are not mapped to `blocked`/`unavailable` and escape as raw exceptions (extractors.py:116). `blocked` also covers more than the spec's bot check (429/403/"try again later"); this is documented.

- met: The change is covered by tests that fail without it.

  node/tests/test_extractors.py covers every acceptance case: missing directory → unavailable, meta blocked, fr.auto plus en.manual → en manual, de only → None, options passed, private → unavailable, bot → blocked. The tests import the new module, so they fail without the change. The subtitle-error test, however, stubs an `OSError` that the real yt-dlp does not raise.

- met: Every choice the spec leaves open is written down in docs/decisions.md.

  Nine dated lines cover the signature, the dependency, the delay placement, the error markers, the meta.json requirement, the importlib load, duration 0, the subtitle errors and `quiet`. One line (yt-dlp networking errors derive from OSError) appears to be factually wrong. That `choose_track` returns None instead of `no_transcript` is not recorded.

## Proposed learnings (not decided)

- When a stub replaces a third-party library, check that the exception types it raises match the real library's class hierarchy; otherwise the tests only confirm the author's assumption.
- For yt-dlp, catch `yt_dlp.utils.YoutubeDLError`, the common base of DownloadError and the networking RequestError, rather than OSError.
- Tests that build the default extractor should inject or monkeypatch the yt-dlp import, so that tests never touch the real library, as spec 5.2 requires.
