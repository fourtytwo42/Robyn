#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import {
  createPublicClient,
  createWalletClient,
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
  throw new Error("Schema-15 broadcast rehearsal is restricted to loopback Anvil 28546");
}

const chain = {
  id: 31337,
  name: "Schema-15 isolated Devnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
};
const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
if ((await publicClient.getChainId()) !== 31337) {
  throw new Error("Broadcast rehearsal requires chain 31337");
}

// This is Anvil's published disposable development key. It is never used
// outside the isolated chain and is intentionally not written to evidence.
const account = privateKeyToAccount(
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
);
const wallet = createWalletClient({ account, chain, transport: http(rpcUrl) });
const artifactPath =
  "packages/contracts/out/Schema15AnvilLifecycleHarness.sol/Schema15AnvilLifecycleHarness.json";
const artifact = JSON.parse(readFileSync(artifactPath, "utf8"));
const bytecode = artifact.bytecode.object;
const abi = artifact.abi;
if (!bytecode || bytecode === "0x") throw new Error("Missing harness creation bytecode");

const deploymentHash = await wallet.deployContract({
  abi,
  bytecode,
  args: [account.address],
});
const deploymentReceipt = await publicClient.waitForTransactionReceipt({
  hash: deploymentHash,
});
if (deploymentReceipt.status !== "success" || !deploymentReceipt.contractAddress) {
  throw new Error("Schema-15 Anvil harness deployment failed");
}
const harness = deploymentReceipt.contractAddress;
const transactions = [
  {
    label: "deploy-exact-production-and-accelerated-streams",
    hash: deploymentHash,
    blockNumber: deploymentReceipt.blockNumber.toString(),
    gasUsed: deploymentReceipt.gasUsed.toString(),
  },
];
const initializeHash = await wallet.sendTransaction({
  to: harness,
  data: encodeFunctionData({ abi, functionName: "initialize" }),
});
const initializeReceipt = await publicClient.waitForTransactionReceipt({
  hash: initializeHash,
});
if (initializeReceipt.status !== "success") throw new Error("Harness initialization failed");
transactions.push({
  label: "initialize-exact-stream-contracts",
  hash: initializeHash,
  blockNumber: initializeReceipt.blockNumber.toString(),
  gasUsed: initializeReceipt.gasUsed.toString(),
});
const read = (functionName) =>
  publicClient.readContract({ address: harness, abi, functionName });
const productionToken = getAddress(await read("productionToken"));
const acceleratedToken = getAddress(await read("acceleratedToken"));
const rewardAsset = getAddress(await read("rewardAsset"));

const send = async (label, functionName, args = []) => {
  const hash = await wallet.sendTransaction({
    to: harness,
    data: encodeFunctionData({ abi, functionName, args }),
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`${label} failed`);
  return {
    label,
    hash,
    blockNumber: receipt.blockNumber.toString(),
    gasUsed: receipt.gasUsed.toString(),
  };
};

transactions.push(await send("deposit-both-streams", "depositBoth", [10n ** 21n]));

await publicClient.request({
  method: "evm_increaseTime",
  params: [601],
});
await publicClient.request({ method: "evm_mine", params: [] });
const tokenArtifact = JSON.parse(
  readFileSync("packages/contracts/out/RobynLaunchToken.sol/RobynLaunchToken.json", "utf8"),
);
const acceleratedClaimable = await publicClient.readContract({
  address: acceleratedToken,
  abi: tokenArtifact.abi,
  functionName: "withdrawableRewardOf",
  args: [account.address, 0n],
});
if (acceleratedClaimable === 0n) throw new Error("Accelerated stream did not unlock");

const claim = async (label, token) => {
  const hash = await wallet.sendTransaction({
    to: token,
    data: encodeFunctionData({
      abi: tokenArtifact.abi,
      functionName: "claim",
      args: [0n],
    }),
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`${label} failed`);
  transactions.push({
    label,
    hash,
    blockNumber: receipt.blockNumber.toString(),
    gasUsed: receipt.gasUsed.toString(),
  });
};
await claim("claim-accelerated-after-ten-minutes", acceleratedToken);

await publicClient.request({ method: "evm_increaseTime", params: [3000] });
await publicClient.request({ method: "evm_mine", params: [] });
await claim("claim-production-after-one-hour", productionToken);

const runtime = async (address) => {
  const code = await publicClient.getCode({ address });
  return { address, runtimeHash: keccak256(code) };
};
const result = {
  schemaVersion: 1,
  chainId: 31337,
  disposableDevAccount: account.address,
  harness: await runtime(harness),
  productionToken: await runtime(productionToken),
  acceleratedToken: await runtime(acceleratedToken),
  rewardAsset: await runtime(rewardAsset),
  transactions,
  productionDuration: String(await read("productionDuration")),
  acceleratedDuration: String(await read("acceleratedDuration")),
  passed: true,
};
writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
chmodSync(output, 0o600);
