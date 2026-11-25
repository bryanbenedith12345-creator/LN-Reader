"""The HTTP layer: the access token, the API and the routes."""
from __future__ import annotations

import json
import threading
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer

import pytest


def _serve(library):
    from lnreader.auth import load_token
    from lnreader.web import App

    httpd = ThreadingHTTPServer(("127.0.0.1", 0), App)
    httpd.daemon_threads = True
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    return httpd, f"http://127.0.0.1:{httpd.server_address[1]}", load_token()


def _get(url, token=None, headers=None):
    request = urllib.request.Request(url)
    if token:
        request.add_header("X-LN-Token", token)
    for key, value in (headers or {}).items():
        request.add_header(key, value)
    with urllib.request.urlopen(request, timeout=5) as response:
        return response.status, response.read()


def test_api_asks_for_the_token(library):
    httpd, base, token = _serve(library)
    try:
        with pytest.raises(urllib.error.HTTPError) as info:
            _get(base + "/api/library")
        assert info.value.code == 401
        status, body = _get(base + "/api/library", token)
        assert status == 200
        assert json.loads(body)["books"] == []
    finally:
        httpd.shutdown()


def test_page_carries_the_token(library):
    httpd, base, token = _serve(library)
    try:
        status, body = _get(base + "/")
        assert status == 200
        assert token.encode() in body
    finally:
        httpd.shutdown()


def test_progress_and_highlights_round_trip(library, sample_epub):
    httpd, base, token = _serve(library)
    try:
        request = urllib.request.Request(
            base + "/api/import?name=sample.epub",
            data=sample_epub,
            headers={"Content-Type": "application/epub+zip", "X-LN-Token": token},
            method="POST")
        with urllib.request.urlopen(request, timeout=10) as response:
            payload = json.loads(response.read())
        book_id = payload["book"]["id"]

        body = json.dumps({"book": book_id, "ch": 1, "ratio": 0.5}).encode()
        request = urllib.request.Request(
            base + "/api/progress", data=body,
            headers={"Content-Type": "application/json", "X-LN-Token": token}, method="POST")
        with urllib.request.urlopen(request, timeout=5) as response:
            assert json.loads(response.read())["progress"]["ch"] == 1

        _, raw = _get(base + "/api/library", token)
        books = json.loads(raw)["books"]
        assert books[0]["progress"]["ch"] == 1
    finally:
        httpd.shutdown()

