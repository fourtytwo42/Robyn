#!/usr/bin/env python3
import json
import logging
import os
import re
import signal
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import requests
from requests.adapters import HTTPAdapter


CONFIG_PATH = os.environ.get(
    "ROBINHOOD_L1_FAILOVER_CONFIG",
    "/etc/robinhood-l1-failover.json",
)
MAX_REQUEST_BYTES = 32 * 1024 * 1024
RETRYABLE_HTTP = {401, 403, 408, 425, 429, 500, 502, 503, 504}
RETRYABLE_MESSAGES = (
    "block range extends beyond current head",
    "capacity",
    "connection refused",
    "connection reset",
    "free plan",
    "historical state",
    "i/o timeout",
    "internal error",
    "limit exceeded",
    "missing trie node",
    "rate limit",
    "request timeout",
    "temporarily unavailable",
    "timeout",
    "too many request",
    "try again",
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
)
LOG = logging.getLogger("robinhood-l1-failover")


class Provider:
    def __init__(self, raw):
        self.name = raw["name"]
        self.url = raw["url"]
        self.paid = bool(raw.get("paid", False))
        self.connect_timeout = float(raw.get("connectTimeoutSeconds", 4))
        self.read_timeout = float(raw.get("readTimeoutSeconds", 15))
        self.cooldown_base = int(raw.get("cooldownBaseSeconds", 15))
        self.cooldown_max = int(raw.get("cooldownMaxSeconds", 300))
        self.lock = threading.Lock()
        self.consecutive_failures = 0
        self.cooldown_until = 0.0
        self.requests = 0
        self.successes = 0
        self.failures_total = 0
        self.last_error = ""
        self.last_success_epoch = 0.0

    def available(self, now):
        with self.lock:
            return now >= self.cooldown_until

    def record_attempt(self):
        with self.lock:
            self.requests += 1

    def record_success(self):
        with self.lock:
            self.successes += 1
            self.consecutive_failures = 0
            self.cooldown_until = 0.0
            self.last_error = ""
            self.last_success_epoch = time.time()

    def record_failure(self, error):
        with self.lock:
            self.failures_total += 1
            self.consecutive_failures += 1
            delay = min(
                self.cooldown_max,
                self.cooldown_base * (2 ** min(self.consecutive_failures - 1, 5)),
            )
            self.cooldown_until = time.time() + delay
            self.last_error = sanitize(error)
            return delay

    def status(self):
        with self.lock:
            return {
                "name": self.name,
                "paid": self.paid,
                "requests": self.requests,
                "successes": self.successes,
                "failures": self.failures_total,
                "consecutiveFailures": self.consecutive_failures,
                "cooldownSeconds": max(0, round(self.cooldown_until - time.time(), 1)),
                "lastSuccessEpoch": round(self.last_success_epoch, 3),
                "lastError": self.last_error,
            }


with open(CONFIG_PATH, encoding="utf-8") as config_file:
    CONFIG = json.load(config_file)

PROVIDERS = [Provider(item) for item in CONFIG["providers"]]
if not PROVIDERS:
    raise SystemExit("at least one provider is required")
if any(provider.paid for provider in PROVIDERS):
    raise SystemExit("paid providers are prohibited by policy")

LISTEN_HOST = CONFIG.get("listenHost", "127.0.0.1")
LISTEN_PORT = int(CONFIG.get("listenPort", 18545))
THREAD_LOCAL = threading.local()
ACTIVE_LOCK = threading.Lock()
ACTIVE_PROVIDER = None
PAID_FALLBACK_REQUESTS = 0
START_EPOCH = time.time()


def sanitize(value):
    text = str(value)
    for provider in PROVIDERS:
        text = text.replace(provider.url, f"<{provider.name}>")
    text = re.sub(r"/v2/[A-Za-z0-9_-]+", "/v2/<redacted>", text)
    text = re.sub(r"alch_[A-Za-z0-9_-]+", "<redacted>", text)
    return text[:300]


def session():
    current = getattr(THREAD_LOCAL, "session", None)
    if current is None:
        current = requests.Session()
        adapter = HTTPAdapter(pool_connections=8, pool_maxsize=16, max_retries=0)
        current.mount("https://", adapter)
        current.mount("http://", adapter)
        THREAD_LOCAL.session = current
    return current


