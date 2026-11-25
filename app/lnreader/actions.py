"""Reading progress, global settings, book removal and image saving."""
from __future__ import annotations

import posixpath
import re
import shutil
import time
import zipfile
from pathlib import Path
from urllib.parse import unquote

from .config import (
    BOOKS, CACHE, DEFAULT_SETTINGS, META, META_LOCK, SAFE_EXT, STORE,
)
from .dialogs import save_image_dialog
from .epub import load_meta
from .shelves import prune_book


def update_progress(body: dict) -> dict:
    book_id = str(body.get("book", ""))
    meta = load_meta(book_id)
    if not meta:
        raise ValueError("unknown book")
    total = len(meta["chapters"])
    with STORE.lock:
        prog = STORE.state["progress"].setdefault(
            book_id, {"ch": 0, "ratio": 0, "scroll": {}, "read": [], "updated": 0}
        )
        if "ch" in body:
            prog["ch"] = max(0, min(total - 1, int(body["ch"])))
        if "ratio" in body:
            ratio = max(0.0, min(1.0, float(body["ratio"])))
            prog["ratio"] = ratio
            prog["scroll"][str(prog["ch"])] = round(ratio, 4)
            if ratio >= 0.97 and prog["ch"] not in prog["read"]:
                prog["read"].append(prog["ch"])
        if isinstance(body.get("scroll"), dict):
            for key, val in body["scroll"].items():
                try:
                    index = str(int(key))
                    if 0 <= int(index) < total:
                        prog["scroll"][index] = round(max(0.0, min(1.0, float(val))), 4)
                except (TypeError, ValueError):
                    continue
        if isinstance(body.get("read"), list):
            prog["read"] = sorted({int(x) for x in body["read"] if 0 <= int(x) < total})
        prog["updated"] = time.time()
    STORE.save()
    return {"progress": prog}


def save_settings(body: dict) -> dict:
    with STORE.lock:
        for key, val in body.items():
            if key in DEFAULT_SETTINGS:
                STORE.state["settings"][key] = val
    STORE.save()
    return {"settings": STORE.state["settings"]}


def delete_book(body: dict) -> dict:
    book_id = str(body.get("book", ""))
    with STORE.lock:
        STORE.state["books"].pop(book_id, None)
        STORE.state["progress"].pop(book_id, None)
        STORE.state["book_settings"].pop(book_id, None)
        STORE.state["highlights"] = [h for h in STORE.state["highlights"] if h.get("book") != book_id]
    prune_book(book_id)
    (BOOKS / f"{book_id}.epub").unlink(missing_ok=True)
    shutil.rmtree(CACHE / book_id, ignore_errors=True)
    with META_LOCK:
        META.pop(book_id, None)
    STORE.save()
    return {"ok": True}


def save_image(body: dict) -> dict:
    book_id = str(body.get("book", ""))
    rel = posixpath.normpath(unquote(str(body.get("path", "")).strip()))
    if not re.fullmatch(r"[0-9a-f]{16}", book_id) or rel.startswith("..") or rel.startswith("/"):
        raise ValueError("bad image path")
    if posixpath.splitext(rel)[1].lower() not in SAFE_EXT:
        raise ValueError("not an image")
    epub = BOOKS / f"{book_id}.epub"
    if not epub.exists():
        raise ValueError("unknown book")
    try:
        with zipfile.ZipFile(epub) as zf:
            payload = zf.read(rel)
    except Exception:
        raise ValueError("image not found")
    fallback = posixpath.basename(rel) or "image"
    name = posixpath.basename(str(body.get("name") or fallback))
    name = re.sub(r'[<>:"/\\|?*\x00-\x1f]+', " ", name).strip() or fallback
    ext = posixpath.splitext(rel)[1].lower()
    stem = posixpath.splitext(name)[0][:120] or "image"
    saved = save_image_dialog(payload, stem + ext)
    if not saved:
        return {"saved": False}
    return {"saved": True, "path": saved}
