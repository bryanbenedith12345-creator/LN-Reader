"""Read the EPUB package document: metadata, spine, contents and cover."""
from __future__ import annotations

import posixpath
import re
import zipfile
from html import unescape
from urllib.parse import unquote
from xml.etree import ElementTree as ET


def _resolve(href: str | None, base: str) -> str | None:
    href = unquote((href or "").split("#")[0].strip())
    if not href:
        return None
    path = posixpath.normpath(posixpath.join(base, href))
    return None if path.startswith("..") else path


def _find_opf(zf: zipfile.ZipFile, names: set[str]) -> str:
    try:
        rootfile = ET.fromstring(zf.read("META-INF/container.xml")).find(".//{*}rootfile")
        if rootfile is not None:
            opf = rootfile.get("full-path")
            if opf and opf in names:
                return opf
    except Exception:
        pass
    return next((n for n in names if n.lower().endswith(".opf")), "")


def _read_nav(zf: zipfile.ZipFile, nav: dict, base: str) -> dict[str, str]:
    toc: dict[str, str] = {}
    try:
        raw = zf.read(nav["path"]).decode("utf-8", "ignore")
        pattern = r'<a\b[^>]*?href\s*=\s*["\']([^"\']+)["\'][^>]*>(.*?)</a>'
        for hit in re.finditer(pattern, raw, re.S | re.I):
            path = _resolve(hit.group(1), posixpath.dirname(nav["path"]))
            label = re.sub(r"\s+", " ", unescape(re.sub(r"<[^>]+>", " ", hit.group(2)))).strip()
            if path and label:
                toc.setdefault(path, label)
    except Exception:
        pass
    return toc


def _read_ncx(zf: zipfile.ZipFile, ncx: dict) -> dict[str, str]:
    toc: dict[str, str] = {}
    try:
        ncx_dir = posixpath.dirname(ncx["path"])
        for point in ET.fromstring(zf.read(ncx["path"])).iter():
            if not point.tag.endswith("navPoint"):
                continue
            label = next(
                (c.text.strip() for c in point.iter()
                 if c.tag.endswith("text") and c.text and c.text.strip()), "")
            src = next((c.get("src") for c in point if c.tag.endswith("content")), None)
            path = _resolve(src, ncx_dir)
            if path and label:
                toc.setdefault(path, label)
    except Exception:
        pass
    return toc


def _find_cover(md, manifest: dict[str, dict]) -> str | None:
    if md is not None:
        for meta in md.findall("{*}meta"):
            if (meta.get("name") or "").lower() == "cover":
                item = manifest.get(meta.get("content") or "")
                if item:
                    return item["path"]
    cover = next((i["path"] for i in manifest.values()
                  if "cover-image" in i["props"] and i["path"]), None)
    if cover:
        return cover
    return next((i["path"] for i in manifest.values()
                 if i["path"] and i["type"].startswith("image/")
                 and "cover" in posixpath.basename(i["path"]).lower()), None)


def read_package(zf: zipfile.ZipFile) -> dict:
    """Return title, author, spine, table of contents and cover path."""
    names = set(zf.namelist())
    opf_path = _find_opf(zf, names)
    if not opf_path:
        raise ValueError("not a valid EPUB (no package document)")

    package = ET.fromstring(zf.read(opf_path))
    base = posixpath.dirname(opf_path)
    md = package.find("{*}metadata")

    def resolve(href: str | None) -> str | None:
        return _resolve(href, base)

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
        spine = sorted(i["path"] for i in manifest.values()
                       if i["path"] and i["path"].lower().endswith((".xhtml", ".html", ".htm")))
    spine = list(dict.fromkeys(spine))
    if not spine:
        raise ValueError("EPUB has no readable chapters")

    toc: dict[str, str] = {}
    nav = next((i for i in manifest.values() if "nav" in i["props"] and i["path"]), None)
    if nav:
        toc = _read_nav(zf, nav, base)
    if not toc:
        ncx = next((i for i in manifest.values() if "ncx" in i["type"] and i["path"]), None)
        if ncx:
            toc = _read_ncx(zf, ncx)

    return {
        "title": title,
        "author": author,
        "spine": spine,
        "toc": toc,
        "cover": _find_cover(md, manifest),
        "base": base,
    }
