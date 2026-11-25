"""Clean the spine pages and group them into reader chapters."""
from __future__ import annotations

import json
import posixpath
import re
import zipfile
from pathlib import Path

from .cleaner import ChapterClean
from .config import CACHE


def _clean_pages(book_id: str, zf: zipfile.ZipFile, spine: list[str]) -> list[tuple[str, str, str]]:
    pages = []
    spine_index = {path: idx for idx, path in enumerate(spine)}
    for path in spine:
        cleaner = ChapterClean(book_id, posixpath.dirname(path), spine_index)
        try:
            cleaner.feed(zf.read(path).decode("utf-8", "ignore"))
            cleaner.close()
        except Exception:
            pass
        html = "".join(cleaner.out).strip() or "<p></p>"
        text = re.sub(r"\n{3,}", "\n\n", "".join(cleaner.txt)).strip()
        pages.append((path, html, text))
    return pages


def _group(pages, toc: dict[str, str]) -> list[tuple[str, list]]:
    """A chapter starts at its contents entry and runs until the next one."""
    spine_index = {page[0]: idx for idx, page in enumerate(pages)}
    positions: dict[int, str] = {}
    for path, label in toc.items():
        index = spine_index.get(path)
        if index is not None:
            positions.setdefault(index, label)
    starts = sorted(positions.items())
    grouped: list[tuple[str, list]] = []
    if starts:
        if starts[0][0] > 0:
            grouped.append(("Front Matter", pages[:starts[0][0]]))
        for number, (start, label) in enumerate(starts):
            end = starts[number + 1][0] if number + 1 < len(starts) else len(pages)
            if end > start:
                grouped.append((label, pages[start:end]))
    else:
        grouped = [(f"Chapter {index + 1}", [page]) for index, page in enumerate(pages)]
    return grouped


def build_chapters(book_id: str, zf: zipfile.ZipFile, package: dict) -> tuple[list[dict], int]:
    """Write the chapter cache and return the chapter list plus word count."""
    spine = package["spine"]
    pages = _clean_pages(book_id, zf, spine)
    grouped = _group(pages, package.get("toc") or {})

    spine_index = {path: idx for idx, path in enumerate(spine)}
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

    chap_dir = CACHE / book_id / "ch"
    chap_dir.mkdir(parents=True, exist_ok=True)
    for stale in chap_dir.glob("*.json"):
        stale.unlink(missing_ok=True)

    chapters: list[dict] = []
    words = 0
    for index, (label, group) in enumerate(grouped):
        html_out = "\n".join(remap_links(page[1], index) for page in group)
        text = "\n\n".join(page[2] for page in group if page[2].strip())
        (chap_dir / f"{index}.json").write_text(
            json.dumps({"html": html_out, "text": text}, ensure_ascii=False), "utf-8")
        words += len(text.split())
        chapters.append({"title": label or f"Chapter {index + 1}", "href": group[0][0]})
    return chapters, words
