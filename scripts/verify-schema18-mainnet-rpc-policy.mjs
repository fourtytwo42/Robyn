#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createPublicClient, http } from "viem";

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
};
const lanUrl = process.env.ROBYN_MAINNET_RPC_URL ?? "http://127.0.0.1:18549";
const alchemyUrl = required("ROBYN_MAINNET_ALCHEMY_PROBE_URL");
const outputPath = resolve(required("ROBYN_MAINNET_RPC_ACCEPTANCE"));
if (!/^http:\/\/(127\.0\.0\.1|localhost):[0-9]+$/.test(lanUrl)) {
  throw new Error("application Mainnet RPC must be the loopback LAN gateway");
}
const lan = createPublicClient({ transport: http(lanUrl, { timeout: 30_000, retryCount: 0 }) });
const probe = createPublicClient({ transport: http(alchemyUrl, { timeout: 30_000, retryCount: 0 }) });
const [lanChainId, lanSyncing, lanHead, probeChainId, probeSyncing, probeHead, health] = await Promise.all([
  lan.getChainId(),
  lan.request({ method: "eth_syncing", params: [] }),
  lan.getBlockNumber(),
  probe.getChainId(),
  probe.request({ method: "eth_syncing", params: [] }),
  probe.getBlockNumber(),
  fetch(new URL("/health", lanUrl)).then(async (response) => {
    if (!response.ok) throw new Error(`gateway health ${response.status}`);
    return response.json();
  }),
]);
if (lanChainId !== 4663 || probeChainId !== 4663 || lanSyncing !== false || probeSyncing !== false) {
  throw new Error("Mainnet RPC identity or synchronization check failed");
}
const lag = probeHead > lanHead ? probeHead - lanHead : 0n;
if (lag > 50n) throw new Error(`LAN Mainnet RPC is ${lag} blocks behind the comparison probe`);
if (
  health.status !== "ok" ||
  health.activeProvider !== "primary" ||
  health.providerSelection !== "operator" ||
  health.fallbackTrafficAuthorized !== false
) {
  throw new Error("gateway is not LAN-primary with operator-only fallback");
}
const block = await lan.getBlock({ blockNumber: lanHead });
const [receiptProbe, logsProbe, codeProbe, balanceProbe, callProbe, feeHistoryProbe, estimateProbe] = await Promise.all([
  lan.getTransactionCount({ address: "0x0000000000000000000000000000000000000000" }),
  lan.getLogs({ fromBlock: lanHead, toBlock: lanHead }),
  lan.getCode({ address: "0xE6CD65E3039fCbb7fD8fb992E5388247d9627549" }),
  lan.getBalance({ address: "0xecc5d6d032ADc9ca9E0F4042128067b8366da17A" }),
  lan.call({ to: "0xE6CD65E3039fCbb7fD8fb992E5388247d9627549", data: "0xe75235b8" }),
  lan.request({ method: "eth_feeHistory", params: ["0x1", `0x${lanHead.toString(16)}`, []] }),
  lan.estimateGas({ account: "0xecc5d6d032ADc9ca9E0F4042128067b8366da17A", to: "0xecc5d6d032ADc9ca9E0F4042128067b8366da17A", value: 0n }),
]);
if (!block.hash || !codeProbe || codeProbe === "0x" || !callProbe.data) {
  throw new Error("LAN method-equivalence surface is incomplete");
}
const report = {
  schemaVersion: 18,
  generatedAt: new Date().toISOString(),
  status: "pass",
  chainId: 4663,
  lan: {
    provider: "loopback-lan-gateway",
    blockNumber: lanHead.toString(),
    canonicalHash: block.hash,
    lagBlocks: lag.toString(),
    gateway: {
      status: health.status,
      activeProvider: health.activeProvider,
      providerSelection: health.providerSelection,
      fallbackTrafficAuthorized: health.fallbackTrafficAuthorized,
    },
    methodChecks: {
      nonce: receiptProbe.toString(),
      logs: logsProbe.length,
      codeBytes: (codeProbe.length - 2) / 2,
      balanceWei: balanceProbe.toString(),
      callBytes: (callProbe.data.length - 2) / 2,
      feeHistoryBlocks: feeHistoryProbe.baseFeePerGas.length,
      estimateGas: estimateProbe.toString(),
    },
  },
  alchemyProbe: {
    permittedMethods: ["eth_chainId", "eth_syncing", "eth_blockNumber"],
    blockNumber: probeHead.toString(),
    applicationFallbackAuthorized: false,
    applicationTrafficSent: false,
  },
  degradedPolicy: "disable-financial-submission-no-automatic-fallback",
  transactionBroadcasts: 0,
};
await mkdir(dirname(outputPath), { recursive: true, mode: 0o700 });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600, flag: "wx" });
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
