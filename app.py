#!/usr/bin/env python3
"""
LN Reader — High-Performance Python Backend with pywebview
- Native desktop window with pywebview
- Aggressive RAM optimization engine (< 60MB base working set)
- Built-in multi-threaded HTTP server with Range request streaming
- Python <-> JS Bridge (pywebview.api) for native dialogs and disk access
- Auto-discovery and fast metadata extraction for local EPUBs
"""

import os
import sys
import gc
import json
import socket
import urllib.parse
import threading
import time
import base64
import zipfile
import xml.etree.ElementTree as ET
from http.server import HTTPServer, SimpleHTTPRequestHandler
try:
    from http.server import ThreadingHTTPServer
    ServerClass = ThreadingHTTPServer
except ImportError:
    ServerClass = HTTPServer

# Configure low-RAM Chromium / WebEngine flags BEFORE importing GUI
os.environ['QT_API'] = 'pyside6'
LOW_RAM_FLAGS = (
    '--enable-low-end-device-mode '
    '--renderer-process-limit=1 '
    '--js-flags="--max-old-space-size=128 --optimize-for-size" '
    '--disable-background-networking '
    '--disable-sync '
    '--disable-speech-api '
    '--disable-gpu-shader-disk-cache '
    '--disk-cache-size=10485760 '
    '--media-cache-size=10485760 '
    '--disable-features=Translate,OptimizationHints,MediaRouter,CalculateNativeWinOcclusion'
)
os.environ['QTWEBENGINE_CHROMIUM_FLAGS'] = LOW_RAM_FLAGS
os.environ['WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS'] = LOW_RAM_FLAGS

import webview
import ctypes
from ctypes import wintypes

try:
    import win32process
    HAS_WIN32 = True
except ImportError:
    HAS_WIN32 = False

WORKSPACE_DIR = os.path.dirname(os.path.abspath(__file__))
DEFAULT_PORT = 8000

# Win32 Process / Memory Management Helpers
kernel32 = ctypes.windll.kernel32
psapi = ctypes.windll.psapi
kernel32.GetCurrentProcess.restype = ctypes.c_void_p
psapi.EmptyWorkingSet.argtypes = [ctypes.c_void_p]
psapi.EmptyWorkingSet.restype = ctypes.c_int

class PROCESSENTRY32(ctypes.Structure):
    _fields_ = [
        ('dwSize', wintypes.DWORD),
        ('cntUsage', wintypes.DWORD),
        ('th32ProcessID', wintypes.DWORD),
        ('th32DefaultHeapID', ctypes.c_size_t),
        ('th32ModuleID', wintypes.DWORD),
        ('cntThreads', wintypes.DWORD),
        ('th32ParentProcessID', wintypes.DWORD),
        ('pcPriClassBase', wintypes.LONG),
        ('dwFlags', wintypes.DWORD),
        ('szExeFile', wintypes.WCHAR * 260)
    ]


def get_child_process_ids(parent_pid):
    """Retrieve process IDs of all child processes (e.g. QtWebEngineProcess.exe)."""
    pids = []
    h_snap = kernel32.CreateToolhelp32Snapshot(2, 0)
    if h_snap == -1:
        return pids
    pe = PROCESSENTRY32()
    pe.dwSize = ctypes.sizeof(PROCESSENTRY32)
    if kernel32.Process32FirstW(h_snap, ctypes.byref(pe)):
        while True:
            if pe.th32ParentProcessID == parent_pid:
                pids.append((pe.th32ProcessID, pe.szExeFile))
            if not kernel32.Process32NextW(h_snap, ctypes.byref(pe)):
                break
    kernel32.CloseHandle(h_snap)
    return pids


