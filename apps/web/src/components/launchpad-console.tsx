"use client";

import {
  createPublicClient,
  createWalletClient,
  defineChain,
  formatEther,
  http,
  parseEther,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Deployment } from "@/lib/deployment";
import { TokenArt } from "@/components/launchpad-visuals";

const ZERO = "0x0000000000000000000000000000000000000000" as Address;
const factoryAbi = [
  {
    type: "function",
    name: "launchCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "launchTokenById",
    stateMutability: "view",
    inputs: [{ type: "uint256" }],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "vaultByToken",
    stateMutability: "view",
    inputs: [{ type: "address" }],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "creatorByToken",
    stateMutability: "view",
    inputs: [{ type: "address" }],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "createLaunch",
    stateMutability: "nonpayable",
    inputs: [
      { name: "name", type: "string" },
      { name: "symbol", type: "string" },
      { name: "initialSupply", type: "uint256" },
      { name: "assets", type: "address[]" },
      { name: "weights", type: "uint16[]" },
    ],
    outputs: [{ type: "address" }, { type: "address" }],
  },
  {
    type: "function",
    name: "sealLaunchExclusions",
    stateMutability: "nonpayable",
    inputs: [{ type: "address" }, { type: "address[]" }],
    outputs: [],
  },
] as const;
const marketFactoryAbi = [
  {
    type: "function",
    name: "marketByToken",
    stateMutability: "view",
    inputs: [{ type: "address" }],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "createMarket",
    stateMutability: "nonpayable",
    inputs: [{ type: "address" }],
    outputs: [{ type: "address" }],
  },
] as const;
const erc20Abi = [
  {
    type: "function",
    name: "name",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "string" }],
  },
  {
    type: "function",
    name: "symbol",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "string" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [{ type: "address" }, { type: "uint256" }],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "claimAll",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
] as const;
const marketAbi = [
  {
    type: "function",
    name: "seed",
    stateMutability: "nonpayable",
    inputs: [{ type: "uint256" }, { type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "buy",
    stateMutability: "nonpayable",
    inputs: [{ type: "uint256" }, { type: "uint256" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "sell",
    stateMutability: "nonpayable",
    inputs: [{ type: "uint256" }, { type: "uint256" }],
    outputs: [{ type: "uint256" }],
  },
] as const;
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
  {
    type: "function",
    name: "convertLeg",
    stateMutability: "nonpayable",
    inputs: [
      { type: "uint256" },
      { type: "uint256" },
      { type: "uint256" },
      { type: "uint256" },
    ],
    outputs: [{ type: "uint256" }],
  },
] as const;

type Launch = {
  id: bigint;
  token: Address;
  vault: Address;
  market: Address;
  creator: Address;
  name: string;
  symbol: string;
  balance: bigint;
};

function amount(value: bigint) {
  return Number(formatEther(value)).toLocaleString(undefined, {
    maximumFractionDigits: 2,
  });
}

export function LaunchpadConsole({ deployment }: { deployment: Deployment }) {
  const [privateKey, setPrivateKey] = useState<Hex>();
  const [launches, setLaunches] = useState<Launch[]>([]);
  const [name, setName] = useState("My Community");
  const [symbol, setSymbol] = useState("MYCO");
  const [weights, setWeights] = useState([40, 40, 20]);
  const [status, setStatus] = useState(
    "Create or fund a session wallet, then launch.",
  );
  const [busy, setBusy] = useState(false);
  const rpcUrl =
    typeof window === "undefined"
      ? "http://127.0.0.1:8546"
      : "http://" + window.location.hostname + ":8546";
  const chain = useMemo(
    () =>
      defineChain({
        id: deployment.chainId,
        name: "Robyn Controlled Devnet",
        nativeCurrency: { name: "Dev Ether", symbol: "DEV", decimals: 18 },
        rpcUrls: { default: { http: [rpcUrl] } },
      }),
    [deployment.chainId, rpcUrl],
  );
  const publicClient = useMemo(
    () => createPublicClient({ chain, transport: http(rpcUrl) }),
    [chain, rpcUrl],
  );
  const account = useMemo(
    () => (privateKey ? privateKeyToAccount(privateKey) : undefined),
    [privateKey],
  );
  const walletClient = useMemo(
    () =>
      account
        ? createWalletClient({ account, chain, transport: http(rpcUrl) })
        : undefined,
    [account, chain, rpcUrl],
  );

  const loadWallet = useCallback(() => {
    const stored = window.sessionStorage.getItem("robyn-devnet-session-key");
    setPrivateKey(stored?.startsWith("0x") ? (stored as Hex) : undefined);
  }, []);

  const refresh = useCallback(async () => {
    const count = await publicClient.readContract({
      address: deployment.contracts.factory,
      abi: factoryAbi,
      functionName: "launchCount",
    });
    const records: Launch[] = [];
    const first = count > 12n ? count - 11n : 1n;
    for (let id = first; id <= count; id++) {
      const token = await publicClient.readContract({
        address: deployment.contracts.factory,
        abi: factoryAbi,
        functionName: "launchTokenById",
        args: [id],
      });
      const [vault, creator, market, tokenName, tokenSymbol, balance] =
        await Promise.all([
          publicClient.readContract({
            address: deployment.contracts.factory,
            abi: factoryAbi,
            functionName: "vaultByToken",
            args: [token],
          }),
          publicClient.readContract({
            address: deployment.contracts.factory,
            abi: factoryAbi,
            functionName: "creatorByToken",
            args: [token],
          }),
          publicClient.readContract({
            address: deployment.contracts.marketFactory,
            abi: marketFactoryAbi,
            functionName: "marketByToken",
            args: [token],
          }),
          publicClient.readContract({
            address: token,
            abi: erc20Abi,
            functionName: "name",
          }),
          publicClient.readContract({
            address: token,
            abi: erc20Abi,
            functionName: "symbol",
          }),
          account
            ? publicClient.readContract({
                address: token,
                abi: erc20Abi,
                functionName: "balanceOf",
                args: [account.address],
              })
            : Promise.resolve(0n),
        ]);
      records.push({
        id,
        token,
        vault,
        creator,
        market,
        name: tokenName,
        symbol: tokenSymbol,
        balance,
      });
    }
    setLaunches(records.reverse());
  }, [
    account,
    deployment.contracts.factory,
    deployment.contracts.marketFactory,
    publicClient,
  ]);

  useEffect(() => {
    loadWallet();
    window.addEventListener("robyn-wallet-change", loadWallet);
    return () => window.removeEventListener("robyn-wallet-change", loadWallet);
  }, [loadWallet]);

  useEffect(() => {
    void refresh().catch(() => setStatus("Unable to load launch registry."));
  }, [refresh]);

  const submit = useCallback(
    async (
      request: Parameters<NonNullable<typeof walletClient>["writeContract"]>[0],
    ) => {
      if (!walletClient) throw new Error("Create a session wallet first.");
      const hash = await walletClient.writeContract(request);
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success")
        throw new Error("Transaction reverted.");
    },
    [publicClient, walletClient],
  );

  async function createLaunch() {
    if (!account || !walletClient)
      return setStatus("Create and fund a session wallet first.");
    if (!name.trim() || !/^[A-Z0-9]{2,8}$/.test(symbol.trim().toUpperCase()))
      return setStatus("Enter a name and a 2-8 character symbol.");
    if (
      weights.some((weight) => !Number.isInteger(weight) || weight < 0) ||
      weights.reduce((a, b) => a + b, 0) !== 100
    )
      return setStatus(
        "Basket weights must be whole percentages totaling 100.",
      );
    const basket = weights
      .map((weight, index) => ({
        asset: deployment.contracts.rewardAssets[index],
        weight,
      }))
      .filter(
        (item): item is { asset: Address; weight: number } =>
          item.weight > 0 && item.asset !== undefined,
      );
    const baseBalance = await publicClient.readContract({
      address: deployment.contracts.baseAsset,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [account.address],
    });
    if (baseBalance < parseEther("500"))
      return setStatus(
        "Fund the wallet first; launch seeding requires 500 mUSD.",
      );
    setBusy(true);
    try {
      setStatus("1/7 Creating token and immutable basket...");
      await submit({
        address: deployment.contracts.factory,
        abi: factoryAbi,
        functionName: "createLaunch",
        args: [
          name.trim(),
          symbol.trim().toUpperCase(),
          parseEther("1000000000"),
          basket.map((item) => item.asset),
          basket.map((item) => item.weight * 100),
        ],
        account,
      });
      const id = await publicClient.readContract({
        address: deployment.contracts.factory,
        abi: factoryAbi,
        functionName: "launchCount",
      });
      const token = await publicClient.readContract({
        address: deployment.contracts.factory,
        abi: factoryAbi,
        functionName: "launchTokenById",
        args: [id],
      });
      setStatus("2/7 Deploying the fixed-policy market...");
      await submit({
        address: deployment.contracts.marketFactory,
        abi: marketFactoryAbi,
        functionName: "createMarket",
        args: [token],
        account,
      });
      const market = await publicClient.readContract({
        address: deployment.contracts.marketFactory,
        abi: marketFactoryAbi,
        functionName: "marketByToken",
        args: [token],
      });
      setStatus("3/7 Approving market inventory...");
      await submit({
        address: token,
        abi: erc20Abi,
        functionName: "approve",
        args: [market, parseEther("500000000")],
        account,
      });
      setStatus("4/7 Approving base liquidity...");
      await submit({
        address: deployment.contracts.baseAsset,
        abi: erc20Abi,
        functionName: "approve",
        args: [market, parseEther("500")],
        account,
      });
      setStatus("5/7 Seeding token and base liquidity...");
      await submit({
        address: market,
        abi: marketAbi,
        functionName: "seed",
        args: [parseEther("500000000"), parseEther("500")],
        account,
      });
      setStatus("6/7 Sealing the market inventory exclusion...");
      await submit({
        address: deployment.contracts.factory,
        abi: factoryAbi,
        functionName: "sealLaunchExclusions",
        args: [token, [market]],
        account,
      });
      setStatus(
        "Launch complete. Its market is live and basket rules are immutable.",
      );
      await refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Launch failed.");
    } finally {
      setBusy(false);
    }
  }

  async function act(
    launch: Launch,
    kind: "buy" | "sell" | "convert" | "claim",
  ) {
    if (!account) return setStatus("Create and fund a session wallet first.");
    if (launch.market === ZERO)
      return setStatus("This launch does not have a market yet.");
    setBusy(true);
    try {
      if (kind === "buy") {
        setStatus("Approving and buying 990,000 tokens...");
        await submit({
          address: deployment.contracts.baseAsset,
          abi: erc20Abi,
          functionName: "approve",
          args: [launch.market, parseEther("1000")],
          account,
        });
        await submit({
          address: launch.market,
          abi: marketAbi,
          functionName: "buy",
          args: [parseEther("1000"), parseEther("990000")],
          account,
        });
      } else if (kind === "sell") {
        setStatus("Approving and selling 10,000 tokens...");
        await submit({
          address: launch.token,
          abi: erc20Abi,
          functionName: "approve",
          args: [launch.market, parseEther("10000")],
          account,
        });
        await submit({
          address: launch.market,
          abi: marketAbi,
          functionName: "sell",
          args: [parseEther("10000"), parseEther("9.9")],
          account,
        });
      } else if (kind === "convert") {
        setStatus("Converting every eligible pending basket leg...");
        const legCount = await publicClient.readContract({
          address: launch.vault,
          abi: vaultAbi,
          functionName: "legCount",
        });
        for (let index = 0n; index < legCount; index++) {
          const leg = await publicClient.readContract({
            address: launch.vault,
            abi: vaultAbi,
            functionName: "leg",
            args: [index],
          });
          const threshold = parseEther("1");
          if (leg.pendingBase < threshold) continue;
          try {
            await submit({
              address: launch.vault,
              abi: vaultAbi,
              functionName: "convertLeg",
              args: [
                index,
                leg.pendingBase,
                1n,
                BigInt(Math.floor(Date.now() / 1000) + 300),
              ],
              account,
            });
          } catch (error) {
            const latest = await publicClient.readContract({
              address: launch.vault,
              abi: vaultAbi,
              functionName: "leg",
              args: [index],
            });
            if (latest.pendingBase >= threshold) throw error;
          }
        }
      } else {
        setStatus("Claiming all available basket rewards...");
        await submit({
          address: launch.token,
          abi: erc20Abi,
          functionName: "claimAll",
          account,
        });
      }
      setStatus(kind.charAt(0).toUpperCase() + kind.slice(1) + " completed.");
      await refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Action failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="console launchpad-console"
      aria-labelledby="launchpad-title"
    >
      <div className="console-heading">
        <div>
          <p className="eyebrow">Permissionless launchpad</p>
          <h2 id="launchpad-title">Launch your own fee-funded reward token.</h2>
          <p>
            Choose an immutable mock-asset basket, seed a market, then trade and
            claim through the shared registry.
          </p>
        </div>
        <span className="live-chip">
          {launches.length} live launch{launches.length === 1 ? "" : "es"}
        </span>
      </div>
      <div className="launch-layout">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void createLaunch();
          }}
          className="launch-form"
        >
          <div className="launch-art-preview">
            <TokenArt symbol={symbol} alt="" priority />
            <div>
              <strong>Token artwork preview</strong>
              <span>
                Known demos use curated art. New launches receive Robyn&apos;s
                generative fallback until custom metadata is enabled.
              </span>
            </div>
          </div>
          <label>
            Token name
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={32}
            />
          </label>
          <label>
            Symbol
            <input
              value={symbol}
              onChange={(event) => setSymbol(event.target.value.toUpperCase())}
              maxLength={8}
            />
          </label>
          <fieldset>
            <legend>Basket weights (must total 100%)</legend>
            {["mNVDA", "mSPY", "mETH"].map((asset, index) => (
              <label key={asset}>
                {asset}
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={weights[index]}
                  onChange={(event) =>
                    setWeights(
                      weights.map((value, offset) =>
                        offset === index ? Number(event.target.value) : value,
                      ),
                    )
                  }
                />
              </label>
            ))}
          </fieldset>
          <p
            className={
              weights.reduce((a, b) => a + b, 0) === 100
                ? "weight-total valid"
                : "weight-total"
            }
          >
            Total {weights.reduce((a, b) => a + b, 0)}%
          </p>
          <button
            className="button primary"
            type="submit"
            disabled={busy || !account}
          >
            Launch token and market
          </button>
          {!account ? (
            <p className="form-hint">
              Create a session wallet in the live market panel below first.
            </p>
          ) : null}
        </form>
        <div className="launch-list" aria-label="Launch registry">
          {launches.map((launch) => (
            <article key={launch.token}>
              <TokenArt
                symbol={launch.symbol}
                alt=""
                className="launch-list-art"
              />
              <div>
                <span className="asset-symbol">{launch.symbol}</span>
                <span className="weight">#{launch.id.toString()}</span>
              </div>
              <h3>{launch.name}</h3>
              <p>
                {amount(launch.balance)} {launch.symbol} in this wallet
              </p>
              <code>
                {launch.token.slice(0, 10)}...{launch.token.slice(-6)}
              </code>
              <div className="action-row">
                <button
                  className="button"
                  disabled={busy || !account}
                  onClick={() => void act(launch, "buy")}
                >
                  Buy 990k
                </button>
                <button
                  className="button ghost"
                  disabled={busy || launch.balance < parseEther("10000")}
                  onClick={() => void act(launch, "sell")}
                >
                  Sell 10k
                </button>
                <button
                  className="button ghost"
                  disabled={busy || !account}
                  onClick={() => void act(launch, "convert")}
                >
                  Convert
                </button>
                <button
                  className="button ghost"
                  disabled={busy || !account}
                  onClick={() => void act(launch, "claim")}
                >
                  Claim
                </button>
              </div>
            </article>
          ))}
        </div>
      </div>
      <p
        className="transaction-status"
        role="status"
        aria-live="polite"
        data-testid="launch-status"
      >
        {status}
      </p>
    </section>
  );
}
