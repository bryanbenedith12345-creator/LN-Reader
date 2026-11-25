"""Feature coverage: search, per-book settings, deletes and exports."""
from __future__ import annotations

import json
import os
import threading
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer


def _book(library, sample_epub):
    from lnreader.epub import import_epub

    return import_epub(sample_epub, "sample.epub")["id"]


def test_search_across_the_library(library, sample_epub):
    from lnreader.queries import search_library

    book_id = _book(library, sample_epub)
    hits = search_library("begins")
    assert len(hits) == 1
    assert hits[0]["book"] == book_id
    assert search_library("x") == []


def test_per_book_settings_round_trip(library, sample_epub):
    from lnreader.books import effective_settings, get_settings, save_settings

    book_id = _book(library, sample_epub)
    save_settings({"book": book_id, "settings": {"size": 24, "font": "sans"}})
    assert get_settings(book_id)["size"] == 24
    assert effective_settings(book_id)["size"] == 24
    assert effective_settings(book_id)["width"] == library.STORE.state["settings"]["width"]
    save_settings({"book": book_id, "settings": None})
    assert get_settings(book_id) == {}
    assert effective_settings(book_id)["size"] == library.DEFAULT_SETTINGS["size"]


def test_saving_book_info_ignores_unknown_fields(library, sample_epub):
    from lnreader.books import get_info, save_info

    book_id = _book(library, sample_epub)
    save_info({"book": book_id, "title": "  Mine  ", "bogus": "x", "tags": "a, a, b"})
    info = get_info(book_id)
    assert info["title"] == "Mine"
    assert "bogus" not in info
    assert info["tags"] == ["a", "b"]


def test_deleting_a_book_clears_its_annotations(library, sample_epub):
    from lnreader.actions import delete_book
    from lnreader.annotations import save_highlights
    from lnreader.shelves import add_books, create, set_favorite

    book_id = _book(library, sample_epub)
    save_highlights({"book": book_id, "list": [
        {"id": "h1", "ch": 0, "start": 0, "end": 3, "quote": "abc"}]})
    set_favorite(book_id, True)
    shelf = create("Keepers")
    add_books(shelf["id"], [book_id])
    delete_book({"book": book_id})
    state = library.STORE.state
    assert state["highlights"] == []
    assert state["favorites"] == []
    assert state["collection_books"][shelf["id"]] == []
    assert book_id not in state["books"]


def test_export_can_be_saved_without_a_dialog(library, sample_epub, monkeypatch):
    from lnreader.annotations import save_highlights
    from lnreader.exports import save_export

    monkeypatch.setenv("LN_NO_DIALOG", "1")
    book_id = _book(library, sample_epub)
    save_highlights({"book": book_id, "list": [
        {"id": "h1", "ch": 0, "start": 0, "end": 3, "quote": "abc", "note": "n"}]})
    result = save_export([book_id], "md")
    assert result["saved"] is True
    assert os.path.exists(result["path"])
    with open(result["path"], encoding="utf-8") as handle:
        assert "abc" in handle.read()


def test_api_rejects_unauthenticated_posts(library):
    import pytest

    from lnreader.web import App

    httpd = ThreadingHTTPServer(("127.0.0.1", 0), App)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{httpd.server_address[1]}"
    try:
        request = urllib.request.Request(
            base + "/api/settings", data=json.dumps({"size": 3}).encode(),
            headers={"Content-Type": "application/json"}, method="POST")
        with pytest.raises(urllib.error.HTTPError) as info:
            urllib.request.urlopen(request, timeout=5)
        assert info.value.code == 401
    finally:
        httpd.shutdown()

