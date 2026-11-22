"""Turn chapter XHTML into the safe HTML subset the reader renders."""
from __future__ import annotations

import posixpath
import re
from html import escape
from html.parser import HTMLParser
from urllib.parse import unquote

from .config import asset_url

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
