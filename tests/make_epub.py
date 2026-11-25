"""Build a tiny but valid EPUB for the tests."""
from __future__ import annotations

import zipfile
from io import BytesIO

CONTAINER = """<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf"
    media-type="application/oebps-package+xml"/></rootfiles>
</container>"""

OPF = """<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>{title}</dc:title>
    <dc:creator>{author}</dc:creator>
    <dc:language>en</dc:language>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    {items}
  </manifest>
  <spine>{spine}</spine>
</package>"""

NAV = """<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>Contents</title></head><body>
<nav epub:type="toc"><ol>{entries}</ol></nav>
</body></html>"""


def build_epub(title: str = "Test Novel", author: str = "A Writer",
               chapters: list[tuple[str, str]] | None = None) -> bytes:
    """Return the bytes of a small EPUB with the given chapter titles."""
    chapters = chapters or [("Chapter One", "The story begins here."), ("Chapter Two", "And then it ends.")]
    items, spine, entries = [], [], []
    for index, (name, text) in enumerate(chapters, start=1):
        filename = f"chapter{index}.xhtml"
        items.append(f'<item id="c{index}" href="{filename}" media-type="application/xhtml+xml"/>')
        spine.append(f'<itemref idref="c{index}"/>')
        entries.append(f'<li><a href="{filename}">{name}</a></li>')
    buffer = BytesIO()
    with zipfile.ZipFile(buffer, "w") as zf:
        zf.writestr("mimetype", "application/epub+zip", compress_type=zipfile.ZIP_STORED)
        zf.writestr("META-INF/container.xml", CONTAINER)
        zf.writestr("OEBPS/content.opf", OPF.format(
            title=title, author=author, items="\n    ".join(items), spine="".join(spine)))
        zf.writestr("OEBPS/nav.xhtml", NAV.format(entries="".join(entries)))
        for index, (name, text) in enumerate(chapters, start=1):
            zf.writestr(f"OEBPS/chapter{index}.xhtml",
                        f'<?xml version="1.0" encoding="utf-8"?>'
                        f'<html xmlns="http://www.w3.org/1999/xhtml"><head><title>{name}</title></head>'
                        f'<body><h1>{name}</h1><p>{text}</p><p>Extra line for length.</p></body></html>')
    return buffer.getvalue()
