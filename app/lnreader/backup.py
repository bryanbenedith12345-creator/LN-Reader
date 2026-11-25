"""Backups: zip the library, restore it and keep the folder from growing."""
from __future__ import annotations

import io
import json
import posixpath
import time
import zipfile

from .config import BACKUPS, BOOKS, STORE
from .epub import import_epub

KEEP_BACKUPS = 10
MAX_BACKUP_BYTES = 512 * 1024 * 1024
MAX_BOOK_BYTES = 300 * 1024 * 1024


def _prune(keep: int = KEEP_BACKUPS) -> None:
    files = sorted(BACKUPS.glob("LN-Reader-*.zip"), key=lambda p: p.name, reverse=True)
    for old in files[keep:]:
        old.unlink(missing_ok=True)


def make_backup() -> "object":
    BACKUPS.mkdir(parents=True, exist_ok=True)
    path = BACKUPS / time.strftime("LN-Reader-%Y%m%d-%H%M%S.zip")
    with zipfile.ZipFile(path, "w", zipfile.ZIP_STORED) as zf:
        for epub in BOOKS.glob("*.epub"):
            zf.write(epub, "books/" + epub.name)
        zf.writestr("lnreader.json", json.dumps(STORE.state, ensure_ascii=False), zipfile.ZIP_DEFLATED)
    _prune()
    return path


def restore_backup(payload: bytes) -> dict:
    """Import books and merge reading history from a backup zip."""
    if len(payload) > MAX_BACKUP_BYTES:
        raise ValueError("backup is too large")
    imported = 0
    incoming: dict = {}
    with zipfile.ZipFile(io.BytesIO(payload)) as zf:
        total = 0
        for info in zf.infolist():
            total += info.file_size
            if total > MAX_BACKUP_BYTES:
                raise ValueError("backup expands too far")
        for name in zf.namelist():
            lower = name.lower()
            if lower.endswith(".epub"):
                try:
                    import_epub(zf.read(name), posixpath.basename(name))
                    imported += 1
                except Exception:
                    continue
            elif lower.endswith(".json") and posixpath.basename(lower) == "lnreader.json":
                try:
                    incoming = json.loads(zf.read(name).decode("utf-8"))
                except Exception:
                    incoming = {}
    with STORE.lock:
        state = STORE.state
        for book_id, progress in (incoming.get("progress") or {}).items():
            if not isinstance(progress, dict):
                continue
            old = state["progress"].get(book_id)
            if not old or (progress.get("updated") or 0) > (old.get("updated") or 0):
                state["progress"][book_id] = {**old, **progress} if old else progress
            elif old:
                old["read"] = sorted(set(old.get("read", [])) | set(progress.get("read", [])))
        for key in ("highlights",):
            known = {str(item.get("id")) for item in state[key]}
            for item in incoming.get(key) or []:
                if isinstance(item, dict) and item.get("id") and str(item["id"]) not in known:
                    state[key].append(item)
                    known.add(str(item["id"]))
        for book_id, record in (incoming.get("books") or {}).items():
            state["books"].setdefault(book_id, record)
        for book_id, settings in (incoming.get("book_settings") or {}).items():
            state["book_settings"].setdefault(book_id, settings)
        known_favorites = set(state.get("favorites", []))
        for book_id in incoming.get("favorites") or []:
            if book_id not in known_favorites:
                state.setdefault("favorites", []).append(book_id)
        shelves = state.setdefault("collections", [])
        by_name = {c["name"].lower(): c["id"] for c in shelves}
        id_map = {}
        for shelf in incoming.get("collections") or []:
            name = str(shelf.get("name", "")).strip()
            if not name:
                continue
            match = by_name.get(name.lower())
            if match:
                id_map[shelf.get("id")] = match      # same shelf, merge its books
                continue
            shelf["name"] = name
            shelves.append(shelf)
            by_name[name.lower()] = shelf["id"]
            id_map[shelf.get("id")] = shelf["id"]
        known = {c["id"] for c in shelves}
        for incoming_id, ids in (incoming.get("collection_books") or {}).items():
            target = id_map.get(incoming_id, incoming_id)
            if target not in known:
                continue
            books = state.setdefault("collection_books", {}).setdefault(target, [])
            for book_id in ids or []:
                if book_id not in books:
                    books.append(book_id)
    STORE.save()
    return {"imported": imported}
