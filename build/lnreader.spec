# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller recipe for Simple LN Reader.

Build it with build.bat (or: python -m PyInstaller build\\lnreader.spec).
Every path is derived from this file's own folder, so the build works from any
working directory and from a copy of the project.
"""
import os

_spec = globals().get("SPEC") or os.path.join(globals().get("SPECPATH", os.getcwd()), "lnreader.spec")
HERE = os.path.dirname(os.path.abspath(_spec))   # ...\\build
ROOT = os.path.dirname(HERE)                     # the folder holding app\\

APP = os.path.join(ROOT, "app")
UI = os.path.join(APP, "ui")
WORKER = os.path.join(APP, "lnreader", "tts_worker.py")

# None of these are used. pywebview's own hook would pull PyQt6 in (about 70 MB
# of Qt that never runs on Windows, where the WebView2 backend is the one used).
EXCLUDE = [
    "tkinter", "unittest", "pytest", "_pytest", "pip", "pydoc", "doctest",
    "test", "pygame", "numpy",
    "PyQt6", "PyQt5", "PySide6", "PySide2", "qtpy", "shiboken6",
    "gi", "gtk", "cefpython3", "ceftools",
]

a = Analysis(
    [os.path.join(APP, "server.py")],
    pathex=[APP],
    binaries=[],
    datas=[(UI, "ui"), (WORKER, ".")],
    hiddenimports=["webview.platforms.winforms", "clr", "pythonnet", "clr_loader"],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=EXCLUDE,
    noarchive=False,
    optimize=0,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="Simple LN Reader",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=os.path.join(HERE, "app.ico"),
    version=os.path.join(HERE, "version.txt"),
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name="Simple LN Reader",
)
