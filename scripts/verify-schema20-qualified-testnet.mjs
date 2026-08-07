#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { createPublicClient, getAddress, http, keccak256, parseAbi, parseEther } from "viem";

const [manifestArgument, outputArgument] = process.argv.slice(2);
if (!manifestArgument || !outputArgument) {
  throw new Error("usage: verify-schema20-qualified-testnet.mjs <manifest.json> <output.json>");
}
const manifestRaw = await readFile(manifestArgument, "utf8");
const manifest = JSON.parse(manifestRaw);
if (manifest.schemaVersion !== 20 || manifest.chainId !== 46_630) {
  throw new Error("qualified Schema-20 Testnet manifest identity mismatch");
}
const rpcUrl = process.env.ROBYN_SCHEMA20_RPC_URL ?? "http://127.0.0.1:18548";
const client = createPublicClient({ transport: http(rpcUrl, { retryCount: 0, timeout: 30_000 }) });
if ((await client.getChainId()) !== 46_630 || (await client.request({ method: "eth_syncing", params: [] })) !== false) {
  throw new Error("qualified Schema-20 Testnet RPC is wrong-chain or syncing");
}
// Keep the runtime verifier self-contained. Protected application bundles do not
// ship Foundry build output, and these view-only signatures are sufficient to
// verify the sealed Schema-20 deployment without recompiling contracts.
const factory = parseAbi([
  "function launchCount() view returns (uint256)",
  "function launchTokenById(uint256 launchId) view returns (address token)",
]);
const coordinator = parseAbi(["function launchMode() view returns (uint8)"]);
const router = parseAbi([
  "function conversionsPaused() view returns (bool)",
  "function executionRouteStatus(address asset) view returns ((uint8 kind,uint128 maximumNativeInput,uint128 maximumAssetInput,bytes32 disabledReason,bool enabled,bool runtimeVerified,bool ready,bytes32 reason) status)",
]);
const staking = parseAbi([
  "function totalPrincipal() view returns (uint256)",
  "function totalEligibleStake() view returns (uint256)",
  "function totalWarmingStake() view returns (uint256)",
  "function outstandingLiability() view returns (uint256)",
]);
const sale = parseAbi([
  "function finalized() view returns (bool)",
  "function allocationFunded() view returns (bool)",
]);
const locker = parseAbi(["function principalLiquidity() view returns (uint128)"]);
const erc20 = parseAbi([
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
]);
const read = (address, abi, functionName, args = []) => client.readContract({ address, abi, functionName, args });
const checks = [];
const check = (name, passed, actual) => {
  checks.push({ name, passed, actual: typeof actual === "bigint" ? actual.toString() : actual });
  if (!passed) throw new Error(`qualified Schema-20 Testnet check failed: ${name}`);
};
for (const [role, expected] of Object.entries(manifest.runtimeCodeHashes)) {
  const address = manifest.contracts[role];
  const code = address ? await client.getCode({ address: getAddress(address) }) : undefined;
  check(`runtime:${role}`, Boolean(code && code !== "0x" && keccak256(code).toLowerCase() === String(expected).toLowerCase()), code ? keccak256(code) : null);
}
const c = manifest.contracts;
const [launchCount, launchMode, conversionsPaused, totalSupply, principal, eligible, warming, liability, backing, locked, finalized, saleFunded, saleAllowance, stakingAllowance] = await Promise.all([
  read(c.launchFactory, factory, "launchCount"),
  read(c.coordinator, coordinator, "launchMode"),
  read(c.assetRouter, router, "conversionsPaused"),
  read(c.daoToken, erc20, "totalSupply"),
  read(c.rdaoStaking, staking, "totalPrincipal"),
  read(c.rdaoStaking, staking, "totalEligibleStake"),
  read(c.rdaoStaking, staking, "totalWarmingStake"),
  read(c.rdaoStaking, staking, "outstandingLiability"),
  read(c.wrappedNative, erc20, "balanceOf", [c.rdaoStaking]),
  read(c.rdaoLiquidityLocker, locker, "principalLiquidity"),
  read(c.rdaoSale, sale, "finalized"),
  read(c.rdaoSale, sale, "allocationFunded"),
  read(c.daoToken, erc20, "allowance", [manifest.deployer, c.rdaoSale]),
  read(c.daoToken, erc20, "allowance", [manifest.deployer, c.rdaoStaking]),
]);
check("launch-count", launchCount === 1n, launchCount);
check("public-mode", Number(launchMode) === 2, Number(launchMode));
check("conversions-active", conversionsPaused === false, conversionsPaused);
check("rdao-fixed-supply", totalSupply === parseEther("1000000000"), totalSupply);
check("retained-principal", principal === parseEther("800000000"), principal);
check("retained-eligible", eligible === parseEther("800000000"), eligible);
check("no-warming-stake", warming === 0n, warming);
check("exact-weth-backing", backing === liability, { backing: backing.toString(), liability: liability.toString() });
check("permanent-liquidity", locked > 0n, locked);
check("sale-finalized", finalized === true, finalized);
check("sale-allocation-funded", saleFunded === true, saleFunded);
check("sale-allowance-cleared", saleAllowance === 0n, saleAllowance);
check("staking-allowance-cleared", stakingAllowance === 0n, stakingAllowance);
const launchToken = await read(c.launchFactory, factory, "launchTokenById", [1n]);
const launchSupply = await read(launchToken, erc20, "totalSupply");
check("launch-fixed-supply", launchSupply === parseEther("1000000000"), launchSupply);
for (const route of manifest.assetRoutes) {
  const status = await read(c.assetRouter, router, "executionRouteStatus", [getAddress(route.asset)]);
  check(`route:${route.symbol}`, status.enabled === true && status.ready === true, { enabled: status.enabled, ready: status.ready, reason: status.reason });
}
const result = {
  schemaVersion: 20,
  chainId: 46_630,
  manifestSha256: createHash("sha256").update(manifestRaw).digest("hex"),
  verifiedAt: new Date().toISOString(),
  passed: checks.every((entry) => entry.passed),
  contractsVerified: checks,
};
await writeFile(outputArgument, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
process.stdout.write(`${JSON.stringify(result)}\n`);
