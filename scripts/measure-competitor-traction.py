"""Measure reproducible onchain launch/event counts on Robinhood Chain.

Counts are raw factory events, not unique users, active tokens, quality, volume,
or endorsement. The public RPC is queried read-only in bounded block chunks.
"""

from __future__ import annotations

import json
import time
from datetime import datetime, timezone
from pathlib import Path

import requests
from eth_utils import keccak
from web3 import Web3


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "research" / "competitor-traction.json"
RPC = "https://rpc.mainnet.chain.robinhood.com"
BLOCKSCOUT = "https://robinhoodchain.blockscout.com/api/v2"
CHUNK = 100_000

TARGETS = {
    "bags": {"address": "0xe8Cc4431adF8b5A847C113EF0c6af9043219Cb37", "abi_address": "0x7dfa0131F6c8626F199A2E33E49DfB5660e6Ef1C", "event": "TokenCreated", "start_block": 7_887_315},
    "pons": {"address": "0xA5aAb3F0c6EeadF30Ef1D3Eb997108E976351feB", "event": "TokenLaunched", "start_block": 8_991_118},
}


def get_json(url: str) -> dict:
    error = None
    for attempt in range(4):
        try:
            response = requests.get(url, timeout=45)
            response.raise_for_status()
            return response.json()
        except requests.RequestException as exc:
            error = exc
            time.sleep(1.5 * (attempt + 1))
    raise error  # type: ignore[misc]


def event_topic(abi: list[dict], name: str) -> str:
    event = next(item for item in abi if item.get("type") == "event" and item.get("name") == name)
    signature = f"{name}({','.join(value['type'] for value in event['inputs'])})"
    return "0x" + keccak(text=signature).hex()


def creation_block(address: str) -> int:
    data = get_json(f"{BLOCKSCOUT}/addresses/{address}")
    tx_hash = data.get("creation_tx_hash")
    if not tx_hash:
        raise RuntimeError(f"No creation transaction for {address}")
    tx = get_json(f"{BLOCKSCOUT}/transactions/{tx_hash}")
    return int(tx["block"])


def count_logs(w3: Web3, address: str, topic: str, start: int, end: int) -> int:
    total = 0
    for lower in range(start, end + 1, CHUNK):
        upper = min(lower + CHUNK - 1, end)
        logs = w3.eth.get_logs({"address": Web3.to_checksum_address(address), "topics": [topic], "fromBlock": lower, "toBlock": upper})
        total += len(logs)
        time.sleep(0.03)
    return total


def main() -> None:
    w3 = Web3(Web3.HTTPProvider(RPC, request_kwargs={"timeout": 45}))
    latest = w3.eth.block_number
    results = {}
    for name, target in TARGETS.items():
        abi_address = target.get("abi_address") or target["address"]
        smart = get_json(f"{BLOCKSCOUT}/smart-contracts/{abi_address}")
        abi = smart.get("abi") or []
        topic = event_topic(abi, target["event"])
        # Proxies do not always expose their creation transaction through the
        # explorer address endpoint. These first-code/event search bounds were
        # independently established and are intentionally retained as data.
        start = int(target.get("start_block") or creation_block(target["address"]))
        results[name] = {
            **target,
            "abi_address": abi_address,
            "creation_block": start,
            "event_topic": topic,
            "event_count": count_logs(w3, target["address"], topic, start, latest),
        }
    output = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "chain_id": w3.eth.chain_id,
        "latest_block": latest,
        "methodology": f"eth_getLogs from factory creation block through latest block in {CHUNK:,}-block chunks",
        "warning": "Raw creation-event counts are not active-token, unique-user, quality, liquidity, or revenue counts.",
        "results": results,
    }
    OUTPUT.write_text(json.dumps(output, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({key: value["event_count"] for key, value in results.items()}, indent=2))
    print(f"Wrote {OUTPUT}")


if __name__ == "__main__":
    main()
