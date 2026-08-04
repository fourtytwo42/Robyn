#!/usr/bin/env node
import { appendFileSync, chmodSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  createPublicClient, createWalletClient, encodeFunctionData, http, keccak256, parseEther,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const argv = process.argv.slice(2);
const option = (name) => {
  const index = argv.indexOf(`--${name}`);
  if (index === -1 || !argv[index + 1]) throw new Error(`Missing --${name}`);
  return argv[index + 1];
};
const rpcUrl = option("rpc-url");
const lifecyclePath = resolve(option("lifecycle"));
const journalPath = resolve(option("journal"));
const cycle = Number(option("cycle"));
if (rpcUrl !== "http://127.0.0.1:28547" || !Number.isSafeInteger(cycle) || cycle < 1) {
  throw new Error("Invalid isolated Schema-20 soak action configuration");
}
const lifecycle = JSON.parse(readFileSync(lifecyclePath, "utf8"));
if (lifecycle.schemaVersion !== 20 || lifecycle.chainId !== 31337 || !lifecycle.passed) {
  throw new Error("Passing Schema-20 lifecycle evidence required");
}
const chain = {
  id: 31337,
  name: "Schema-20 soak",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
};
const owner = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
const participant = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const client = createPublicClient({ chain, transport: http(rpcUrl) });
const ownerWallet = createWalletClient({ account: owner, chain, transport: http(rpcUrl) });
const participantWallet = createWalletClient({ account: participant, chain, transport: http(rpcUrl) });
if ((await client.getChainId()) !== 31337) throw new Error("wrong chain");

const artifact = (path) => JSON.parse(readFileSync(path, "utf8"));
const erc20 = artifact("packages/contracts/out/RobynDaoTokenV3.sol/RobynDaoTokenV3.json").abi;
const stakingAbi = artifact("packages/contracts/out/RobynRdaoStaking.sol/RobynRdaoStaking.json").abi;
const lockerAbi = artifact("packages/contracts/out/RobynRdaoV4LiquidityLocker.sol/RobynRdaoV4LiquidityLocker.json").abi;
const wethAbi = artifact("packages/contracts/out/DevnetWrappedNative.sol/DevnetWrappedNative.json").abi;
const traderAbi = artifact("packages/contracts/out/RobynRdaoV4LiquidityLocker.t.sol/Schema20RdaoV4Trader.json").abi;
const { rdao, staking, locker, wrappedNative, trader } = lifecycle.contracts;
const existing = readFileSync(journalPath, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
const append = (entry) => {
  appendFileSync(journalPath, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`);
  chmodSync(journalPath, 0o600);
};
const deadline = async () => (await client.getBlock()).timestamp + 120n;

async function send(label, wallet, to, abi, functionName, args = [], value = 0n) {
  const idempotencyKey = `schema20-soak:${cycle}:${label}`;
  const priorReceipt = existing.find((entry) => entry.idempotencyKey === idempotencyKey && entry.state === "confirmed");
  if (priorReceipt) {
    const receipt = await client.getTransactionReceipt({ hash: priorReceipt.hash });
    if (receipt.status !== "success") throw new Error(`${idempotencyKey} prior receipt failed`);
    return receipt;
  }
  const priorSubmission = existing.find((entry) => entry.idempotencyKey === idempotencyKey && entry.hash);
  if (priorSubmission) {
    const receipt = await client.getTransactionReceipt({ hash: priorSubmission.hash }).catch(() => null);
    if (!receipt) throw new Error(`${idempotencyKey} is ambiguous`);
    if (receipt.status !== "success") throw new Error(`${idempotencyKey} failed`);
    append({ idempotencyKey, state: "confirmed", hash: priorSubmission.hash, blockNumber: receipt.blockNumber.toString(), gasUsed: receipt.gasUsed.toString() });
    return receipt;
  }
  const data = encodeFunctionData({ abi, functionName, args });
  const nonce = await client.getTransactionCount({ address: wallet.account.address, blockTag: "pending" });
  await client.call({ account: wallet.account.address, to, data, value });
  append({ idempotencyKey, state: "intent", nonce, from: wallet.account.address, to, value: value.toString(), calldataHash: keccak256(data) });
  const hash = await wallet.sendTransaction({ to, data, value, nonce });
  append({ idempotencyKey, state: "submitted", nonce, hash });
  const receipt = await client.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`${idempotencyKey} failed`);
  append({ idempotencyKey, state: "confirmed", hash, blockNumber: receipt.blockNumber.toString(), gasUsed: receipt.gasUsed.toString() });
  return receipt;
}

await send("wrap", participantWallet, wrappedNative, wethAbi, "deposit", [], parseEther("0.02"));
await send("approve-weth", participantWallet, wrappedNative, wethAbi, "approve", [trader, parseEther("0.01")]);
await send("swap-forward", participantWallet, trader, traderAbi, "swap", [wrappedNative, parseEther("0.01"), participant.address]);
await send("approve-rdao", participantWallet, rdao, erc20, "approve", [trader, parseEther("1000")]);
await send("swap-reverse", participantWallet, trader, traderAbi, "swap", [rdao, parseEther("1000"), participant.address]);
const ownerEarned = await client.readContract({ address: staking, abi: stakingAbi, functionName: "earned", args: [owner.address] });
const participantEarned = await client.readContract({ address: staking, abi: stakingAbi, functionName: "earned", args: [participant.address] });
if (ownerEarned > 0n) await send("claim-owner", participantWallet, staking, stakingAbi, "claimFor", [owner.address]);
if (participantEarned > 0n) await send("claim-participant", ownerWallet, staking, stakingAbi, "claimFor", [participant.address]);
await send("harvest", ownerWallet, locker, lockerAbi, "harvest", [0n, await deadline()]);
process.stdout.write(`${JSON.stringify({ cycle, passed: true })}\n`);
