"""
readymarine_imagetools: the product-photo service the backend calls (never the public).

    GET  /health                       {"ok": true, "busy": n, "models": {...}}
    POST /analyze        body=<image>  what is wrong with the photo (no model, ~0.1 s)
    POST /enhance?mode=  body=<image>  {"image": <base64 JPEG 1200x1200>, "info": {...}}

Built so it can never weigh on the shop: ONE picture at a time (a semaphore), at most
QUEUE_MAX callers waiting behind it (the rest get 503 and retry later), two CPU threads,
lowered priority, and models dropped from memory after ten idle minutes. The container is
also capped by docker-compose (cpus / mem_limit).
"""
import base64
import json
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

import pipeline

MAX_BODY = 20 * 1024 * 1024
QUEUE_MAX = int(os.environ.get('IMAGETOOLS_QUEUE_MAX', '4'))
WORK = threading.Semaphore(1)
_waiting = 0
_waiting_lock = threading.Lock()


class Busy(Exception):
    pass


def run_exclusive(fn, *args):
    global _waiting
    with _waiting_lock:
        if _waiting >= QUEUE_MAX:
            raise Busy()
        _waiting += 1
    try:
        with WORK:
            return fn(*args)
    finally:
        with _waiting_lock:
            _waiting -= 1


class Handler(BaseHTTPRequestHandler):
    server_version = 'imagetools/1'

    def log_message(self, fmt, *args):  # one short line per request, no bodies
        print(f'[imagetools] {self.command} {self.path} {fmt % args}', flush=True)

    def _json(self, status, payload):
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _body(self):
        n = int(self.headers.get('Content-Length') or 0)
        if n <= 0:
            raise pipeline.BadImage('empty body')
        if n > MAX_BODY:
            raise pipeline.BadImage('image larger than 20 MB')
        return self.rfile.read(n)

    def do_GET(self):
        if urlparse(self.path).path == '/health':
            return self._json(200, {
                'ok': True, 'busy': _waiting,
                'models': {'isnet': pipeline.ISNET.loaded, 'sr': pipeline.SR.loaded},
            })
        return self._json(404, {'error': 'not found'})

    def do_POST(self):
        url = urlparse(self.path)
        try:
            if url.path == '/analyze':
                data = self._body()
                return self._json(200, run_exclusive(pipeline.analyze, data))
            if url.path == '/enhance':
                mode = (parse_qs(url.query).get('mode') or ['auto'])[0]
                data = self._body()
                jpeg, info = run_exclusive(pipeline.enhance, data, mode)
                return self._json(200, {'image': base64.b64encode(jpeg).decode(), 'info': info})
            return self._json(404, {'error': 'not found'})
        except Busy:
            return self._json(503, {'error': 'busy', 'retry_after': 5})
        except (pipeline.BadImage, ValueError) as e:
            return self._json(422, {'error': str(e)})
        except Exception as e:  # never leave the caller hanging on a bug
            print(f'[imagetools] error: {e!r}', flush=True)
            return self._json(500, {'error': 'processing failed'})


def _janitor():
    while True:
        time.sleep(60)
        try:
            pipeline.unload_idle_models()
        except Exception as e:
            print(f'[imagetools] unload failed: {e!r}', flush=True)


if __name__ == '__main__':
    try:
        os.nice(10)  # the shop's own processes always come first
    except OSError:
        pass
    threading.Thread(target=_janitor, daemon=True).start()
    port = int(os.environ.get('PORT', '8000'))
    print(f'[imagetools] listening on :{port}', flush=True)
    ThreadingHTTPServer(('0.0.0.0', port), Handler).serve_forever()
