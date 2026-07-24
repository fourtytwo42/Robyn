import { readFile } from "node:fs/promises";
import {
  createPublicClient,
  decodeEventLog,
  http,
  parseAbiItem,
  type Address,
} from "viem";
import { createDatabase } from "@robyn/db";

type Manifest = {
  schemaVersion?: number;
  chainId: number;
  liquidityVenue?: "uniswap-v4" | "uniswap-v3";
  deploymentBlock: number;
  contracts: {
    factory: Address;
    marketFactory: Address;
    legacyMarketFactories?: Address[];
    atomicLaunchCoordinator?: Address;
    protocolFeeRouter?: Address;
  };
};
const manifest = JSON.parse(
  await readFile(
    process.env.ROBYN_MANIFEST ?? "/home/hendo420/Robyn/deployments/31337.json",
    "utf8",
  ),
) as Manifest;
const client = createPublicClient({
  transport: http(
    process.env.ROBYN_OPERATOR_RPC_URL ?? "http://127.0.0.1:8545",
  ),
});
const { sql } = createDatabase();
const pollMs = Number(process.env.INDEXER_POLL_MS ?? "3000");
let stopping = false;

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
] as const;
const marketFactoryAbi = [
  {
    type: "function",
    name: "marketByToken",
    stateMutability: "view",
    inputs: [{ type: "address" }],
    outputs: [{ type: "address" }],
  },
] as const;
const zeroAddress = "0x0000000000000000000000000000000000000000";
const atomicLaunchEvent = parseAbiItem(
  "event AtomicLaunchCreated(uint256 indexed launchId,address indexed creator,address indexed token,address vault,address market,address adapter,address pool,address locker,bytes32 configurationHash,bytes32 launchSaltHash,bytes32 metadataUriHash)",
);
const atomicV4LaunchEvent = parseAbiItem(
  "event AtomicV4LaunchCreated(uint256 indexed launchId,address indexed creator,address indexed token,(address vault,address market,address adapter,address poolManager,bytes32 poolId,address positionManager,address hook,address locker,uint24 poolFeePips,int24 tickSpacing,bytes32 configurationHash,bytes32 launchSaltHash,bytes32 metadataUriHash) receipt)",
);
const marketStateAbi = [
  {
    type: "function",
    name: "seeded",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "bool" }],
  },
] as const;
const tokenStateAbi = [
  {
    type: "function",
    name: "exclusionsSealed",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "bool" }],
  },
] as const;
const feeRouterStateAbi = [
  {
    type: "function",
    name: "launchAccount",
    stateMutability: "view",
    inputs: [{ type: "address" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "creator", type: "address" },
          { name: "vault", type: "address" },
          { name: "market", type: "address" },
          { name: "locker", type: "address" },
          { name: "pendingCreatorBase", type: "uint256" },
          { name: "pendingDaoRewardBase", type: "uint256" },
          { name: "pendingTreasuryBase", type: "uint256" },
          { name: "cumulativeBaseFees", type: "uint256" },
          { name: "cumulativeLaunchFeesConverted", type: "uint256" },
          { name: "cumulativeNativeConverted", type: "uint256" },
          { name: "claimableCreatorNative", type: "uint256" },
          { name: "cumulativeCreatorNative", type: "uint256" },
          { name: "claimedCreatorNative", type: "uint256" },
          { name: "registered", type: "bool" },
        ],
      },
    ],
  },
] as const;
const nativeV4FeeRouterStateAbi = [
  {
    type: "function",
    name: "launchAccount",
    stateMutability: "view",
    inputs: [{ type: "address" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "creator", type: "address" },
          { name: "vault", type: "address" },
          { name: "market", type: "address" },
          { name: "locker", type: "address" },
          { name: "cumulativeNativeFees", type: "uint256" },
          { name: "cumulativeLaunchFeesConverted", type: "uint256" },
          { name: "claimableCreatorNative", type: "uint256" },
          { name: "cumulativeCreatorNative", type: "uint256" },
          { name: "claimedCreatorNative", type: "uint256" },
          { name: "registered", type: "bool" },
        ],
      },
    ],
  },
] as const;

