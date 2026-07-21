"""Generate transparent, non-promissory reward-capture scenarios for Robyn.

The model describes fee flow, not investment returns. It intentionally excludes
asset appreciation, taxes, gas, execution losses and token-price speculation.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "research" / "reward-economics.json"

ARCHITECTURES = {
    "bags_adapter_max_creator_share": {
        "pool_fee_bps": 200,
        "creator_share_bps": 5000,
        "basket_share_of_creator_bps": 10000,
        "note": "Bags advertises a 2% swap fee split evenly between protocol and creator; confirm the live deployment and contract-recipient behavior before relying on this.",
    },
    "pons_adapter": {
        "pool_fee_bps": 100,
        "creator_share_bps": 7000,
        "basket_share_of_creator_bps": 10000,
        "note": "pons advertises 70% of a 1% trading fee for creators; confirm the live fee-wallet implementation before relying on it.",
    },
    "alloy_advertised": {
        "pool_fee_bps": 100,
        "creator_share_bps": 7000,
        "basket_share_of_creator_bps": 10000,
        "note": "Advertised/repository economics only. The inspected old live factory currently reports 0% drip and 100% creator allocation.",
    },
    "vladdy_stock_mode_1pct": {
        "pool_fee_bps": 100,
        "creator_share_bps": 7500,
        "basket_share_of_creator_bps": 10000,
        "note": "Live V4 platformBps is 25%; stock mode routes the remaining share to a single stock reserve.",
    },
    "vladdy_stock_mode_5pct": {
        "pool_fee_bps": 500,
        "creator_share_bps": 7500,
        "basket_share_of_creator_bps": 10000,
        "note": "High-fee scenario based on the four inspected 5% stock-mode launches; likely creates a major trading-friction tradeoff.",
    },
    "robyn_native_reference": {
        "pool_fee_bps": 100,
        "creator_share_bps": 7500,
        "basket_share_of_creator_bps": 10000,
        "note": "Planning assumption, not a deployed configuration: 1% pool fee and 75% of that fee to holder rewards.",
    },
}

DAILY_VOLUMES_USD = [1_000, 10_000, 100_000]
MARKET_CAPS_USD = [50_000, 250_000, 1_000_000]
EXECUTION_LOSS_BPS = [0, 50, 200]


def capture_rate(config: dict) -> float:
    return (
        config["pool_fee_bps"]
        / 10_000
        * config["creator_share_bps"]
        / 10_000
        * config["basket_share_of_creator_bps"]
        / 10_000
    )


def main() -> None:
    output = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "warning": "Scenario model only. Values are fee flows, not promised yield or APY.",
        "formulae": {
            "gross_daily_rewards_usd": "daily_volume_usd * pool_fee_rate * creator_share * basket_share",
            "net_daily_rewards_usd": "gross_daily_rewards_usd * (1 - execution_loss_rate)",
            "illustrative_annual_reward_to_market_cap": "net_daily_rewards_usd * 365 / market_cap_usd",
        },
        "excluded": [
            "token or basket price changes",
            "gas and keeper costs",
            "taxes and regulatory costs",
            "market impact beyond the selected execution-loss scenario",
            "failed or delayed conversions",
            "holder dilution and wallet-level holding duration",
        ],
        "architectures": {},
    }
    for name, config in ARCHITECTURES.items():
        rate = capture_rate(config)
        rows = []
        for volume in DAILY_VOLUMES_USD:
            gross = volume * rate
            for loss_bps in EXECUTION_LOSS_BPS:
                net = gross * (1 - loss_bps / 10_000)
                rows.append(
                    {
                        "daily_volume_usd": volume,
                        "execution_loss_bps": loss_bps,
                        "gross_daily_rewards_usd": round(gross, 2),
                        "net_daily_rewards_usd": round(net, 2),
                        "illustrative_annual_reward_to_market_cap": {
                            str(cap): round(net * 365 / cap, 6) for cap in MARKET_CAPS_USD
                        },
                    }
                )
        output["architectures"][name] = {
            **config,
            "gross_reward_capture_bps_of_volume": round(rate * 10_000, 4),
            "scenarios": rows,
        }
    OUTPUT.write_text(json.dumps(output, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {OUTPUT}")


if __name__ == "__main__":
    main()
