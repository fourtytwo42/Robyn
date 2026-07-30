#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  createPublicClient,
  getAddress,
  http,
  keccak256,
  parseAbi,
  pad,
  stringToHex,
  toHex,
  zeroAddress,
  zeroHash,
} from "viem";

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
};
const rpcUrl = required("ROBYN_MAINNET_RPC_URL");
const manifestPath = resolve(required("ROBYN_MAINNET_DEPLOYMENT_MANIFEST"));
const governanceReportPath = resolve(
  required("ROBYN_MAINNET_GOVERNANCE_REPORT"),
);
const outputPath = resolve(required("ROBYN_MAINNET_GOVERNANCE_VERIFY_REPORT"));
const [manifest, governance] = await Promise.all([
  readFile(manifestPath, "utf8").then(JSON.parse),
  readFile(governanceReportPath, "utf8").then(JSON.parse),
]);
if (manifest.schemaVersion !== 14 || Number(manifest.chainId) !== 4663) {
  throw new Error("deployment manifest must be Schema-14 on chain 4663");
}
const safe = getAddress(
  manifest.contracts?.safe ?? manifest.guardian ?? governance.predictedSafe,
);
const timelock = getAddress(manifest.contracts?.timelock);
const daoToken = getAddress(manifest.contracts?.daoToken);
const governor = getAddress(manifest.contracts?.governor);
if (safe !== getAddress(governance.predictedSafe)) {
  throw new Error("deployed Safe differs from the predeployment prediction");
}

const client = createPublicClient({ transport: http(rpcUrl) });
if ((await client.getChainId()) !== 4663) {
  throw new Error("Mainnet RPC must return chain ID 4663");
}
const blockNumber = await client.getBlockNumber();
const safeAbi = parseAbi([
  "function getOwners() view returns (address[])",
  "function getThreshold() view returns (uint256)",
  "function getModulesPaginated(address,uint256) view returns (address[] array,address next)",
]);
const timelockAbi = parseAbi([
  "function getMinDelay() view returns (uint256)",
  "function hasRole(bytes32,address) view returns (bool)",
]);
const tokenAbi = parseAbi([
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
]);
const governorAbi = parseAbi([
  "function token() view returns (address)",
  "function timelock() view returns (address)",
]);
const sentinel = getAddress("0x0000000000000000000000000000000000000001");
const [
  owners,
  threshold,
  modulesPage,
  singletonSlot,
  fallbackSlot,
  minDelay,
  totalSupply,
  governorToken,
  governorTimelock,
] = await Promise.all([
  client.readContract({ address: safe, abi: safeAbi, functionName: "getOwners" }),
  client.readContract({
    address: safe,
    abi: safeAbi,
    functionName: "getThreshold",
  }),
  client.readContract({
    address: safe,
    abi: safeAbi,
    functionName: "getModulesPaginated",
    args: [sentinel, 10n],
  }),
  client.getStorageAt({ address: safe, slot: pad(toHex(0), { size: 32 }) }),
  client.getStorageAt({
    address: safe,
    slot: "0x6c9a6c4a39284e37ed1cf53a690fd295f6c0a87f5e93e687169aa32a712b9d68",
  }),
  client.readContract({
    address: timelock,
    abi: timelockAbi,
    functionName: "getMinDelay",
  }),
  client.readContract({
    address: daoToken,
    abi: tokenAbi,
    functionName: "totalSupply",
  }),
  client.readContract({
    address: governor,
    abi: governorAbi,
    functionName: "token",
  }),
  client.readContract({
    address: governor,
    abi: governorAbi,
    functionName: "timelock",
  }),
]);
const expectedOwners = governance.owners
  .map((owner) => getAddress(owner))
  .sort((left, right) => left.toLowerCase().localeCompare(right.toLowerCase()));
const actualOwners = owners
  .map((owner) => getAddress(owner))
  .sort((left, right) => left.toLowerCase().localeCompare(right.toLowerCase()));
