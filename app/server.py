#!/usr/bin/env python3
"""LN Reader - local light-novel library, reader and highlight manager.

Serves the UI over a loopback-only HTTP server and opens it in a native
webview window (pywebview). Chrome/Edge app-window and the default browser
are used as fallbacks. Everything is stored under ./data.
"""
from __future__ import annotations

import hashlib
import io
import json
import mimetypes
import os
import posixpath
import re
import atexit
import shutil
import subprocess
import sys
import threading
import time
import traceback
import urllib.request
import zipfile
from collections import OrderedDict
from html import escape, unescape
from html.parser import HTMLParser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, quote, unquote, urlparse
from xml.etree import ElementTree as ET

BASE = Path(__file__).resolve().parent
UI = BASE / "ui"
ROOT = BASE.parent
DATA = ROOT / "data"
BOOKS = DATA / "books"
CACHE = DATA / "cache"
BACKUPS = DATA / "backups"
STATE_FILE = DATA / "state.json"
WPM = 230
META_VERSION = 5


def _streams() -> None:
    """pythonw.exe has no console: route output to data/app.log instead."""
    try:
        if sys.stdout is None or sys.stderr is None:
            DATA.mkdir(parents=True, exist_ok=True)
            log = DATA / "app.log"
            if log.exists() and log.stat().st_size > 512 * 1024:
                log.unlink(missing_ok=True)
            handle = open(log, "a", encoding="utf-8", buffering=1)
            if sys.stdout is None:
                sys.stdout = handle
            if sys.stderr is None:
                sys.stderr = handle
    except Exception:
        pass


_streams()

DEFAULT_SETTINGS = {
    "theme": "cupertino",
    "font": "serif",
    "size": 19,
    "lh": 1.78,
    "width": 720,
    "justify": True,
}

BLOCK = {
    "p", "div", "br", "hr", "li", "ul", "ol", "h1", "h2", "h3", "h4", "h5", "h6",
    "blockquote", "section", "article", "figure", "figcaption", "table", "tr",
    "td", "th", "pre", "center", "header", "footer", "aside", "dl", "dt", "dd",
}
ALLOWED = BLOCK | {
    "span", "i", "em", "b", "strong", "u", "s", "strike", "del", "ins", "sub",
    "sup", "small", "big", "a", "img", "ruby", "rt", "rp", "code", "mark", "q",
    "cite", "abbr", "tbody", "thead", "tfoot", "caption", "colgroup", "col", "wbr",
}
VOID = {"br", "hr", "img", "wbr", "col"}
DROP = {
    "script", "style", "head", "title", "math", "noscript", "template", "desc",
    "metadata", "iframe", "object", "embed", "video", "audio", "canvas", "form",
    "input", "button", "select", "textarea", "link", "meta",
}
STYLE_OK = {"text-align", "font-style", "font-weight", "text-indent", "text-decoration", "vertical-align"}
SAFE_EXT = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".avif", ".svg"}


# ---------------------------------------------------------------- storage ----
class Store:
    def __init__(self) -> None:
        for d in (DATA, BOOKS, CACHE, BACKUPS):
            d.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()
        self.data = self._load()

    def _load(self) -> dict:
        base = {
            "books": {},
            "progress": {},
            "highlights": [],
            "bookmarks": [],
            "settings": dict(DEFAULT_SETTINGS),
            "created": time.time(),
        }
        try:
            raw = json.loads(STATE_FILE.read_text("utf-8"))
            if isinstance(raw, dict):
                for key, val in raw.items():
                    if key in base and isinstance(val, type(base[key])):
                        base[key] = val
        except Exception:
            pass
        base["settings"] = {**DEFAULT_SETTINGS, **base["settings"]}
        return base

    @property
    def state(self) -> dict:
        return self.data

    def save(self) -> None:
        with self.lock:
            tmp = STATE_FILE.with_suffix(".tmp")
            tmp.write_text(json.dumps(self.data, ensure_ascii=False, indent=1), "utf-8")
            os.replace(tmp, STATE_FILE)


