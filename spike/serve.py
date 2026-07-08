#!/usr/bin/env python3
"""No-cache static server for the spike, so the browser never serves stale JS/assets."""
import http.server, socketserver, os
os.chdir(os.path.dirname(os.path.abspath(__file__)))
class H(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()
socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(("127.0.0.1", 8777), H) as httpd:
    print("serving spike/ on http://127.0.0.1:8777/ (no-store)")
    httpd.serve_forever()
