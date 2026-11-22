"""Library, book detail and full-text search payloads."""
from __future__ import annotations

from .config import STORE
from .epub import chapter_data, load_meta

# ---------------------------------------------------------------- payloads ----
def library() -> dict:
    state = STORE.state
    books = []
    for book_id in list(state["books"]):
        meta = load_meta(book_id)
        if not meta:
            continue
        books.append({
            "id": book_id,
            "title": meta["title"],
            "author": meta["author"],
            "chapters": len(meta["chapters"]),
            "words": meta["words"],
            "cover": bool(meta.get("cover")),
            "added": state["books"][book_id].get("added", 0),
            "progress": state["progress"].get(book_id, {}),
        })
    books.sort(key=lambda b: -(b["progress"].get("updated") or b["added"]))
    highlights = state["highlights"]
    return {
        "books": books,
        "settings": state["settings"],
        "highlights": highlights,
        "bookmarks": state["bookmarks"],
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
        "progress": state["progress"].get(book_id, {}),
        "highlights": [h for h in state["highlights"] if h.get("book") == book_id],
        "bookmarks": [b for b in state["bookmarks"] if b.get("book") == book_id],
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