STORE = Store()
META: dict[str, dict] = {}
META_LOCK = threading.Lock()
CHAP: "OrderedDict[str, dict]" = OrderedDict()
CHAP_LOCK = threading.Lock()


def meta_file(book_id: str) -> Path:
    return CACHE / book_id / "meta.json"


def asset_url(book_id: str, path: str) -> str:
    return "/api/asset/%s/%s" % (book_id, quote(path))


# ------------------------------------------------------------ html cleaning ----
class ChapterClean(HTMLParser):
    """Turn chapter XHTML into a small, safe subset of HTML + plain text."""

    def __init__(self, book_id: str, base_dir: str, spine: dict[str, int]) -> None:
        super().__init__(convert_charrefs=True)
        self.book_id = book_id
        self.base_dir = base_dir
        self.spine = spine
        self.out: list[str] = []
        self.txt: list[str] = []
        self.stack: list[str] = []
        self.drop: list[str] = []

    def resolve(self, href: str) -> str | None:
        href = unquote((href or "").strip().split("#")[0])
        if not href or href.startswith(("data:", "http:", "https:", "//", "mailto:", "javascript:")):
            return None
        path = posixpath.normpath(posixpath.join(self.base_dir, href))
        return None if path.startswith("..") else path

    def attrs(self, tag: str, data: dict[str, str]) -> str | None:
        pairs: list[tuple[str, str]] = []
        if tag == "img":
            path = self.resolve(
                data.get("src") or data.get("xlink:href") or data.get("href")
                or data.get("data-src") or data.get("data-original") or ""
            )
            if not path:
                return None
            pairs += [("src", asset_url(self.book_id, path)), ("alt", data.get("alt", "")), ("loading", "lazy")]
            for key in ("width", "height"):
                val = (data.get(key) or "").strip()
                if val.isdigit() and int(val) > 0:
                    pairs.append((key, val))
        elif tag == "a":
            href = (data.get("href") or "").strip()
            if href.startswith(("http://", "https://")):
                pairs += [("href", href), ("target", "_blank"), ("rel", "noopener noreferrer")]
            elif href.startswith("#"):
                pairs.append(("href", href))
            else:
                path = self.resolve(href)
                if path and path in self.spine:
                    pairs += [("href", "#"), ("data-ch", str(self.spine[path]))]
        elif tag == "font":
            return None
        if tag in ("td", "th"):
            for key in ("colspan", "rowspan"):
                if (data.get(key) or "").isdigit():
                    pairs.append((key, data[key]))
        if data.get("id"):
            pairs.append(("id", data["id"]))
        style = data.get("style")
        if style:
            keep = []
            for part in style.split(";"):
                if ":" not in part:
                    continue
                name, val = part.split(":", 1)
                name, val = name.strip().lower(), val.strip()
                if name in STYLE_OK and not re.search(r"url\(|expression|@", val, re.I):
                    keep.append(f"{name}:{val}")
            if keep:
                pairs.append(("style", ";".join(keep)))
        return "".join(f' {k}="{escape(v, quote=True)}"' for k, v in pairs)

    def handle_starttag(self, tag: str, attrs) -> None:
        if self.drop:
            if tag not in VOID:
                self.drop.append(tag)
            return
        if tag in DROP:
            self.drop.append(tag)
            return
        if tag == "image":
            tag = "img"
        if tag not in ALLOWED:
            return
        extra = self.attrs(tag, dict(attrs))
        if extra is None:
            return
        self.out.append(f"<{tag}{extra}>")
        if tag in VOID:
            if tag in BLOCK:
                self.txt.append("\n")
        else:
            self.stack.append(tag)
            if tag in BLOCK:
                self.txt.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if self.drop:
            if tag in self.drop:
                while self.drop:
                    if self.drop.pop() == tag:
                        break
            return
        if tag in VOID or tag not in self.stack:
            return
        while self.stack:
            open_tag = self.stack.pop()
            self.out.append(f"</{open_tag}>")
            if open_tag in BLOCK:
                self.txt.append("\n")
            if open_tag == tag:
                break

    def handle_data(self, data: str) -> None:
        if self.drop or not data:
            return
        self.out.append(escape(data, quote=False))
        self.txt.append(data)


