#!/usr/bin/env node
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  encodeFunctionData,
  getAddress,
  http,
  keccak256,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const argv = process.argv.slice(2);
const option = (name, fallback) => {
  const index = argv.indexOf(`--${name}`);
  return index === -1 ? fallback : argv[index + 1];
};
const rpcUrl = option("rpc-url", "");
const output = resolve(option("output", ""));
if (rpcUrl !== "http://127.0.0.1:28546" || !output) {
  throw new Error("Schema-19 broadcast rehearsal is restricted to loopback Anvil 28546");
}

const chain = {
  id: 31337,
  name: "Schema-19 isolated Devnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
};
const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
if ((await publicClient.getChainId()) !== 31337) {
  throw new Error("Broadcast rehearsal requires chain 31337");
}

// Published disposable Anvil keys, intentionally never written to evidence.
const administrator = privateKeyToAccount(
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
);
const holder = privateKeyToAccount(
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
);
const administratorWallet = createWalletClient({
  account: administrator,
  chain,
  transport: http(rpcUrl),
});
const holderWallet = createWalletClient({ account: holder, chain, transport: http(rpcUrl) });

const harnessArtifact = JSON.parse(
  readFileSync(
    "packages/contracts/out/Schema19AnvilLifecycleHarness.sol/Schema19AnvilLifecycleHarness.json",
    "utf8",
  ),
);
const bytecode = harnessArtifact.bytecode.object;
const abi = harnessArtifact.abi;
if (!bytecode || bytecode === "0x") throw new Error("Missing Schema-19 harness bytecode");

const transactionEvidence = async (label, receipt, expectedResult = "success") => {
  const transaction = await publicClient.getTransaction({ hash: receipt.transactionHash });
  const block = await publicClient.getBlock({ blockNumber: receipt.blockNumber });
  return {
    label,
    hash: receipt.transactionHash,
    calldataHash: keccak256(transaction.input),
    expectedResult,
    actualResult: receipt.status,
    blockNumber: receipt.blockNumber.toString(),
    gasUsed: receipt.gasUsed.toString(),
    stateFingerprint: block.stateRoot,
    failureTrace: null,
  };
};

const deploymentHash = await administratorWallet.deployContract({
  abi,
  bytecode,
  args: [holder.address],
});
const deploymentReceipt = await publicClient.waitForTransactionReceipt({ hash: deploymentHash });
if (deploymentReceipt.status !== "success" || !deploymentReceipt.contractAddress) {
  throw new Error("Schema-19 Anvil harness deployment failed");
}
const harness = deploymentReceipt.contractAddress;
const transactions = [
  await transactionEvidence("deploy-schema19-claim-maintenance-harness", deploymentReceipt),
];

