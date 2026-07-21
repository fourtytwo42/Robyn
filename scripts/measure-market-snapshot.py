"""Create a read-only Robinhood Chain Stock Token market snapshot.

Canonical identity comes from Robinhood's RHJ API. Pair liquidity and volume are
discovery estimates from Dexscreener and are not executable quotes. Chainlink
feeds are read onchain from BASKET Protocol's verified factory registry.
"""

from __future__ import annotations

import json
import time
from datetime import datetime, timezone
from pathlib import Path

import requests
from web3 import Web3


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "research" / "market-snapshot.json"
RPC = "https://rpc.mainnet.chain.robinhood.com"
BLOCKSCOUT = "https://robinhoodchain.blockscout.com/api/v2"
RHJ_ASSETS = "https://api.robinhood.com/rhj/assets"
DEXSCREENER = "https://api.dexscreener.com/latest/dex/tokens"
BASKET_FACTORY = "0xEedC0E6812D49D1165E501eB8B5Ad53380Df3d75"

FEED_ABI = [
    {
        "inputs": [],
        "name": "decimals",
        "outputs": [{"type": "uint8"}],
        "stateMutability": "view",
        "type": "function",
    },
    {
        "inputs": [],
        "name": "description",
        "outputs": [{"type": "string"}],
        "stateMutability": "view",
        "type": "function",
    },
    {
        "inputs": [],
        "name": "latestRoundData",
        "outputs": [
            {"type": "uint80"},
            {"type": "int256"},
            {"type": "uint256"},
            {"type": "uint256"},
            {"type": "uint80"},
        ],
        "stateMutability": "view",
        "type": "function",
    },
]


def get_json(url: str) -> dict:
    response = requests.get(url, timeout=45)
    response.raise_for_status()
    return response.json()


def canonical_assets() -> list[dict]:
    raw = get_json(RHJ_ASSETS).get("assets", [])
    items = []
    for asset in raw:
        deployment = next(
            (item for item in asset.get("deployments", []) if int(item.get("chainId", 0)) == 4663),
            None,
        )
        if not deployment:
            continue
        items.append(
            {
                "symbol": asset.get("tokenSymbol"),
                "name": asset.get("tokenName"),
                "address": deployment.get("contractAddress"),
                "status": asset.get("status"),
                "multiplier": asset.get("currentMultiplier"),
            }
        )
    return sorted(items, key=lambda item: item["symbol"] or "")


def pair_snapshot(token: dict) -> dict:
    raw = get_json(f"{DEXSCREENER}/{token['address']}")
    pairs = [pair for pair in raw.get("pairs") or [] if "robinhood" in pair.get("chainId", "").lower()]

    def number(value) -> float:
        try:
            return float(value or 0)
        except (TypeError, ValueError):
            return 0.0

    normalized = []
    token_address = token["address"].lower()
    for pair in pairs:
        base = pair.get("baseToken") or {}
        quote = pair.get("quoteToken") or {}
        other = quote if base.get("address", "").lower() == token_address else base
        normalized.append(
            {
                "dex": pair.get("dexId"),
                "pair": pair.get("pairAddress"),
                "other_symbol": other.get("symbol"),
                "other_address": other.get("address"),
                "price_usd": number(pair.get("priceUsd")),
                "liquidity_usd": number((pair.get("liquidity") or {}).get("usd")),
                "volume_24h_usd": number((pair.get("volume") or {}).get("h24")),
                "created_at_ms": pair.get("pairCreatedAt"),
            }
        )
    normalized.sort(key=lambda item: item["liquidity_usd"], reverse=True)
    direct_usdg = [item for item in normalized if item["other_symbol"] == "USDG"]
    direct_eth = [item for item in normalized if item["other_symbol"] in {"ETH", "WETH"}]
    return {
        **token,
        "pair_count_returned": len(normalized),
        "aggregate_liquidity_usd": sum(item["liquidity_usd"] for item in normalized),
        "aggregate_volume_24h_usd": sum(item["volume_24h_usd"] for item in normalized),
        "top_pair": normalized[0] if normalized else None,
        "top_usdg_pair": direct_usdg[0] if direct_usdg else None,
        "top_eth_pair": direct_eth[0] if direct_eth else None,
        "pairs": normalized[:5],
    }


