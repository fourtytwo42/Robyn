import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { join } from "node:path";
import process from "node:process";
import test from "node:test";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  toHex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { prepareFundedTransaction } from "../lib/endurance-transaction-funding.mjs";
import {
  normalizeFeeEnvelope,
  transactionFundingShortfall,
} from "../testnet-endurance-policy.mjs";

const project = privateKeyToAccount(
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
);
const actor = privateKeyToAccount(
  "0x59c6995e998f97a5a0044976f0945389dc9e86dae88c7a8412f4603b6b78690d",
);
const recipient = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";

function sleep(milliseconds) {
  return new Promise((resolvePromise) =>
    setTimeout(resolvePromise, milliseconds),
  );
}

test("isolated Anvil funds a zero-balance actor once and submits with pinned fees", async () => {
  const port = 28_549;
  const rpcUrl = `http://127.0.0.1:${port}`;
  const anvil = spawn(
    join(process.env.HOME, ".foundry", "bin", "anvil"),
    [
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--chain-id",
      "31337",
      "--silent",
    ],
    { stdio: "ignore" },
  );
  const chain = defineChain({
    id: 31_337,
    name: "Schema-16 funding regression",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  });
  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
  const projectWallet = createWalletClient({
    account: project,
    chain,
    transport: http(rpcUrl),
  });
  const actorWallet = createWalletClient({
    account: actor,
    chain,
    transport: http(rpcUrl),
  });
  try {
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try {
        ready = (await publicClient.getChainId()) === 31_337;
      } catch {}
      if (ready) break;
      await sleep(25);
    }
    assert.equal(ready, true);
    await publicClient.request({
      method: "anvil_setBalance",
      params: [actor.address, "0x0"],
    });
    const fees = await publicClient.estimateFeesPerGas();
    const feeEnvelope = normalizeFeeEnvelope({
      maxFeePerGas: fees.maxFeePerGas,
      maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
      gasPrice: fees.gasPrice,
      fallbackGasPrice: await publicClient.getGasPrice(),
    });
    const fundingHashes = [];
    let raisedBaseFee = false;
    const prepared = await prepareFundedTransaction({
      request: { to: recipient, value: 1n },
      feeEnvelope,
      estimationGasCeiling: 50_000n,
      transactionGasCeiling: 100_000n,
      additionalFeeReserveWei: 0n,
      ensureFunding: async ({ targetWei }) => {
        const balanceWei = await publicClient.getBalance({
          address: actor.address,
        });
        const shortfallWei = transactionFundingShortfall({
          balanceWei,
          targetWei,
        });
        if (shortfallWei === 0n) return;
        const hash = await projectWallet.sendTransaction({
          account: project,
          to: actor.address,
          value: shortfallWei,
          ...feeEnvelope,
        });
        fundingHashes.push(hash);
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        assert.equal(receipt.status, "success");
        if (!raisedBaseFee) {
          await publicClient.request({
            method: "anvil_setNextBlockBaseFeePerGas",
            params: [toHex(feeEnvelope.maxFeePerGas - 1n)],
          });
          raisedBaseFee = true;
        }
      },
      estimateGas: (request) =>
        publicClient.estimateGas({ ...request, account: actor }),
    });
    assert.equal(fundingHashes.length, 1);
    assert.equal(raisedBaseFee, true);
    assert.equal(prepared.request.maxFeePerGas, feeEnvelope.maxFeePerGas);
    assert.equal(
      prepared.request.maxPriorityFeePerGas,
      feeEnvelope.maxPriorityFeePerGas,
    );
    const hash = await actorWallet.sendTransaction({
      account: actor,
      ...prepared.request,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    assert.equal(receipt.status, "success");
  } finally {
    anvil.kill("SIGTERM");
  }
});
