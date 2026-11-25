"""EPUB indexing: metadata, chapter cache and library scanning."""
from __future__ import annotations

import hashlib
import json
import posixpath
import time
import zipfile
from collections import OrderedDict
from pathlib import Path

from .config import (
    BOOKS, CACHE, CHAP, CHAP_LOCK, META, META_LOCK, META_VERSION, SAFE_EXT,
    STORE, meta_file,
)
from .epub_chapters import build_chapters
from .epub_meta import read_package


def build_meta(book_id: str, epub: Path) -> dict:
    """Index one EPUB: parse the package, clean the chapters, write the cache."""
    with zipfile.ZipFile(epub) as zf:
        package = read_package(zf)
        cover_ext = ""
        cover = package.get("cover")
        if cover and posixpath.splitext(cover)[1].lower() in SAFE_EXT:
            try:
                payload = zf.read(cover)
            except Exception:
                payload = b""
            if payload:
                cover_ext = posixpath.splitext(cover)[1].lower()
                cache_dir = CACHE / book_id
                cache_dir.mkdir(parents=True, exist_ok=True)
                (cache_dir / ("cover" + cover_ext)).write_bytes(payload)
        chapters, words = build_chapters(book_id, zf, package)

    meta = {
        "id": book_id,
        "title": package["title"],
        "author": package["author"],
        "cover": cover_ext,
        "chapters": chapters,
        "words": words,
        "v": META_VERSION,
    }
    meta_file(book_id).write_text(json.dumps(meta, ensure_ascii=False), "utf-8")
    with META_LOCK:
        META[book_id] = meta
    return meta


def load_meta(book_id: str, refresh: bool = False) -> dict | None:
    with META_LOCK:
        if not refresh and book_id in META:
            return META[book_id]
    path = meta_file(book_id)
    meta = None
    if path.exists() and not refresh:
        try:
            meta = json.loads(path.read_text("utf-8"))
            if meta.get("v") != META_VERSION:
                meta = None
        except Exception:
            meta = None
    if meta is None:
        epub = BOOKS / f"{book_id}.epub"
        if not epub.exists():
            return None
        meta = build_meta(book_id, epub)
    with META_LOCK:
        META[book_id] = meta
    return meta


def chapter_data(book_id: str, index: int) -> dict | None:
    key = f"{book_id}:{index}"
    with CHAP_LOCK:
        if key in CHAP:
            CHAP.move_to_end(key)
            return CHAP[key]
    meta = load_meta(book_id)
    if not meta or not 0 <= index < len(meta["chapters"]):
        return None
    path = CACHE / book_id / "ch" / f"{index}.json"
    data = None
    if path.exists():
        try:
            data = json.loads(path.read_text("utf-8"))
        except Exception:
            data = None
    if data is None:
        meta = load_meta(book_id, refresh=True)
        if not meta or not path.exists():
            return None
        data = json.loads(path.read_text("utf-8"))
    with CHAP_LOCK:
        CHAP[key] = data
        while len(CHAP) > 8:
            CHAP.popitem(last=False)
    return data


def import_epub(payload: bytes, filename: str = "book.epub") -> dict:
    if len(payload) < 64 or not payload.startswith(b"PK"):
        raise ValueError("not an EPUB file")
    book_id = hashlib.sha1(payload).hexdigest()[:16]
    epub = BOOKS / f"{book_id}.epub"
    if not epub.exists():
        epub.write_bytes(payload)
    meta = load_meta(book_id)
    with STORE.lock:
        record = STORE.state["books"].setdefault(book_id, {"added": time.time(), "name": filename[:200]})
        if not record.get("added"):
            record["added"] = time.time()
    if meta:
        STORE.save()
        return meta
    raise ValueError("could not read book")


def scan_library() -> None:
    for epub in sorted(BOOKS.glob("*.epub")):
        book_id = epub.stem
        try:
            if load_meta(book_id) is None:
                print(f"  indexing {epub.name} ...", flush=True)
                build_meta(book_id, epub)
        except Exception as exc:
            print(f"  skipped {epub.name}: {exc}", flush=True)
        with STORE.lock:
            STORE.state["books"].setdefault(book_id, {"added": epub.stat().st_mtime, "name": epub.name})
    STORE.save()
    from .shelves import prune_missing

    prune_missing({epub.stem for epub in BOOKS.glob("*.epub")})
