"""Collect reproducible Robinhood Chain contract provenance and read-only state.

This script performs no transactions and requires no credentials.
"""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path

import requests
from web3 import Web3


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "research" / "live-contract-audit.json"
BLOCKSCOUT = "https://robinhoodchain.blockscout.com/api/v2"
RPC = "https://rpc.mainnet.chain.robinhood.com"

CONTRACTS = {
    "vladdy_factory": "0x096a26E187D49Ae014e666c57c532a958d7D03d7",
    "vladdy_hook": "0x00514DD955fc83E23898bDde4aa0347C8658c0Cc",
    "vladdy_router": "0x0F550C47746185E3B5Cc92A074c8C659aF654456",
    "vladdy_locker": "0xAa188cC60F2576bD32fB3572AC242866Fa278582",
    "alloy_repository_launchpad": "0x927750E6EebAD299EFDb88f37F830BAD27b0657e",
    "alloy_repository_keeper": "0xA3f7d1fC4Bc08d996C2cD77c1F32cc5F8aE9c4b",
    "alloy_repository_index": "0x0E97c9Ba434Ca51a14b3a843Ae6e1b8D26a8A5d8",
    "alloy_current_launchpad": "0x5a5f18795c545160244068873094d79de12310f2",
    "hoodetf_factory": "0x4F019423f7A58400046cb169F0153aEF2DDc81FB",
    "basket_factory": "0xEedC0E6812D49D1165E501eB8B5Ad53380Df3d75",
    "basket_rebalancer": "0x8c9C42AEf14E7afd38728386D843B76b0eEF3004",
    "basket_fee_distributor": "0xe0d89AB301E564A1B7cAFa4ACa906c0cdB5F95FE",
    "indexpad_factory": "0x2F7bE872eeBfE6D9D010F9757028f389ba2aC2cA",
    "bags_factory": "0xe8Cc4431adF8b5A847C113EF0c6af9043219Cb37",
    "bags_vault": "0x4861446aa7fFd9e67a83cBbAcb1A4B70540B83Aa",
    "pons_factory": "0xA5aAb3F0c6EeadF30Ef1D3Eb997108E976351feB",
}

HIGH_SIGNAL_NAMES = {
    "owner",
    "admin",
    "pause",
    "unpause",
    "upgradeToAndCall",
    "setOwner",
    "setFeeConfig",
    "setStockTokenAllowed",
    "setClaimers",
    "transferOwnership",
    "renounceOwnership",
    "sweep",
    "claim",
    "launch",
    "launchCount",
    "basketCount",
    "allBasketsLength",
    "platformBps",
    "platformWallet",
    "hook",
    "lpLocker",
}


def get_json(path: str) -> dict:
    response = requests.get(f"{BLOCKSCOUT}{path}", timeout=45)
    response.raise_for_status()
    return response.json()


def normalize_sources(contract: dict) -> list[dict]:
    sources: list[dict] = []
    primary = contract.get("source_code")
    if primary:
        sources.append({"file_path": contract.get("file_path"), "source_code": primary})
    for item in contract.get("additional_sources") or []:
        if item.get("source_code"):
            sources.append(item)
    return sources


def source_signals(sources: list[dict]) -> dict:
    joined = "\n".join(item["source_code"] for item in sources)
    spdx = sorted(set(re.findall(r"SPDX-License-Identifier:\s*([^\s*]+)", joined)))
    imports = sorted(set(re.findall(r'import\s+(?:\{[^}]+\}\s+from\s+)?["\']([^"\']+)', joined)))
    return {
        "source_file_count": len(sources),
        "source_files": [item.get("file_path") for item in sources],
        "spdx_identifiers": spdx,
        "imports": imports,
        "mentions_stock_rewards_distributor": "StockRewardsDistributor" in joined,
        "mentions_magnified_accounting": "magnified" in joined.lower(),
        "mentions_amount_out_minimum_zero": bool(
            re.search(r"amountOutMinimum\s*:\s*0|amountOutMinimum\s*=\s*0", joined)
        ),
        "mentions_reentrancy_guard": "ReentrancyGuard" in joined,
        "mentions_safe_erc20": "SafeERC20" in joined,
        "mentions_upgradeability": any(
            term in joined for term in ("UUPSUpgradeable", "upgradeToAndCall", "UpgradeableBeacon")
        ),
    }


