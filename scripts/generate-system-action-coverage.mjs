#!/usr/bin/env node
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import ts from "typescript";

const root = process.cwd();
const output = join(root, "config/system-action-coverage.json");
const commonEvidence = [
  "RobynV4NativeProtocol.t.sol",
  "RobynV4HundredsUsersSimulation.t.sol",
];

const contractSpecs = [
  ["RobynV4LaunchCoordinatorV6", "packages/contracts/src/uniswap/RobynV4LaunchCoordinatorV6.sol"],
  ["RobynNativeLaunchFactoryV4", "packages/contracts/src/uniswap/RobynNativeLaunchFactoryV4.sol"],
  ["RobynNativeLaunchDeployerV4", "packages/contracts/src/uniswap/RobynNativeLaunchDeployerV4.sol"],
  ["RobynNativeVaultDeployerV4", "packages/contracts/src/uniswap/RobynNativeVaultDeployerV4.sol"],
  ["RobynV4MarketFactory", "packages/contracts/src/uniswap/RobynV4MarketFactory.sol"],
  ["RobynV4AdapterDeployer", "packages/contracts/src/uniswap/RobynV4AdapterDeployer.sol"],
  ["RobynV4LockerDeployer", "packages/contracts/src/uniswap/RobynV4LockerDeployer.sol"],
  ["RobynV4MarketDeployer", "packages/contracts/src/uniswap/RobynV4MarketDeployer.sol"],
  ["RobynV4BondingCurveMarket", "packages/contracts/src/uniswap/RobynV4BondingCurveMarket.sol"],
  ["RobynV4GraduationAdapter", "packages/contracts/src/uniswap/RobynV4GraduationAdapter.sol"],
  ["RobynV4FeePositionLocker", "packages/contracts/src/uniswap/RobynV4FeePositionLocker.sol"],
  ["RobynV4FeeAndPhaseHook", "packages/contracts/src/uniswap/RobynV4FeeAndPhaseHook.sol"],
  ["RobynV4AssetRouter", "packages/contracts/src/uniswap/RobynV4AssetRouter.sol"],
  ["RobynNativeBasketVaultV2", "packages/contracts/src/uniswap/RobynNativeBasketVaultV2.sol"],
  [
    "RobynNativeProtocolFeeRouterV4",
    "packages/contracts/src/uniswap/RobynNativeProtocolFeeRouterV4.sol",
  ],
  ["RobynTokenSink", "packages/contracts/src/RobynTokenSink.sol"],
  ["RobynLaunchToken", "packages/contracts/src/RobynLaunchToken.sol"],
  ["RobynDaoToken", "packages/contracts/src/dao/RobynDaoToken.sol"],
  ["RobynTestnetGovernor", "packages/contracts/src/dao/RobynTestnetGovernor.sol"],
  [
    "RobynV4TestAssetLiquidityLocker",
    "packages/contracts/src/uniswap/RobynV4TestAssetLiquidityLocker.sol",
  ],
];

const inheritedFunctions = {
  RobynLaunchToken: ["approve", "transfer", "transferFrom"],
  RobynDaoToken: [
    "approve",
    "transfer",
    "transferFrom",
    "permit",
    "delegate",
    "delegateBySig",
    "getVotes",
    "getPastVotes",
  ],
  RobynTestnetGovernor: [
    "propose",
    "castVote",
    "castVoteWithReason",
    "queue",
    "execute",
    "cancel",
  ],
};

function contractBody(source, contractName) {
  const declaration = new RegExp(`\\bcontract\\s+${contractName}\\b`).exec(source);
  if (!declaration) throw new Error(`contract ${contractName} not found`);
  const opening = source.indexOf("{", declaration.index);
  let depth = 0;
  for (let index = opening; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(opening + 1, index);
  }
  throw new Error(`contract ${contractName} body is incomplete`);
}

function publicSourceFunctions(body) {
  const functions = [];
  const matches = [...body.matchAll(/\bfunction\s+([A-Za-z0-9_]+)\s*\(/g)];
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const end = matches[index + 1]?.index ?? body.length;
    const declaration = body.slice(match.index, end).split("{", 1)[0];
    if (/\b(public|external)\b/.test(declaration)) functions.push(match[1]);
  }
  return [...new Set(functions)].sort();
}

