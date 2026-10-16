"""Truncation (section 5.5) and pages (section 5.6)."""

MARKER = "[…]"


def _words(paragraph: str) -> int:
    return 0 if paragraph == MARKER else len(paragraph.split())


def truncate(paragraphs: list[str], max_words: int) -> tuple[list[str], bool]:
    """Keep the first and last `max_words // 2` words around a `[…]` paragraph."""
    if sum(_words(p) for p in paragraphs) <= max_words:
        return paragraphs, False
    half = max_words // 2
    head: list[str] = []
    left = half
    for paragraph in paragraphs:
        if left == 0:
            break
        words = paragraph.split()
        head.append(" ".join(words[:left]))
        left -= min(left, len(words))
    tail: list[str] = []
    left = half
    for paragraph in reversed(paragraphs):
        if left == 0:
            break
        words = paragraph.split()
        tail.append(" ".join(words[len(words) - min(left, len(words)) :]))
        left -= min(left, len(words))
    return [*head, MARKER, *reversed(tail)], True


def paginate(paragraphs: list[str], page_words: int) -> list[str]:
    """Group whole paragraphs into pages of at most `page_words` words; cut longer ones."""
    pages: list[list[str]] = []
    count = 0
    for paragraph in paragraphs:
        words = _words(paragraph)
        if pages and count + words <= page_words:
            pages[-1].append(paragraph)
            count += words
            continue
        if words <= page_words:
            pages.append([paragraph])
            count = words
            continue
        tokens = paragraph.split()
        for i in range(0, len(tokens), page_words):
            chunk = tokens[i : i + page_words]
            pages.append([" ".join(chunk)])
            count = len(chunk)
    return ["\n\n".join(page) for page in pages]


def word_count(pages: list[str]) -> int:
    return sum(_words(p) for page in pages for p in page.split("\n\n"))
