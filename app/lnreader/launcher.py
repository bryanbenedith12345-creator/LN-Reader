"""Native window, browser fallback and the application entry point."""
from __future__ import annotations

import atexit
import json
import os
import subprocess
import sys
import threading
import time
import urllib.request
from http.server import ThreadingHTTPServer

from .config import DATA, UI
from .epub import scan_library
from .web import App

# ------------------------------------------------------------- window open ----
BROWSERS = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    os.path.expandvars(r"%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"),
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
]


def _colorref(value: str) -> int | None:
    """#RRGGBB -> Win32 COLORREF (0x00BBGGRR)."""
    text = str(value or "").strip().lstrip("#")
    if len(text) == 3:
        text = "".join(ch * 2 for ch in text)
    if len(text) != 6:
        return None
    try:
        r, g, b = (int(text[i:i + 2], 16) for i in (0, 2, 4))
    except ValueError:
        return None
    return r | (g << 8) | (b << 16)


def theme_titlebar(hwnd: int, background: str, text: str, dark: bool) -> bool:
    """Paint the native title bar with the active app theme (Windows 11)."""
    if sys.platform != "win32":
        return False
    try:
        import ctypes
        from ctypes import wintypes

        user32 = ctypes.windll.user32
        if not hwnd:
            user32.FindWindowW.argtypes = [wintypes.LPCWSTR, wintypes.LPCWSTR]
            user32.FindWindowW.restype = wintypes.HWND
            hwnd = user32.FindWindowW(None, "Yolala's LN Reader")
        if not hwnd:
            return False
        dwm = ctypes.windll.dwmapi
        dwm.DwmSetWindowAttribute.argtypes = [
            wintypes.HWND, wintypes.DWORD, ctypes.c_void_p, wintypes.DWORD,
        ]
        dwm.DwmSetWindowAttribute.restype = ctypes.c_long

        def set_attr(name: int, value: int) -> bool:
            ref = ctypes.c_uint32(value)
            return dwm.DwmSetWindowAttribute(hwnd, name, ctypes.byref(ref), 4) == 0

        set_attr(20, 1 if dark else 0)          # DWMWA_USE_IMMERSIVE_DARK_MODE
        bg = _colorref(background)
        fg = _colorref(text)
        if bg is not None:
            set_attr(35, bg)                    # DWMWA_CAPTION_COLOR
            set_attr(34, bg)                    # DWMWA_BORDER_COLOR
        if fg is not None:
            set_attr(36, fg)                    # DWMWA_TEXT_COLOR
        return True
    except Exception:
        return False


class TitlebarApi:
    """Tiny JS bridge: the web UI tells the native frame its theme colors."""

    hwnd = 0

    def set_titlebar(self, background: str, text: str, dark: bool = False) -> bool:
        return theme_titlebar(self.hwnd, background, text, dark)


def native_window(url: str) -> bool:
    try:
        import webview  # pywebview - native window (WebView2 on Windows)
    except Exception:
        return False
    try:
        api = TitlebarApi()
        window = webview.create_window(
            "Yolala's LN Reader", url, width=1440, height=920, min_size=(980, 620),
            background_color="#111113", js_api=api,
        )

        def remember_window() -> None:
            try:
                api.hwnd = window.native.Handle.ToInt64()
            except Exception:
                pass

        webview.start(remember_window, debug=False, private_mode=False,
                      storage_path=str(DATA / "webview"))
        return True
    except Exception as exc:
        print(f"[window] native webview unavailable: {exc}", file=sys.stderr, flush=True)
        return False


def browser_window(url: str) -> bool:
    for exe in BROWSERS:
        if exe and os.path.exists(exe):
            try:
                subprocess.run([
                    exe, f"--app={url}", "--window-size=1440,920",
                    f"--user-data-dir={DATA / 'browser'}", "--no-first-run",
                    "--no-default-browser-check", "--disable-features=TranslateUI",
                ], check=False)
                return True
            except Exception:
                continue
    return False


def running_port() -> int | None:
    """Return the port of an already running instance, if any."""
    try:
        info = json.loads((DATA / "instance.json").read_text("utf-8"))
        port = int(info["port"])
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/ping", timeout=0.7) as res:
            if json.loads(res.read().decode("utf-8")).get("ok"):
                return port
    except Exception:
        pass
    return None


def cleanup_instance(port: int) -> None:
    try:
        info = json.loads((DATA / "instance.json").read_text("utf-8"))
        if int(info.get("port")) == port:
            (DATA / "instance.json").unlink(missing_ok=True)
    except Exception:
        pass


def open_client(url: str) -> bool:
    if native_window(url):
        return True
    return browser_window(url)


def main() -> None:
    existing = running_port()
    if existing:
        url = f"http://127.0.0.1:{existing}/"
        if "--no-window" in sys.argv:
            print(url, flush=True)
        elif not open_client(url):
            import webbrowser
            webbrowser.open(url)
        return

    if not UI.exists():
        raise RuntimeError("The ui folder is missing next to server.py")
    scan_library()
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), App)
    httpd.daemon_threads = True
    port = httpd.server_address[1]
    url = f"http://127.0.0.1:{port}/"
    (DATA / "instance.json").write_text(json.dumps({"port": port, "pid": os.getpid()}), "utf-8")
    atexit.register(cleanup_instance, port)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()

    if "--no-window" in sys.argv:
        print(url, flush=True)
        try:
            while True:
                time.sleep(3600)
        except KeyboardInterrupt:
            pass
        return

    print(f"Yolala's LN Reader running at {url}", flush=True)
    if not open_client(url):
        import webbrowser
        webbrowser.open(url)
        deadline = time.time() + 6 * 3600
        while time.time() < deadline:
            time.sleep(5)
            if App.last_ping and time.time() - App.last_ping > 120:
                break
    httpd.shutdown()


def fatal(message: str) -> None:
    try:
        DATA.mkdir(parents=True, exist_ok=True)
        (DATA / "last-error.log").write_text(message, "utf-8")
    except Exception:
        pass
    try:
        print(message, file=sys.stderr, flush=True)
    except Exception:
        pass
    try:
        if sys.platform == "win32":
            import ctypes
            ctypes.windll.user32.MessageBoxW(None, message[-1500:], "Yolala's LN Reader - problem", 0x10)
    except Exception:
        pass
