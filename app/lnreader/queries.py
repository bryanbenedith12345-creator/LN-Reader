"""Library, book detail, shelves and full-text search payloads."""
from __future__ import annotations

from .books import get_info, get_settings
from .config import STORE
from .epub import chapter_data, load_meta
from .shelves import collection_books, collections, favorites


def book_record(book_id: str) -> dict | None:
    """One shelf entry: EPUB metadata with the reader's overrides applied."""
    meta = load_meta(book_id)
    if not meta:
        return None
    info = get_info(book_id)
    record = STORE.state["books"].get(book_id, {})
    return {
        "id": book_id,
        "title": info.get("title") or meta["title"],
        "epub_title": meta["title"],
        "author": info.get("author") or meta["author"],
        "series": info.get("series", ""),
        "tags": info.get("tags", []),
        "chapters": len(meta["chapters"]),
        "words": meta["words"],
        "cover": bool(meta.get("cover")),
        "added": record.get("added", 0),
        "progress": STORE.state["progress"].get(book_id, {}),
        "settings": get_settings(book_id),
    }


def library() -> dict:
    state = STORE.state
    books = []
    for book_id in list(state["books"]):
        record = book_record(book_id)
        if record:
            books.append(record)
    books.sort(key=lambda b: -((b["progress"] or {}).get("updated") or b["added"]))
    highlights = state["highlights"]
    return {
        "books": books,
        "settings": state["settings"],
        "highlights": highlights,
        "favorites": favorites(),
        "collections": collections(),
        "collection_books": collection_books(),
        "stats": {
            "books": len(books),
            "highlights": len(highlights),
            "words": sum(b["words"] for b in books),
            "read": sum(len(p.get("read", [])) for p in state["progress"].values()),
        },
    }


def book_detail(book_id: str) -> dict | None:
    meta = load_meta(book_id)
    if not meta:
        return None
    state = STORE.state
    return {
        "meta": meta,
        "info": get_info(book_id),
        "progress": state["progress"].get(book_id, {}),
        "highlights": [h for h in state["highlights"] if h.get("book") == book_id],
        "settings": get_settings(book_id),
    }


def search_book(book_id: str, query: str) -> dict:
    meta = load_meta(book_id)
    if not meta or len(query.strip()) < 2:
        return {"hits": [], "total": 0}
    needle = query.lower()
    hits = []
    total = 0
    for idx, chapter in enumerate(meta["chapters"]):
        data = chapter_data(book_id, idx)
        text = (data or {}).get("text", "")
        low = text.lower()
        pos = low.find(needle)
        if pos < 0:
            continue
        total += 1
        start = max(0, pos - 70)
        snippet = text[start:pos + len(needle) + 110].replace("\n", " ")
        hits.append({
            "chapter": idx,
            "title": chapter["title"],
            "snippet": ("..." if start else "") + snippet.strip() + "...",
            "pos": pos,
        })
        if len(hits) >= 40:
            break
    return {"hits": hits, "total": total}


def search_library(query: str, limit: int = 30) -> list[dict]:
    """Full text search across every book in the library."""
    needle = query.strip().lower()
    if len(needle) < 2:
        return []
    results = []
    for book_id in list(STORE.state["books"]):
        meta = load_meta(book_id)
        if not meta:
            continue
        for idx, chapter in enumerate(meta["chapters"]):
            data = chapter_data(book_id, idx)
            text = (data or {}).get("text", "")
            pos = text.lower().find(needle)
            if pos < 0:
                continue
            start = max(0, pos - 60)
            snippet = text[start:pos + len(needle) + 100].replace("\n", " ")
            results.append({
                "book": book_id,
                "chapter": idx,
                "title": chapter["title"],
                "snippet": snippet.strip(),
            })
            if len(results) >= limit:
                return results
    return results
