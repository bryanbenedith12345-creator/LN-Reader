"""Export highlights and notes as Markdown, CSV or an EPUB digest."""
from __future__ import annotations

import csv
import io
import posixpath
import time
import zipfile
from xml.sax.saxutils import escape

from .config import STORE

COLOR_NAMES = {
    "yellow": "Yellow", "green": "Green", "blue": "Blue",
    "pink": "Pink", "purple": "Purple", "orange": "Orange",
}


def _collect(book_ids: list[str]) -> list[dict]:
    wanted = set(book_ids)
    items = []
    for item in STORE.state["highlights"]:
        if wanted and item.get("book") not in wanted:
            continue
        items.append(item)
    items.sort(key=lambda h: (h.get("book", ""), h.get("ch", 0), h.get("start", 0)))
    return items


def _chapter_title(book_id: str, index: int) -> str:
    from .epub import load_meta
    meta = load_meta(book_id)
    if meta and 0 <= index < len(meta["chapters"]):
        return meta["chapters"][index]["title"]
    return f"Chapter {index + 1}"


def _book_title(book_id: str) -> str:
    from .epub import load_meta
    meta = load_meta(book_id)
    if meta:
        info = STORE.state["books"].get(book_id, {}).get("info") or {}
        return info.get("title") or meta["title"]
    return book_id


def to_markdown(book_ids: list[str]) -> str:
    items = _collect(book_ids)
    lines = ["# Highlights", ""]
    current = ""
    for item in items:
        book = item.get("book", "")
        if book != current:
            current = book
            lines += [f"## {_book_title(book)}", ""]
        title = _chapter_title(book, int(item.get("ch", 0)))
        quote = str(item.get("quote", "")).strip().replace("\n", " ")
        lines.append(f"### {title}")
        lines.append("")
        lines.append(f"> {quote}")
        note = str(item.get("note", "")).strip()
        if note:
            lines += ["", f"**Note:** {note}"]
        lines += ["", f"*{COLOR_NAMES.get(item.get('color', ''), 'Highlight')} · "
                  f"{time.strftime('%Y-%m-%d %H:%M', time.localtime(item.get('created', 0)))}*", ""]
    if not items:
        lines.append("_No highlights yet._")
    return "\n".join(lines)


def to_csv(book_ids: list[str]) -> str:
    buffer = io.StringIO()
    writer = csv.writer(buffer, lineterminator="\n")
    writer.writerow(["book", "chapter", "chapter_title", "color", "note", "quote", "created"])
    for item in _collect(book_ids):
        writer.writerow([
            _book_title(item.get("book", "")),
            int(item.get("ch", 0)) + 1,
            _chapter_title(item.get("book", ""), int(item.get("ch", 0))),
            item.get("color", ""),
            item.get("note", ""),
            str(item.get("quote", "")).strip().replace("\n", " "),
            time.strftime("%Y-%m-%d %H:%M", time.localtime(item.get("created", 0))),
        ])
    return buffer.getvalue()


def to_epub(book_ids: list[str]) -> bytes:
    """Build a small EPUB containing every highlight as its own chapter."""
    items = _collect(book_ids)
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as zf:
        zf.writestr("mimetype", "application/epub+zip", compress_type=zipfile.ZIP_STORED)
        zf.writestr("META-INF/container.xml",
                    '<?xml version="1.0" encoding="UTF-8"?>'
                    '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">'
                    '<rootfiles><rootfile full-path="OEBPS/content.opf" '
                    'media-type="application/oebps-package+xml"/></rootfiles></container>')
        pages = []
        for index, item in enumerate(items):
            name = f"page{index + 1}.xhtml"
            title = f"{_book_title(item.get('book', ''))} - {_chapter_title(item.get('book', ''), int(item.get('ch', 0)))}"
            quote = escape(str(item.get("quote", "")).strip())
            note = escape(str(item.get("note", "")).strip())
            body = [f"<h1>{escape(title)}</h1>", f"<blockquote><p>{quote}</p></blockquote>"]
            if note:
                body.append(f"<p><strong>Note:</strong> {note}</p>")
            zf.writestr(f"OEBPS/{name}",
                        '<?xml version="1.0" encoding="utf-8"?>'
                        '<html xmlns="http://www.w3.org/1999/xhtml"><head>'
                        f'<title>{escape(title)}</title></head><body>{"".join(body)}</body></html>')
            pages.append((name, title))
        nav_items = "".join(f'<li><a href="{name}">{escape(title)}</a></li>' for name, title in pages)
        zf.writestr("OEBPS/nav.xhtml",
                    '<?xml version="1.0" encoding="utf-8"?>'
                    '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">'
                    '<head><title>Highlights</title></head><body><nav epub:type="toc"><ol>'
                    f"{nav_items}</ol></nav></body></html>")
        manifest = "".join(
            f'<item id="p{i + 1}" href="{name}" media-type="application/xhtml+xml"/>'
            for i, (name, _) in enumerate(pages))
        spine = "".join(f'<itemref idref="p{i + 1}"/>' for i in range(len(pages)))
        zf.writestr("OEBPS/content.opf",
                    '<?xml version="1.0" encoding="utf-8"?>'
                    '<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">'
                    '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">'
                    '<dc:identifier id="id">lnreader-highlights</dc:identifier>'
                    '<dc:title>Highlights</dc:title><dc:language>en</dc:language>'
                    '</metadata><manifest>'
                    f'{manifest}'
                    '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" '
                    'properties="nav"/></manifest><spine>' + spine + "</spine></package>")
    return buffer.getvalue()


def export(book_ids: list[str], fmt: str) -> tuple[bytes, str]:
    fmt = (fmt or "md").lower()
    stamp = time.strftime("%Y%m%d-%H%M%S")
    if fmt == "csv":
        return to_csv(book_ids).encode("utf-8"), f"LN-Reader-highlights-{stamp}.csv"
    if fmt == "epub":
        return to_epub(book_ids), f"LN-Reader-highlights-{stamp}.epub"
    return to_markdown(book_ids).encode("utf-8"), f"LN-Reader-highlights-{stamp}.md"


def save_export(book_ids: list[str], fmt: str) -> dict:
    """Build the export and let the user choose where it goes."""
    from .dialogs import NOTE_FILTERS, save_file_dialog

    payload, name = export(book_ids, fmt)
    ext = posixpath.splitext(name)[1].lower()
    saved = save_file_dialog(payload, name, "Export highlights",
                             NOTE_FILTERS.get(ext), "exports")
    return {"saved": bool(saved), "path": saved or "", "name": name}
