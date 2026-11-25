"""Shared test setup: every test runs against a throw-away library folder."""
from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "app"))
sys.path.insert(0, str(Path(__file__).resolve().parent))


@pytest.fixture()
def library(tmp_path, monkeypatch):
    """Point the whole app at a temporary data folder and reload the package."""
    monkeypatch.setenv("LN_READER_DATA", str(tmp_path / "data"))
    for name in list(sys.modules):
        if name == "lnreader" or name.startswith("lnreader."):
            del sys.modules[name]
    import lnreader.config as config

    yield config

    for name in list(sys.modules):
        if name == "lnreader" or name.startswith("lnreader."):
            del sys.modules[name]


@pytest.fixture()
def sample_epub():
    from make_epub import build_epub

    return build_epub()