const failures = [];
if (JSON.stringify(actualOwners) !== JSON.stringify(expectedOwners)) {
  failures.push("Safe owner set mismatch");
}
if (threshold !== 2n) failures.push("Safe threshold is not two");
if (modulesPage[0].length !== 0 || modulesPage[1] !== sentinel) {
  failures.push("Safe has an unexpected module");
}
const wordAddress = (word) =>
  getAddress(`0x${(word ?? "0x").replace(/^0x/, "").slice(-40)}`);
if (wordAddress(singletonSlot) !== getAddress(governance.safeContracts.singleton.address)) {
  failures.push("Safe singleton slot mismatch");
}
if (
  wordAddress(fallbackSlot) !==
  getAddress(governance.safeContracts.fallbackHandler.address)
) {
  failures.push("Safe fallback handler mismatch");
}
if (minDelay !== 172_800n) failures.push("Timelock delay is not two days");
if (totalSupply !== 1_000_000_000n * 10n ** 18n) {
  failures.push("RDAO fixed supply mismatch");
}
if (getAddress(governorToken) !== daoToken) failures.push("Governor token mismatch");
if (getAddress(governorTimelock) !== timelock) {
  failures.push("Governor Timelock mismatch");
}
const role = (name) => keccak256(stringToHex(name));
const roles = {
  governorProposer: await client.readContract({
    address: timelock,
    abi: timelockAbi,
    functionName: "hasRole",
    args: [role("PROPOSER_ROLE"), governor],
  }),
  safeCanceller: await client.readContract({
    address: timelock,
    abi: timelockAbi,
    functionName: "hasRole",
    args: [role("CANCELLER_ROLE"), safe],
  }),
  openExecutor: await client.readContract({
    address: timelock,
    abi: timelockAbi,
    functionName: "hasRole",
    args: [role("EXECUTOR_ROLE"), zeroAddress],
  }),
  deployerAdmin: await client.readContract({
    address: timelock,
    abi: timelockAbi,
    functionName: "hasRole",
    args: [zeroHash, getAddress(governance.deployer)],
  }),
  timelockAdmin: await client.readContract({
    address: timelock,
    abi: timelockAbi,
    functionName: "hasRole",
    args: [zeroHash, timelock],
  }),
};
if (!roles.governorProposer) failures.push("Governor lacks proposer role");
if (!roles.safeCanceller) failures.push("Safe lacks cancellation role");
if (!roles.openExecutor) failures.push("Timelock execution is not open");
if (roles.deployerAdmin) failures.push("deployer retained Timelock administration");
if (!roles.timelockAdmin) failures.push("Timelock lacks self administration");

const resolvedAllocations = governance.allocations.map((allocation) => ({
  ...allocation,
  recipient:
    allocation.recipient === "timelock"
      ? timelock
      : getAddress(allocation.recipient),
}));
for (const allocation of resolvedAllocations) {
  const balance = await client.readContract({
    address: daoToken,
    abi: tokenAbi,
    functionName: "balanceOf",
    args: [allocation.recipient],
  });
  if (balance !== 200_000_000n * 10n ** 18n) {
    failures.push(`RDAO allocation mismatch for ${allocation.recipient}`);
  }
  allocation.balance = balance.toString();
}
const report = {
  schemaVersion: 14,
  generatedAt: new Date().toISOString(),
  chainId: 4663,
  sourceBlock: blockNumber.toString(),
  safe: {
    address: safe,
    owners: actualOwners,
    threshold: threshold.toString(),
    modules: modulesPage[0],
    singleton: wordAddress(singletonSlot),
    fallbackHandler: wordAddress(fallbackSlot),
  },
  timelock: { address: timelock, delay: minDelay.toString(), roles },
  daoToken: {
    address: daoToken,
    totalSupply: totalSupply.toString(),
    allocations: resolvedAllocations,
  },
  governor: { address: governor, token: governorToken, timelock: governorTimelock },
  failures,
  passed: failures.length === 0,
  mainnetActivationAuthorized: false,
};
await mkdir(dirname(outputPath), { recursive: true, mode: 0o700 });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, {
  encoding: "utf8",
  flag: "wx",
  mode: 0o600,
});
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (failures.length > 0) process.exitCode = 2;
