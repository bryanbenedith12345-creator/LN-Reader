#!/usr/bin/env python3
"""
LN Reader — Server & Application Entry Point
Supports both headless server mode (`python server.py --server-only`) and
desktop pywebview application mode (`python server.py` or `python app.py`).
"""

import sys
import app

if __name__ == '__main__':
    if '--server-only' in sys.argv:
        port = app.DEFAULT_PORT
        if len(sys.argv) > 2 and sys.argv[2].isdigit():
            port = int(sys.argv[2])
        httpd, actual_port = app.start_http_server(port)
        print(f"[i] LN Reader running in headless server mode on http://127.0.0.1:{actual_port}")
        print("Press Ctrl+C to stop.")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n[i] Server stopped cleanly.")
    else:
        app.main()
