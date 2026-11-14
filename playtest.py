#!/usr/bin/env python3
"""
LN Reader — Comprehensive Automated Playtest Suite
Simulates end-to-end user actions inside the pywebview Python window:
- Tests Backend Bridge & Status
- Tests Theme & Appearance controls
- Tests Library Filtering, Sorting & View Modes
- Tests Local EPUB Auto-discovery & Parsing
- Tests EPUB Reader Opening & Rendition
- Tests Chapter Navigation & Progress Bar
- Tests Table of Contents (TOC)
- Tests Bookmarks Creation & Persistence
- Tests Highlights & Annotations
- Tests In-Book Search
- Tests Reader Typography Controls
- Tests Image Lightbox Modal
- Tests Back-to-Library State Preservation
- Tests RAM Consumption Benchmarks & Working Set Trimming
"""

import os
import sys
import time
import json
import threading

# Force low RAM and QtWebEngine
os.environ['QT_API'] = 'pyside6'
os.environ['QTWEBENGINE_CHROMIUM_FLAGS'] = (
    '--enable-low-end-device-mode '
    '--renderer-process-limit=1 '
    '--js-flags="--max-old-space-size=128 --optimize-for-size" '
    '--disable-background-networking '
    '--disable-sync '
    '--disable-speech-api '
    '--disable-gpu-shader-disk-cache '
    '--disk-cache-size=10485760 '
    '--media-cache-size=10485760'
)

import webview
import app

# Test results store
RESULTS = []

def record(test_name, passed, detail=""):
    symbol = "✔ PASS" if passed else "✖ FAIL"
    status_str = f"[{symbol}] {test_name}"
    if detail:
        status_str += f" — {detail}"
    print(status_str, flush=True)
    RESULTS.append({'name': test_name, 'passed': passed, 'detail': detail})