const send = async (wallet, label, address, contractAbi, functionName, args = []) => {
  const hash = await wallet.sendTransaction({
    to: address,
    data: encodeFunctionData({ abi: contractAbi, functionName, args }),
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`${label} failed`);
  transactions.push(await transactionEvidence(label, receipt));
  return receipt;
};
await send(administratorWallet, "initialize-schema19-streams", harness, abi, "initialize");

const readHarness = (functionName) =>
  publicClient.readContract({ address: harness, abi, functionName });
const productionToken = getAddress(await readHarness("productionToken"));
const acceleratedToken = getAddress(await readHarness("acceleratedToken"));
const rewardAsset = getAddress(await readHarness("rewardAsset"));
const claimsRouter = getAddress(await readHarness("claimsRouter"));
const maintenance = getAddress(await readHarness("maintenance"));

await send(administratorWallet, "deposit-overlapping-production-and-test-streams", harness, abi, "depositBoth", [
  10n ** 21n,
]);
await publicClient.request({ method: "evm_increaseTime", params: [601] });
await publicClient.request({ method: "evm_mine", params: [] });

const tokenArtifact = JSON.parse(
  readFileSync("packages/contracts/out/RobynLaunchToken.sol/RobynLaunchToken.json", "utf8"),
);
const claimsArtifact = JSON.parse(
  readFileSync("packages/contracts/out/RobynClaimsRouter.sol/RobynClaimsRouter.json", "utf8"),
);
const rewardArtifact = JSON.parse(
  readFileSync(
    "packages/contracts/out/Schema19AnvilLifecycleHarness.sol/Schema19TortureRewardAsset.json",
    "utf8",
  ),
);
const maintenanceArtifact = JSON.parse(
  readFileSync(
    "packages/contracts/out/Schema19AnvilLifecycleHarness.sol/Schema19BroadcastMaintenance.json",
    "utf8",
  ),
);

const acceleratedClaimable = await publicClient.readContract({
  address: acceleratedToken,
  abi: tokenArtifact.abi,
  functionName: "withdrawableRewardOf",
  args: [holder.address, 0n],
});
if (acceleratedClaimable === 0n) throw new Error("Accelerated reward did not vest");
await send(
  administratorWallet,
  "permissionless-claim-all-for-holder",
  acceleratedToken,
  tokenArtifact.abi,
  "claimAllFor",
  [holder.address],
);

await send(
  administratorWallet,
  "enable-maintenance-failure",
  harness,
  abi,
  "setMaintenanceFailure",
  [true],
);
await publicClient.request({ method: "evm_increaseTime", params: [3000] });
await publicClient.request({ method: "evm_mine", params: [] });
const failedMaintenanceClaim = await send(
  holderWallet,
  "holder-claim-survives-maintenance-failure",
  claimsRouter,
  claimsArtifact.abi,
  "claimAll",
  [productionToken],
);
const claimEvent = failedMaintenanceClaim.logs
  .map((log) => {
    try {
      return decodeEventLog({ abi: claimsArtifact.abi, data: log.data, topics: log.topics });
    } catch {
      return null;
    }
  })
  .find((event) => event?.eventName === "HolderRewardsClaimed");
if (!claimEvent || claimEvent.args.maintenanceCallSucceeded !== false) {
  throw new Error("Claim did not record isolated maintenance failure");
}

await send(
  administratorWallet,
  "disable-maintenance-failure",
  harness,
  abi,
  "setMaintenanceFailure",
  [false],
);
await send(
  holderWallet,
  "permissionless-user-funded-maintenance",
  maintenance,
  maintenanceArtifact.abi,
  "processRewards",
  [productionToken],
);
const successfulAttempts = await publicClient.readContract({
  address: maintenance,
  abi: maintenanceArtifact.abi,
  functionName: "successfulAttempts",
});
if (successfulAttempts !== 1n) throw new Error("Maintenance was not processed exactly once");
const holderRewards = await publicClient.readContract({
  address: rewardAsset,
  abi: rewardArtifact.abi,
  functionName: "balanceOf",
  args: [holder.address],
});
if (holderRewards < 2n * 10n ** 21n - 2n) {
  throw new Error("Holder did not receive both vested streams");
}

const runtime = async (address) => {
  const code = await publicClient.getCode({ address });
  return { address, runtimeHash: keccak256(code) };
};
const result = {
  schemaVersion: 1,
  schema: 19,
  chainId: 31337,
  executionMode: "local-anvil-broadcast",
  administrator: administrator.address,
  holder: holder.address,
  harness: await runtime(harness),
  productionToken: await runtime(productionToken),
  acceleratedToken: await runtime(acceleratedToken),
  claimsRouter: await runtime(claimsRouter),
  maintenance: await runtime(maintenance),
  rewardAsset: await runtime(rewardAsset),
  transactions,
  productionDuration: String(await readHarness("productionDuration")),
  acceleratedDuration: String(await readHarness("acceleratedDuration")),
  successfulMaintenanceAttempts: successfulAttempts.toString(),
  holderRewards: holderRewards.toString(),
  passed: true,
};
writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
chmodSync(output, 0o600);
