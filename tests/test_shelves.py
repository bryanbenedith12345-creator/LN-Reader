"""Favourites, named shelves and batch membership."""
from __future__ import annotations

import pytest


def _book(library, sample_epub, name="sample.epub"):
    from lnreader.epub import import_epub

    return import_epub(sample_epub, name)["id"]


def _another_book(library, title):
    from lnreader.epub import import_epub
    from make_epub import build_epub

    return import_epub(build_epub(title=title), title + ".epub")["id"]


def test_favourites_toggle_and_dedupe(library, sample_epub):
    from lnreader.shelves import favorites, set_favorite

    book_id = _book(library, sample_epub)
    set_favorite(book_id, True)
    set_favorite(book_id, True)
    assert favorites() == [book_id]
    set_favorite(book_id, False)
    assert favorites() == []


def test_shelf_names_are_required_and_unique(library):
    from lnreader.shelves import create, rename

    shelf = create("  Fantasy   and  more ")
    assert shelf["name"] == "Fantasy and more"
    with pytest.raises(ValueError):
        create("   ")
    with pytest.raises(ValueError):
        create("fantasy AND more")
    renamed = rename(shelf["id"], "Space opera")
    assert renamed["name"] == "Space opera"
    rename(shelf["id"], "Space opera")
    assert library.STORE.state["collections"][0]["name"] == "Space opera"


def test_adding_and_removing_books_in_batches(library, sample_epub):
    from lnreader.shelves import add_books, collection_books, create, remove_books, shelf_books

    first = _book(library, sample_epub, "one.epub")
    second = _another_book(library, "Second Novel")
    shelf = create("Shelf")
    add_books(shelf["id"], [first, second, first])
    assert shelf_books(shelf["id"]) == [first, second]
    remove_books(shelf["id"], [first])
    assert shelf_books(shelf["id"]) == [second]
    assert collection_books()[shelf["id"]] == [second]
    add_books(shelf["id"], [])
    assert shelf_books(shelf["id"]) == [second]


def test_unknown_shelves_are_rejected(library, sample_epub):
    from lnreader.shelves import add_books, delete, rename, remove_books, shelf_books

    book_id = _book(library, sample_epub)
    for call in (lambda: add_books("nope", [book_id]), lambda: remove_books("nope", [book_id]),
                 lambda: rename("nope", "x"), lambda: delete("nope")):
        with pytest.raises(ValueError):
            call()
    assert shelf_books("nope") == []


def test_deleting_a_shelf_keeps_the_books(library, sample_epub):
    from lnreader.shelves import add_books, create, delete, shelf_books

    book_id = _book(library, sample_epub)
    shelf = create("Temporary")
    add_books(shelf["id"], [book_id])
    delete(shelf["id"])
    assert library.STORE.state["collections"] == []
    assert shelf["id"] not in library.STORE.state["collection_books"]
    assert book_id in library.STORE.state["books"]


def test_library_payload_carries_the_shelves(library, sample_epub):
    from lnreader.queries import library as build_library
    from lnreader.shelves import add_books, create, set_favorite

    book_id = _book(library, sample_epub)
    set_favorite(book_id, True)
    shelf = create("Reading next")
    add_books(shelf["id"], [book_id])
    payload = build_library()
    assert payload["favorites"] == [book_id]
    assert [c["name"] for c in payload["collections"]] == ["Reading next"]
    assert payload["collection_books"][shelf["id"]] == [book_id]
    assert "bookmarks" not in payload


def test_backup_round_trip_keeps_shelves(library, sample_epub):
    from lnreader.backup import make_backup, restore_backup
    from lnreader.shelves import add_books, create, favorites, set_favorite, shelf_books

    book_id = _book(library, sample_epub)
    set_favorite(book_id, True)
    shelf = create("Favorites of mine")
    add_books(shelf["id"], [book_id])
    archive = make_backup().read_bytes()

    library.STORE.state["favorites"] = []
    library.STORE.state["collections"] = []
    library.STORE.state["collection_books"] = {}
    restore_backup(archive)

    assert favorites() == [book_id]
    restored = library.STORE.state["collections"]
    assert [c["name"] for c in restored] == ["Favorites of mine"]
    assert shelf_books(restored[0]["id"]) == [book_id]


def test_prune_missing_drops_books_that_left_the_library(library, sample_epub):
    from lnreader.shelves import add_books, create, favorites, prune_missing, set_favorite

    book_id = _book(library, sample_epub)
    set_favorite(book_id, True)
    shelf = create("Shelf")
    add_books(shelf["id"], [book_id])
    prune_missing(set())
    assert favorites() == []
    assert library.STORE.state["collection_books"][shelf["id"]] == []


def test_shelf_ids_are_unique_in_the_same_millisecond(library):
    from lnreader.shelves import create

    first = create("One")
    second = create("Two")
    assert first["id"] != second["id"]