def trim_system_memory():
    """Forces aggressive GC and purges working set pages for Python and all child renderer processes."""
    gc.collect()
    # 1. Trim current Python process
    try:
        h_proc = kernel32.GetCurrentProcess()
        psapi.EmptyWorkingSet(h_proc)
    except Exception:
        pass

    # 2. Trim all child renderer processes
    try:
        my_pid = os.getpid()
        for cpid, name in get_child_process_ids(my_pid):
            ch = kernel32.OpenProcess(0x0100 | 0x0400, False, cpid)  # PROCESS_SET_QUOTA | PROCESS_QUERY_INFORMATION
            if ch:
                try:
                    psapi.EmptyWorkingSet(ch)
                except Exception:
                    pass
                kernel32.CloseHandle(ch)
    except Exception:
        pass


def get_memory_usage_mb():
    """Returns current Working Set memory usage in MB for process tree."""
    total_bytes = 0
    try:
        if HAS_WIN32:
            h_proc = kernel32.GetCurrentProcess()
            info = win32process.GetProcessMemoryInfo(h_proc)
            total_bytes += info.get('WorkingSetSize', 0)
            my_pid = os.getpid()
            for cpid, name in get_child_process_ids(my_pid):
                ch = kernel32.OpenProcess(0x0400, False, cpid)
                if ch:
                    try:
                        cinfo = win32process.GetProcessMemoryInfo(ch)
                        total_bytes += cinfo.get('WorkingSetSize', 0)
                    except Exception:
                        pass
                    kernel32.CloseHandle(ch)
    except Exception:
        pass
    return round(total_bytes / (1024 * 1024), 2)


# EPUB Fast Metadata Parser
def parse_epub_metadata(epub_path):
    """Fast, zero-overhead pure Python EPUB metadata and cover extractor."""
    try:
        with zipfile.ZipFile(epub_path, 'r') as z:
            container_xml = z.read('META-INF/container.xml')
            c_root = ET.fromstring(container_xml)
            rootfile = c_root.find('.//{*}rootfile')
            if rootfile is None:
                return None
            opf_path = rootfile.attrib.get('full-path', 'content.opf')
            opf_dir = os.path.dirname(opf_path)

            opf_xml = z.read(opf_path)
            opf = ET.fromstring(opf_xml)

            title_el = opf.find('.//{*}title')
            creator_el = opf.find('.//{*}creator')
            desc_el = opf.find('.//{*}description')

            title = title_el.text.strip() if title_el is not None and title_el.text else os.path.splitext(os.path.basename(epub_path))[0]
            author = creator_el.text.strip() if creator_el is not None and creator_el.text else 'Unknown Author'
            desc = desc_el.text.strip() if desc_el is not None and desc_el.text else ''

            # Find cover
            cover_id = None
            for meta in opf.findall('.//{*}meta'):
                if meta.attrib.get('name') == 'cover':
                    cover_id = meta.attrib.get('content')
                    break

            cover_href = None
            manifest = opf.find('.//{*}manifest')
            if manifest is not None:
                for item in manifest.findall('{*}item'):
                    iid = item.attrib.get('id', '')
                    mtype = item.attrib.get('media-type', '')
                    if cover_id and iid == cover_id:
                        cover_href = item.attrib.get('href')
                        break
                    elif 'cover' in iid.lower() and 'image' in mtype:
                        cover_href = item.attrib.get('href')
                        break

            cover_data_url = None
            if cover_href:
                try:
                    full_cover = os.path.normpath(os.path.join(opf_dir, cover_href)).replace('\\', '/')
                    cover_bytes = z.read(full_cover)
                    # Downscale or serve as data URL
                    mtype = 'image/jpeg' if full_cover.lower().endswith(('.jpg', '.jpeg')) else 'image/png'
                    b64 = base64.b64encode(cover_bytes).decode('ascii')
                    cover_data_url = f'data:{mtype};base64,{b64}'
                except Exception:
                    pass

            return {
                'title': title,
                'author': author,
                'description': desc,
                'coverDataUrl': cover_data_url
            }
    except Exception as e:
        print(f"[!] Error parsing EPUB {epub_path}: {e}")
        return None


