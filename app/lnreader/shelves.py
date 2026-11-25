"""Shelves: favorites plus named collections the reader creates."""
from __future__ import annotations

import re
import time

from .config import STORE

FAVORITES = "favorites"
MAX_NAME = 60
MAX_SHELVES = 40


def _clean(name: str) -> str:
    text = re.sub(r"\s+", " ", str(name or "")).strip()[:MAX_NAME]
    if not text:
        raise ValueError("a shelf needs a name")
    return text


def favorites() -> list[str]:
    return list(STORE.state.get("favorites", []))


def collections() -> list[dict]:
    return [dict(c) for c in STORE.state.get("collections", [])]


def collection_books() -> dict[str, list[str]]:
    return {key: list(val) for key, val in STORE.state.get("collection_books", {}).items()}


def shelf_books(shelf_id: str) -> list[str]:
    if shelf_id == FAVORITES:
        return favorites()
    return list(STORE.state.get("collection_books", {}).get(shelf_id, []))


def set_favorite(book_id: str, on: bool) -> dict:
    """Heart or un-heart one book."""
    if not book_id or book_id == "None":
        raise ValueError("missing book")
    with STORE.lock:
        favs = STORE.state.setdefault("favorites", [])
        if on and book_id not in favs:
            favs.append(book_id)
        elif not on and book_id in favs:
            favs.remove(book_id)
        result = list(favs)
    STORE.save()
    return {"favorites": result}


def create(name: str) -> dict:
    data = STORE.state
    with STORE.lock:
        shelves = data.setdefault("collections", [])
        if len(shelves) >= MAX_SHELVES:
            raise ValueError("too many shelves")
        clean = _clean(name)
        if any(c["name"].lower() == clean.lower() for c in shelves):
            raise ValueError("a shelf with that name already exists")
        used = {c["id"] for c in shelves}
        stamp = int(time.time() * 1000)
        while "s%d" % stamp in used:
            stamp += 1
        record = {"id": "s" + str(stamp), "name": clean, "created": int(time.time())}
        shelves.append(record)
        data.setdefault("collection_books", {})[record["id"]] = []
    STORE.save()
    return record


def rename(shelf_id: str, name: str) -> dict:
    with STORE.lock:
        shelves = STORE.state.get("collections", [])
        found = next((c for c in shelves if c["id"] == shelf_id), None)
        if not found:
            raise ValueError("no such shelf")
        clean = _clean(name)
        if any(c["name"].lower() == clean.lower() and c["id"] != shelf_id for c in shelves):
            raise ValueError("a shelf with that name already exists")
        found["name"] = clean
    STORE.save()
    return dict(found)


def delete(shelf_id: str) -> dict:
    with STORE.lock:
        shelves = STORE.state.get("collections", [])
        found = next((c for c in shelves if c["id"] == shelf_id), None)
        if not found:
            raise ValueError("no such shelf")
        shelves.remove(found)
        STORE.state.get("collection_books", {}).pop(shelf_id, None)
    STORE.save()
    return {"ok": True}


def add_books(shelf_id: str, book_ids: list[str]) -> dict:
    """Put books on a shelf; the same book is never added twice."""
    ids = [str(b) for b in (book_ids or []) if b]
    if not ids:
        return {"favorites": favorites()} if shelf_id == FAVORITES else {"books": shelf_books(shelf_id)}
    if shelf_id == FAVORITES:
        return set_favorite(ids[0], True) if len(ids) == 1 else _add_many_favorites(ids)
    with STORE.lock:
        if not any(c["id"] == shelf_id for c in STORE.state.get("collections", [])):
            raise ValueError("no such shelf")
        books = STORE.state.setdefault("collection_books", {}).setdefault(shelf_id, [])
        for book_id in ids:
            if book_id not in books:
                books.append(book_id)
        result = list(books)
    STORE.save()
    return {"books": result}


def _add_many_favorites(ids: list[str]) -> dict:
    with STORE.lock:
        favs = STORE.state.setdefault("favorites", [])
        for book_id in ids:
            if book_id not in favs:
                favs.append(book_id)
        result = list(favs)
    STORE.save()
    return {"favorites": result}


def remove_books(shelf_id: str, book_ids: list[str]) -> dict:
    ids = {str(b) for b in (book_ids or []) if b}
    if shelf_id == FAVORITES:
        with STORE.lock:
            favs = [b for b in STORE.state.get("favorites", []) if b not in ids]
            STORE.state["favorites"] = favs
        STORE.save()
        return {"favorites": favs}
    with STORE.lock:
        if shelf_id not in STORE.state.get("collection_books", {}):
            raise ValueError("no such shelf")
        books = [b for b in STORE.state["collection_books"][shelf_id] if b not in ids]
        STORE.state["collection_books"][shelf_id] = books
    STORE.save()
    return {"books": books}


def prune_book(book_id: str) -> None:
    """Forget a book everywhere after it is removed from the library."""
    with STORE.lock:
        state = STORE.state
        state["favorites"] = [b for b in state.get("favorites", []) if b != book_id]
        for shelf in state.get("collection_books", {}).values():
            if book_id in shelf:
                shelf.remove(book_id)
    STORE.save()


def prune_missing(known_ids: set[str]) -> None:
    """Drop shelf entries whose book file is no longer in the library."""
    with STORE.lock:
        state = STORE.state
        state["favorites"] = [b for b in state.get("favorites", []) if b in known_ids]
        for shelf_id, books in list(state.get("collection_books", {}).items()):
            state["collection_books"][shelf_id] = [b for b in books if b in known_ids]
    STORE.save()
