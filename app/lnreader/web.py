"""Loopback HTTP server and static/API routing."""
from __future__ import annotations

import hashlib
import json
import mimetypes
import posixpath
import re
import subprocess
import sys
import time
import zipfile
from http.server import BaseHTTPRequestHandler
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

from .actions import (
    delete_book, make_backup, restore_backup, save_bookmarks, save_highlights,
    save_image, save_settings, update_progress,
)
from .config import BOOKS, CACHE, DATA, UI
from .epub import chapter_data, import_epub, load_meta
from .queries import book_detail, library, search_book

STATIC_FILES = {"": "index.html", "/": "index.html", "/index.html": "index.html"}
STATIC_FILES.update({
    f"/{folder}/{file.name}": f"{folder}/{file.name}"
    for folder in ("css", "js")
    for file in (UI / folder).glob(f"*.{folder}")
})

# ------------------------------------------------------------------ server ----
class App(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "LNReader/1.0"
    last_ping = 0.0
    STATIC = STATIC_FILES
    TYPES = {".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
             ".js": "text/javascript; charset=utf-8"}

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
        self.send(200, data, self.TYPES.get(Path(name).suffix, "application/octet-stream"), {"ETag": etag, "Cache-Control": "no-cache"})

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
