"""Highlights: saving and listing."""
from __future__ import annotations

import time

from .config import STORE


def save_highlights(body: dict) -> dict:
    book_id = str(body.get("book", ""))
    entries = body.get("list")
    if not isinstance(entries, list):
        raise ValueError("missing list")
    clean = []
    for item in entries:
        if not isinstance(item, dict):
            continue
        try:
            clean.append({
                "id": str(item["id"])[:64],
                "book": book_id,
                "ch": int(item["ch"]),
                "start": int(item["start"]),
                "end": int(item["end"]),
                "quote": str(item.get("quote", ""))[:4000],
                "color": str(item.get("color", "yellow"))[:16],
                "note": str(item.get("note", ""))[:2000],
                "created": int(item.get("created") or time.time()),
            })
        except Exception:
            continue
    with STORE.lock:
        STORE.state["highlights"] = [h for h in STORE.state["highlights"] if h.get("book") != book_id] + clean
    STORE.save()
    return {"ok": True, "count": len(clean)}
