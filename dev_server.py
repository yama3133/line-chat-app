# -*- coding: utf-8 -*-
"""ローカル動作確認用サーバー（Vercelでは使わない）。
  python3 dev_server.py  → http://localhost:8000
GET / で index.html、POST /api/generate で api/generate.py の build_pptx を実行。
"""
import json, os, sys
from http.server import BaseHTTPRequestHandler, HTTPServer

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "api"))
from generate import build_pptx  # noqa

ROOT = os.path.dirname(__file__)
PORT = int(os.environ.get("PORT", "8000"))


class Dev(BaseHTTPRequestHandler):
    def log_message(self, *a):  # 静かに
        pass

    def do_GET(self):
        path = "/index.html" if self.path in ("/", "") else self.path
        fp = os.path.join(ROOT, path.lstrip("/").split("?")[0])
        if os.path.isfile(fp):
            self.send_response(200)
            ct = "text/html; charset=utf-8" if fp.endswith(".html") else "application/octet-stream"
            self.send_header("Content-Type", ct); self.end_headers()
            with open(fp, "rb") as f:
                self.wfile.write(f.read())
        else:
            self.send_response(404); self.end_headers(); self.wfile.write(b"not found")

    def do_POST(self):
        if self.path.split("?")[0] != "/api/generate":
            self.send_response(404); self.end_headers(); return
        try:
            n = int(self.headers.get("content-length", 0))
            data = json.loads(self.rfile.read(n) or b"{}")
            if not data.get("conversation"):
                raise ValueError("conversation is empty")
            pptx = build_pptx(data)
        except Exception as e:
            self.send_response(400); self.send_header("Content-Type", "application/json")
            self.end_headers(); self.wfile.write(json.dumps({"error": str(e)}).encode()); return
        self.send_response(200)
        self.send_header("Content-Type",
                         "application/vnd.openxmlformats-officedocument.presentationml.presentation")
        self.send_header("Content-Disposition", 'attachment; filename="line_chat.pptx"')
        self.send_header("Content-Length", str(len(pptx)))
        self.end_headers(); self.wfile.write(pptx)


if __name__ == "__main__":
    print(f"▶ http://localhost:{PORT}")
    HTTPServer(("0.0.0.0", PORT), Dev).serve_forever()
