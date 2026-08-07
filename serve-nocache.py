#!/usr/bin/env python3
"""Dev server that disables browser caching, so every reload is fresh."""
import http.server
import socketserver

PORT = 8000


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()


with socketserver.TCPServer(("0.0.0.0", PORT), NoCacheHandler) as httpd:
    print(f"Serving with no-cache on http://0.0.0.0:{PORT} (reachable on your LAN)")
    httpd.serve_forever()
