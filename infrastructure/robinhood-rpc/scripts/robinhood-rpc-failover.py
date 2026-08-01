#!/usr/bin/env python3
import collections
import json
import logging
import os
import signal
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import requests
from requests.adapters import HTTPAdapter

CONFIG_PATH = os.environ.get("ROBINHOOD_RPC_FAILOVER_CONFIG", "/etc/robinhood-rpc-failover.json")
MAX_REQUEST_BYTES = 32 * 1024 * 1024
RETRYABLE_HTTP = {401, 403, 408, 425, 429, 500, 502, 503, 504}
RETRYABLE_TEXT = ("rate limit", "too many request", "timeout", "temporarily unavailable", "capacity", "internal error")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
LOG = logging.getLogger("robinhood-rpc-failover")

with open(CONFIG_PATH, encoding="utf-8") as handle:
    CONFIG = json.load(handle)
PROVIDERS = CONFIG["providers"]
if not PROVIDERS:
    raise SystemExit("at least one RPC provider is required")
if any(item.get("paid", False) for item in PROVIDERS):
    raise SystemExit("paid providers are prohibited by policy")

EXPECTED_CHAIN = CONFIG["expectedChainId"].lower()
MAX_LAG = int(CONFIG.get("maxLagBlocks", 600))
CANONICAL_DEPTH = int(CONFIG.get("canonicalCheckDepth", 1000))
PROBE_INTERVAL = int(CONFIG.get("probeIntervalSeconds", 10))
LISTEN_HOST = CONFIG.get("listenHost", "0.0.0.0")
LISTEN_PORT = int(CONFIG.get("listenPort", 8547))
LOCK = threading.Lock()
START = time.time()
ACTIVE = None
LOCAL = threading.local()
STATE = {p["name"]: {"healthy": False, "head": 0, "syncing": None, "canonical": None, "failures": 0, "cooldownUntil": 0.0, "lastError": "", "successes": 0, "requests": 0} for p in PROVIDERS}


def session():
    current = getattr(LOCAL, "session", None)
    if current is None:
        current = requests.Session()
        adapter = HTTPAdapter(pool_connections=16, pool_maxsize=32, max_retries=0)
        current.mount("https://", adapter)
        current.mount("http://", adapter)
        LOCAL.session = current
    return current


def rpc(provider, method, params, timeout=(3, 8)):
    response = session().post(provider["url"], json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params}, timeout=timeout)
    response.raise_for_status()
    payload = response.json()
    if payload.get("error"):
        raise RuntimeError(payload["error"].get("message", "JSON-RPC error"))
    return payload.get("result")


def probe_all():
    results = {}
    for provider in PROVIDERS:
        try:
            chain = str(rpc(provider, "eth_chainId", [])).lower()
            if chain != EXPECTED_CHAIN:
                raise RuntimeError(f"wrong chain ID {chain}")
            head = int(rpc(provider, "eth_blockNumber", []), 16)
            if provider.get("local", False):
                syncing = rpc(provider, "eth_syncing", [])
                ok = syncing is False
            else:
                # Many public gateways intentionally disable eth_syncing even
                # when their serving node is current. Head/canonical checks are
                # the authoritative public-provider health signals.
                syncing = False
                ok = True
            results[provider["name"]] = {"ok": ok, "head": head, "syncing": syncing, "error": "" if ok else "provider reports syncing"}
        except Exception as exc:
            results[provider["name"]] = {"ok": False, "head": 0, "syncing": None, "error": f"{type(exc).__name__}: {exc}"[:240]}

    usable_heads = [item["head"] for item in results.values() if item["ok"]]
    reference = max(usable_heads) if usable_heads else 0
    check_block = max(0, reference - CANONICAL_DEPTH)
    hashes = {}
    if check_block:
        tag = hex(check_block)
        for provider in PROVIDERS:
            item = results[provider["name"]]
            if not item["ok"] or reference - item["head"] > MAX_LAG:
                continue
            try:
                block = rpc(provider, "eth_getBlockByNumber", [tag, False])
                if isinstance(block, dict) and block.get("hash"):
                    hashes[provider["name"]] = block["hash"].lower()
                else:
                    item["error"] = "canonical check returned no block"
            except Exception as exc:
                item["error"] = f"canonical check failed: {type(exc).__name__}"[:240]

    majority = None
    if hashes:
        majority, count = collections.Counter(hashes.values()).most_common(1)[0]
        if count < 2 and len(hashes) > 1:
            majority = None

    with LOCK:
        for provider in PROVIDERS:
            name = provider["name"]
            item = results[name]
            lag_ok = bool(reference and item["head"] and reference - item["head"] <= MAX_LAG)
            canonical = None if not hashes or name not in hashes or majority is None else hashes[name] == majority
            healthy = item["ok"] and lag_ok and canonical is not False
            state = STATE[name]
            state.update({"healthy": healthy, "head": item["head"], "syncing": item["syncing"], "canonical": canonical, "lastError": "" if healthy else item["error"] or f"lag {reference - item['head']}"})


