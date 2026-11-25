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

from . import auth
from . import tts as speech
from .actions import delete_book, save_image, save_settings, update_progress
from .annotations import save_highlights
from .backup import make_backup, restore_backup
from .books import save_info, save_settings as save_book_settings
from .config import BOOKS, CACHE, DATA, UI
from .epub import chapter_data, import_epub, load_meta
from .exports import export, save_export
from .shelves import add_books, create, delete as delete_shelf, rename, remove_books, set_favorite
from .queries import book_detail, library, search_book, search_library

STATIC_FILES = {"": "index.html", "/": "index.html", "/index.html": "index.html"}
STATIC_FOLDERS = {"css": ".css", "js": ".js", "partials": ".html"}
for _folder, _ext in STATIC_FOLDERS.items():
    for _file in (UI / _folder).glob(f"*{_ext}"):
        STATIC_FILES[f"/{_folder}/{_file.name}"] = f"{_folder}/{_file.name}"
TOKEN_PLACEHOLDER = "<!--LN_TOKEN-->"
MAX_UPLOAD = 300 * 1024 * 1024

auth.load_token()


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
        if length > MAX_UPLOAD:
            raise ValueError("file is too large")
        return self.rfile.read(length) if length else b""

    def authorised(self, query: dict) -> bool:
        """Only the page we served may talk to this server."""
        if not auth.matches(auth.from_headers(self.headers, query)):
            return False
        origin = self.headers.get("Origin")
        if origin and "127.0.0.1" not in origin and "localhost" not in origin:
            return False
        return True

    # ------------------------------------------------------------------ get --
    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        path, query = parsed.path, parse_qs(parsed.query)
        try:
            App.last_ping = time.time()
            if path == "/api/ping":
                return self.send(200, {"ok": True})
            if path.startswith("/api/") and not self.authorised(query):
                return self.send(401, {"error": "unauthorised"})
            if path == "/api/library":
                return self.send(200, library())
            if path == "/api/tts":
                return self.send(200, speech.status())
            if path == "/api/export":
                return self.download_backup()
            if path == "/api/search-all":
                return self.send(200, {"hits": search_library(query.get("q", [""])[0])})
            if path == "/api/export-notes":
                return self.download_notes(query)
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

    # ----------------------------------------------------------------- post --
    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        path, query = parsed.path, parse_qs(parsed.query)
        try:
            App.last_ping = time.time()
            if path.startswith("/api/") and not self.authorised(query):
                try:
                    self.read_body()          # drain, or keep-alive goes out of sync
                except Exception:
                    pass
                return self.send(401, {"error": "unauthorised"})
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

            if path == "/api/tts/catalog":
                self.read_body()
                return self.send(200, speech.open_catalog())
            if path == "/api/tts/say":
                ask = json.loads(self.read_body() or b"{}")
                audio = speech.speak(str(ask.get("voice", "")), str(ask.get("text", "")),
                                     float(ask.get("speed") or 1))
                return self.send(200, audio, "audio/wav", {"Cache-Control": "no-store"})

            payload = json.loads(self.read_body() or b"{}")
            if path == "/api/tts/download":
                asked = speech.download_voice(str(payload.get("id", "")))
                return self.send(200, {"job": asked["job"], **speech.status()})
            if path == "/api/tts/remove":
                speech.remove_voice(str(payload.get("id", "")))
                return self.send(200, speech.status())
            if path == "/api/tts/warm":
                return self.send(200, speech.warm(str(payload.get("voice", "")),
                                                  float(payload.get("speed") or 1)))
            if path == "/api/save-image":
                return self.send(200, save_image(payload))
            if path == "/api/export-notes":
                book = str(payload.get("book", ""))
                fmt = str(payload.get("format", "md"))
                ids = [book] if book else [entry["id"] for entry in library()["books"]]
                return self.send(200, save_export(ids, fmt))
            if path == "/api/progress":
                return self.send(200, update_progress(payload))
            if path == "/api/highlights":
                return self.send(200, save_highlights(payload))
            if path == "/api/favorite":
                book = str(payload.get("book") or "")
                if not book:
                    raise ValueError("missing book")
                return self.send(200, set_favorite(book, bool(payload.get("on"))))
            if path == "/api/shelves":
                action = str(payload.get("action", ""))
                if action == "create":
                    return self.send(200, {"shelf": create(payload.get("name", ""))})
                if action == "rename":
                    return self.send(200, {"shelf": rename(str(payload.get("id", "")), payload.get("name", ""))})
                if action == "delete":
                    return self.send(200, delete_shelf(str(payload.get("id", ""))))
                raise ValueError("unknown shelf action")
            if path == "/api/shelf-books":
                shelf_id = str(payload.get("shelf", ""))
                if payload.get("remove"):
                    return self.send(200, remove_books(shelf_id, payload["remove"]))
                return self.send(200, add_books(shelf_id, payload.get("add") or []))
            if path == "/api/book-info":
                return self.send(200, save_info(payload))
            if path == "/api/book-settings":
                return self.send(200, save_book_settings(payload))
            if path == "/api/settings":
                return self.send(200, save_settings(payload))
            if path == "/api/delete":
                delete_book(payload)
                return self.send(200, library())
            return self.send(404, {"error": "unknown endpoint"})
        except Exception as exc:
            return self.send(400, {"error": str(exc)})

    def do_DELETE(self) -> None:
        self.do_POST()

    # --------------------------------------------------------------- static --
    def static(self, path: str) -> None:
        name = self.STATIC.get(path)
        if not name or not (UI / name).exists():
            return self.send(404, {"error": "not found"})
        data = (UI / name).read_bytes()
        headers = {}
        if name == "index.html":
            data = self.with_token(data)
            headers["Set-Cookie"] = auth.cookie_header()
        etag = '"%s-%d"' % (hashlib.sha1(data).hexdigest()[:16], len(data))
        if self.headers.get("If-None-Match") == etag:
            self.send_response(304)
            self.send_header("ETag", etag)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        ctype = self.TYPES.get(Path(name).suffix, "application/octet-stream")
        headers.update({"ETag": etag, "Cache-Control": "no-cache"})
        self.send(200, data, ctype, headers)

    def with_token(self, data: bytes) -> bytes:
        meta = f'<meta name="ln-token" content="{auth.TOKEN}">'.encode("utf-8")
        return data.replace(TOKEN_PLACEHOLDER.encode("utf-8"), meta)

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
        headers = {
            "Content-Disposition": f'attachment; filename="{path.name}"',
            "Cache-Control": "no-store",
        }
        self.send(200, path.read_bytes(), "application/zip", headers)

    def download_notes(self, query: dict) -> None:
        book = query.get("book", [""])[0]
        fmt = query.get("format", ["md"])[0]
        ids = [book] if book else [entry["id"] for entry in library()["books"]]
        payload, name = export(ids, fmt)
        headers = {
            "Content-Disposition": f'attachment; filename="{name}"',
            "Cache-Control": "no-store",
        }
        ctype = {"md": "text/markdown; charset=utf-8", "csv": "text/csv; charset=utf-8"}.get(fmt, "application/epub+zip")
        self.send(200, payload, ctype, headers)