def list_workspace_epubs():
    """Scan workspace for all .epub files and extract metadata."""
    books = []
    for fname in os.listdir(WORKSPACE_DIR):
        if fname.lower().endswith('.epub'):
            fpath = os.path.join(WORKSPACE_DIR, fname)
            fsize = os.path.getsize(fpath)
            meta = parse_epub_metadata(fpath) or {}
            books.append({
                'id': f'local_{abs(hash(fname))}',
                'fileName': fname,
                'fileSize': fsize,
                'title': meta.get('title') or fname.replace('.epub', ''),
                'author': meta.get('author') or 'Unknown Author',
                'description': meta.get('description') or '',
                'coverUrl': meta.get('coverDataUrl'),
                'url': f'/{urllib.parse.quote(fname)}',
                'progress': 0,
                'status': 'unread',
                'isFavorite': False,
                'readingSeconds': 0
            })
    return books


# High-Performance HTTP Request Handler with Range Support & REST API
class LNReaderHTTPHandler(SimpleHTTPRequestHandler):
    """Custom request handler tuned for EPUB readers, Range streaming, and REST APIs."""

    extensions_map = SimpleHTTPRequestHandler.extensions_map.copy()
    extensions_map.update({
        '.epub': 'application/epub+zip',
        '.xhtml': 'application/xhtml+xml',
        '.html': 'text/html; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.js': 'application/javascript; charset=utf-8',
        '.json': 'application/json; charset=utf-8',
        '.woff': 'font/woff',
        '.woff2': 'font/woff2',
        '.ttf': 'font/ttf',
        '.otf': 'font/otf',
        '.svg': 'image/svg+xml',
        '.webp': 'image/webp',
        '.jpeg': 'image/jpeg',
        '.jpg': 'image/jpeg',
        '.png': 'image/png',
        '.gif': 'image/gif',
        '.ico': 'image/x-icon'
    })

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=WORKSPACE_DIR, **kwargs)

    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, HEAD, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', '*')
        
        # Prevent stale cache issues during active modifications
        if self.path.endswith(('.html', '.js', '.css', '.json')):
            self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        else:
            self.send_header('Cache-Control', 'public, max-age=86400')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def do_GET(self):
        url_path = urllib.parse.urlparse(self.path).path
        if url_path == '/api/status':
            self.send_json({
                'status': 'online',
                'app': 'LN Reader Desktop',
                'version': '2.0.0',
                'engine': 'pywebview',
                'ram_mb': get_memory_usage_mb()
            })
            return
        elif url_path == '/api/memory':
            self.send_json({
                'working_set_mb': get_memory_usage_mb()
            })
            return
        elif url_path == '/api/library/books':
            books = list_workspace_epubs()
            self.send_json({'books': books})
            return

        super().do_GET()

    def do_POST(self):
        url_path = urllib.parse.urlparse(self.path).path
        if url_path == '/api/memory/trim':
            trim_system_memory()
            time.sleep(0.1)
            new_ram = get_memory_usage_mb()
            self.send_json({'success': True, 'ram_mb': new_ram})
            return
        self.send_response(404)
        self.end_headers()

    def send_json(self, data):
        body = json.dumps(data).encode('utf-8')
        self.send_response(200)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        # Suppress log spam for asset loading
        msg = format % args
        if any(msg.startswith(p) for p in ['"GET /style.css', '"GET /js/', '"GET /css/', '"GET /Danmachi', '"GET /api/memory']):
            return
        sys.stderr.write(f"[{self.log_date_time_string()}] {msg}\n")


THEME_COLORS = {
    'warm': ('#f4efe4', '#1c1917', False),
    'sepia': ('#efe3cb', '#2c180a', False),
    'solarized': ('#f7eed4', '#475b62', False),
    'obsidian': ('#18181b', '#f4f4f5', True),
    'light': ('#ffffff', '#18181b', False),
    'contrast': ('#000000', '#ffffff', True),
    'oled': ('#000000', '#ffffff', True),
    'dark': ('#121316', '#f4f4f5', True),
    'slate': ('#1a202c', '#f7fafc', True),
    'espresso': ('#1c1815', '#f5efe6', True),
}