def abi_summary(abi: list[dict]) -> dict:
    functions = [entry for entry in abi if entry.get("type") == "function"]
    events = [entry for entry in abi if entry.get("type") == "event"]
    errors = [entry for entry in abi if entry.get("type") == "error"]
    function_names = sorted({entry.get("name") for entry in functions if entry.get("name")})
    return {
        "function_count": len(functions),
        "event_count": len(events),
        "error_count": len(errors),
        "function_names": function_names,
        "high_signal_functions": sorted(set(function_names) & HIGH_SIGNAL_NAMES),
        "event_names": sorted({entry.get("name") for entry in events if entry.get("name")}),
    }


def safe_zero_arg_reads(w3: Web3, address: str, abi: list[dict]) -> dict:
    contract = w3.eth.contract(address=Web3.to_checksum_address(address), abi=abi)
    reads: dict[str, object] = {}
    for entry in abi:
        if (
            entry.get("type") != "function"
            or entry.get("inputs")
            or entry.get("stateMutability") not in {"view", "pure"}
            or not entry.get("outputs")
        ):
            continue
        name = entry.get("name")
        if not name or name in reads:
            continue
        try:
            value = getattr(contract.functions, name)().call()
            if isinstance(value, bytes):
                value = "0x" + value.hex()
            elif isinstance(value, tuple):
                value = list(value)
            reads[name] = value
        except Exception as exc:  # Some views legitimately revert until configured.
            reads[name] = {"error": str(exc)[:240]}
    return reads


def main() -> None:
    w3 = Web3(Web3.HTTPProvider(RPC, request_kwargs={"timeout": 45}))
    result = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "chain_id": w3.eth.chain_id,
        "block_number": w3.eth.block_number,
        "sources": {
            "blockscout_api": BLOCKSCOUT,
            "rpc": RPC,
        },
        "contracts": {},
    }

    for label, address in CONTRACTS.items():
        if not re.fullmatch(r"0x[0-9a-fA-F]{40}", address):
            result["contracts"][label] = {
                "address": address,
                "error": "Invalid EVM address: expected 40 hexadecimal characters after 0x",
            }
            continue
        lookup_address = address.lower()
        address_data = get_json(f"/addresses/{lookup_address}")
        item = {
            "address": address,
            "is_contract": address_data.get("is_contract"),
            "is_verified": address_data.get("is_verified"),
            "name": address_data.get("name"),
            "proxy_type": address_data.get("proxy_type"),
            "implementations": address_data.get("implementations"),
        }
        if item["is_verified"]:
            verified = get_json(f"/smart-contracts/{lookup_address}")
            abi = verified.get("abi") or []
            sources = normalize_sources(verified)
            item.update(
                {
                    "file_path": verified.get("file_path"),
                    "compiler_version": verified.get("compiler_version"),
                    "optimization_enabled": verified.get("optimization_enabled"),
                    "is_partially_verified": verified.get("is_partially_verified"),
                    "certified": verified.get("certified"),
                    "license_type": verified.get("license_type"),
                    "source_signals": source_signals(sources),
                    "abi_summary": abi_summary(abi),
                    "zero_arg_reads": safe_zero_arg_reads(w3, address, abi),
                }
            )
        result["contracts"][label] = item

    OUTPUT.write_text(json.dumps(result, indent=2, default=str) + "\n", encoding="utf-8")
    print(f"Wrote {OUTPUT}")


if __name__ == "__main__":
    main()
