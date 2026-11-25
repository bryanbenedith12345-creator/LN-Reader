"""Indexing an EPUB: metadata, chapters and the chapter cache."""
from __future__ import annotations


def test_import_creates_a_book(library, sample_epub):
    from lnreader.epub import import_epub

    meta = import_epub(sample_epub, "sample.epub")
    assert meta["title"] == "Test Novel"
    assert meta["author"] == "A Writer"
    assert len(meta["chapters"]) == 2
    assert meta["chapters"][0]["title"] == "Chapter One"


def test_chapter_cache_holds_clean_html(library, sample_epub):
    from lnreader.epub import chapter_data, import_epub

    meta = import_epub(sample_epub, "sample.epub")
    data = chapter_data(meta["id"], 0)
    assert data is not None
    assert "The story begins here." in data["html"]
    assert "The story begins here." in data["text"]


def test_library_payload_uses_overrides(library, sample_epub):
    from lnreader.books import save_info
    from lnreader.epub import import_epub
    from lnreader.queries import library

    meta = import_epub(sample_epub, "sample.epub")
    save_info({"book": meta["id"], "title": "My Title", "tags": "fantasy, funny"})
    payload = library()
    book = next(b for b in payload["books"] if b["id"] == meta["id"])
    assert book["title"] == "My Title"
    assert book["epub_title"] == "Test Novel"
    assert book["tags"] == ["fantasy", "funny"]


def test_search_finds_text(library, sample_epub):
    from lnreader.epub import import_epub
    from lnreader.queries import search_book, search_library

    meta = import_epub(sample_epub, "sample.epub")
    assert search_book(meta["id"], "begins")["total"] == 1
    assert search_book(meta["id"], "nothing here")["total"] == 0
    assert len(search_library("begins")) == 1