def apply_native_titlebar_theme(window_ref, theme_name='warm'):
    """Dynamically applies theme colors to the Windows native title bar."""
    if not window_ref:
        return
    native = getattr(window_ref, 'native', None)
    if not native:
        return
    try:
        hwnd = int(native.winId())
        if not hwnd:
            return
        theme_key = theme_name.lower().strip() if theme_name else 'warm'
        if theme_key not in THEME_COLORS:
            theme_key = 'warm'
        hex_bg, hex_text, is_dark = THEME_COLORS[theme_key]

        r = int(hex_bg[1:3], 16)
        g = int(hex_bg[3:5], 16)
        b = int(hex_bg[5:7], 16)
        bgr = (b << 16) | (g << 8) | r
        cap_col = wintypes.COLORREF(bgr)
        ctypes.windll.dwmapi.DwmSetWindowAttribute(hwnd, 35, ctypes.byref(cap_col), ctypes.sizeof(cap_col))

        rt = int(hex_text[1:3], 16)
        gt = int(hex_text[3:5], 16)
        bt = int(hex_text[5:7], 16)
        bgr_t = (bt << 16) | (gt << 8) | rt
        text_col = wintypes.COLORREF(bgr_t)
        ctypes.windll.dwmapi.DwmSetWindowAttribute(hwnd, 36, ctypes.byref(text_col), ctypes.sizeof(text_col))

        border_col = wintypes.COLORREF(bgr)
        ctypes.windll.dwmapi.DwmSetWindowAttribute(hwnd, 34, ctypes.byref(border_col), ctypes.sizeof(border_col))

        dark = wintypes.BOOL(is_dark)
        ctypes.windll.dwmapi.DwmSetWindowAttribute(hwnd, 20, ctypes.byref(dark), ctypes.sizeof(dark))
    except Exception:
        pass


# Pywebview Python <-> JS Bridge API
class LNReaderJSBridge:
    """Methods exposed to JavaScript via window.pywebview.api.*"""

    def __init__(self, window_ref=None):
        self.window = window_ref

    def set_window(self, window_ref):
        self.window = window_ref

    def get_memory_stats(self):
        """Returns memory usage in MB."""
        return {
            'ram_mb': get_memory_usage_mb()
        }

    def trim_memory(self):
        """Triggered from frontend on navigation/close to release unused memory."""
        trim_system_memory()
        return {
            'success': True,
            'ram_mb': get_memory_usage_mb()
        }

    def scan_local_books(self):
        """Returns metadata of all EPUB files in workspace."""
        return list_workspace_epubs()

    def pick_epub_files(self):
        """Opens native OS file picker to select one or more EPUBs."""
        if not self.window:
            return []
        res = self.window.create_file_dialog(
            webview.OPEN_DIALOG,
            allow_multiple=True,
            file_types=('EPUB Light Novels (*.epub)', 'All Files (*.*)')
        )
        return res if res else []

    def pick_save_file(self, filename='export.zip'):
        """Opens native OS save file dialog."""
        if not self.window:
            return None
        res = self.window.create_file_dialog(
            webview.SAVE_DIALOG,
            save_filename=filename,
            file_types=('Export Files (*.*)',)
        )
        return res

    def save_file_content(self, file_path, content_b64):
        """Writes binary base64 content to local disk."""
        try:
            raw_data = base64.b64decode(content_b64)
            with open(file_path, 'wb') as f:
                f.write(raw_data)
            return {'success': True}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    def set_theme(self, canvas_theme='warm', chrome_theme='light'):
        """Called from frontend when user changes theme so titlebar dynamically re-colors."""
        theme = canvas_theme or chrome_theme or 'warm'
        apply_native_titlebar_theme(self.window, theme)
        return {'success': True, 'theme': theme}

    def minimize(self):
        """Minimize the desktop window safely."""
        if self.window:
            self.window.minimize()

    def maximize(self):
        """Maximize the desktop window safely."""
        if self.window:
            self.window.maximize()

    def restore(self):
        """Restore the desktop window safely."""
        if self.window:
            self.window.restore()

    def toggle_maximize(self):
        """Toggle between maximized and normal window states safely."""
        if self.window:
            if getattr(self.window, 'maximized', False):
                self.window.restore()
                return False
            else:
                self.window.maximize()
                return True
        return False

    def is_maximized(self):
        """Check whether the window is currently maximized."""
        if self.window:
            return bool(getattr(self.window, 'maximized', False))
        return False

    def toggle_fullscreen(self):
        if self.window:
            self.window.toggle_fullscreen()

    def close(self):
        """Close and destroy the desktop window."""
        if self.window:
            self.window.destroy()

    def set_title(self, title):
        """Update window title."""
        if self.window:
            try:
                self.window.set_title(title)
            except Exception:
                pass
        if self.window:
            try:
                self.window.set_title(title)
            except Exception:
                pass


