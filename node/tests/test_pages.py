from yt_digest_node.pages import MARKER, paginate, truncate, word_count


def words(n: int, start: int = 0) -> str:
    return " ".join(f"w{i}" for i in range(start, start + n))


def test_under_the_limit_is_untouched() -> None:
    assert truncate([words(10)], 10) == ([words(10)], False)


def test_truncation_keeps_first_and_last_half() -> None:
    paragraphs, cut = truncate([words(25)], 10)
    assert cut
    assert paragraphs == [words(5), MARKER, words(5, 20)]
    assert word_count(paginate(paragraphs, 100)) == 10


def test_truncation_keeps_inner_paragraph_breaks() -> None:
    paragraphs, _ = truncate([words(3), words(10, 3), words(12, 13)], 10)
    assert paragraphs == [words(3), words(2, 3), MARKER, words(5, 20)]


def test_truncation_splits_one_paragraph_across_halves() -> None:
    paragraphs, _ = truncate([words(8), words(4, 8), words(8, 12)], 10)
    assert paragraphs == [words(5), MARKER, words(5, 15)]


def test_pages_group_paragraphs_within_limit() -> None:
    pages = paginate([words(3), words(2, 3), words(4, 5), words(1, 9)], 5)
    assert pages == [f"{words(3)}\n\n{words(2, 3)}", f"{words(4, 5)}\n\n{words(1, 9)}"]


def test_long_paragraph_is_cut_and_order_kept() -> None:
    paragraphs = [words(2), words(12, 2), words(3, 14)]
    pages = paginate(paragraphs, 5)
    assert all(0 < len(p.split()) <= 5 for p in pages)
    assert " ".join(pages).split() == words(17).split()
    assert len(pages) == 4


def test_marker_is_not_a_word() -> None:
    pages = paginate([words(5), MARKER, words(5, 5)], 5)
    assert word_count(pages) == 10
    assert all(page for page in pages)


def test_no_paragraph_gives_no_page() -> None:
    assert paginate([], 5) == []
