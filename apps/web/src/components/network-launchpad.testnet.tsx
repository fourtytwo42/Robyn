"use client";

import {
  decodeEventLog,
  formatEther,
  parseEther,
  type Address,
  type Hex,
} from "viem";
import { useCallback, useEffect, useState } from "react";
import type { Deployment } from "@/lib/deployment";
import { TokenCardArt } from "@/components/launchpad-visuals";
import { GuidedLaunchWizard } from "@/components/guided-launch-wizard";
import { useRobynTestnetWallet } from "./robyn-testnet-wallet";
import { normalizeWalletError } from "@/lib/wallet-policy";

const ZERO = "0x0000000000000000000000000000000000000000" as Address;
const atomicLaunchCoordinatorAbi = [
  {
    type: "function",
    name: "createLaunch",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "request",
        type: "tuple",
        components: [
          { name: "name", type: "string" },
          { name: "symbol", type: "string" },
          { name: "assets", type: "address[]" },
          { name: "weights", type: "uint16[]" },
          { name: "userSalt", type: "bytes32" },
        ],
      },
    ],
    outputs: [{ type: "address" }, { type: "address" }, { type: "address" }],
  },
  {
    type: "event",
    name: "AtomicLaunchCreated",
    inputs: [
      { indexed: true, name: "launchId", type: "uint256" },
      { indexed: true, name: "creator", type: "address" },
      { indexed: true, name: "token", type: "address" },
      { indexed: false, name: "vault", type: "address" },
      { indexed: false, name: "market", type: "address" },
      { indexed: false, name: "adapter", type: "address" },
      { indexed: false, name: "pool", type: "address" },
      { indexed: false, name: "locker", type: "address" },
      { indexed: false, name: "configurationHash", type: "bytes32" },
      { indexed: false, name: "launchSaltHash", type: "bytes32" },
    ],
  },
] as const;

function randomLaunchSalt(): Hex {
  const bytes = new Uint8Array(32);
  do crypto.getRandomValues(bytes);
  while (bytes.every((value) => value === 0));
  return `0x${Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("")}`;
}

function launchErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("PoolAlreadyExists"))
    return "A Uniswap pool already exists for the predicted token. The complete launch was reverted; generate a new launch salt and try again.";
  if (message.includes("CoordinatorNotBound"))
    return "The atomic launch coordinator is not bound. No launch was created.";
  if (message.includes("LaunchSaltAlreadyUsed"))
    return "That launch salt was already used. No launch was created; try again to generate a fresh salt.";
  if (
    message.includes("InvalidConfiguration") ||
    message.includes("InvalidWeights") ||
    message.includes("InvalidBasket")
  )
    return "The token or reward basket configuration is invalid. No launch was created.";
  return message;
}
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

