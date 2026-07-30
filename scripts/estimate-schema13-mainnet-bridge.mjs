#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  createPublicClient,
  encodeFunctionData,
  getAddress,
  http,
  keccak256,
} from "viem";
import { mainnet } from "viem/chains";

const DELAYED_INBOX = getAddress("0x1A07cc4BD17E0118BdB54D70990D2158AbAD7a2D");
const depositEthAbi = [
  {
    type: "function",
    name: "depositEth",
    stateMutability: "payable",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
];

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
};

const rpcUrl = required("ROBYN_ETHEREUM_MAINNET_RPC_URL");
const sender = getAddress(required("ROBYN_MAINNET_DEPLOYER_ADDRESS"));
const amountWei = BigInt(required("ROBYN_MAINNET_BRIDGE_AMOUNT_WEI"));
const expectedRuntimeHash = required(
  "ROBYN_MAINNET_DELAYED_INBOX_RUNTIME_HASH",
).toLowerCase();
const outputPath = resolve(required("ROBYN_MAINNET_BRIDGE_ESTIMATE"));
if (amountWei <= 0n) throw new Error("bridge amount must be positive");

const client = createPublicClient({ chain: mainnet, transport: http(rpcUrl) });
const chainId = await client.getChainId();
if (chainId !== 1) throw new Error("Ethereum RPC must return chain ID 1");
const [blockNumber, code, senderBalanceWei, fees] = await Promise.all([
  client.getBlockNumber(),
  client.getCode({ address: DELAYED_INBOX }),
  client.getBalance({ address: sender }),
  client.estimateFeesPerGas({ type: "eip1559" }),
]);
if (!code || code === "0x") throw new Error("Delayed Inbox has no runtime code");
const runtimeCodeHash = keccak256(code).toLowerCase();
if (runtimeCodeHash !== expectedRuntimeHash) {
  throw new Error(
    `Delayed Inbox runtime hash mismatch: ${runtimeCodeHash} != ${expectedRuntimeHash}`,
  );
}
const data = encodeFunctionData({ abi: depositEthAbi, functionName: "depositEth" });
const gasEstimate = await client.estimateGas({
  account: sender,
  to: DELAYED_INBOX,
  data,
  value: amountWei,
});
const maxFeePerGasWei = fees.maxFeePerGas;
if (!maxFeePerGasWei || maxFeePerGasWei <= 0n) {
  throw new Error("Ethereum RPC did not return a positive max fee per gas");
}
const estimatedCostWei = gasEstimate * maxFeePerGasWei;
if (senderBalanceWei < amountWei + estimatedCostWei) {
  throw new Error("deployer cannot cover the proposed deposit and estimated bridge gas");
}

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  chainId,
  sourceBlock: blockNumber.toString(),
  sender,
  senderBalanceWei: senderBalanceWei.toString(),
  target: DELAYED_INBOX,
  runtimeCodeHash,
  calldataHash: keccak256(data),
  bridgeAmountWei: amountWei.toString(),
  gasEstimate: gasEstimate.toString(),
  maxFeePerGasWei: maxFeePerGasWei.toString(),
  estimatedCostWei: estimatedCostWei.toString(),
  receiptOrBroadcast: false,
  method: "depositEth()",
};
await mkdir(dirname(outputPath), { recursive: true, mode: 0o700 });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, {
  encoding: "utf8",
  flag: "wx",
  mode: 0o600,
});
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