def basket_feeds(w3: Web3) -> list[dict]:
    verified = get_json(f"{BLOCKSCOUT}/smart-contracts/{BASKET_FACTORY.lower()}")
    factory = w3.eth.contract(address=Web3.to_checksum_address(BASKET_FACTORY), abi=verified["abi"])
    count = factory.functions.supportedTokenCount().call()
    feeds = []
    now = int(datetime.now(timezone.utc).timestamp())
    for index in range(count):
        token = factory.functions.supportedTokens(index).call()
        feed = factory.functions.feedOf(token).call()
        item = {"token": token, "feed": feed}
        try:
            aggregator = w3.eth.contract(address=feed, abi=FEED_ABI)
            decimals = aggregator.functions.decimals().call()
            round_id, answer, started_at, updated_at, answered_in_round = (
                aggregator.functions.latestRoundData().call()
            )
            item.update(
                {
                    "description": aggregator.functions.description().call(),
                    "decimals": decimals,
                    "answer": str(answer),
                    "price": answer / (10**decimals),
                    "round_id": str(round_id),
                    "started_at": started_at,
                    "updated_at": updated_at,
                    "age_seconds": now - updated_at,
                    "answered_in_round": str(answered_in_round),
                }
            )
        except Exception as exc:
            item["error"] = str(exc)[:300]
        feeds.append(item)
    return feeds


def auth_probe(url: str) -> dict:
    response = requests.get(url, timeout=30)
    return {"url": url, "status": response.status_code, "body": response.text[:300]}


def main() -> None:
    w3 = Web3(Web3.HTTPProvider(RPC, request_kwargs={"timeout": 45}))
    assets = canonical_assets()
    markets = []
    for index, asset in enumerate(assets):
        try:
            markets.append(pair_snapshot(asset))
        except Exception as exc:
            markets.append({**asset, "error": str(exc)[:300]})
        if index and index % 25 == 0:
            time.sleep(1)

    by_address = {item["address"].lower(): item for item in assets}
    feeds = basket_feeds(w3)
    for feed in feeds:
        asset = by_address.get(feed["token"].lower())
        if asset:
            feed["symbol"] = asset["symbol"]

    usdg = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168"
    nvda = next(item["address"] for item in assets if item["symbol"] == "NVDA")
    result = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "chain_id": w3.eth.chain_id,
        "block_number": w3.eth.block_number,
        "methodology": {
            "identity": "Canonical assets from Robinhood RHJ API.",
            "pair_data": "Dexscreener discovery estimates; not executable quotes and not summed TVL.",
            "oracle_data": "Direct onchain latestRoundData reads from feeds listed by verified BASKET factory.",
        },
        "sources": {
            "rhj_assets": RHJ_ASSETS,
            "dexscreener": DEXSCREENER,
            "rpc": RPC,
            "basket_factory": BASKET_FACTORY,
        },
        "asset_count": len(assets),
        "markets": markets,
        "basket_registered_feeds": feeds,
        "authenticated_quote_api_probes": [
            auth_probe(
                "https://api.0x.org/swap/allowance-holder/quote"
                f"?chainId=4663&sellToken={usdg}&buyToken={nvda}&sellAmount=100000000"
                "&taker=0x0000000000000000000000000000000000000001"
            ),
            auth_probe(
                "https://api.1inch.dev/swap/v6.1/4663/quote"
                f"?src={usdg}&dst={nvda}&amount=100000000"
            ),
        ],
    }
    OUTPUT.write_text(json.dumps(result, indent=2, default=str) + "\n", encoding="utf-8")
    print(f"Wrote {OUTPUT}")


if __name__ == "__main__":
    main()