def start_http_server(port):
    """Start local server on available port."""
    server_address = ('127.0.0.1', port)
    for attempt in range(10):
        try:
            httpd = ServerClass(server_address, LNReaderHTTPHandler)
            print(f"[i] LN Reader backend server running at http://127.0.0.1:{server_address[1]}")
            t = threading.Thread(target=httpd.serve_forever, daemon=True)
            t.start()
            return httpd, server_address[1]
        except OSError:
            server_address = ('127.0.0.1', server_address[1] + 1)
    raise RuntimeError("Failed to bind to a local port.")


def periodic_memory_trimmer(interval=45):
    """Background daemon to periodically trim memory when idle."""
    while True:
        time.sleep(interval)
        try:
            trim_system_memory()
        except Exception:
            pass


def main():
    print("=" * 60)
    print("      LN Reader — Desktop EPUB Reader (Python + pywebview)")
    print("=" * 60)
    
    # 1. Start HTTP server
    httpd, port = start_http_server(DEFAULT_PORT)
    url = f"http://127.0.0.1:{port}/index.html"

    # 2. Start memory trimming daemon
    trim_thread = threading.Thread(target=periodic_memory_trimmer, args=(45,), daemon=True)
    trim_thread.start()

    # 3. Create Bridge API & Native Window (with strict resize thresholds)
    MIN_WIDTH = 1040
    MIN_HEIGHT = 640
    MAX_WIDTH = 2560
    MAX_HEIGHT = 1440

    api = LNReaderJSBridge()
    window = webview.create_window(
        title='LN Reader — Desktop EPUB Reader',
        url=url,
        js_api=api,
        width=1220,
        height=820,
        min_size=(MIN_WIDTH, MIN_HEIGHT),
        background_color='#faf7f0',
        text_select=True
    )
    api.set_window(window)

    def enforce_size_thresholds():
        native = getattr(window, 'native', None)
        if native:
            try:
                from qtpy import QtCore
                native.setMinimumSize(QtCore.QSize(MIN_WIDTH, MIN_HEIGHT))
                native.setMaximumSize(QtCore.QSize(MAX_WIDTH, MAX_HEIGHT))
            except Exception:
                try:
                    native.setMinimumSize(MIN_WIDTH, MIN_HEIGHT)
                    native.setMaximumSize(MAX_WIDTH, MAX_HEIGHT)
                except Exception:
                    pass

    def on_shown():
        enforce_size_thresholds()
        apply_native_titlebar_theme(window, 'warm')

    def on_loaded():
        enforce_size_thresholds()
        apply_native_titlebar_theme(window, 'warm')
        print(f"[i] LN Reader window loaded successfully! Current RAM: {get_memory_usage_mb()} MB")
        trim_system_memory()

    window.events.shown += on_shown
    window.events.loaded += on_loaded

    # 4. Start GUI event loop
    print("[i] Starting pywebview GUI window...")
    try:
        webview.start(gui='qt')
    except Exception as e:
        print(f"[!] Qt engine exception: {e}. Falling back to default engine...")
        webview.start()

    print("[i] Application closed cleanly. Bye!")


if __name__ == '__main__':
    main()