export function NetworkLaunchpadConsole({
  deployment,
  openByDefault,
  showRegistry = true,
}: {
  deployment: Deployment;
  openByDefault?: boolean;
  showRegistry?: boolean;
}) {
  const {
    account,
    publicClient,
    walletClient,
    connect,
    isWrongChain,
    switchToRobinhoodTestnet,
  } = useRobynTestnetWallet();
  const [launches, setLaunches] = useState<Launch[]>([]);
  const [name, setName] = useState("My Community");
  const [symbol, setSymbol] = useState("MYCO");
  const [weights, setWeights] = useState([40, 40, 20]);
  const [status, setStatus] = useState(
    "Connect and fund a testnet wallet, then launch.",
  );
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    if (!publicClient) return;
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
                args: [account],
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
    void refresh().catch(() => setStatus("Unable to load launch registry."));
  }, [refresh]);

  const submit = useCallback(
    async (
      request: Parameters<NonNullable<typeof walletClient>["writeContract"]>[0],
    ) => {
      if (!walletClient) throw new Error("Connect a testnet wallet first.");
      if (isWrongChain)
        throw new Error("Switch to Robinhood Testnet before launching.");
      if (!publicClient) throw new Error("Public RPC client is unavailable.");
      const hash = await walletClient.writeContract(request);
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success")
        throw new Error("Transaction reverted.");
      return receipt;
    },
    [isWrongChain, publicClient, walletClient],
  );

  async function bindArtwork(token: Address, mediaId?: string) {
    if (!mediaId) return;
    setStatus("Binding sanitized artwork to the canonical launch...");
    for (let attempt = 0; attempt < 40; attempt++) {
      const response = await fetch(`/api/launches/${token}/metadata`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mediaId }),
      });
      if (response.ok) return;
      if (response.status !== 404)
        throw new Error(
          ((await response.json()) as { error?: string }).error ??
            "artwork_binding_failed",
        );
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error("Launch succeeded, but artwork indexing timed out.");
  }

  async function createLaunch(artworkMediaId?: string) {
    if (!account || !walletClient)
      return setStatus("Connect and fund a testnet wallet first.");
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
    setBusy(true);
    try {
      const coordinator = deployment.contracts.atomicLaunchCoordinator;
      if (!coordinator)
        throw new Error("Atomic launch coordinator is not configured.");
      const request = {
        name: name.trim(),
        symbol: symbol.trim().toUpperCase(),
        assets: basket.map((item) => item.asset),
        weights: basket.map((item) => item.weight * 100),
        userSalt: randomLaunchSalt(),
      } as const;
      setStatus("Simulating the complete atomic launch...");
      const simulation = await publicClient.simulateContract({
        address: coordinator,
        abi: atomicLaunchCoordinatorAbi,
        functionName: "createLaunch",
        args: [request],
        account,
      });
      setStatus("Confirm one transaction in your wallet...");
      const receipt = await submit(simulation.request);
      setStatus("Confirming launch identity from its transaction receipt...");
      const launchLog = receipt.logs.find(
        (log) => log.address.toLowerCase() === coordinator.toLowerCase(),
      );
      if (!launchLog) throw new Error("Atomic launch event was not emitted.");
      const decoded = decodeEventLog({
        abi: atomicLaunchCoordinatorAbi,
        eventName: "AtomicLaunchCreated",
        data: launchLog.data,
        topics: launchLog.topics,
      });
      const token = decoded.args.token;
      setStatus("Waiting for the canonical launch to be indexed...");
      await refresh();
      try {
        await bindArtwork(token, artworkMediaId);
      } catch (metadataError) {
        setStatus(
          `Onchain launch succeeded, but artwork binding needs attention: ${metadataError instanceof Error ? metadataError.message : "unknown metadata error"}`,
        );
        return;
      }
      setStatus(
        "Launch complete. Its market is live and basket rules are immutable.",
      );
    } catch (error) {
      setStatus(launchErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function act(
    launch: Launch,
    kind: "buy" | "sell" | "convert" | "claim",
  ) {
    if (!account) return setStatus("Connect and fund a testnet wallet first.");
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
          <h2 id="launchpad-title">
            Create a token holders want to earn with.
          </h2>
          <p>
            Choose its immutable testnet-mock reward basket, seed a market, then
            let trading activity fund rewards holders can claim.
          </p>
        </div>
        <span className="live-chip">
          {launches.length} live launch{launches.length === 1 ? "" : "es"}
        </span>
      </div>
      <div className="launch-layout">
        <GuidedLaunchWizard
          account={account}
          busy={busy}
          name={name}
          setName={setName}
          symbol={symbol}
          setSymbol={setSymbol}
          weights={weights}
          setWeights={setWeights}
          status={status}
          walletHint={
            isWrongChain
              ? "Switch the connected wallet to Robinhood Testnet."
              : "Connect a supported self-custody wallet."
          }
          walletActionLabel={
            isWrongChain
              ? "Switch network"
              : account
                ? "Refresh wallet"
                : "Connect wallet"
          }
          onWalletAction={async () => {
            try {
              if (!account) await connect();
              else if (isWrongChain) await switchToRobinhoodTestnet();
              else await refresh();
            } catch (error) {
              setStatus(normalizeWalletError(error));
            }
          }}
          assetSymbols={["tmNVDA", "tmSPY", "tmETH"]}
          marketSummary="Seeded testnet mock market"
          signMessage={async (message) => {
            if (!walletClient || !account || isWrongChain)
              throw new Error("Connect a testnet wallet first.");
            return walletClient.signMessage({
              account,
              message,
            });
          }}
          onLaunch={createLaunch}
          openByDefault={openByDefault}
        />
        {showRegistry ? (
          <div className="launch-list" aria-label="Launch registry">
            {launches.map((launch) => (
              <article key={launch.token}>
                <TokenCardArt
                  symbol={launch.symbol}
                  name={launch.name}
                  badge="Live market"
                  launchNumber={launch.id.toString()}
                />
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
        ) : null}
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
