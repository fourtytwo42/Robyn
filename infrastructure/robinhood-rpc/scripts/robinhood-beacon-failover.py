#!/usr/bin/env python3
import json
import logging
import os
import signal
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import requests
from requests.adapters import HTTPAdapter

CONFIG_PATH = os.environ.get("ROBINHOOD_BEACON_FAILOVER_CONFIG", "/etc/robinhood-beacon-failover.json")
RETRYABLE_HTTP = {401, 403, 408, 425, 429, 500, 502, 503, 504}
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
LOG = logging.getLogger("robinhood-beacon-failover")

with open(CONFIG_PATH, encoding="utf-8") as handle:
    CONFIG = json.load(handle)

PROVIDERS = CONFIG["providers"]
if not PROVIDERS:
    raise SystemExit("at least one public beacon provider is required")
if any(item.get("paid", False) for item in PROVIDERS):
    raise SystemExit("paid providers are prohibited by policy")

LISTEN_HOST = CONFIG.get("listenHost", "127.0.0.1")
LISTEN_PORT = int(CONFIG.get("listenPort", 18546))
LOCK = threading.Lock()
STATE = {item["name"]: {"failures": 0, "cooldownUntil": 0.0, "lastError": "", "successes": 0} for item in PROVIDERS}
ACTIVE = None
START = time.time()
LOCAL = threading.local()


def session():
    current = getattr(LOCAL, "session", None)
    if current is None:
        current = requests.Session()
        adapter = HTTPAdapter(pool_connections=8, pool_maxsize=16, max_retries=0)
        current.mount("https://", adapter)
        current.mount("http://", adapter)
        LOCAL.session = current
    return current


def fail(provider, message):
    with LOCK:
        state = STATE[provider["name"]]
        state["failures"] += 1
        delay = min(300, 10 * (2 ** min(state["failures"] - 1, 5)))
        state["cooldownUntil"] = time.time() + delay
        state["lastError"] = str(message)[:240]
    LOG.warning("provider=%s action=circuit_open cooldown=%ss", provider["name"], delay)


def succeed(provider):
    global ACTIVE
    with LOCK:
        state = STATE[provider["name"]]
        state["failures"] = 0
        state["cooldownUntil"] = 0.0
        state["lastError"] = ""
        state["successes"] += 1
        changed = ACTIVE != provider["name"]
        ACTIVE = provider["name"]
    if changed:
        LOG.info("active_provider=%s", provider["name"])


def candidates():
    now = time.time()
    with LOCK:
        ready = [item for item in PROVIDERS if STATE[item["name"]]["cooldownUntil"] <= now]
    return ready or PROVIDERS


def forward(path, head_only=False):
    last = "no provider available"
    for provider in candidates():
        url = provider["url"].rstrip("/") + path
        try:
            response = session().get(url, headers={"Accept": "application/json", "User-Agent": "robinhood-beacon-failover/1.0"}, timeout=(4, 25), stream=head_only)
            if response.status_code in RETRYABLE_HTTP:
                last = f"HTTP {response.status_code}"
                fail(provider, last)
                continue
            succeed(provider)
            return response.status_code, response.headers, b"" if head_only else response.content
        except requests.RequestException as exc:
            last = type(exc).__name__
            fail(provider, last)
    body = json.dumps({"code": 503, "message": "all configured public beacon providers failed"}).encode()
    return 503, {"Content-Type": "application/json"}, body


def status_body():
    with LOCK:
        providers = []
        for item in PROVIDERS:
            state = dict(STATE[item["name"]])
            state["name"] = item["name"]
            state["cooldownSeconds"] = max(0, round(state.pop("cooldownUntil") - time.time(), 1))
            providers.append(state)
        payload = {"status": "ok", "activeProvider": ACTIVE, "uptimeSeconds": round(time.time() - START, 1), "paidProviders": 0, "providers": providers}
    return json.dumps(payload, separators=(",", ":")).encode()


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    def log_message(self, _format, *_args):
        return
    def do_GET(self):
        if self.path == "/__status":
            body = status_body()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        code, headers, body = forward(self.path)
        self.send_response(code)
        self.send_header("Content-Type", headers.get("Content-Type", "application/json"))
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
    def do_HEAD(self):
        code, headers, _body = forward(self.path, True)
        self.send_response(code)
        self.send_header("Content-Type", headers.get("Content-Type", "application/json"))
        self.send_header("Content-Length", "0")
        self.end_headers()


SERVER = ThreadingHTTPServer((LISTEN_HOST, LISTEN_PORT), Handler)
SERVER.daemon_threads = True
def stop(_signum, _frame):
    threading.Thread(target=SERVER.shutdown, daemon=True).start()
signal.signal(signal.SIGTERM, stop)
signal.signal(signal.SIGINT, stop)
LOG.info("listening=%s:%s provider_order=%s", LISTEN_HOST, LISTEN_PORT, ",".join(item["name"] for item in PROVIDERS))
SERVER.serve_forever(poll_interval=0.5)