def transient_json_error(body):
    try:
        payload = json.loads(body)
    except (json.JSONDecodeError, UnicodeDecodeError):
        return True, "malformed JSON response"

    if isinstance(payload, dict):
        errors = [payload.get("error")] if payload.get("error") else []
    elif isinstance(payload, list):
        errors = [
            item.get("error")
            for item in payload
            if isinstance(item, dict) and item.get("error")
        ]
    else:
        return True, "unexpected JSON response type"

    if not errors:
        return False, ""

    rendered = json.dumps(errors, sort_keys=True).lower()
    if any(pattern in rendered for pattern in RETRYABLE_MESSAGES):
        return True, rendered
    return False, ""


def ordered_candidates():
    now = time.time()
    ready = [provider for provider in PROVIDERS if provider.available(now)]
    if ready:
        return ready
    return [
        min(
            PROVIDERS,
            key=lambda provider: provider.status()["cooldownSeconds"],
        )
    ]


def mark_active(provider):
    global ACTIVE_PROVIDER, PAID_FALLBACK_REQUESTS
    with ACTIVE_LOCK:
        changed = ACTIVE_PROVIDER != provider.name
        ACTIVE_PROVIDER = provider.name
        if provider.paid:
            PAID_FALLBACK_REQUESTS += 1
        if changed:
            level = logging.WARNING if provider.paid else logging.INFO
            LOG.log(
                level,
                "active_provider=%s paid=%s",
                provider.name,
                str(provider.paid).lower(),
            )


def forward(body):
    last_error = "no provider attempted"
    for provider in ordered_candidates():
        provider.record_attempt()
        try:
            response = session().post(
                provider.url,
                data=body,
                headers={
                    "Content-Type": "application/json",
                    "Accept": "application/json",
                    "User-Agent": "robinhood-nitro-l1-failover/1.0",
                },
                timeout=(provider.connect_timeout, provider.read_timeout),
            )
        except requests.RequestException as exc:
            last_error = f"transport error: {sanitize(exc)}"
            delay = provider.record_failure(last_error)
            LOG.warning(
                "provider=%s action=circuit_open cooldown=%ss error=%s",
                provider.name,
                delay,
                last_error,
            )
            continue

        retry_json, json_error = transient_json_error(response.content)
        if response.status_code in RETRYABLE_HTTP or retry_json:
            last_error = (
                f"http={response.status_code} {json_error or response.text[:200]}"
            )
            delay = provider.record_failure(last_error)
            LOG.warning(
                "provider=%s action=circuit_open cooldown=%ss error=%s",
                provider.name,
                delay,
                sanitize(last_error),
            )
            continue

        provider.record_success()
        mark_active(provider)
        return response.status_code, response.headers, response.content

    LOG.error("all_providers_failed error=%s", sanitize(last_error))
    payload = json.dumps(
        {
            "jsonrpc": "2.0",
            "id": None,
            "error": {
                "code": -32098,
                "message": "all configured public Ethereum L1 providers failed",
            },
        }
    ).encode()
    return 503, {"Content-Type": "application/json"}, payload


def status_payload():
    with ACTIVE_LOCK:
        active = ACTIVE_PROVIDER
        paid_requests = PAID_FALLBACK_REQUESTS
    return {
        "status": "ok",
        "uptimeSeconds": round(time.time() - START_EPOCH, 1),
        "activeProvider": active,
        "paidFallbackRequests": paid_requests,
        "providers": [provider.status() for provider in PROVIDERS],
    }


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, _format, *_args):
        return

    def do_GET(self):
        if self.path != "/status":
            self.send_error(404)
            return
        body = json.dumps(status_payload(), separators=(",", ":")).encode()
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
        body = self.rfile.read(length)
        status, headers, response_body = forward(body)
        self.send_response(status)
        self.send_header("Content-Type", headers.get("Content-Type", "application/json"))
        self.send_header("Content-Length", str(len(response_body)))
        self.send_header("Connection", "keep-alive")
        self.end_headers()
        self.wfile.write(response_body)


SERVER = ThreadingHTTPServer((LISTEN_HOST, LISTEN_PORT), Handler)
SERVER.daemon_threads = True


def stop_server(_signum, _frame):
    threading.Thread(target=SERVER.shutdown, daemon=True).start()


signal.signal(signal.SIGTERM, stop_server)
signal.signal(signal.SIGINT, stop_server)
LOG.info(
    "listening=%s:%s provider_order=%s",
    LISTEN_HOST,
    LISTEN_PORT,
    ",".join(provider.name for provider in PROVIDERS),
)
SERVER.serve_forever(poll_interval=0.5)
SERVER.server_close()
