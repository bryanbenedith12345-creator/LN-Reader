"""Loopback access token.

The reading server listens on 127.0.0.1, but any web page in the same browser
can still try to POST to it. A per-user token, injected into the page and sent
back as a header, stops that kind of cross-site request.
"""
from __future__ import annotations

import secrets
from http.cookies import SimpleCookie

from .config import DATA, TOKEN_FILE

COOKIE_NAME = "ln_token"
HEADER_NAME = "X-LN-Token"
TOKEN = ""


def load_token() -> str:
    """Return the stable token for this machine, creating it on first run."""
    global TOKEN
    token = ""
    try:
        token = TOKEN_FILE.read_text("utf-8").strip()
    except Exception:
        token = ""
    if not token:
        token = secrets.token_urlsafe(24)
        try:
            DATA.mkdir(parents=True, exist_ok=True)
            TOKEN_FILE.write_text(token, "utf-8")
        except Exception:
            pass
    TOKEN = token
    return token


def matches(candidate: str) -> bool:
    return bool(TOKEN) and bool(candidate) and candidate == TOKEN


def from_headers(headers, query: dict | None = None) -> str:
    """Pull a token out of the header, the cookie jar or the query string."""
    header = headers.get(HEADER_NAME) if headers else None
    if header:
        return header.strip()
    cookie = SimpleCookie()
    try:
        cookie.load(headers.get("Cookie") or "")
    except Exception:
        cookie = SimpleCookie()
    morsel = cookie.get(COOKIE_NAME)
    if morsel:
        return (morsel.value or "").strip()
    if query:
        values = query.get("t") or []
        if values:
            return values[0].strip()
    return ""


def cookie_header() -> str:
    return f"{COOKIE_NAME}={TOKEN}; Path=/; SameSite=Strict; Max-Age=31536000"
