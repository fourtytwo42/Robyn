#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  createPublicClient, getAddress, http, keccak256, parseAbi, parseAbiItem,
} from "viem";

const [manifestArg, outputArg] = process.argv.slice(2);
if (!manifestArg || !outputArg) throw new Error("usage: verify-schema18-retirement-eligibility.mjs <schema18-public-manifest> <output>");
const manifestRaw = await readFile(path.resolve(manifestArg), "utf8");
const manifest = JSON.parse(manifestRaw);
const archiveAccepted = process.env.ROBYN_SCHEMA18_TEST_CANARY_ARCHIVE_ACCEPTED === "true";
if (manifest.schemaVersion !== 18 || manifest.chainId !== 4663 || !manifest.canary?.launchToken) {
  throw new Error("sealed Schema-18 Mainnet Public manifest with canary required");
}
const rpc = process.env.ROBYN_SCHEMA19_MAINNET_RPC_URL ?? "http://127.0.0.1:18549";
const parsed = new URL(rpc);
if (!["127.0.0.1", "localhost"].includes(parsed.hostname)) throw new Error("retirement preflight requires loopback LAN RPC");
const client = createPublicClient({ transport: http(rpc, { retryCount: 0, timeout: 30_000 }) });
if ((await client.getChainId()) !== 4663 || (await client.request({ method: "eth_syncing" })) !== false) {
  throw new Error("retirement preflight RPC is wrong-chain or syncing");
}
const gateway = await fetch(new URL("/health", rpc)).then(async (response) => response.ok ? response.json() : Promise.reject(new Error(`gateway health ${response.status}`)));
if (gateway.status !== "ok" || gateway.activeProvider !== "primary" || gateway.providerSelection !== "operator" || gateway.fallbackTrafficAuthorized !== false) {
  throw new Error("retirement preflight requires healthy LAN-only gateway");
}
const c = manifest.contracts;
const token = getAddress(manifest.canary.launchToken);
const deployer = getAddress(manifest.deployer);
const factoryAbi = parseAbi([
  "function launchCount() view returns (uint256)",
  "function launchTokenById(uint256) view returns (address)",
  "function creatorByToken(address) view returns (address)",
  "function vaultByToken(address) view returns (address)",
]);
const marketFactoryAbi = parseAbi([
  "function marketByToken(address) view returns (address)",
  "function adapterByToken(address) view returns (address)",
]);
const assetRouterAbi = parseAbi(["function poolManager() view returns (address)"]);
const feeAbi = parseAbi([
  "function totalNativeLiabilities() view returns (uint256)",
  "function creatorFeeSplit(address) view returns (address[] recipients,uint16[] sharesBps,bool locked)",
  "function launchAccount(address) view returns ((address creator,address vault,address market,address locker,address hook,uint256 cumulativeNativeFees,uint256 cumulativeLaunchFeesConverted,uint256 cumulativeBondingNativeFees,uint256 cumulativeLockedLpNativeFees,uint256 cumulativeHookNativeFees,uint256 cumulativeLockedLaunchFeesConverted,uint256 cumulativeHookLaunchFeesConverted,uint256 claimableCreatorNative,uint256 cumulativeCreatorNative,uint256 claimedCreatorNative,uint256 pendingBasketNative,uint256 cumulativeBasketNativeSettled,bool registered))",
]);
const erc20Abi = parseAbi(["function balanceOf(address) view returns (uint256)"]);
const [launchCount, tokenById, creator, vault, market, adapter, poolManager, liabilities, routerBalance, split, account] = await Promise.all([
  client.readContract({ address: c.launchFactory, abi: factoryAbi, functionName: "launchCount" }),
  client.readContract({ address: c.launchFactory, abi: factoryAbi, functionName: "launchTokenById", args: [1n] }),
  client.readContract({ address: c.launchFactory, abi: factoryAbi, functionName: "creatorByToken", args: [token] }),
  client.readContract({ address: c.launchFactory, abi: factoryAbi, functionName: "vaultByToken", args: [token] }),
  client.readContract({ address: c.marketFactory, abi: marketFactoryAbi, functionName: "marketByToken", args: [token] }),
  client.readContract({ address: c.marketFactory, abi: marketFactoryAbi, functionName: "adapterByToken", args: [token] }),
  client.readContract({ address: c.assetRouter, abi: assetRouterAbi, functionName: "poolManager" }),
  client.readContract({ address: c.feeRouter, abi: feeAbi, functionName: "totalNativeLiabilities" }),
  client.getBalance({ address: c.feeRouter }),
  client.readContract({ address: c.feeRouter, abi: feeAbi, functionName: "creatorFeeSplit", args: [token] }),
  client.readContract({ address: c.feeRouter, abi: feeAbi, functionName: "launchAccount", args: [token] }),
]);
if (launchCount !== 1n || getAddress(tokenById) !== token || getAddress(creator) !== deployer) throw new Error("Schema-18 is no longer the single project canary deployment");
if (liabilities !== routerBalance || account.registered !== true || getAddress(account.creator) !== deployer) throw new Error("Schema-18 canary liabilities or registration changed");
const [splitRecipients, splitSharesBps, splitLocked] = split;
if (splitRecipients.length !== 1 || getAddress(splitRecipients[0]) !== deployer || Number(splitSharesBps[0]) !== 10_000) throw new Error("Schema-18 creator liability is not project-controlled");

