#!/usr/bin/env python3
"""Simple LN Reader - start the local server and open the reading window.

The implementation lives in the ``lnreader`` package next to this file:
config (paths/state), cleaner/epub (EPUB parsing), queries, actions,
dialogs, web (HTTP server) and launcher (window + startup).
"""
from __future__ import annotations

import traceback

from lnreader.launcher import fatal, main


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        pass
    except Exception:
        fatal("Simple LN Reader could not start.\n\n" + traceback.format_exc())