async function loadAtomicLaunches(asOfBlock: bigint) {
  const coordinator = manifest.contracts.atomicLaunchCoordinator;
  if (!coordinator)
    return new Map<
      string,
      { blockNumber: bigint; args: Record<string, unknown> }
    >();
  const v4 = manifest.liquidityVenue === "uniswap-v4";
  const event = v4 ? atomicV4LaunchEvent : atomicLaunchEvent;
  const logs = await client.getLogs({
    address: coordinator,
    event,
    fromBlock: BigInt(manifest.deploymentBlock),
    toBlock: asOfBlock,
  });
  const launches = new Map<
    string,
    { blockNumber: bigint; args: Record<string, unknown> }
  >();
  for (const log of logs) {
    const decoded = decodeEventLog({
      abi: [event],
      data: log.data,
      topics: log.topics,
    });
    const eventArgs = decoded.args as unknown as Record<string, unknown>;
    const receipt = eventArgs.receipt as Record<string, unknown> | undefined;
    launches.set(String(eventArgs.launchId), {
      blockNumber: log.blockNumber,
      args: receipt ? { ...eventArgs, ...receipt } : eventArgs,
    });
  }
  return launches;
}

async function resolveMarket(token: Address) {
  const factories = [
    manifest.contracts.marketFactory,
    ...(manifest.contracts.legacyMarketFactories ?? []),
  ];
  for (const factory of factories) {
    const market = await client.readContract({
      address: factory,
      abi: marketFactoryAbi,
      functionName: "marketByToken",
      args: [token],
    });
    if (market.toLowerCase() !== zeroAddress) return market;
  }
  return zeroAddress as Address;
}
const tokenAbi = [
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
] as const;

