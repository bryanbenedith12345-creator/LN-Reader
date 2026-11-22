"""Native Save-As dialog for chapter images."""
from __future__ import annotations

import os
import posixpath
import sys
from pathlib import Path

from .config import DATA

def save_image_dialog(payload: bytes, suggested: str) -> str | None:
    """Ask for a destination and write the image there. Returns the path."""
    ext = posixpath.splitext(suggested)[1].lower() or ".jpg"
    folder = DATA / "images"
    folder.mkdir(parents=True, exist_ok=True)
    if sys.platform != "win32" or os.environ.get("LN_NO_DIALOG"):
        target = folder / suggested
        number = 1
        while target.exists():
            target = folder / f"{Path(suggested).stem} ({number}){ext}"
            number += 1
        target.write_bytes(payload)
        return str(target)

    import ctypes
    from ctypes import wintypes

    class OPENFILENAMEW(ctypes.Structure):
        _fields_ = [
            ("lStructSize", wintypes.DWORD),
            ("hwndOwner", wintypes.HWND),
            ("hInstance", wintypes.HINSTANCE),
            ("lpstrFilter", wintypes.LPCWSTR),
            ("lpstrCustomFilter", wintypes.LPWSTR),
            ("nMaxCustFilter", wintypes.DWORD),
            ("nFilterIndex", wintypes.DWORD),
            ("lpstrFile", wintypes.LPWSTR),
            ("nMaxFile", wintypes.DWORD),
            ("lpstrFileTitle", wintypes.LPWSTR),
            ("nMaxFileTitle", wintypes.DWORD),
            ("lpstrInitialDir", wintypes.LPCWSTR),
            ("lpstrTitle", wintypes.LPCWSTR),
            ("Flags", wintypes.DWORD),
            ("nFileOffset", wintypes.WORD),
            ("nFileExtension", wintypes.WORD),
            ("lpstrDefExt", wintypes.LPCWSTR),
            ("lCustData", wintypes.LPARAM),
            ("lpfnHook", ctypes.c_void_p),
            ("lpTemplateName", wintypes.LPCWSTR),
            ("pvReserved", ctypes.c_void_p),
            ("dwReserved", wintypes.DWORD),
            ("FlagsEx", wintypes.DWORD),
        ]

    buffer = ctypes.create_unicode_buffer(suggested, 2048)
    filters = ctypes.create_unicode_buffer(
        "Image files\0*.jpg;*.jpeg;*.png;*.gif;*.webp;*.bmp;*.avif\0All files\0*.*\0\0"
    )
    dialog = OPENFILENAMEW()
    dialog.lStructSize = ctypes.sizeof(OPENFILENAMEW)
    dialog.hwndOwner = ctypes.windll.user32.FindWindowW(None, "Yolala's LN Reader")
    dialog.lpstrFilter = ctypes.cast(filters, wintypes.LPCWSTR)
    dialog.lpstrFile = ctypes.cast(buffer, wintypes.LPWSTR)
    dialog.nMaxFile = 2048
    dialog.lpstrTitle = "Save image"
    pictures = Path.home() / "Pictures"
    if pictures.is_dir():
        dialog.lpstrInitialDir = str(pictures)
    dialog.lpstrDefExt = ext.lstrip(".")
    dialog.Flags = 0x00080000 | 0x00000002 | 0x00000008 | 0x00000800
    comdlg = ctypes.windll.comdlg32
    comdlg.GetSaveFileNameW.argtypes = [ctypes.POINTER(OPENFILENAMEW)]
    comdlg.GetSaveFileNameW.restype = wintypes.BOOL
    if not comdlg.GetSaveFileNameW(ctypes.byref(dialog)):
        return None
    target = Path(buffer.value)
    if not target.suffix:
        target = target.with_suffix(ext)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(payload)
    return str(target)
