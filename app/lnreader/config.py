"""Paths, constants, the shared JSON store and runtime state."""
from __future__ import annotations

import json
import os
import shutil
import sys
import threading
import time
from collections import OrderedDict
from pathlib import Path
from urllib.parse import quote

# Two ways to run: from source, or from the built exe. Frozen, the code sits in
# PyInstaller's _internal folder while the library, downloads and browser
# profile stay in a data folder next to Simple LN Reader.exe.
FROZEN = bool(getattr(sys, "frozen", False))
if FROZEN:
    BASE = Path(getattr(sys, "_MEIPASS", Path(sys.executable).parent))
    UI = BASE / "ui"
    ROOT = Path(os.environ.get("LN_READER_HOME", Path(sys.executable).resolve().parent))
else:
    BASE = Path(__file__).resolve().parent.parent
    UI = BASE / "ui"
    ROOT = Path(os.environ.get("LN_READER_HOME", BASE.parent))
DATA = Path(os.environ.get("LN_READER_DATA", ROOT / "data"))
BOOKS = DATA / "books"
CACHE = DATA / "cache"
BACKUPS = DATA / "backups"
STATE_FILE = DATA / "state.json"
TOKEN_FILE = DATA / "token.txt"
WPM = 230
META_VERSION = 5

# Fields a reader may override per book (the EPUB values stay untouched).
INFO_FIELDS = ("title", "author", "series")
TAGS_MAX = 12



def _streams() -> None:
    """pythonw.exe has no console: route output to data/app.log instead."""
    try:
        if sys.stdout is None or sys.stderr is None:
            DATA.mkdir(parents=True, exist_ok=True)
            log = DATA / "app.log"
            if log.exists() and log.stat().st_size > 512 * 1024:
                log.unlink(missing_ok=True)
            handle = open(log, "a", encoding="utf-8", buffering=1)
            if sys.stdout is None:
                sys.stdout = handle
            if sys.stderr is None:
                sys.stderr = handle
    except Exception:
        pass


_streams()


def real_python() -> list[str] | None:
    """Command prefix for a real CPython, for what the frozen exe cannot do.

    The Piper engine is installed with pip and speaks from its own process, so
    it needs an interpreter; a built exe has none of its own. Source runs use
    themselves, the exe looks for the Python 3 already on the machine and
    returns None when there is none.
    """
    if not FROZEN:
        return [sys.executable]
    for name in ("python", "python3"):
        found = shutil.which(name)
        if found:
            try:
                if Path(found).stat().st_size > 4096:  # skip the Store stub
                    return [found]
            except OSError:
                pass
    roots = [Path(os.environ[k]) / "Programs" / "Python"
             for k in ("LOCALAPPDATA",) if os.environ.get(k)]
    if os.environ.get("PROGRAMFILES"):
        roots.append(Path(os.environ["PROGRAMFILES"]) / "Python")
    roots.append(Path("C:/"))
    for root in roots:
        try:
            for exe in sorted(root.glob("Python3*/python.exe"), reverse=True):
                if exe.is_file():
                    return [str(exe)]
        except OSError:
            continue
    launcher = shutil.which("py")
    if launcher:
        return [launcher, "-3"]
    return None


DEFAULT_SETTINGS = {
    "theme": "cupertino",
    "font": "serif",
    "size": 19,
    "lh": 1.78,
    "width": 720,
    "justify": True,
}


SAFE_EXT = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".avif", ".svg"}

class Store:
    def __init__(self) -> None:
        for d in (DATA, BOOKS, CACHE, BACKUPS):
            d.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()
        self.data = self._load()

    def _load(self) -> dict:
        base = {
            "books": {},
            "progress": {},
            "highlights": [],
            "favorites": [],
            "collections": [],
            "collection_books": {},
            "book_settings": {},
            "settings": dict(DEFAULT_SETTINGS),
            "created": time.time(),
        }
        try:
            raw = json.loads(STATE_FILE.read_text("utf-8"))
            if isinstance(raw, dict):
                for key, val in raw.items():
                    if key in base and isinstance(val, type(base[key])):
                        base[key] = val
        except Exception:
            pass
        base["settings"] = {**DEFAULT_SETTINGS, **base["settings"]}
        return base

    @property
    def state(self) -> dict:
        return self.data

    def save(self) -> None:
        with self.lock:
            tmp = STATE_FILE.with_suffix(".tmp")
            tmp.write_text(json.dumps(self.data, ensure_ascii=False, indent=1), "utf-8")
            os.replace(tmp, STATE_FILE)


STORE = Store()
META: dict[str, dict] = {}
META_LOCK = threading.Lock()
CHAP: "OrderedDict[str, dict]" = OrderedDict()
CHAP_LOCK = threading.Lock()


def meta_file(book_id: str) -> Path:
    return CACHE / book_id / "meta.json"


def asset_url(book_id: str, path: str) -> str:
    return "/api/asset/%s/%s" % (book_id, quote(path))