async function walk(directory, predicate) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path, predicate));
    else if (predicate(path)) files.push(path);
  }
  return files;
}

const contracts = [];
for (const [contract, source] of contractSpecs) {
  const text = await readFile(join(root, source), "utf8");
  contracts.push({
    contract,
    source,
    artifact: contract,
    functions: publicSourceFunctions(contractBody(text, contract)),
    ...(inheritedFunctions[contract]
      ? { inheritedFunctions: inheritedFunctions[contract] }
      : {}),
    evidence: contract === "RobynTestnetGovernor"
      ? ["RobynTestnetGovernor.t.sol", "RobynV4HundredsUsersSimulation.t.sol"]
      : contract === "RobynV4TestAssetLiquidityLocker"
        ? ["RobynV4TestAssetLiquidityLocker.t.sol"]
        : commonEvidence,
  });
}

const api = [];
for (const file of await walk(join(root, "apps/api/src"), (path) => path.endsWith(".ts"))) {
  const source = await readFile(file, "utf8");
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ["get", "post", "put", "delete", "patch"].includes(node.expression.name.text) &&
      node.arguments.length > 0 &&
      ts.isStringLiteralLike(node.arguments[0]) &&
      node.arguments[0].text.startsWith("/")
    ) {
      api.push({
        method: node.expression.name.text.toUpperCase(),
        path: node.arguments[0].text,
        source: relative(root, file).split(sep).join("/"),
      });
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
}
api.sort((a, b) =>
  `${a.path}:${a.method}:${a.source}`.localeCompare(`${b.path}:${b.method}:${b.source}`),
);

const ui = (await walk(
  join(root, "apps/web/src/app"),
  (path) => path.endsWith(`${sep}page.tsx`),
)).map((file) => {
  const relativePage = relative(join(root, "apps/web/src/app"), file)
    .split(sep)
    .join("/");
  const route = `/${relativePage.replace(/\/?page\.tsx$/, "")}`.replace(/\/$/, "") || "/";
  return { route, source: relative(root, file).split(sep).join("/") };
}).sort((a, b) => a.route.localeCompare(b.route));

const workers = [
  {
    id: "native-v4-incremental-ingestion-and-projection",
    source: "apps/indexer/src/server.ts",
    markers: ["chain-indexer", "launch-projector", "projectLaunch"],
  },
  {
    id: "native-v4-keeper",
    source: "apps/keeper/src/server.ts",
    markers: ["convert-v4-launch-fees", "collectFees"],
  },
  {
    id: "ipfs-artifact-service",
    source: "apps/artifacts/src/server.ts",
    markers: ["/health", "artifact"],
  },
];

const journeys = [
  "home-discovery-navigation",
  "markets-search-filter-sort-pagination-watchlist",
  "atomic-create-ipfs-metadata-profile",
  "bonding-buy-sell-graduation-post-graduation-v4-trade",
  "all-24-assets-basket-convert-holder-claim",
  "creator-token-claim-portfolio-batch",
  "dao-reward-delegate-propose-vote-queue-execute-cancel",
  "wallet-disconnect-switch-wrong-chain-rejection",
  "desktop-tablet-mobile-keyboard-reduced-motion",
  "quarantine-fallback-report-restore",
  "keeper-indexer-restart-rebuild-reconcile",
  "backup-isolated-restore-served-release",
  "public-100-wallet-1500-write-campaign",
  "30-minute-public-testnet-endurance",
].map((id) => ({ id, status: "pending", evidence: [] }));

await writeFile(
  output,
  `${JSON.stringify({
    schemaVersion: 2,
    protocolProfile: "native-eth-uniswap-v4-schema8",
    generatedFrom: {
      contracts: "Solidity public and external functions",
      api: "Fastify route registrations",
      ui: "Next.js page routes",
      workers: "declared runtime markers",
    },
    contracts,
    api,
    ui,
    workers,
    journeys,
  }, null, 2)}\n`,
);
