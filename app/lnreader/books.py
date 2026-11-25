"""Per-book overrides: shelf details (title, author, series, tags) and reading settings."""
from __future__ import annotations

from .config import DEFAULT_SETTINGS, INFO_FIELDS, STORE, TAGS_MAX


def _record(book_id: str) -> dict:
    return STORE.state["books"].setdefault(book_id, {"added": 0, "name": ""})


def get_info(book_id: str) -> dict:
    info = _record(book_id).get("info")
    return dict(info) if isinstance(info, dict) else {}


def get_settings(book_id: str) -> dict:
    saved = STORE.state["book_settings"].get(book_id)
    if not isinstance(saved, dict):
        return {}
    return {k: v for k, v in saved.items() if k in DEFAULT_SETTINGS and v is not None}


def effective_settings(book_id: str) -> dict:
    """Global reading settings with the per-book overrides applied on top."""
    base = dict(STORE.state["settings"])
    base.update(get_settings(book_id))
    return base


def save_info(body: dict) -> dict:
    """Store the reader's own details for a book without touching the EPUB."""
    book_id = str(body.get("book", ""))
    if not book_id:
        raise ValueError("unknown book")
    info = get_info(book_id)
    for field in INFO_FIELDS:
        if field in body:
            value = str(body.get(field) or "").strip()
            if value:
                info[field] = value[:200]
            else:
                info.pop(field, None)
    if "tags" in body:
        raw = body.get("tags")
        if isinstance(raw, str):
            raw = raw.split(",")
        tags = []
        for tag in raw or []:
            name = str(tag).strip()[:40]
            if name and name.lower() not in [t.lower() for t in tags]:
                tags.append(name)
        info["tags"] = tags[:TAGS_MAX]
    with STORE.lock:
        _record(book_id)["info"] = info
    STORE.save()
    return {"info": info}


def save_settings(body: dict) -> dict:
    """Save (or clear with settings=None) the reading settings for one book."""
    book_id = str(body.get("book", ""))
    if not book_id:
        raise ValueError("unknown book")
    payload = body.get("settings")
    with STORE.lock:
        if payload is None:
            STORE.state["book_settings"].pop(book_id, None)
            settings = {}
        else:
            settings = {k: v for k, v in (payload or {}).items()
                        if k in DEFAULT_SETTINGS and v is not None}
            STORE.state["book_settings"][book_id] = settings
    STORE.save()
    return {"settings": settings}
