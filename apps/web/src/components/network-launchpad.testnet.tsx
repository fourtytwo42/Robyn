"use client";

import {
  createPublicClient,
  createWalletClient,
  custom,
  defineChain,
  formatEther,
  http,
  parseEther,
  type Address,
  type EIP1193Provider,
  type Hex,
} from "viem";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Deployment } from "@/lib/deployment";
import { TokenCardArt } from "@/components/launchpad-visuals";
import { GuidedLaunchWizard } from "@/components/guided-launch-wizard";

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

export function NetworkLaunchpadConsole({
  deployment,
  openByDefault,
  showRegistry = true,
}: {
  deployment: Deployment;
  openByDefault?: boolean;
  showRegistry?: boolean;
}) {
  const [account, setAccount] = useState<Address>();
  const [launches, setLaunches] = useState<Launch[]>([]);
  const [name, setName] = useState("My Community");
  const [symbol, setSymbol] = useState("MYCO");
  const [weights, setWeights] = useState([40, 40, 20]);
  const [status, setStatus] = useState(
    "Connect and fund a testnet wallet, then launch.",
  );
  const [busy, setBusy] = useState(false);
  const rpcUrl =
    process.env.NEXT_PUBLIC_ROBYN_RPC_URL ??
    "https://rpc.testnet.chain.robinhood.com";
  const chain = useMemo(
    () =>
      defineChain({
        id: 46630,
        name: "Robinhood Chain Testnet",
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        rpcUrls: { default: { http: [rpcUrl] } },
        testnet: true,
      }),
    [rpcUrl],
  );
  const publicClient = useMemo(
    () => createPublicClient({ chain, transport: http(rpcUrl) }),
    [chain, rpcUrl],
  );
  const provider = useMemo(
    () =>
      typeof window === "undefined"
        ? undefined
        : (window as Window & { ethereum?: EIP1193Provider }).ethereum,
    [],
  );
  const walletClient = useMemo(
    () =>
      provider && account
        ? createWalletClient({ account, chain, transport: custom(provider) })
        : undefined,
    [account, chain, provider],
  );

  const loadWallet = useCallback(() => {
    if (!provider) {
      setAccount(undefined);
      return;
    }
    void provider
      .request({ method: "eth_accounts" })
      .then((accounts) => {
        const selected =
          Array.isArray(accounts) && typeof accounts[0] === "string"
            ? (accounts[0] as Address)
            : undefined;
        setAccount(selected);
      })
      .catch(() => setAccount(undefined));
  }, [provider]);

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
    loadWallet();
    window.addEventListener("robyn-testnet-wallet-change", loadWallet);
    return () =>
      window.removeEventListener("robyn-testnet-wallet-change", loadWallet);
  }, [loadWallet]);

  useEffect(() => {
    void refresh().catch(() => setStatus("Unable to load launch registry."));
  }, [refresh]);

  const submit = useCallback(
    async (
      request: Parameters<NonNullable<typeof walletClient>["writeContract"]>[0],
    ) => {
      if (!walletClient) throw new Error("Connect a testnet wallet first.");
      const hash = await walletClient.writeContract(request);
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success")
        throw new Error("Transaction reverted.");
    },
    [publicClient, walletClient],
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
    const baseBalance = await publicClient.readContract({
      address: deployment.contracts.baseAsset,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [account],
    });
    if (baseBalance < parseEther("500"))
      return setStatus(
        "Claim testnet mock USD first; launch seeding requires 500 tmUSD.",
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
      await refresh();
      await bindArtwork(token, artworkMediaId);
      setStatus(
        "Launch complete. Its market is live and basket rules are immutable.",
      );
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
          walletHint="Connect a wallet in the testnet panel above first."
          walletActionLabel={account ? "Refresh wallet" : "Connect wallet"}
          onWalletAction={async () => {
            if (!provider) throw new Error("No injected wallet was found.");
            await provider.request({ method: "eth_requestAccounts" });
            window.dispatchEvent(new Event("robyn-testnet-wallet-change"));
          }}
          assetSymbols={["tmNVDA", "tmSPY", "tmETH"]}
          marketSummary="Seeded testnet mock market"
          signMessage={async (message) => {
            if (!provider || !account)
              throw new Error("Connect a testnet wallet first.");
            const request = provider.request as (args: {
              method: string;
              params: readonly unknown[];
            }) => Promise<unknown>;
            return (await request({
              method: "personal_sign",
              params: [message, account],
            })) as Hex;
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