async function rebuildLaunches(asOfBlock: bigint) {
  const atomicLaunches = await loadAtomicLaunches(asOfBlock);
  const count = await client.readContract({
    address: manifest.contracts.factory,
    abi: factoryAbi,
    functionName: "launchCount",
  });
  for (let id = 1n; id <= count; id++) {
    const token = await client.readContract({
      address: manifest.contracts.factory,
      abi: factoryAbi,
      functionName: "launchTokenById",
      args: [id],
    });
    const [vault, creator, market, name, symbol] = await Promise.all([
      client.readContract({
        address: manifest.contracts.factory,
        abi: factoryAbi,
        functionName: "vaultByToken",
        args: [token],
      }),
      client.readContract({
        address: manifest.contracts.factory,
        abi: factoryAbi,
        functionName: "creatorByToken",
        args: [token],
      }),
      resolveMarket(token),
      client.readContract({
        address: token,
        abi: tokenAbi,
        functionName: "name",
      }),
      client.readContract({
        address: token,
        abi: tokenAbi,
        functionName: "symbol",
      }),
    ]);
    const atomic = atomicLaunches.get(id.toString());
    if (manifest.contracts.atomicLaunchCoordinator) {
      if (!atomic) continue;
      const eventToken = String(atomic.args.token).toLowerCase();
      const eventVault = String(atomic.args.vault).toLowerCase();
      const eventMarket = String(atomic.args.market).toLowerCase();
      const eventCreator = String(atomic.args.creator).toLowerCase();
      if (
        eventToken !== token.toLowerCase() ||
        eventVault !== vault.toLowerCase() ||
        eventMarket !== market.toLowerCase() ||
        eventCreator !== creator.toLowerCase()
      )
        continue;
      const [seeded, exclusionsSealed] = await Promise.all([
        client.readContract({
          address: market,
          abi: marketStateAbi,
          functionName: "seeded",
        }),
        client.readContract({
          address: token,
          abi: tokenStateAbi,
          functionName: "exclusionsSealed",
        }),
      ]);
      if (!seeded || !exclusionsSealed) continue;
      if (manifest.contracts.protocolFeeRouter) {
        const feeAccount = await client.readContract({
          address: manifest.contracts.protocolFeeRouter,
          abi:
            manifest.liquidityVenue === "uniswap-v4"
              ? nativeV4FeeRouterStateAbi
              : feeRouterStateAbi,
          functionName: "launchAccount",
          args: [token],
        });
        if (
          !feeAccount.registered ||
          feeAccount.creator.toLowerCase() !== creator.toLowerCase() ||
          feeAccount.vault.toLowerCase() !== vault.toLowerCase() ||
          feeAccount.market.toLowerCase() !== market.toLowerCase() ||
          feeAccount.locker.toLowerCase() !==
            String(atomic.args.locker).toLowerCase()
        )
          continue;
      }
    }
    const countLegs = await client.readContract({
      address: vault,
      abi: vaultAbi,
      functionName: "legCount",
    });
    const assets: string[] = [],
      weights: number[] = [];
    for (let i = 0n; i < countLegs; i++) {
      const leg = await client.readContract({
        address: vault,
        abi: vaultAbi,
        functionName: "leg",
        args: [i],
      });
      assets.push(leg.asset.toLowerCase());
      weights.push(leg.weightBps);
    }
    const found = await sql.unsafe<{ block_number: string }[]>(
      "SELECT block_number::text FROM raw_logs WHERE chain_id=$1 AND address=$2 AND lower(topics->>3) LIKE $3 ORDER BY block_number LIMIT 1",
      [
        manifest.chainId,
        manifest.contracts.factory.toLowerCase(),
        "%" + token.slice(2).toLowerCase(),
      ],
    );
    const created =
      atomic?.blockNumber ??
      (found[0]
        ? BigInt(found[0].block_number)
        : BigInt(manifest.deploymentBlock));
    await sql.unsafe(
      "INSERT INTO launches (chain_id,launch_id,token,vault,market,creator,name,symbol,assets,weights_bps,created_block,updated_block,formula_version) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11,$12,$13) ON CONFLICT (chain_id,token) DO UPDATE SET market=EXCLUDED.market,name=EXCLUDED.name,symbol=EXCLUDED.symbol,assets=EXCLUDED.assets,weights_bps=EXCLUDED.weights_bps,created_block=EXCLUDED.created_block,updated_block=EXCLUDED.updated_block,formula_version=EXCLUDED.formula_version",
      [
        manifest.chainId,
        id.toString(),
        token.toLowerCase(),
        vault.toLowerCase(),
        market.toLowerCase(),
        creator.toLowerCase(),
        name,
        symbol,
        JSON.stringify(assets),
        JSON.stringify(weights),
        created.toString(),
        asOfBlock.toString(),
        atomic && manifest.contracts.protocolFeeRouter
          ? manifest.liquidityVenue === "uniswap-v4"
            ? "native-v4-dao-atomic"
            : "native-v3-dao-atomic"
          : atomic
            ? "native-v2-atomic"
            : "native-v1",
      ],
    );
  }
}

async function resetCanonical() {
  await sql.begin(async (tx) => {
    await tx.unsafe(
      "DELETE FROM raw_logs WHERE chain_id=$1 AND block_number>=$2",
      [manifest.chainId, manifest.deploymentBlock],
    );
    await tx.unsafe(
      "DELETE FROM chain_blocks WHERE chain_id=$1 AND number>=$2",
      [manifest.chainId, manifest.deploymentBlock],
    );
    await tx.unsafe("DELETE FROM launches WHERE chain_id=$1", [
      manifest.chainId,
    ]);
    await tx.unsafe(
      "DELETE FROM indexer_checkpoints WHERE service='chain-indexer' AND chain_id=$1",
      [manifest.chainId],
    );
  });
}

