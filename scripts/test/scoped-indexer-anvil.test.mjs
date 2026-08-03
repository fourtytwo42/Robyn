import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import test from "node:test";
import { parseAbiItem, toEventSelector } from "viem";
import { schema19IndexingPolicyHash } from "../lib/schema19-indexing-policy.mjs";

const repo = path.resolve(new URL("../..", import.meta.url).pathname);
const foundryPath = path.join(os.homedir(), ".foundry", "bin");
const commandEnv = {
  ...process.env,
  PATH: `${foundryPath}:${process.env.PATH}`,
};
const privateKey =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const rpcUrl = "http://127.0.0.1:28547";
const relevantPoolId = `0x${"11".repeat(32)}`;
const unrelatedPoolId = `0x${"22".repeat(32)}`;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repo,
    env: commandEnv,
    encoding: "utf8",
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed: ${result.stderr || result.stdout}`,
    );
  }
  return result.stdout.trim();
}

async function waitFor(check, label, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`timed out waiting for ${label}`);
}

function artifact(name) {
  return path.join(
    repo,
    "packages/contracts/out/ScopedIndexerEmitter.sol",
    `${name}.json`,
  );
}

async function bytecode(name) {
  return JSON.parse(await readFile(artifact(name), "utf8")).bytecode.object;
}

async function deploy(name) {
  const receipt = JSON.parse(
    run("cast", [
      "send",
      "--rpc-url",
      rpcUrl,
      "--private-key",
      privateKey,
      "--create",
      await bytecode(name),
      "--json",
    ]),
  );
  return receipt.contractAddress;
}

function send(address, signature, args) {
  run("cast", [
    "send",
    "--rpc-url",
    rpcUrl,
    "--private-key",
    privateKey,
    address,
    signature,
    ...args,
    "--json",
  ]);
}

let activeSchema;
function psql(database, query) {
  return run("psql", ["-d", database, "-Atc", query], {
    env: {
      ...commandEnv,
      ...(activeSchema ? { PGOPTIONS: `-c search_path=${activeSchema}` } : {}),
    },
  });
}

async function stopProcess(child) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 3_000)),
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

test(
  "isolated Anvil ingestion excludes global noise and reconstructs dynamic scope",
  { timeout: 120_000 },
  async () => {
    const temporary = await mkdtemp(
      path.join(os.tmpdir(), "robyn-scoped-indexer-"),
    );
    const database = "robyn";
    const schema = `scoped_indexer_${process.pid}`;
    activeSchema = schema;
    let anvil;
    let indexer;
    try {
      run("psql", [
        "-d",
        database,
        "-v",
        "ON_ERROR_STOP=1",
        "-c",
        `create schema ${schema}`,
      ]);
      anvil = spawn(
        "anvil",
        [
          "--host",
          "127.0.0.1",
          "--port",
          "28547",
          "--chain-id",
          "31337",
          "--accounts",
          "2",
          "--silent",
        ],
        { cwd: repo, env: commandEnv, stdio: ["ignore", "pipe", "pipe"] },
      );
      await waitFor(() => {
        const result = spawnSync("cast", ["chain-id", "--rpc-url", rpcUrl], {
          env: commandEnv,
          encoding: "utf8",
        });
        return result.status === 0 && result.stdout.trim() === "31337";
      }, "Anvil");

      run("forge", [
        "build",
        "--root",
        "packages/contracts",
        "test/mocks/ScopedIndexerEmitter.sol",
      ]);
      const token = await deploy("ScopedActivityEmitter");
      const poolManager = await deploy("ScopedPoolEmitter");
      const coordinator = await deploy("ScopedIndexerCoordinator");
      const wethNoise = await deploy("ScopedNoiseEmitter");
      const permit2Noise = await deploy("ScopedNoiseEmitter");

      send(wethNoise, "emitNoise(uint256)", ["100"]);
      send(permit2Noise, "emitNoise(uint256)", ["100"]);
      send(poolManager, "emitNoise(bytes32,uint256)", [unrelatedPoolId, "100"]);
      send(coordinator, "emitLaunchAndActivity(address,address,bytes32)", [
        token,
        poolManager,
        relevantPoolId,
      ]);

      const launchTopic = toEventSelector(
        parseAbiItem(
          "event AtomicV4LaunchCreated(uint256 indexed launchId,address indexed creator,address indexed token,(address vault,address market,address adapter,address poolManager,bytes32 poolId,address positionManager,address hook,address locker,uint24 poolFeePips,int24 tickSpacing,bytes32 configurationHash,bytes32 launchSaltHash,bytes32 metadataUriHash,(uint64 version,uint256 targetGraduationNative,uint256 actualGraduationNative,uint256 maximumCurvePurchase,uint256 initialVirtualNativeReserve,uint256 terminalNativePerTokenX18,uint160 terminalSqrtPriceX96) graduationProfile,bytes32 graduationProfileHash) receipt)",
        ),
      );
      const poolTopics = [
        "event Initialize(bytes32 indexed id,address indexed currency0,address indexed currency1,uint24 fee,int24 tickSpacing,address hooks,uint160 sqrtPriceX96,int24 tick)",
        "event ModifyLiquidity(bytes32 indexed id,address indexed sender,int24 tickLower,int24 tickUpper,int256 liquidityDelta,bytes32 salt)",
        "event Swap(bytes32 indexed id,address indexed sender,int128 amount0,int128 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick,uint24 fee)",
        "event Donate(bytes32 indexed id,address indexed sender,uint256 amount0,uint256 amount1)",
      ].map((event) => toEventSelector(parseAbiItem(event)));
      const unsignedPolicy = {
        version: 1,
        protocolRoots: [coordinator],
        launchCoordinator: coordinator,
        launchEventTopics: [launchTopic],
        poolManager,
        poolEventTopics: poolTopics,
        addressBatchSize: 8,
        poolIdBatchSize: 8,
      };
      const manifest = {
        schemaVersion: 19,
        chainId: 31337,
        deploymentBlock: 0,
        liquidityVenue: "uniswap-v4",
        contracts: {
          factory: coordinator,
          marketFactory: coordinator,
          atomicLaunchCoordinator: coordinator,
          poolManager,
          wrappedNative: wethNoise,
          permit2: permit2Noise,
        },
        indexingPolicy: {
          ...unsignedPolicy,
          policyHash: schema19IndexingPolicyHash(unsignedPolicy),
        },
      };
      const manifestPath = path.join(temporary, "manifest.json");
      await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

      run("pnpm", ["--filter", "@robyn/db", "build"]);
      run("pnpm", ["--filter", "@robyn/indexer", "build"]);
      run("pnpm", ["--filter", "@robyn/db", "migrate"], {
        env: {
          ...commandEnv,
          PGDATABASE: database,
          PGOPTIONS: `-c search_path=${schema}`,
          PGSCHEMA: schema,
        },
      });

      const startIndexer = () =>
        spawn("node", ["apps/indexer/dist/server.js"], {
          cwd: repo,
          env: {
            ...commandEnv,
            PGDATABASE: database,
            PGOPTIONS: `-c search_path=${schema}`,
            PGSCHEMA: schema,
            ROBYN_MANIFEST: manifestPath,
            ROBYN_OPERATOR_RPC_URL: rpcUrl,
            ROBYN_INDEXER_ROLE: "ingester",
            INDEXER_RECONCILIATION_MS: "600000",
            INDEXER_HEARTBEAT_MS: "10000",
            INDEXER_MAXIMUM_OBSERVED_LAG_BLOCKS: "40",
            ROBYN_STORAGE_PATH: temporary,
          },
          stdio: ["ignore", "pipe", "pipe"],
        });

      const waitForHead = async () => {
        const head = BigInt(run("cast", ["block-number", "--rpc-url", rpcUrl]));
        await waitFor(() => {
          const value = psql(
            database,
            "select coalesce(max(last_block),0) from indexer_checkpoints where service='chain-indexer'",
          );
          return BigInt(value || "0") >= head;
        }, "scoped indexer checkpoint");
      };

      indexer = startIndexer();
      await waitForHead();
      await stopProcess(indexer);
      indexer = undefined;

      assert.equal(psql(database, "select count(*) from raw_logs"), "3");
      assert.equal(
        psql(
          database,
          `select count(*) from raw_logs where lower(address) in ('${wethNoise.toLowerCase()}','${permit2Noise.toLowerCase()}')`,
        ),
        "0",
      );
      assert.equal(
        psql(
          database,
          `select count(*) from raw_logs where lower(address)='${poolManager.toLowerCase()}' and topics->>1 <> '${relevantPoolId}'`,
        ),
        "0",
      );

      send(token, "emitActivity(uint256)", ["2"]);
      send(poolManager, "emitSwap(bytes32,uint256)", [relevantPoolId, "2"]);
      send(poolManager, "emitNoise(bytes32,uint256)", [unrelatedPoolId, "100"]);
      indexer = startIndexer();
      await waitForHead();
      await stopProcess(indexer);
      indexer = undefined;

      assert.equal(psql(database, "select count(*) from raw_logs"), "5");
      assert.equal(
        psql(
          database,
          "select count(*)-count(distinct transaction_hash || ':' || log_index) from raw_logs",
        ),
        "0",
      );
      assert.equal(
        psql(
          database,
          `select count(*) from raw_logs where lower(address)='${token.toLowerCase()}'`,
        ),
        "2",
      );
      assert.equal(
        psql(
          database,
          `select count(*) from raw_logs where lower(address)='${poolManager.toLowerCase()}' and topics->>1='${relevantPoolId}'`,
        ),
        "2",
      );
    } finally {
      await stopProcess(indexer);
      await stopProcess(anvil);
      run("psql", [
        "-d",
        database,
        "-v",
        "ON_ERROR_STOP=1",
        "-c",
        `drop schema if exists ${schema} cascade`,
      ]);
      activeSchema = undefined;
      await rm(temporary, { recursive: true, force: true });
    }
  },
);
