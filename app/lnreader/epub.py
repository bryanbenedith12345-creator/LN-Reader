"""EPUB parsing, chapter loading and library indexing."""
from __future__ import annotations

import hashlib
import json
import posixpath
import re
import time
import zipfile
from html import unescape
from pathlib import Path
from urllib.parse import unquote
from xml.etree import ElementTree as ET

from .cleaner import ChapterClean
from .config import (
    BOOKS, CACHE, CHAP, CHAP_LOCK, META, META_LOCK, META_VERSION,
    SAFE_EXT, STORE, meta_file,
)

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