async function syncOnce() {
  if ((await client.getChainId()) !== manifest.chainId)
    throw new Error("Indexer chain mismatch");
  const head = await client.getBlockNumber();
  const rows = await sql.unsafe<{ last_block: string; last_hash: string }[]>(
    "SELECT last_block::text,last_hash FROM indexer_checkpoints WHERE service='chain-indexer' AND chain_id=$1",
    [manifest.chainId],
  );
  let start = BigInt(manifest.deploymentBlock);
  if (rows[0]) {
    const last = BigInt(rows[0].last_block);
    if (last > head) {
      await resetCanonical();
    } else {
      const prior = await client.getBlock({ blockNumber: last });
      if (prior.hash?.toLowerCase() === rows[0].last_hash.toLowerCase())
        start = last + 1n;
      else await resetCanonical();
    }
  }
  for (let number = start; number <= head; number++) {
    const [block, logs] = await Promise.all([
      client.getBlock({ blockNumber: number }),
      client.getLogs({ fromBlock: number, toBlock: number }),
    ]);
    if (!block.hash) throw new Error("Block hash unavailable");
    await sql.begin(async (tx) => {
      await tx.unsafe(
        "INSERT INTO chain_blocks (chain_id,number,hash,parent_hash,timestamp,canonical) VALUES ($1,$2,$3,$4,$5,true) ON CONFLICT (chain_id,number) DO UPDATE SET hash=EXCLUDED.hash,parent_hash=EXCLUDED.parent_hash,timestamp=EXCLUDED.timestamp,canonical=true,observed_at=now()",
        [
          manifest.chainId,
          number.toString(),
          block.hash.toLowerCase(),
          block.parentHash.toLowerCase(),
          block.timestamp.toString(),
        ],
      );
      for (const log of logs) {
        if (
          !log.blockHash ||
          !log.transactionHash ||
          log.logIndex === null ||
          log.transactionIndex === null
        )
          continue;
        await tx.unsafe(
          "INSERT INTO raw_logs (chain_id,block_number,block_hash,transaction_hash,transaction_index,log_index,address,topics,data,removed) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10) ON CONFLICT (chain_id,transaction_hash,log_index) DO UPDATE SET block_number=EXCLUDED.block_number,block_hash=EXCLUDED.block_hash,transaction_index=EXCLUDED.transaction_index,address=EXCLUDED.address,topics=EXCLUDED.topics,data=EXCLUDED.data,removed=EXCLUDED.removed",
          [
            manifest.chainId,
            number.toString(),
            log.blockHash.toLowerCase(),
            log.transactionHash.toLowerCase(),
            Number(log.transactionIndex),
            Number(log.logIndex),
            log.address.toLowerCase(),
            JSON.stringify(log.topics),
            log.data,
            log.removed,
          ],
        );
      }
    });
  }
  const block = await client.getBlock({ blockNumber: head });
  if (!block.hash) throw new Error("Head hash unavailable");
  await rebuildLaunches(head);
  await sql.unsafe(
    "INSERT INTO indexer_checkpoints (service,chain_id,last_block,last_hash) VALUES ('chain-indexer',$1,$2,$3) ON CONFLICT (service,chain_id) DO UPDATE SET last_block=EXCLUDED.last_block,last_hash=EXCLUDED.last_hash,updated_at=now()",
    [manifest.chainId, head.toString(), block.hash.toLowerCase()],
  );
  process.stdout.write(
    JSON.stringify({ level: "info", event: "sync", head: head.toString() }) +
      "\n",
  );
}

process.on("SIGTERM", () => {
  stopping = true;
});
process.on("SIGINT", () => {
  stopping = true;
});
while (!stopping) {
  try {
    await syncOnce();
  } catch (error) {
    process.stderr.write(
      JSON.stringify({
        level: "error",
        event: "sync_failed",
        message: error instanceof Error ? error.message : String(error),
      }) + "\n",
    );
  }
  if (!stopping) await new Promise((resolve) => setTimeout(resolve, pollMs));
}
await sql.end();
