"""Reading progress, highlights, bookmarks, settings and backups."""
from __future__ import annotations

import io
import json
import posixpath
import re
import shutil
import time
import zipfile
from pathlib import Path
from urllib.parse import unquote

from .config import (
    BACKUPS, BOOKS, CACHE, DEFAULT_SETTINGS, META, META_LOCK, SAFE_EXT, STORE,
)
from .dialogs import save_image_dialog
from .epub import import_epub, load_meta
from .queries import library

# ----------------------------------------------------------------- actions ----
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


def save_bookmarks(body: dict) -> dict:
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
                "name": str(item.get("name", ""))[:200] or "Bookmark",
                "created": int(item.get("created") or time.time()),
            })
        except Exception:
            continue
    with STORE.lock:
        STORE.state["bookmarks"] = [b for b in STORE.state["bookmarks"] if b.get("book") != book_id] + clean
    STORE.save()
    return {"ok": True, "count": len(clean)}


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
        STORE.state["highlights"] = [h for h in STORE.state["highlights"] if h.get("book") != book_id]
        STORE.state["bookmarks"] = [b for b in STORE.state["bookmarks"] if b.get("book") != book_id]
    (BOOKS / f"{book_id}.epub").unlink(missing_ok=True)
    shutil.rmtree(CACHE / book_id, ignore_errors=True)
    with META_LOCK:
        META.pop(book_id, None)
    STORE.save()
    return library()



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

def make_backup() -> Path:
    BACKUPS.mkdir(parents=True, exist_ok=True)
    path = BACKUPS / time.strftime("LN-Reader-%Y%m%d-%H%M%S.zip")
    with zipfile.ZipFile(path, "w", zipfile.ZIP_STORED) as zf:
        for epub in BOOKS.glob("*.epub"):
            zf.write(epub, "books/" + epub.name)
        zf.writestr("lnreader.json", json.dumps(STORE.state, ensure_ascii=False), zipfile.ZIP_DEFLATED)
    return path


def restore_backup(payload: bytes) -> dict:
    imported = 0
    incoming = {}
    with zipfile.ZipFile(io.BytesIO(payload)) as zf:
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
                old = {**old, **progress} if old else progress
                state["progress"][book_id] = old
            elif old:
                old["read"] = sorted(set(old.get("read", [])) | set(progress.get("read", [])))
        for key in ("highlights", "bookmarks"):
            known = {str(item.get("id")) for item in state[key]}
            for item in incoming.get(key) or []:
                if isinstance(item, dict) and item.get("id") and str(item["id"]) not in known:
                    state[key].append(item)
                    known.add(str(item["id"]))
        for book_id, record in (incoming.get("books") or {}).items():
            state["books"].setdefault(book_id, record)
    STORE.save()
    return {"imported": imported, "library": library()}
