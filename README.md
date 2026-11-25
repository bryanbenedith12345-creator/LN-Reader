# Simple LN Reader

A local-only EPUB reader for light novels. A small Python server runs on
`127.0.0.1`, a native window (or your browser) shows the reading app, and
everything — books, progress, highlights, shelves — stays on your machine.

## Running it

Double-click **Run.bat**. It checks for Python 3.10+, installs `pywebview` the
first time it is needed, and opens the reading window. If `pywebview` is not
available the app falls back to Chrome/Edge in app mode.

```bash
python app/server.py            # normal start
python app/server.py --no-window # just the server, prints the local URL
```

## What it does

**Library**

- Drop `.epub` files anywhere in the window, or use *Add books*.
- Search the shelf, sort by recently read, added, title, author or progress.
- **Shelves.** Every book has a heart: tap it and the book is kept in
  *Favorites*. Create as many named shelves as you like from the sidebar
  (`+` next to *Shelves*), rename or delete them in place, and they appear as
  their own views in the sidebar with live counts.
- **Putting books on shelves** takes three shapes: drag a cover onto a shelf in
  the sidebar, tick several books with *Select* and use the batch bar
  (*Add to shelf* / *Favorite* / *Remove from shelf*), or open a book's details
  and toggle its shelf chips.
- *Search in books* looks inside the full text of every book, not just titles.
- Book details (the button on a cover) let you set your own title, author,
  series and tags without touching the EPUB.

**Reading**

- Chapters are grouped from the table of contents, so a chapter is a real
  chapter and not one XHTML file.
- Reading position is remembered per chapter; the next read resumes exactly
  where you stopped.
- 21 themes, sepia mode (`S`), serif/sans, text size, line height, page width
  and justified text — globally or, with *For this book*, per book.
- Highlights in six colours with notes, searchable from the Highlights view.
- Heart the book you are reading from the reader toolbar (`F`) to keep it in
  *Favorites*.
- Read aloud with the system voice or a Piper voice pack, by sentence or
  paragraph, with word highlighting and follow-along scrolling. Piper voices are
  free, run on the CPU and are added from inside the app (*Read aloud → Add a
  voice*), then kept offline until you remove them.
- Image lightbox with zoom, and *Save as…* writes the picture to disk.

**Your data**

- *Back up everything* writes a zip of the library and your reading history to
  `data/backups` (the last ten are kept); *Restore backup* merges it back.
- Highlights and notes export as Markdown, CSV or an EPUB digest; the app asks
  where to save the file instead of relying on the browser's download folder.

## Layout

```
app/
  server.py              entry point
  lnreader/              the backend (Python standard library only)
    config.py            paths, the JSON store, defaults
    auth.py              the loopback access token
    web.py               HTTP routing
    launcher.py          native window, browser fallback, startup
    epub.py              indexing: metadata, chapter cache, imports
    epub_meta.py         the OPF package: title, spine, contents, cover
    epub_chapters.py     cleaning the pages and grouping chapters
    cleaner.py           the safe HTML subset the reader renders
    queries.py           library, book detail, search payloads
    actions.py           progress, settings, deleting, saving images
    annotations.py       highlights
    shelves.py           favorites and named shelves
    books.py             per-book details and reading settings
    exports.py           Markdown / CSV / EPUB exports
    backup.py            making and restoring backups
    dialogs.py           the native Save-As dialog
    tts.py               Piper voice packs: engine, catalogue, downloads
  ui/                    the reading app (plain HTML, CSS and JavaScript)
    index.html           the shell
    partials/            the reader window, drawers and overlays
    js/                  30 small modules, one job each
    css/                 one file per area of the interface
    img/                 the logo, used as the app mark and page icon
tests/                   pytest suite over synthetic EPUBs
build.bat                builds the stand-alone .exe
build/
  lnreader.spec          PyInstaller recipe (paths resolved from this folder)
  app.ico                the app icon, 16 to 256 px, cut from the logo
  version.txt            the file properties Explorer shows for the exe
```

Motion is kept in one place: `css/base.css` holds the `--dur-*` timings and the
three easings every transition uses, and `js/motion.js` is the single door
panels, menus, toasts and the lightbox are opened and dismissed through, so
they each ease out instead of vanishing. Readers who ask their system for
reduced motion get none of it.

## Development

```bash
pip install -r requirements.txt
python -m pytest tests -q
```

The tests build small EPUBs on the fly, so they never touch your library. Set
`LN_READER_DATA` to point the app at a different data folder, and
`LN_NO_DIALOG=1` to make Save-As dialogs write into that folder instead of
showing a window (used for automated runs).

### Building the exe

Double-click **build.bat**. On its first run it installs PyInstaller, then it
builds with the recipe in `build/` and leaves the app in
`dist\Simple LN Reader\`: `Simple LN Reader.exe` (~5 MB) beside an `_internal`
folder, 25 MB together, no console window and no UPX.

That folder is the whole app — copy it anywhere and run the exe. Books,
downloads and settings are created in `data\` next to it on first start, and a
second double-click brings the running window to the front instead of opening
another copy. Python 3.10+ is needed to *build*; the exe itself runs without
it, and only the optional Piper voice packs look for a Python of their own.

## Safety

- The server only listens on `127.0.0.1`.
- Every API call needs the per-user token that the page receives, so another
  web page cannot drive your library.
- Uploads are capped and backups are checked before they are unpacked.
- Chapter HTML is filtered down to a safe subset before it reaches the reader.

## Notes

- Only EPUBs are supported, and only text-based ones (no fixed-layout or comic
  books).
- Read aloud starts with the voices your operating system provides. Adding a
  Piper voice packs a one-off 22 MB speech engine into `data/tts/runtime` and
  about 60 MB per voice into `data/tts/voices`; both can be deleted from the app
  at any time and nothing leaves the machine.
- The library is a folder of EPUBs plus `data/state.json`; copying that folder
  moves everything, including your shelves.
