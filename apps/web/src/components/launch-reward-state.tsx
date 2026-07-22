"use client";

import {
  createPublicClient,
  defineChain,
  formatEther,
  http,
  type Address,
} from "viem";
import { useEffect, useMemo, useState } from "react";
import {
  BasketAssetArt,
  type BasketArtSymbol,
} from "@/components/launchpad-visuals";

const vaultAbi = [
  {
    type: "function",
    name: "legCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "leg",
    stateMutability: "view",
    inputs: [{ type: "uint256" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "asset", type: "address" },
          { name: "weightBps", type: "uint16" },
          { name: "pendingBase", type: "uint256" },
          { name: "consumedBase", type: "uint256" },
          { name: "rewardsDeposited", type: "uint256" },
          { name: "pendingSince", type: "uint256" },
        ],
      },
    ],
  },
] as const;

const erc20Abi = [
  {
    type: "function",
    name: "symbol",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "string" }],
  },
] as const;

type LegState = {
  asset: Address;
  symbol: string;
  weightBps: number;
  pendingBase: bigint;
  consumedBase: bigint;
  rewardsDeposited: bigint;
};

function units(value: bigint) {
  return Number(formatEther(value)).toLocaleString(undefined, {
    maximumFractionDigits: 4,
  });
}

export function LaunchRewardState({
  vault,
  indexedBlock,
  detailed = false,
}: {
  vault: string;
  indexedBlock: string | null;
  detailed?: boolean;
}) {
  const [legs, setLegs] = useState<LegState[]>();
  const [chainBlock, setChainBlock] = useState<bigint>();
  const [error, setError] = useState(false);
  const isTestnet = process.env.NEXT_PUBLIC_ROBYN_NETWORK_MODE === "testnet";
  const rpcUrl = isTestnet
    ? (process.env.NEXT_PUBLIC_ROBYN_RPC_URL ??
      "https://rpc.testnet.chain.robinhood.com")
    : "/rpc";
  const client = useMemo(
    () =>
      createPublicClient({
        chain: defineChain({
          id: isTestnet ? 46630 : 31337,
          name: isTestnet
            ? "Robinhood Chain Testnet"
            : "Robyn Controlled Development Network",
          nativeCurrency: isTestnet
            ? { name: "Ether", symbol: "ETH", decimals: 18 }
            : { name: "Dev Ether", symbol: "DEV", decimals: 18 },
          testnet: isTestnet,
          rpcUrls: { default: { http: [rpcUrl] } },
        }),
        transport: http(rpcUrl),
      }),
    [isTestnet, rpcUrl],
  );

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const [count, block] = await Promise.all([
          client.readContract({
            address: vault as Address,
            abi: vaultAbi,
            functionName: "legCount",
          }),
          client.getBlockNumber(),
        ]);
        const next = await Promise.all(
          Array.from({ length: Number(count) }, async (_, index) => {
            const leg = await client.readContract({
              address: vault as Address,
              abi: vaultAbi,
              functionName: "leg",
              args: [BigInt(index)],
            });
            const symbol = await client.readContract({
              address: leg.asset,
              abi: erc20Abi,
              functionName: "symbol",
            });
            return {
              asset: leg.asset,
              symbol,
              weightBps: leg.weightBps,
              pendingBase: leg.pendingBase,
              consumedBase: leg.consumedBase,
              rewardsDeposited: leg.rewardsDeposited,
            };
          }),
        );
        if (active) {
          setLegs(next);
          setChainBlock(block);
        }
      } catch {
        if (active) setError(true);
      }
    })();
    return () => {
      active = false;
    };
  }, [client, vault]);

  const baseSymbol = isTestnet ? "tmUSD" : "mUSD";

  if (error)
    return (
      <p className="metric-unavailable">
        Live reward state unavailable. Indexed configuration remains visible.
      </p>
    );
  if (!legs) return <p className="metric-unavailable">Loading live rewards…</p>;

  return (
    <div className={detailed ? "reward-state detailed" : "reward-state"}>
      {legs.map((leg, index) => (
        <article key={leg.asset}>
          {(
            ["mNVDA", "mSPY", "mETH", "tmNVDA", "tmSPY", "tmETH"] as const
          ).includes(leg.symbol as "mNVDA") ? (
            <BasketAssetArt
              symbol={leg.symbol.replace(/^t/, "") as BasketArtSymbol}
              priority={detailed && index === 0}
            />
          ) : null}
          <div className="reward-leg-heading">
            <strong>{leg.symbol}</strong>
            <span>{leg.weightBps / 100}%</span>
          </div>
          <dl>
            <div>
              <dt>Pending cash</dt>
              <dd>
                {units(leg.pendingBase)} {baseSymbol}
              </dd>
            </div>
            <div>
              <dt>Purchased / deposited</dt>
              <dd>
                {units(leg.rewardsDeposited)} {leg.symbol}
              </dd>
            </div>
            {detailed ? (
              <div>
                <dt>Converted base</dt>
                <dd>
                  {units(leg.consumedBase)} {baseSymbol}
                </dd>
              </div>
            ) : null}
          </dl>
          {detailed ? <code>{leg.asset}</code> : null}
        </article>
      ))}
      <p className="freshness">
        Indexed block {indexedBlock ?? "unavailable"} · live chain block{" "}
        {chainBlock?.toString() ?? "unavailable"} · realized state only
      </p>
    </div>
  );
}