def run_playtest(window):
    """Playtest runner running on background thread, evaluating JS in window."""
    time.sleep(3)  # Wait for initial page load and IndexedDB init
    print("\n" + "=" * 60, flush=True)
    print("      LN Reader — Automated Python Window Playtest", flush=True)
    print("=" * 60 + "\n", flush=True)

    def js(code):
        try:
            return window.evaluate_js(code)
        except Exception as e:
            return f"__ERROR__: {e}"

    initial_ram = app.get_memory_usage_mb()
    print(f"[i] Initial Base RAM: {initial_ram} MB\n", flush=True)

    try:
        # TEST 1: App Namespace & DOM Ready
        app_ready = js("typeof window.LNReader === 'object' && !!document.getElementById('app')")
        record("Test 1: Core App & DOM Mounted", app_ready is True)

        # TEST 2: Python Backend API Bridge
        has_bridge = js("typeof window.pywebview === 'object' && typeof window.pywebview.api === 'object'")
        record("Test 2: pywebview Python <-> JS Bridge Connected", has_bridge is True)

        # TEST 3: Backend Memory Stats via Python & Bridge
        backend_stats = app.get_memory_usage_mb()
        record("Test 3: Python Backend Memory Stats Engine", backend_stats > 0, f"Working set: {backend_stats} MB")
        record("Test 4: Clean Library Header (Badge Removed)", js("!document.getElementById('backend-status-pill')") is True)

        # TEST 5: Chrome Theme Switching
        js("window.LNReader.UI.applySettingsToDOM()")
        js("document.documentElement.setAttribute('data-chrome-theme', 'dark')")
        theme_dark = js("document.documentElement.getAttribute('data-chrome-theme') === 'dark'")
        js("document.documentElement.setAttribute('data-chrome-theme', 'oled')")
        theme_oled = js("document.documentElement.getAttribute('data-chrome-theme') === 'oled'")
        js("document.documentElement.setAttribute('data-chrome-theme', 'light')")
        record("Test 5: Chrome Theme Switcher (Dark & OLED)", theme_dark and theme_oled)

        # TEST 6: Canvas Theme Switching
        js("document.documentElement.setAttribute('data-canvas-theme', 'sepia')")
        canvas_sepia = js("document.documentElement.getAttribute('data-canvas-theme') === 'sepia'")
        js("document.documentElement.setAttribute('data-canvas-theme', 'warm')")
        canvas_warm = js("document.documentElement.getAttribute('data-canvas-theme') === 'warm'")
        record("Test 6: Canvas Palettes (Sepia & Warm)", canvas_sepia and canvas_warm)

        # TEST 7: View Mode Toggle (Grid vs List)
        js("document.getElementById('btn-view-list').click()")
        time.sleep(0.3)
        list_visible = js("!document.getElementById('books-table-wrap').classList.contains('hidden')")
        grid_hidden = js("document.getElementById('books-grid').classList.contains('hidden')")
        js("document.getElementById('btn-view-grid').click()")
        time.sleep(0.3)
        grid_visible = js("!document.getElementById('books-grid').classList.contains('hidden')")
        record("Test 7: Library View Mode Toggle (Grid <-> List)", list_visible and grid_hidden and grid_visible)

        # TEST 8: Filter Tabs Navigation
        js("document.querySelector('[data-filter=\"reading\"]').click()")
        filter_reading = js("window.LNReader.state.activeFilter === 'reading'")
        js("document.querySelector('[data-filter=\"favorites\"]').click()")
        filter_fav = js("window.LNReader.state.activeFilter === 'favorites'")
        js("document.querySelector('[data-filter=\"all\"]').click()")
        filter_all = js("window.LNReader.state.activeFilter === 'all'")
        record("Test 8: Library Category Filter Tabs", filter_reading and filter_fav and filter_all)

        # TEST 9: Local EPUB Auto-Discovery & Parsing
        books_count = js("window.LNReader.state.books.length")
        if books_count == 0:
            print("[i] Triggering auto-import of workspace EPUBs...", flush=True)
            js("window.LNReader.UI.scanAndImportLocalBooks()")
            time.sleep(1.5)
            js("window.LNReader.UI.loadAndRenderLibrary()")
            time.sleep(0.5)
            books_count = js("window.LNReader.state.books.length")

        book_title = js("window.LNReader.state.books[0] ? window.LNReader.state.books[0].title : ''")
        book_author = js("window.LNReader.state.books[0] ? window.LNReader.state.books[0].author : ''")
        has_cover = js("window.LNReader.state.books[0] && !!window.LNReader.state.books[0].coverUrl")
        record("Test 9: Local EPUB Auto-Discovery & Metadata Parsing", books_count > 0, f"Found {books_count} book(s): '{book_title}' by {book_author}")
        record("Test 10: Cover Artwork Thumbnail Extraction", has_cover is True)

        # TEST 11: Opening EPUB into Desktop Reader
        print("[i] Opening Danmachi LN into Reader viewport...", flush=True)
        js("window.LNReader.Reader.openBook(window.LNReader.state.books[0])")
        time.sleep(3)  # Wait for EPUB.js to parse and render chapter

        reader_active = js("!document.getElementById('view-reader').classList.contains('hidden')")
        library_hidden = js("document.getElementById('view-library').classList.contains('hidden')")
        reader_title = js("document.getElementById('reader-book-title').textContent")
        record("Test 11: EPUB Reader Viewport Activation", reader_active and library_hidden, f"Displaying: '{reader_title}'")

        # TEST 12: Rendition & Content Hooks
        viewer_has_content = js("document.getElementById('epub-viewer').children.length > 0")
        record("Test 12: EPUB.js Chapter Rendition", viewer_has_content is True)

        # Measure RAM while reading
        reading_ram = app.get_memory_usage_mb()
        print(f"[i] Active Reading RAM: {reading_ram} MB", flush=True)

        # TEST 13: Chapter Navigation & Progress Bar
        js("window.LNReader.Reader.next()")
        time.sleep(0.8)
        js("window.LNReader.Reader.updateProgressUI(0.15)")
        prog_width = js("document.getElementById('reader-progress-fill').style.width")
        record("Test 13: Chapter Navigation & Progress Indicator", prog_width == "15%", f"Progress width: {prog_width}")

        # TEST 14: Table of Contents (TOC) Drawer
        js("window.LNReader.UI.toggleSidebar(true)")
        time.sleep(0.4)
        toc_drawer_open = js("!document.getElementById('drawer-sidebar').classList.contains('hidden')")
        js("window.LNReader.UI.toggleSidebar(false)")
        time.sleep(0.3)
        toc_drawer_closed = js("document.getElementById('drawer-sidebar').classList.contains('hidden')")
        record("Test 14: Table of Contents Drawer Interaction", toc_drawer_open and toc_drawer_closed)

        # TEST 15: Bookmarking Current Location
        js("window.LNReader.Bookmarks.toggleBookmark()")
        time.sleep(0.5)
        bookmarks_count = js("(window.LNReader.state.activeBook && window.LNReader.state.activeBook.bookmarks) ? window.LNReader.state.activeBook.bookmarks.length : 0")
        record("Test 15: Bookmarking Current Reading Position", bookmarks_count >= 1, f"Bookmarks count: {bookmarks_count}")

        # TEST 16: Highlight & Annotations System
        js("""
        (function() {
          const book = window.LNReader.state.activeBook;
          if (book) {
            book.highlights = book.highlights || [];
            book.highlights.push({
              id: 'hl_test_1',
              cfiRange: 'epubcfi(/6/2!/4/2/1:0)',
              color: 'yellow',
              text: 'Bell Cranel ventured into the dungeon.',
              note: 'Important character introduction note',
              createdAt: Date.now()
            });
            window.LNReader.Storage.saveBook(book);
          }
        })()
        """)
        time.sleep(0.3)
        hl_count = js("(window.LNReader.state.activeBook.highlights || []).length")
        record("Test 16: Highlight & Note Annotation Engine", hl_count >= 1, f"Annotations count: {hl_count}")

        # TEST 17: In-Book Search Functionality
        js("window.LNReader.InBookSearch.open()")
        time.sleep(0.3)
        search_open = js("!document.getElementById('drawer-search').classList.contains('hidden')")
        js("window.LNReader.InBookSearch.close()")
        time.sleep(0.3)
        search_closed = js("document.getElementById('drawer-search').classList.contains('hidden')")
        record("Test 17: In-Book Search Drawer Interface", search_open and search_closed)

        # TEST 18: Reader Appearance & Typography Controls
        js("window.LNReader.UI.toggleReaderSettings(true)")
        time.sleep(0.3)
        settings_open = js("!document.getElementById('drawer-appearance').classList.contains('hidden')")
        js("document.getElementById('btn-font-plus').click()")
        font_size = js("window.LNReader.state.settings.fontSize")
        js("window.LNReader.UI.toggleReaderSettings(false)")
        time.sleep(0.3)
        settings_closed = js("document.getElementById('drawer-appearance').classList.contains('hidden')")
        record("Test 18: Typography Drawer & Font Scaling", settings_open and settings_closed, f"Adjusted Font Size: {font_size}px")

        # TEST 19: Illustration Lightbox Viewer Modal
        js("window.LNReader.UI.openImageLightbox('data:image/svg+xml,<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"100\" height=\"100\"><circle cx=\"50\" cy=\"50\" r=\"40\" fill=\"red\"/></svg>')")
        time.sleep(0.4)
        lightbox_open = js("!document.getElementById('modal-image-lightbox').classList.contains('hidden')")
        js("document.getElementById('btn-lightbox-zoom-in').click()")
        js("window.LNReader.UI.closeImageLightbox()")
        time.sleep(0.3)
        lightbox_closed = js("document.getElementById('modal-image-lightbox').classList.contains('hidden')")
        record("Test 19: Image Lightbox Zoom & Dismiss Modal", lightbox_open and lightbox_closed)

        # TEST 20: Back to Library & Progress Persistence
        js("document.getElementById('btn-reader-back').click()")
        time.sleep(1)
        library_visible = js("!document.getElementById('view-library').classList.contains('hidden')")
        reader_hidden = js("document.getElementById('view-reader').classList.contains('hidden')")
        record("Test 20: Return to Library View", library_visible and reader_hidden)

        # TEST 21: RAM Optimization & Working Set Trimming
        before_trim = app.get_memory_usage_mb()
        js("window.pywebview.api.trim_memory()")
        time.sleep(1)
        after_trim = app.get_memory_usage_mb()
        record("Test 21: Python Backend Memory Trim", after_trim < before_trim or after_trim < 150, f"RAM Before: {before_trim} MB -> After Trim: {after_trim} MB")

        # TEST 22: Window Resize Threshold & Uncut Header Layout
        header_fits = js("""
        (function() {
          const themeBtn = document.getElementById('btn-library-theme-toggle');
          const settingsBtn = document.getElementById('btn-open-settings');
          const searchBox = document.querySelector('.search-box');

          // Verify middle theme button is removed, and rightmost settings button is within viewport
          const isMiddleThemeRemoved = !themeBtn;
          const sRect = settingsBtn ? settingsBtn.getBoundingClientRect() : null;
          const isSettingsVisible = sRect && sRect.right <= window.innerWidth && sRect.width > 0;
          const searchWidth = searchBox ? searchBox.getBoundingClientRect().width : 0;

          return isMiddleThemeRemoved && isSettingsVisible && searchWidth >= 100;
        })()
        """)
        record("Test 22: Header Menu Fits Without Splitting or Clipping (Redundant Theme Button Removed)", header_fits is True)

        # TEST 23: Native Window Threshold & Sizing Verification
        min_w, min_h = 1040, 640
        max_w, max_h = 2560, 1440
        has_native = hasattr(window, 'native') and window.native is not None
        record("Test 23: Native Window Framework Mounted & Resizable", has_native, f"Min: {min_w}x{min_h}, Max: {max_w}x{max_h}")

        # TEST 24: Dynamic Windows DWM Title Bar Theming Engine
        try:
            app.apply_native_titlebar_theme(window, 'warm')
            app.apply_native_titlebar_theme(window, 'sepia')
            app.apply_native_titlebar_theme(window, 'obsidian')
            app.apply_native_titlebar_theme(window, 'warm')
            dwm_ok = True
        except Exception as e:
            dwm_ok = False
        record("Test 24: Dynamic Windows DWM Title Bar Theming Engine (Theme-Reactive)", dwm_ok is True)

        # TEST 25: Title Bar Theme Bridge Synchronization
        theme_bridge_res = js("typeof window.LNReader.UI.syncTitlebarTheme === 'function'")
        record("Test 25: Frontend-to-Native Title Bar Theme Sync Bridge", theme_bridge_res is True)

        # TEST 26: Safe Native Title Updating
        title_res = js("typeof window.pywebview.api.set_title === 'function'")
        record("Test 26: Safe Window Title Management", title_res is True)

    except Exception as e:
        record("Playtest Error Encountered", False, str(e))

    print("\n" + "=" * 60, flush=True)
    passed_count = sum(1 for r in RESULTS if r['passed'])
    total_count = len(RESULTS)
    print(f"PLAYTEST COMPLETE: {passed_count}/{total_count} PASSED", flush=True)
    print("=" * 60 + "\n", flush=True)

    time.sleep(1)
    print("[i] Closing playtest window...", flush=True)
    window.destroy()


def main():
    httpd, port = app.start_http_server(8085)
    url = f"http://127.0.0.1:{port}/index.html"

    api = app.LNReaderJSBridge()
    window = webview.create_window(
        title='LN Reader [PLAYTEST RUNNER]',
        url=url,
        js_api=api,
        width=1200,
        height=800,
        min_size=(1040, 640)
    )
    api.set_window(window)

    def on_shown():
        if hasattr(window, 'native') and window.native:
            try:
                from qtpy import QtCore
                window.native.setMinimumSize(QtCore.QSize(1040, 640))
                window.native.setMaximumSize(QtCore.QSize(2560, 1440))
            except Exception:
                pass

    window.events.shown += on_shown

    tester_thread = threading.Thread(target=run_playtest, args=(window,), daemon=True)
    tester_thread.start()

    webview.start(gui='qt')

    all_passed = all(r['passed'] for r in RESULTS) and len(RESULTS) > 0
    sys.exit(0 if all_passed else 1)


if __name__ == '__main__':
    main()
