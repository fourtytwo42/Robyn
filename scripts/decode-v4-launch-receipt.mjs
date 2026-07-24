#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import process from "node:process";
import { createPublicClient, decodeEventLog, getAddress, http } from "viem";

const [transactionHash] = process.argv.slice(2);
if (!transactionHash) {
  throw new Error("usage: decode-v4-launch-receipt.mjs <transaction-hash>");
}

const rpcUrl = process.env.ROBYN_TESTNET_RPC_URL ?? "https://rpc.testnet.chain.robinhood.com";
const artifactPath =
  "packages/contracts/out/RobynV4LaunchCoordinatorV5.sol/RobynV4LaunchCoordinatorV5.json";
const artifact = JSON.parse(await readFile(artifactPath, "utf8"));
const eventAbi = artifact.abi.find(
  (entry) => entry.type === "event" && entry.name === "AtomicV4LaunchCreated",
);
if (!eventAbi) throw new Error("AtomicV4LaunchCreated ABI is missing");

const client = createPublicClient({ transport: http(rpcUrl) });
const receipt = await client.getTransactionReceipt({ hash: transactionHash });
const matches = [];
for (const log of receipt.logs) {
  try {
    const decoded = decodeEventLog({
      abi: [eventAbi],
      data: log.data,
      topics: log.topics,
      strict: true,
    });
    if (decoded.eventName === "AtomicV4LaunchCreated") {
      matches.push({ address: getAddress(log.address), ...decoded.args });
    }
  } catch {
    // Logs from contracts called during the atomic transaction are intentionally ignored.
  }
}
if (matches.length !== 1) {
  throw new Error(`expected one AtomicV4LaunchCreated event, found ${matches.length}`);
}

const match = matches[0];
const receiptData = match.receipt;
process.stdout.write(
  `${JSON.stringify({
    transactionHash,
    blockNumber: Number(receipt.blockNumber),
    coordinator: match.address,
    launchId: match.launchId.toString(),
    creator: getAddress(match.creator),
    token: getAddress(match.token),
    vault: getAddress(receiptData.vault),
    market: getAddress(receiptData.market),
    graduationAdapter: getAddress(receiptData.adapter),
    poolId: receiptData.poolId,
    positionLocker: getAddress(receiptData.locker),
    configurationHash: receiptData.configurationHash,
    launchSaltHash: receiptData.launchSaltHash,
    metadataUriHash: receiptData.metadataUriHash,
  })}\n`,
);
