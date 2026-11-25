"""Highlights and their exports."""
from __future__ import annotations


def _book(library, sample_epub):
    from lnreader.epub import import_epub

    return import_epub(sample_epub, "sample.epub")["id"]


def test_saving_highlights_replaces_the_book_list(library, sample_epub):
    from lnreader.annotations import save_highlights

    book_id = _book(library, sample_epub)
    save_highlights({"book": book_id, "list": [
        {"id": "h1", "ch": 0, "start": 0, "end": 5, "quote": "Hello", "color": "blue"},
    ]})
    save_highlights({"book": book_id, "list": [
        {"id": "h2", "ch": 1, "start": 0, "end": 5, "quote": "World", "color": "green"},
    ]})
    from lnreader.config import STORE

    ids = [h["id"] for h in STORE.state["highlights"]]
    assert ids == ["h2"]


def test_exports_contain_the_highlight(library, sample_epub):
    from lnreader.annotations import save_highlights
    from lnreader.exports import export

    book_id = _book(library, sample_epub)
    save_highlights({"book": book_id, "list": [
        {"id": "h1", "ch": 0, "start": 0, "end": 5, "quote": "Hello", "color": "blue", "note": "nice"},
    ]})

    markdown, name = export([book_id], "md")
    assert name.endswith(".md")
    assert b"Hello" in markdown and b"nice" in markdown

    csv_data, _ = export([book_id], "csv")
    assert b"Hello" in csv_data and b"blue" in csv_data

    epub, epub_name = export([book_id], "epub")
    assert epub_name.endswith(".epub")
    assert epub.startswith(b"PK")
    assert b"Hello" in epub