def probe_loop():
    while True:
        try:
            probe_all()
        except Exception:
            LOG.exception("health_probe_failed")
        time.sleep(PROBE_INTERVAL)


def ordered_candidates():
    now = time.time()
    with LOCK:
        ready = [p for p in PROVIDERS if STATE[p["name"]]["healthy"] and STATE[p["name"]]["cooldownUntil"] <= now]
        if ready:
            return ready
        return [p for p in PROVIDERS if STATE[p["name"]]["cooldownUntil"] <= now] or list(PROVIDERS)


def record_failure(provider, error):
    with LOCK:
        state = STATE[provider["name"]]
        state["failures"] += 1
        delay = min(300, 10 * (2 ** min(state["failures"] - 1, 5)))
        state["cooldownUntil"] = time.time() + delay
        state["lastError"] = str(error)[:240]
    LOG.warning("provider=%s action=circuit_open cooldown=%ss", provider["name"], delay)


def record_success(provider):
    global ACTIVE
    with LOCK:
        state = STATE[provider["name"]]
        state["failures"] = 0
        state["cooldownUntil"] = 0.0
        state["successes"] += 1
        changed = ACTIVE != provider["name"]
        ACTIVE = provider["name"]
    if changed:
        LOG.info("active_provider=%s", provider["name"])


def transient_json(body):
    try:
        payload = json.loads(body)
    except Exception:
        return True
    errors = [payload.get("error")] if isinstance(payload, dict) and payload.get("error") else []
    if isinstance(payload, list):
        errors = [item.get("error") for item in payload if isinstance(item, dict) and item.get("error")]
    rendered = json.dumps(errors).lower()
    return bool(errors and any(text in rendered for text in RETRYABLE_TEXT))


def forward(body):
    for provider in ordered_candidates():
        with LOCK:
            STATE[provider["name"]]["requests"] += 1
        try:
            response = session().post(provider["url"], data=body, headers={"Content-Type": "application/json", "Accept": "application/json", "User-Agent": "robinhood-public-rpc-failover/1.0"}, timeout=(4, 20))
            if response.status_code in RETRYABLE_HTTP or transient_json(response.content):
                record_failure(provider, f"HTTP {response.status_code}")
                continue
            record_success(provider)
            return response.status_code, response.headers.get("Content-Type", "application/json"), response.content
        except requests.RequestException as exc:
            record_failure(provider, type(exc).__name__)
    body = json.dumps({"jsonrpc": "2.0", "id": None, "error": {"code": -32098, "message": "all configured public Robinhood RPC providers failed"}}).encode()
    return 503, "application/json", body


def status_body():
    with LOCK:
        items = []
        for provider in PROVIDERS:
            state = dict(STATE[provider["name"]])
            state["name"] = provider["name"]
            state["local"] = bool(provider.get("local", False))
            state["cooldownSeconds"] = max(0, round(state.pop("cooldownUntil") - time.time(), 1))
            items.append(state)
        payload = {"status": "ok", "activeProvider": ACTIVE, "expectedChainId": EXPECTED_CHAIN, "paidProviders": 0, "uptimeSeconds": round(time.time() - START, 1), "providers": items}
    return json.dumps(payload, separators=(",", ":")).encode()


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    def log_message(self, _format, *_args):
        return
    def do_GET(self):
        if self.path != "/__status":
            self.send_error(404)
            return
        body = status_body()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
    def do_POST(self):
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self.send_error(400)
            return
        if length <= 0 or length > MAX_REQUEST_BYTES:
            self.send_error(413)
            return
        code, content_type, body = forward(self.rfile.read(length))
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)
    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "content-type")
        self.send_header("Access-Control-Allow-Methods", "POST,OPTIONS")
        self.end_headers()


probe_all()
threading.Thread(target=probe_loop, daemon=True).start()
SERVER = ThreadingHTTPServer((LISTEN_HOST, LISTEN_PORT), Handler)
SERVER.daemon_threads = True
def stop(_signum, _frame):
    threading.Thread(target=SERVER.shutdown, daemon=True).start()
signal.signal(signal.SIGTERM, stop)
signal.signal(signal.SIGINT, stop)
LOG.info("listening=%s:%s provider_order=%s", LISTEN_HOST, LISTEN_PORT, ",".join(item["name"] for item in PROVIDERS))
SERVER.serve_forever(poll_interval=0.5)