const latest = await client.getBlockNumber();
const deploymentBlock = BigInt(manifest.application.databaseIdentity.deploymentBlock);
const transfer = parseAbiItem("event Transfer(address indexed from,address indexed to,uint256 value)");
const touched = new Set([deployer.toLowerCase()]);
const transfers = [];
let retainedTransferLogs = 0;
for (let from = deploymentBlock; from <= latest; from += 20_000n) {
  const to = from + 19_999n > latest ? latest : from + 19_999n;
  const logs = await client.getLogs({ address: token, event: transfer, fromBlock: from, toBlock: to });
  retainedTransferLogs += logs.length;
  for (const log of logs) {
    if (log.args.from) touched.add(log.args.from.toLowerCase());
    if (log.args.to) touched.add(log.args.to.toLowerCase());
    transfers.push({
      transactionHash: log.transactionHash,
      blockNumber: log.blockNumber.toString(),
      logIndex: log.logIndex,
      from: getAddress(log.args.from),
      to: getAddress(log.args.to),
      value: log.args.value.toString(),
    });
  }
}
const dynamic = [vault, market, adapter, account.locker, account.hook].map(getAddress);
const allowed = new Set([
  "0x0000000000000000000000000000000000000000", deployer, token, getAddress(poolManager), ...dynamic,
  manifest.guardianSafe, ...Object.values(c).flat().filter((value) => typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value)),
].map((value) => value.toLowerCase()));
const positiveHolders = [];
for (const holder of touched) {
  if (holder === "0x0000000000000000000000000000000000000000") continue;
  const balance = await client.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [holder] });
  if (balance > 0n) positiveHolders.push({ address: getAddress(holder), balance: balance.toString(), allowedProjectOrProtocol: allowed.has(holder) });
}
const externalHolders = positiveHolders.filter((holder) => !holder.allowedProjectOrProtocol);
const externalTransfers = transfers.filter((entry) => externalHolders.some((holder) => holder.address.toLowerCase() === entry.from.toLowerCase() || holder.address.toLowerCase() === entry.to.toLowerCase()));
const runtimeHashes = {};
for (const [label, address] of Object.entries({ launchFactory: c.launchFactory, feeRouter: c.feeRouter, coordinator: c.coordinator, assetRouter: c.assetRouter, token, vault, market, adapter, locker: account.locker })) {
  const code = await client.getCode({ address: getAddress(address) });
  if (!code || code === "0x") throw new Error(`${label} runtime missing`);
  runtimeHashes[label] = keccak256(code);
}
const result = {
  schemaVersion: 18, chainId: 4663, generatedAt: new Date().toISOString(), measurementBlock: latest.toString(),
  manifestSha256: createHash("sha256").update(manifestRaw).digest("hex"),
  launchCount: Number(launchCount), canaryToken: token, creator: getAddress(creator),
  dynamicContracts: { vault: getAddress(vault), market: getAddress(market), adapter: getAddress(adapter), locker: getAddress(account.locker), hook: getAddress(account.hook) },
  creatorSplit: { recipients: splitRecipients.map(getAddress), sharesBps: splitSharesBps.map(Number), locked: splitLocked },
  totalNativeLiabilities: liabilities.toString(), feeRouterBalance: routerBalance.toString(), liabilitiesExactlyBacked: true,
  retainedTransferLogs, positiveHolders, externalHolderCount: externalHolders.length, externalHolders, externalTransfers, runtimeHashes,
  rpcPolicy: { upstream: "LAN-only", alchemyProbeOnly: true, fallbackTrafficAuthorized: false },
  disposition: externalHolders.length === 0
    ? "clean-retirement"
    : archiveAccepted
      ? "owner-accepted-test-canary-archive"
      : "blocked-external-holder",
  ownerAcceptedArchive: archiveAccepted,
  eligibleForCleanRetirement: externalHolders.length === 0,
  eligibleForArchivedReplacement: externalHolders.length === 0 || archiveAccepted,
};
const serialized = `${JSON.stringify(result, null, 2)}\n`;
await writeFile(path.resolve(outputArg), serialized, { mode: 0o600, flag: "wx" });
process.stdout.write(`${JSON.stringify({ passed: result.eligibleForArchivedReplacement, disposition: result.disposition, launchCount: 1, externalHolderCount: result.externalHolderCount, liabilitiesWei: result.totalNativeLiabilities, sha256: createHash("sha256").update(serialized).digest("hex") })}\n`);
if (!result.eligibleForArchivedReplacement) process.exitCode = 2;
