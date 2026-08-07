#!/usr/bin/env python3
"""HTTPS dev server (self-signed) so the webcam / head-steering works on
phones and tablets over the LAN — camera access needs a secure context.
Run:  python3 serve-https.py    then open  https://<your-ip>:8443
(accept the self-signed certificate warning once).
"""
import http.server
import socketserver
import ssl

PORT = 8443
CERT = ".certs/cert.pem"
KEY = ".certs/key.pem"


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()


ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
ctx.load_cert_chain(certfile=CERT, keyfile=KEY)

with socketserver.TCPServer(("0.0.0.0", PORT), NoCacheHandler) as httpd:
    httpd.socket = ctx.wrap_socket(httpd.socket, server_side=True)
    print(f"Serving HTTPS (no-cache) on https://0.0.0.0:{PORT} (reachable on your LAN)")
    httpd.serve_forever()