def build_meta(book_id: str, epub: Path) -> dict:
    with zipfile.ZipFile(epub) as zf:
        names = set(zf.namelist())
        opf_path = None
        try:
            rootfile = ET.fromstring(zf.read("META-INF/container.xml")).find(".//{*}rootfile")
            if rootfile is not None:
                opf_path = rootfile.get("full-path")
        except Exception:
            pass
        if not opf_path or opf_path not in names:
            opf_path = next((n for n in names if n.lower().endswith(".opf")), None)
        if not opf_path:
            raise ValueError("not a valid EPUB (no package document)")

        package = ET.fromstring(zf.read(opf_path))
        base = posixpath.dirname(opf_path)
        md = package.find("{*}metadata")

        def resolve(href: str | None, rel: str = base) -> str | None:
            href = unquote((href or "").split("#")[0].strip())
            if not href:
                return None
            path = posixpath.normpath(posixpath.join(rel, href))
            return None if path.startswith("..") else path

        title = ((md.findtext("{*}title") if md is not None else "") or "").strip() or "Untitled"
        authors = []
        if md is not None:
            for node in md.findall("{*}creator"):
                if node.text and node.text.strip():
                    authors.append(node.text.strip())
        author = ", ".join(dict.fromkeys(authors)) or "Unknown author"

        manifest: dict[str, dict] = {}
        for item in package.findall("{*}manifest/{*}item"):
            item_id = item.get("id")
            if not item_id:
                continue
            manifest[item_id] = {
                "path": resolve(item.get("href")),
                "type": (item.get("media-type") or "").lower(),
                "props": (item.get("properties") or "").lower(),
            }

        spine: list[str] = []
        for ref in package.findall("{*}spine/{*}itemref"):
            item = manifest.get(ref.get("idref") or "")
            if not item or not item["path"]:
                continue
            if "html" in item["type"] or item["path"].lower().endswith((".xhtml", ".html", ".htm")):
                spine.append(item["path"])
        if not spine:
            for item in manifest.values():
                path = item["path"]
                if path and path.lower().endswith((".xhtml", ".html", ".htm")):
                    spine.append(path)
            spine.sort()
        spine = list(dict.fromkeys(spine))
        if not spine:
            raise ValueError("EPUB has no readable chapters")
        spine_index = {path: idx for idx, path in enumerate(spine)}

        toc: dict[str, str] = {}
        nav = next((i for i in manifest.values() if "nav" in i["props"] and i["path"]), None)
        if nav:
            try:
                raw = zf.read(nav["path"]).decode("utf-8", "ignore")
                pattern = r'<a\b[^>]*?href\s*=\s*["\']([^"\']+)["\'][^>]*>(.*?)</a>'
                for hit in re.finditer(pattern, raw, re.S | re.I):
                    path = resolve(hit.group(1), posixpath.dirname(nav["path"]))
                    label = re.sub(r"\s+", " ", unescape(re.sub(r"<[^>]+>", " ", hit.group(2)))).strip()
                    if path and label:
                        toc.setdefault(path, label)
            except Exception:
                pass
        if not toc:
            ncx = next((i for i in manifest.values() if "ncx" in i["type"] and i["path"]), None)
            if ncx:
                try:
                    ncx_dir = posixpath.dirname(ncx["path"])
                    for point in ET.fromstring(zf.read(ncx["path"])).iter():
                        if not point.tag.endswith("navPoint"):
                            continue
                        label = next(
                            (c.text.strip() for c in point.iter() if c.tag.endswith("text") and c.text and c.text.strip()),
                            "",
                        )
                        src = next((c.get("src") for c in point if c.tag.endswith("content")), None)
                        path = resolve(src, ncx_dir)
                        if path and label:
                            toc.setdefault(path, label)
                except Exception:
                    pass

        cover = None
        if md is not None:
            for meta in md.findall("{*}meta"):
                if (meta.get("name") or "").lower() == "cover":
                    item = manifest.get(meta.get("content") or "")
                    if item:
                        cover = item["path"]
        if not cover:
            cover = next((i["path"] for i in manifest.values() if "cover-image" in i["props"] and i["path"]), None)
        if not cover:
            cover = next(
                (i["path"] for i in manifest.values()
                 if i["path"] and i["type"].startswith("image/") and "cover" in posixpath.basename(i["path"]).lower()),
                None,
            )

        cache_dir = CACHE / book_id
        chap_dir = cache_dir / "ch"
        chap_dir.mkdir(parents=True, exist_ok=True)
        cover_ext = ""
        if cover and cover in names and posixpath.splitext(cover)[1].lower() in SAFE_EXT:
            cover_ext = posixpath.splitext(cover)[1].lower()
            try:
                (cache_dir / ("cover" + cover_ext)).write_bytes(zf.read(cover))
            except Exception:
                cover_ext = ""

        pages = []
        for path in spine:
            cleaner = ChapterClean(book_id, posixpath.dirname(path), spine_index)
            if path in names:
                try:
                    cleaner.feed(zf.read(path).decode("utf-8", "ignore"))
                    cleaner.close()
                except Exception:
                    pass
            pages.append((
                path,
                "".join(cleaner.out).strip() or "<p></p>",
                re.sub(r"\n{3,}", "\n\n", "".join(cleaner.txt)).strip(),
            ))

        # Group spine pages into real chapters using the table of contents.
        # A chapter starts at its TOC entry and runs until the next entry, so
        # title images and continuation pages stay with the text they belong to.
        positions = {}
        for path, label in toc.items():
            index = spine_index.get(path)
            if index is not None:
                positions.setdefault(index, label)
        starts = sorted(positions.items())
        grouped = []
        if starts:
            if starts[0][0] > 0:
                grouped.append(("Front Matter", pages[:starts[0][0]]))
            for number, (start, label) in enumerate(starts):
                end = starts[number + 1][0] if number + 1 < len(starts) else len(pages)
                if end > start:
                    grouped.append((label, pages[start:end]))
        else:
            grouped = [(f"Chapter {index + 1}", [page]) for index, page in enumerate(pages)]

        page_chapter = {}
        for chapter_index, (_, group) in enumerate(grouped):
            for page in group:
                page_chapter[page[0]] = chapter_index
        spine_chapter = {spine_index[path]: chapter for path, chapter in page_chapter.items()}

        def remap_links(markup: str, fallback: int) -> str:
            def swap(match):
                try:
                    return 'data-ch="%d"' % spine_chapter.get(int(match.group(1)), fallback)
                except ValueError:
                    return match.group(0)
            return re.sub(r'data-ch="(\d+)"', swap, markup)

        for stale in chap_dir.glob("*.json"):
            stale.unlink(missing_ok=True)

        chapters = []
        words = 0
        for index, (label, group) in enumerate(grouped):
            html_out = "\n".join(remap_links(page[1], index) for page in group)
            text = "\n\n".join(page[2] for page in group if page[2].strip())
            (chap_dir / f"{index}.json").write_text(
                json.dumps({"html": html_out, "text": text}, ensure_ascii=False), "utf-8"
            )
            words += len(text.split())
            chapters.append({"title": label or f"Chapter {index + 1}", "href": group[0][0]})

    meta = {
        "id": book_id,
        "title": title,
        "author": author,
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


def save_image_dialog(payload: bytes, suggested: str) -> str | None:
    """Ask for a destination and write the image there. Returns the path."""
    ext = posixpath.splitext(suggested)[1].lower() or ".jpg"
    folder = DATA / "images"
    folder.mkdir(parents=True, exist_ok=True)
    if sys.platform != "win32" or os.environ.get("LN_NO_DIALOG"):
        target = folder / suggested
        number = 1
        while target.exists():
            target = folder / f"{Path(suggested).stem} ({number}){ext}"
            number += 1
        target.write_bytes(payload)
        return str(target)

    import ctypes
    from ctypes import wintypes

    class OPENFILENAMEW(ctypes.Structure):
        _fields_ = [
            ("lStructSize", wintypes.DWORD),
            ("hwndOwner", wintypes.HWND),
            ("hInstance", wintypes.HINSTANCE),
            ("lpstrFilter", wintypes.LPCWSTR),
            ("lpstrCustomFilter", wintypes.LPWSTR),
            ("nMaxCustFilter", wintypes.DWORD),
            ("nFilterIndex", wintypes.DWORD),
            ("lpstrFile", wintypes.LPWSTR),
            ("nMaxFile", wintypes.DWORD),
            ("lpstrFileTitle", wintypes.LPWSTR),
            ("nMaxFileTitle", wintypes.DWORD),
            ("lpstrInitialDir", wintypes.LPCWSTR),
            ("lpstrTitle", wintypes.LPCWSTR),
            ("Flags", wintypes.DWORD),
            ("nFileOffset", wintypes.WORD),
            ("nFileExtension", wintypes.WORD),
            ("lpstrDefExt", wintypes.LPCWSTR),
            ("lCustData", wintypes.LPARAM),
            ("lpfnHook", ctypes.c_void_p),
            ("lpTemplateName", wintypes.LPCWSTR),
            ("pvReserved", ctypes.c_void_p),
            ("dwReserved", wintypes.DWORD),
            ("FlagsEx", wintypes.DWORD),
        ]

    buffer = ctypes.create_unicode_buffer(suggested, 2048)
    filters = ctypes.create_unicode_buffer(
        "Image files\0*.jpg;*.jpeg;*.png;*.gif;*.webp;*.bmp;*.avif\0All files\0*.*\0\0"
    )
    dialog = OPENFILENAMEW()
    dialog.lStructSize = ctypes.sizeof(OPENFILENAMEW)
    dialog.hwndOwner = ctypes.windll.user32.FindWindowW(None, "LN Reader")
    dialog.lpstrFilter = ctypes.cast(filters, wintypes.LPCWSTR)
    dialog.lpstrFile = ctypes.cast(buffer, wintypes.LPWSTR)
    dialog.nMaxFile = 2048
    dialog.lpstrTitle = "Save image"
    pictures = Path.home() / "Pictures"
    if pictures.is_dir():
        dialog.lpstrInitialDir = str(pictures)
    dialog.lpstrDefExt = ext.lstrip(".")
    dialog.Flags = 0x00080000 | 0x00000002 | 0x00000008 | 0x00000800
    comdlg = ctypes.windll.comdlg32
    comdlg.GetSaveFileNameW.argtypes = [ctypes.POINTER(OPENFILENAMEW)]
    comdlg.GetSaveFileNameW.restype = wintypes.BOOL
    if not comdlg.GetSaveFileNameW(ctypes.byref(dialog)):
        return None
    target = Path(buffer.value)
    if not target.suffix:
        target = target.with_suffix(ext)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(payload)
    return str(target)


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


# ------------------------------------------------------------------ server ----
class App(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "LNReader/1.0"
    last_ping = 0.0
    STATIC = {"": "index.html", "/": "index.html", "/index.html": "index.html",
              "/styles.css": "styles.css", "/app.js": "app.js"}
    TYPES = {"index.html": "text/html; charset=utf-8", "styles.css": "text/css; charset=utf-8",
             "app.js": "text/javascript; charset=utf-8"}

    def log_message(self, *args) -> None:
        pass

    def send(self, code: int, body=b"", ctype: str = "application/json; charset=utf-8", headers=None) -> None:
        if isinstance(body, (dict, list)):
            body = json.dumps(body, ensure_ascii=False).encode("utf-8")
        elif isinstance(body, str):
            body = body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        for key, val in (headers or {}).items():
            self.send_header(key, val)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def read_body(self) -> bytes:
        length = int(self.headers.get("Content-Length") or 0)
        return self.rfile.read(length) if length else b""

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        path, query = parsed.path, parse_qs(parsed.query)
        try:
            App.last_ping = time.time()
            if path == "/api/ping":
                return self.send(200, {"ok": True})
            if path == "/api/library":
                return self.send(200, library())
            if path == "/api/export":
                return self.download_backup()
            if path.startswith("/api/cover/"):
                return self.cover(path.rsplit("/", 1)[-1])
            if path.startswith("/api/asset/"):
                return self.asset(path)
            match = re.match(r"^/api/book/([0-9a-f]+)(?:/(.*))?$", path)
            if match:
                book_id, rest = match.group(1), match.group(2) or ""
                if not rest:
                    detail = book_detail(book_id)
                    return self.send(200, detail) if detail else self.send(404, {"error": "not found"})
                chapter = re.match(r"^chapter/(\d+)$", rest)
                if chapter:
                    data = chapter_data(book_id, int(chapter.group(1)))
                    return self.send(200, data) if data else self.send(404, {"error": "no chapter"})
                if rest == "search":
                    return self.send(200, search_book(book_id, query.get("q", [""])[0]))
            return self.static(path)
        except Exception as exc:
            return self.send(500, {"error": str(exc)})

    def do_HEAD(self) -> None:
        self.do_GET()

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        path, query = parsed.path, parse_qs(parsed.query)
        try:
            App.last_ping = time.time()
            if path == "/api/import":
                body = self.read_body()
                name = query.get("name", ["book.epub"])[0]
                meta = import_epub(body, name)
                return self.send(200, {"book": {"id": meta["id"], "title": meta["title"]}, "library": library()})
            if path == "/api/import-backup":
                return self.send(200, restore_backup(self.read_body()))
            if path == "/api/backup":
                result = make_backup()
                return self.send(200, {"path": str(result), "name": result.name})
            if path == "/api/reveal":
                body = json.loads(self.read_body() or b"{}")
                target = Path(str(body.get("path", ""))).resolve()
                if DATA.resolve() in target.parents and target.exists():
                    if sys.platform == "win32":
                        subprocess.Popen(["explorer", "/select,", str(target)])
                    else:
                        subprocess.Popen(["xdg-open", str(target.parent)])
                    return self.send(200, {"ok": True})
                return self.send(400, {"error": "path outside data folder"})

            payload = json.loads(self.read_body() or b"{}")
            if path == "/api/save-image":
                return self.send(200, save_image(payload))
            if path == "/api/progress":
                return self.send(200, update_progress(payload))
            if path == "/api/highlights":
                return self.send(200, save_highlights(payload))
            if path == "/api/bookmarks":
                return self.send(200, save_bookmarks(payload))
            if path == "/api/settings":
                return self.send(200, save_settings(payload))
            if path == "/api/delete":
                return self.send(200, delete_book(payload))
            return self.send(404, {"error": "unknown endpoint"})
        except Exception as exc:
            return self.send(400, {"error": str(exc)})

    def static(self, path: str) -> None:
        name = self.STATIC.get(path)
        if not name or not (UI / name).exists():
            return self.send(404, {"error": "not found"})
        data = (UI / name).read_bytes()
        etag = '"%s-%d"' % (hashlib.sha1(data).hexdigest()[:16], len(data))
        if self.headers.get("If-None-Match") == etag:
            self.send_response(304)
            self.send_header("ETag", etag)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        self.send(200, data, self.TYPES[name], {"ETag": etag, "Cache-Control": "no-cache"})

    def cover(self, book_id: str) -> None:
        meta = load_meta(book_id)
        if not meta or not meta.get("cover"):
            return self.send(404, b"", "image/gif")
        path = CACHE / book_id / ("cover" + meta["cover"])
        if not path.exists():
            return self.send(404, b"", "image/gif")
        ctype = mimetypes.guess_type(path.name)[0] or "image/jpeg"
        self.send(200, path.read_bytes(), ctype, {"Cache-Control": "max-age=86400"})

    def asset(self, path: str) -> None:
        match = re.match(r"^/api/asset/([0-9a-f]+)/(.+)$", path)
        if not match:
            return self.send(404, {"error": "bad asset"})
        book_id, rel = match.group(1), unquote(match.group(2))
        rel = posixpath.normpath(rel)
        if rel.startswith("..") or rel.startswith("/"):
            return self.send(400, {"error": "bad path"})
        epub = BOOKS / f"{book_id}.epub"
        if not epub.exists():
            return self.send(404, {"error": "no book"})
        try:
            with zipfile.ZipFile(epub) as zf:
                data = zf.read(rel)
        except Exception:
            return self.send(404, {"error": "no asset"})
        ctype = mimetypes.guess_type(rel)[0] or "application/octet-stream"
        self.send(200, data, ctype, {"Cache-Control": "max-age=86400"})

    def download_backup(self) -> None:
        path = make_backup()
        data = path.read_bytes()
        headers = {
            "Content-Disposition": f'attachment; filename="{path.name}"',
            "Cache-Control": "no-store",
        }
        self.send(200, data, "application/zip", headers)

    def do_DELETE(self) -> None:
        self.do_POST()


# ------------------------------------------------------------- window open ----
BROWSERS = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    os.path.expandvars(r"%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"),
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
]


def native_window(url: str) -> bool:
    try:
        import webview  # pywebview - native window (WebView2 on Windows)
    except Exception:
        return False
    try:
        webview.create_window(
            "LN Reader", url, width=1440, height=920, min_size=(980, 620),
            background_color="#111113",
        )
        webview.start(debug=False, private_mode=False, storage_path=str(DATA / "webview"))
        return True
    except Exception as exc:
        print(f"[window] native webview unavailable: {exc}", file=sys.stderr, flush=True)
        return False


def browser_window(url: str) -> bool:
    for exe in BROWSERS:
        if exe and os.path.exists(exe):
            try:
                subprocess.run([
                    exe, f"--app={url}", "--window-size=1440,920",
                    f"--user-data-dir={DATA / 'browser'}", "--no-first-run",
                    "--no-default-browser-check", "--disable-features=TranslateUI",
                ], check=False)
                return True
            except Exception:
                continue
    return False


def running_port() -> int | None:
    """Return the port of an already running instance, if any."""
    try:
        info = json.loads((DATA / "instance.json").read_text("utf-8"))
        port = int(info["port"])
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/ping", timeout=0.7) as res:
            if json.loads(res.read().decode("utf-8")).get("ok"):
                return port
    except Exception:
        pass
    return None


def cleanup_instance(port: int) -> None:
    try:
        info = json.loads((DATA / "instance.json").read_text("utf-8"))
        if int(info.get("port")) == port:
            (DATA / "instance.json").unlink(missing_ok=True)
    except Exception:
        pass


def open_client(url: str) -> bool:
    if native_window(url):
        return True
    return browser_window(url)


def main() -> None:
    existing = running_port()
    if existing:
        url = f"http://127.0.0.1:{existing}/"
        if "--no-window" in sys.argv:
            print(url, flush=True)
        elif not open_client(url):
            import webbrowser
            webbrowser.open(url)
        return

    if not UI.exists():
        raise RuntimeError("The ui folder is missing next to server.py")
    scan_library()
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), App)
    httpd.daemon_threads = True
    port = httpd.server_address[1]
    url = f"http://127.0.0.1:{port}/"
    (DATA / "instance.json").write_text(json.dumps({"port": port, "pid": os.getpid()}), "utf-8")
    atexit.register(cleanup_instance, port)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()

    if "--no-window" in sys.argv:
        print(url, flush=True)
        try:
            while True:
                time.sleep(3600)
        except KeyboardInterrupt:
            pass
        return

    print(f"LN Reader running at {url}", flush=True)
    if not open_client(url):
        import webbrowser
        webbrowser.open(url)
        deadline = time.time() + 6 * 3600
        while time.time() < deadline:
            time.sleep(5)
            if App.last_ping and time.time() - App.last_ping > 120:
                break
    httpd.shutdown()


def fatal(message: str) -> None:
    try:
        DATA.mkdir(parents=True, exist_ok=True)
        (DATA / "last-error.log").write_text(message, "utf-8")
    except Exception:
        pass
    try:
        print(message, file=sys.stderr, flush=True)
    except Exception:
        pass
    try:
        if sys.platform == "win32":
            import ctypes
            ctypes.windll.user32.MessageBoxW(None, message[-1500:], "LN Reader - problem", 0x10)
    except Exception:
        pass


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        pass
    except Exception:
        fatal("LN Reader could not start.\n\n" + traceback.format_exc())
