#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  concatHex,
  createPublicClient,
  createWalletClient,
  encodeDeployData,
  encodeFunctionData,
  getAddress,
  getContractAddress,
  http,
  keccak256,
  pad,
  parseAbi,
  stringToHex,
  zeroAddress,
  zeroHash,
} from "viem";
import { mainnet } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { parseCastDecryptedPrivateKey } from "./lib/campaign-keystore.mjs";

const RELEASE_SHA = "a8d54bb125d091be0cea010262a68a2baaceda30";
const CHAIN_ID = 4663;
const BRIDGE_AMOUNT_WEI = 32_107_112_992_656_000n;
const L1_RESERVE_WEI = 10_000_000_000_000_000n;
const L2_POST_DEPLOY_RESERVE_WEI = 30_000_000_000_000_000n;
const expectedGatewaySha = "17338466f55b3b5559d2248f3510681820d95834";
const stage = process.argv[2];
if (!new Set(["rehearse", "bridge", "deploy", "verify"]).has(stage)) {
  throw new Error("usage: run-schema16-mainnet-live.mjs rehearse|bridge|deploy|verify");
}
const localRehearsal = stage === "rehearse";
const expectedAuthorization = localRehearsal
  ? "local-rehearsal-only"
  : "bridge-and-paused-deployment";
if (process.env.ROBYN_MAINNET_LIVE_AUTHORIZED !== expectedAuthorization) {
  throw new Error("explicit bridge-and-paused-deployment authorization is required");
}

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
};
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const candidateRoot = path.resolve(
  process.env.ROBYN_SCHEMA16_RELEASE_WORKTREE ?? "/home/hendo420/Robyn-mainnet-a8d54bb",
);
const manifestPath = path.resolve(required("ROBYN_MAINNET_AUTHORIZED_MANIFEST"));
const manifestExpectedHash = required("ROBYN_MAINNET_AUTHORIZED_MANIFEST_SHA256").toLowerCase();
const governancePath = path.resolve(required("ROBYN_MAINNET_GOVERNANCE_REPORT"));
const keystorePath = path.resolve(required("ROBYN_MAINNET_KEYSTORE"));
const passwordPath = path.resolve(required("ROBYN_MAINNET_PASSWORD_FILE"));
const l1Rpc = required("ROBYN_ETHEREUM_MAINNET_RPC_URL");
const l2Rpc = process.env.ROBYN_MAINNET_GATEWAY_RPC_URL ?? "http://127.0.0.1:18549";
const evidenceRoot = path.resolve(required("ROBYN_MAINNET_LIVE_EVIDENCE_DIRECTORY"));
if (!/^http:\/\/(127\.0\.0\.1|localhost):[0-9]+$/.test(l2Rpc)) {
  throw new Error("Robinhood Mainnet writes must use the protected loopback LAN gateway");
}

const json = (value) =>
  JSON.stringify(value, (_, item) => (typeof item === "bigint" ? item.toString() : item), 2);
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const command = (name, args, options = {}) =>
  execFileSync(name, args, {
    cwd: options.cwd ?? repoRoot,
    env: options.env ?? process.env,
    encoding: "utf8",
    stdio: options.stdio ?? ["ignore", "pipe", "pipe"],
  }).trim();
const git = (root, ...args) => command("git", ["-C", root, ...args]);
const manifestRaw = await readFile(manifestPath, "utf8");
if (sha256(manifestRaw) !== manifestExpectedHash) throw new Error("authorized manifest checksum mismatch");
const manifest = JSON.parse(manifestRaw);
if (
  manifest.releaseSha !== RELEASE_SHA ||
  manifest.chainId !== CHAIN_ID ||
  manifest.bridgeAuthorized !== true ||
  manifest.deploymentAuthorized !== true ||
  manifest.canaryAuthorized !== false ||
  manifest.publicActivationAuthorized !== false ||
  manifest.policyOnlyReseal !== true ||
  manifest.rpcPolicy?.gatewayReleaseSha !== expectedGatewaySha ||
  manifest.rpcPolicy?.automaticApplicationFallback !== false ||
  manifest.authorization?.maximumBridgeAmountWei !== BRIDGE_AMOUNT_WEI.toString()
) {
  throw new Error("manifest does not authorize only the bridge and Paused deployment");
}
const gasEvidencePath = path.resolve(
  path.dirname(manifestPath),
  manifest.evidence.gasEvidence.sealedFile,
);
const gasEvidenceRaw = await readFile(gasEvidencePath, "utf8");
if (sha256(gasEvidenceRaw) !== manifest.evidence.gasEvidence.sha256) {
  throw new Error("sealed local-fork receipt ledger checksum mismatch");
}
const gasEvidence = JSON.parse(gasEvidenceRaw);
const rehearsedTransactions = new Map(
  gasEvidence.transactions
    .filter((transaction) => ["deployment", "bindings"].includes(transaction.phase))
    .map((transaction) => [transaction.label, transaction]),
);
if (BigInt(manifest.funding.bridgeAmountWei) !== BRIDGE_AMOUNT_WEI) {
  throw new Error("bridge amount differs from the authorized amount");
}
if (git(candidateRoot, "rev-parse", "HEAD") !== RELEASE_SHA || git(candidateRoot, "status", "--porcelain") !== "") {
  throw new Error("frozen release worktree identity mismatch");
}
const toolingSha = git(repoRoot, "rev-parse", "HEAD");
if (
  git(repoRoot, "status", "--porcelain") !== "" ||
  toolingSha !== git(repoRoot, "rev-parse", "@{upstream}") ||
  toolingSha !== manifest.deploymentToolingSha
) {
  throw new Error("live execution requires the clean pushed deployment tooling sealed in the manifest");
}

const governance = JSON.parse(await readFile(governancePath, "utf8"));
if (
  governance.releaseSha !== RELEASE_SHA ||
  governance.governanceMode !== "sole-owner-bootstrap" ||
  governance.threshold !== 1 ||
  getAddress(governance.predictedSafe) !== getAddress(manifest.predictedContracts.safe)
) {
  throw new Error("protected governance identity mismatch");
}
const password = (await readFile(passwordPath, "utf8")).trimEnd();
const cast = path.join(process.env.HOME ?? "/home/hendo420", ".foundry", "bin", "cast");
const decrypted = command(
  cast,
  ["wallet", "decrypt-keystore", path.basename(keystorePath), "--keystore-dir", path.dirname(keystorePath)],
  { env: { ...process.env, CAST_UNSAFE_PASSWORD: password } },
);
const account = privateKeyToAccount(parseCastDecryptedPrivateKey(decrypted));
if (account.address.toLowerCase() !== governance.deployer.toLowerCase()) {
  throw new Error("protected keystore does not match the authorized deployer");
}

const l1 = createPublicClient({ chain: mainnet, transport: http(l1Rpc, { timeout: 30_000, retryCount: 0 }) });
const l1Wallet = createWalletClient({ account, chain: mainnet, transport: http(l1Rpc, { timeout: 30_000, retryCount: 0 }) });
const l2Chain = {
  id: CHAIN_ID,
  name: "Robinhood Chain Mainnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [l2Rpc] } },
};
const l2 = createPublicClient({ chain: l2Chain, transport: http(l2Rpc, { timeout: 30_000, retryCount: 0 }) });
const l2Wallet = createWalletClient({ account, chain: l2Chain, transport: http(l2Rpc, { timeout: 30_000, retryCount: 0 }) });
if ((await l1.getChainId()) !== 1 || (await l2.getChainId()) !== CHAIN_ID) {
  throw new Error("live RPC chain identity mismatch");
}
if (localRehearsal) {
  await l2.request({ method: "anvil_nodeInfo", params: [] });
} else {
  const gatewayHealth = await fetch(new URL("/health", l2Rpc)).then(async (response) => {
    if (!response.ok) throw new Error(`gateway health returned ${response.status}`);
    return response.json();
  });
  if (
    gatewayHealth.expectedChainId !== CHAIN_ID ||
    gatewayHealth.activeProvider !== "primary" ||
    gatewayHealth.providerSelection !== "operator" ||
    gatewayHealth.fallbackTrafficAuthorized !== false ||
    gatewayHealth.status !== "ok"
  ) {
    throw new Error("LAN-only Mainnet gateway is not healthy and selected");
  }
}

await mkdir(evidenceRoot, { recursive: true, mode: 0o700 });
const journalPath = path.join(evidenceRoot, "transactions.jsonl");
const loadJournal = async () => {
  try {
    return (await readFile(journalPath, "utf8")).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
};
const appendJournal = async (record) => {
  const handle = await (await import("node:fs/promises")).open(journalPath, "a", 0o600);
  try {
    await handle.write(`${JSON.stringify(record)}\n`);
    await handle.sync();
  } finally {
    await handle.close();
  }
};
const receiptDigest = (receipt) =>
  sha256(
    json({
      transactionHash: receipt.transactionHash,
      blockNumber: receipt.blockNumber,
      status: receipt.status,
      gasUsed: receipt.gasUsed,
      effectiveGasPrice: receipt.effectiveGasPrice,
      contractAddress: receipt.contractAddress,
      logs: receipt.logs.map((log) => ({ address: log.address, topics: log.topics, data: log.data })),
    }),
  );
const isMissingTransaction = (error) => {
  const name = String(error?.name ?? "").toLowerCase();
  const message = String(error?.shortMessage ?? error?.message ?? error).toLowerCase();
  return name.includes("notfound") || message.includes("not found") || message.includes("could not be found");
};

const phaseUsage = new Map();
const submit = async ({ client, wallet, chain, chainId, phase, label, to, data, value = 0n, maxFeeCap, phaseGasCap }) => {
  const logicalKey = `schema16-live:${phase}:${label}`;
  if (chainId === CHAIN_ID && ["deployment", "bindings"].includes(phase)) {
    const rehearsed = rehearsedTransactions.get(label);
    if (
      !rehearsed ||
      rehearsed.phase !== phase ||
      rehearsed.calldataHash.toLowerCase() !== keccak256(data).toLowerCase() ||
      rehearsed.valueWei !== value.toString()
    ) {
      throw new Error(`${logicalKey} differs from the sealed local-fork transaction`);
    }
  }
  const records = await loadJournal();
  const matching = records.filter((record) => record.logicalKey === logicalKey || record.idempotencyKey === logicalKey || record.idempotencyKey?.startsWith(`${logicalKey}:attempt-`));
  const priorReceipt = matching.find((record) => record.type === "receipt");
  const rejectedKeys = new Set(matching.filter((record) => record.type === "submission-rejected").map((record) => record.idempotencyKey));
  const intents = matching.filter((record) => record.type === "intent");
  const priorIntent = intents.findLast((record) => !rejectedKeys.has(record.idempotencyKey));
  const idempotencyKey = priorIntent?.idempotencyKey ?? (intents.length === 0 ? logicalKey : `${logicalKey}:attempt-${intents.length + 1}`);
  if (priorReceipt) {
    const receipt = await client.getTransactionReceipt({ hash: priorReceipt.transactionHash });
    if (receipt.status !== "success" || receiptDigest(receipt) !== priorReceipt.receiptDigest) {
      throw new Error(`${logicalKey} receipt reconciliation failed`);
    }
    phaseUsage.set(phase, (phaseUsage.get(phase) ?? 0n) + receipt.gasUsed);
    return receipt;
  }
  const confirmedNonce = await client.getTransactionCount({ address: account.address, blockTag: "latest" });
  const pendingNonce = await client.getTransactionCount({ address: account.address, blockTag: "pending" });
  let request;
  let serialized;
  let transactionHash;
  if (priorIntent) {
    if (
      priorIntent.chainId !== chainId ||
      priorIntent.to !== (to ?? null) ||
      priorIntent.valueWei !== value.toString() ||
      priorIntent.calldataHash !== keccak256(data)
    ) throw new Error(`${idempotencyKey} intent differs from the deterministic plan`);
    request = {
      account,
      chain,
      to,
      data,
      value,
      nonce: Number(priorIntent.nonce),
      gas: BigInt(priorIntent.gasLimit),
      maxFeePerGas: BigInt(priorIntent.maxFeePerGasWei),
      maxPriorityFeePerGas: BigInt(priorIntent.maxPriorityFeePerGasWei),
      type: "eip1559",
    };
    serialized = await wallet.signTransaction(request);
    transactionHash = keccak256(serialized);
    if (transactionHash !== priorIntent.transactionHash) throw new Error(`${idempotencyKey} signed hash changed`);
    try {
      const receipt = await client.getTransactionReceipt({ hash: transactionHash });
      if (receipt.status !== "success") throw new Error(`${idempotencyKey} reverted`);
      await appendJournal({ type: "receipt", recordedAt: new Date().toISOString(), idempotencyKey, phase, label, chainId, transactionHash, blockNumber: receipt.blockNumber.toString(), status: receipt.status, gasUsed: receipt.gasUsed.toString(), effectiveGasPriceWei: receipt.effectiveGasPrice.toString(), contractAddress: receipt.contractAddress, receiptDigest: receiptDigest(receipt) });
      phaseUsage.set(phase, (phaseUsage.get(phase) ?? 0n) + receipt.gasUsed);
      return receipt;
    } catch (error) {
      if (!isMissingTransaction(error)) throw error;
    }
    if (confirmedNonce > request.nonce || pendingNonce > request.nonce + 1) {
      throw new Error(`${idempotencyKey} nonce advanced without a matching receipt`);
    }
    try {
      await client.getTransaction({ hash: transactionHash });
      const receipt = await client.waitForTransactionReceipt({
        hash: transactionHash,
        confirmations: chainId === 1 ? 2 : 1,
        timeout: chainId === 1 ? 600_000 : 180_000,
      });
      if (receipt.status !== "success") throw new Error(`${idempotencyKey} reverted`);
      await appendJournal({ type: "receipt", recordedAt: new Date().toISOString(), idempotencyKey, phase, label, chainId, transactionHash, blockNumber: receipt.blockNumber.toString(), status: receipt.status, gasUsed: receipt.gasUsed.toString(), effectiveGasPriceWei: receipt.effectiveGasPrice.toString(), contractAddress: receipt.contractAddress, receiptDigest: receiptDigest(receipt) });
      phaseUsage.set(phase, (phaseUsage.get(phase) ?? 0n) + receipt.gasUsed);
      return receipt;
    } catch (error) {
      if (!isMissingTransaction(error)) throw error;
    }
  } else {
    if (confirmedNonce !== pendingNonce) throw new Error(`${idempotencyKey} has an unresolved pending nonce`);
    const [fees, observedGasPrice] = await Promise.all([
      client.estimateFeesPerGas({ type: "eip1559" }),
      client.getGasPrice(),
    ]);
    if (observedGasPrice >= maxFeeCap) {
      throw new Error(`${idempotencyKey} network gas price reached the sealed fee ceiling`);
    }
    const maxFeePerGas = maxFeeCap;
    const maxPriorityFeePerGas =
      chainId === CHAIN_ID
        ? 0n
        : fees.maxPriorityFeePerGas && fees.maxPriorityFeePerGas < maxFeeCap - observedGasPrice
          ? fees.maxPriorityFeePerGas
          : 0n;
    const estimate = await client.estimateGas({ account: account.address, to, data, value });
    const gas = (estimate * 110n + 99n) / 100n;
    const used = phaseUsage.get(phase) ?? 0n;
    if (estimate + used > phaseGasCap) throw new Error(`${idempotencyKey} phase gas ceiling exceeded`);
    request = { account, chain, to, data, value, nonce: confirmedNonce, gas, maxFeePerGas, maxPriorityFeePerGas, type: "eip1559" };
    const balance = await client.getBalance({ address: account.address });
    const retainedReserve = chainId === 1 ? L1_RESERVE_WEI : L2_POST_DEPLOY_RESERVE_WEI;
    if (balance < value + gas * maxFeePerGas + retainedReserve) {
      throw new Error(`${idempotencyKey} would breach the retained reserve`);
    }
    serialized = await wallet.signTransaction(request);
    transactionHash = keccak256(serialized);
    await appendJournal({ type: "intent", recordedAt: new Date().toISOString(), logicalKey, idempotencyKey, phase, label, chainId, nonce: String(confirmedNonce), to: to ?? null, valueWei: value.toString(), calldataHash: keccak256(data), gasEstimate: estimate.toString(), gasLimit: gas.toString(), maxFeePerGasWei: maxFeePerGas.toString(), maxPriorityFeePerGasWei: maxPriorityFeePerGas.toString(), transactionHash });
  }
  let published;
  try {
    published = await client.sendRawTransaction({ serializedTransaction: serialized });
  } catch (error) {
    try {
      const receipt = await client.getTransactionReceipt({ hash: transactionHash });
      if (receipt.status !== "success") throw new Error(`${logicalKey} reverted`);
      await appendJournal({ type: "receipt", recordedAt: new Date().toISOString(), logicalKey, idempotencyKey, phase, label, chainId, transactionHash, blockNumber: receipt.blockNumber.toString(), status: receipt.status, gasUsed: receipt.gasUsed.toString(), effectiveGasPriceWei: receipt.effectiveGasPrice.toString(), contractAddress: receipt.contractAddress, receiptDigest: receiptDigest(receipt) });
      phaseUsage.set(phase, (phaseUsage.get(phase) ?? 0n) + receipt.gasUsed);
      return receipt;
    } catch (receiptError) {
      if (!isMissingTransaction(receiptError)) throw receiptError;
    }
    try {
      await client.getTransaction({ hash: transactionHash });
      throw new Error(`${logicalKey} submission response failed but the transaction exists; manual reconciliation required`);
    } catch (transactionError) {
      if (!isMissingTransaction(transactionError)) throw transactionError;
    }
    const [latestAfter, pendingAfter] = await Promise.all([
      client.getTransactionCount({ address: account.address, blockTag: "latest" }),
      client.getTransactionCount({ address: account.address, blockTag: "pending" }),
    ]);
    if (latestAfter !== request.nonce || pendingAfter !== request.nonce) {
      throw new Error(`${logicalKey} submission failed with changed nonce state; manual reconciliation required`);
    }
    await appendJournal({
      type: "submission-rejected",
      recordedAt: new Date().toISOString(),
      logicalKey,
      idempotencyKey,
      phase,
      label,
      chainId,
      nonce: String(request.nonce),
      transactionHash,
      errorName: error?.name ?? "Error",
      errorMessage: String(error?.shortMessage ?? error?.message ?? error).slice(0, 500),
    });
    throw new Error(`${logicalKey} was rejected before admission; nonce and hash absence were verified`);
  }
  if (published !== transactionHash) throw new Error(`${idempotencyKey} RPC returned a different transaction hash`);
  const receipt = await client.waitForTransactionReceipt({ hash: transactionHash, confirmations: chainId === 1 ? 2 : 1, timeout: chainId === 1 ? 600_000 : 180_000 });
  if (receipt.status !== "success") throw new Error(`${idempotencyKey} reverted`);
  const usage = (phaseUsage.get(phase) ?? 0n) + receipt.gasUsed;
  if (usage > phaseGasCap) throw new Error(`${idempotencyKey} confirmed beyond the phase gas ceiling`);
  phaseUsage.set(phase, usage);
  await appendJournal({ type: "receipt", recordedAt: new Date().toISOString(), logicalKey, idempotencyKey, phase, label, chainId, transactionHash, blockNumber: receipt.blockNumber.toString(), status: receipt.status, gasUsed: receipt.gasUsed.toString(), effectiveGasPriceWei: receipt.effectiveGasPrice.toString(), contractAddress: receipt.contractAddress, receiptDigest: receiptDigest(receipt) });
  return receipt;
};

const artifact = async (name, source = `${name}.sol`) =>
  JSON.parse(await readFile(path.join(candidateRoot, "packages/contracts/out", source, `${name}.json`), "utf8"));
const codeHash = async (client, address) => {
  const code = await client.getCode({ address });
  if (!code || code === "0x") throw new Error(`missing runtime code at ${address}`);
  return keccak256(code).toLowerCase();
};
const expectedRuntime = new Map(manifest.runtimeIdentities.map((item) => [item.name, item]));

if (stage === "bridge") {
  const inbox = getAddress("0x1A07cc4BD17E0118BdB54D70990D2158AbAD7a2D");
  if ((await codeHash(l1, inbox)) !== "0x69a469ef198a7f785b09fb0783fe42576faef7635e2d56426ec8746bad638e64") {
    throw new Error("Delayed Inbox runtime hash changed");
  }
  const data = encodeFunctionData({ abi: parseAbi(["function depositEth() payable returns (uint256)"]), functionName: "depositEth" });
  const l1Before = await l1.getBalance({ address: account.address });
  const l2Before = await l2.getBalance({ address: account.address });
  if (l1Before < 47_072_920_000_000_000n) throw new Error("authorized L1 funding is no longer available");
  const estimate = await l1.estimateGas({ account: account.address, to: inbox, data, value: BRIDGE_AMOUNT_WEI });
  if (estimate > BigInt(manifest.funding.bridgeGasEstimate)) throw new Error("bridge gas estimate exceeds the sealed estimate");
  const receipt = await submit({ client: l1, wallet: l1Wallet, chain: mainnet, chainId: 1, phase: "bridge", label: "canonical-deposit-eth", to: inbox, data, value: BRIDGE_AMOUNT_WEI, maxFeeCap: BigInt(manifest.funding.bridgeMaxFeePerGasWei), phaseGasCap: BigInt(manifest.funding.bridgeGasEstimate) * 2n });
  const l1After = await l1.getBalance({ address: account.address });
  if (l1After < L1_RESERVE_WEI) throw new Error("L1 emergency reserve was breached");
  const deadline = Date.now() + 30 * 60_000;
  let l2After = await l2.getBalance({ address: account.address });
  while (l2After < l2Before + BRIDGE_AMOUNT_WEI && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 15_000));
    l2After = await l2.getBalance({ address: account.address });
  }
  if (l2After < l2Before + BRIDGE_AMOUNT_WEI) throw new Error("canonical deposit did not credit L2 within 30 minutes");
  await writeFile(path.join(evidenceRoot, "bridge-result.json"), `${json({ status: "passed", transactionHash: receipt.transactionHash, blockNumber: receipt.blockNumber, l1BeforeWei: l1Before, l1AfterWei: l1After, l2BeforeWei: l2Before, l2AfterWei: l2After, bridgeAmountWei: BRIDGE_AMOUNT_WEI, logs: receipt.logs.map((log) => ({ address: log.address, topics: log.topics, data: log.data })) })}\n`, { mode: 0o600, flag: "wx" });
  process.stdout.write(`${json({ status: "passed", stage, transactionHash: receipt.transactionHash, l1AfterWei: l1After, l2AfterWei: l2After })}\n`);
  process.exit(0);
}

const configRaw = await readFile(
  path.join(repoRoot, "config/protocol/robinhood-mainnet-rehearsal.json"),
  "utf8",
);
const config = JSON.parse(configRaw);
const supportRaw = await readFile(path.join(repoRoot, config.supportPolicy), "utf8");
const productionConfigHash = keccak256(
  stringToHex(
    JSON.stringify({
      config: JSON.parse(configRaw),
      support: JSON.parse(supportRaw),
      governance: {
        governanceMode: governance.governanceMode,
        deployer: getAddress(governance.deployer),
        owners: governance.owners,
        threshold: governance.threshold,
        predictedSafe: governance.predictedSafe,
        signerSetHash: governance.signerSetHash,
        allocations: governance.allocations,
      },
    }),
  ),
);
if (productionConfigHash !== manifest.productionConfigHash) {
  throw new Error("production configuration hash changed since rehearsal");
}
const external = Object.fromEntries(Object.entries(config.venue).map(([name, entry]) => [name, getAddress(entry.address)]));
for (const [name, entry] of Object.entries(config.venue)) {
  if ((await codeHash(l2, getAddress(entry.address))) !== entry.runtimeCodeHash.toLowerCase()) {
    throw new Error(`${name} runtime identity changed`);
  }
}
for (const [name, entry] of Object.entries(governance.safeContracts)) {
  if ((await codeHash(l2, getAddress(entry.address))) !== entry.runtimeCodeHash.toLowerCase()) {
    throw new Error(`canonical Safe ${name} runtime identity changed`);
  }
}

const read = (address, abi, functionName, args = []) => l2.readContract({ address, abi, functionName, args });
const contracts = Object.fromEntries(Object.entries(manifest.predictedContracts).map(([name, address]) => [name, getAddress(address)]));
const deployGasCap = BigInt(manifest.gas.phaseCeilings.deployment.ceilingGas);
const bindingGasCap = BigInt(manifest.gas.phaseCeilings.bindings.ceilingGas);
const l2FeeCap = BigInt(manifest.gas.pinnedL2GasPriceWei);
const tx = (phase, label, to, data, value = 0n) => submit({ client: l2, wallet: l2Wallet, chain: l2Chain, chainId: CHAIN_ID, phase, label, to, data, value, maxFeeCap: l2FeeCap, phaseGasCap: phase === "deployment" ? deployGasCap : bindingGasCap });
const deployTx = async (label, name, args, source = `${name}.sol`) => {
  const built = await artifact(name, source);
  return tx("deployment", `deploy-${label}`, undefined, encodeDeployData({ abi: built.abi, bytecode: built.bytecode.object, args }));
};
const callTx = async (label, address, abi, functionName, args = []) => tx("bindings", label, address, encodeFunctionData({ abi, functionName, args }));

const verifyState = async () => {
  for (const [name, address] of Object.entries(contracts)) {
    const expected = expectedRuntime.get(name)?.runtimeCodeHash?.toLowerCase();
    if (!expected || (await codeHash(l2, address)) !== expected) throw new Error(`${name} deployed runtime mismatch`);
  }
  const safeAbi = parseAbi(["function getOwners() view returns (address[])", "function getThreshold() view returns (uint256)", "function getModulesPaginated(address,uint256) view returns (address[],address)"]);
  const owners = await read(contracts.safe, safeAbi, "getOwners");
  if (owners.length !== 1 || owners[0].toLowerCase() !== account.address.toLowerCase() || (await read(contracts.safe, safeAbi, "getThreshold")) !== 1n) throw new Error("Safe ownership mismatch");
  const modules = await read(contracts.safe, safeAbi, "getModulesPaginated", ["0x0000000000000000000000000000000000000001", 10n]);
  if (modules[0].length !== 0) throw new Error("Safe has an unexpected module");
  const timelock = await artifact("TimelockController", "TimelockController.sol");
  const governor = await artifact("RobynGovernor");
  const dao = await artifact("RobynDaoToken");
  const coordinator = await artifact("RobynV4LaunchCoordinatorV6");
  const launchFactory = await artifact("RobynNativeLaunchFactoryV4");
  const feeRouter = await artifact("RobynNativeProtocolFeeRouterV4");
  const assetRouter = await artifact("RobynV4AssetRouter");
  const proposer = await read(contracts.timelock, timelock.abi, "PROPOSER_ROLE");
  const canceller = await read(contracts.timelock, timelock.abi, "CANCELLER_ROLE");
  const executor = await read(contracts.timelock, timelock.abi, "EXECUTOR_ROLE");
  const admin = await read(contracts.timelock, timelock.abi, "DEFAULT_ADMIN_ROLE");
  const hasRole = (role, address) => read(contracts.timelock, timelock.abi, "hasRole", [role, address]);
  if (!(await hasRole(proposer, contracts.governor)) || !(await hasRole(canceller, contracts.safe)) || !(await hasRole(executor, zeroAddress)) || (await hasRole(admin, account.address))) throw new Error("Timelock role verification failed");
  if (getAddress(await read(contracts.governor, governor.abi, "timelock")) !== contracts.timelock || getAddress(await read(contracts.governor, governor.abi, "token")) !== contracts.daoToken) throw new Error("Governor wiring mismatch");
  const supply = await read(contracts.daoToken, dao.abi, "totalSupply");
  if (supply !== 1_000_000_000n * 10n ** 18n || (await read(contracts.daoToken, dao.abi, "balanceOf", [account.address])) !== supply) throw new Error("RDAO bootstrap allocation mismatch");
  if (Number(await read(contracts.coordinator, coordinator.abi, "launchMode")) !== 0 || (await read(contracts.launchFactory, launchFactory.abi, "launchCount")) !== 0n) throw new Error("launches are not empty and Paused");
  if (!(await read(contracts.feeRouter, feeRouter.abi, "paused")) || !(await read(contracts.assetRouter, assetRouter.abi, "conversionsPaused"))) throw new Error("conversions are not Paused");
  for (const route of manifest.routes) {
    const status = await read(contracts.assetRouter, assetRouter.abi, "executionRouteStatus", [getAddress(route.address)]);
    if (status.enabled || status.ready) throw new Error(`${route.symbol} route is unexpectedly enabled`);
  }
  if ((await read(contracts.feeRouter, feeRouter.abi, "totalNativeLiabilities")) !== 0n || (await read(contracts.feeRouter, feeRouter.abi, "unattributedNative")) !== 0n || (await read(contracts.assetRouter, assetRouter.abi, "unattributedNative")) !== 0n) throw new Error("initial liabilities or unattributed assets are nonzero");
  if ((await l2.getBalance({ address: contracts.feeRouter })) !== 0n || (await l2.getBalance({ address: contracts.assetRouter })) !== 0n) throw new Error("unexpected initial protocol balance");
  return { owners, supply, launchMode: 0, launchCount: 0, feeRouterPaused: true, assetRouterPaused: true, liabilitiesWei: "0" };
};

if (stage === "verify") {
  const state = await verifyState();
  const result = { status: "passed", stage, verifiedAt: new Date().toISOString(), releaseSha: RELEASE_SHA, manifestSha256: manifestExpectedHash, deploymentToolingSha: toolingSha, contracts, state, l2BalanceWei: await l2.getBalance({ address: account.address }), canaryAuthorized: false, publicActivationAuthorized: false };
  await writeFile(path.join(evidenceRoot, "postdeployment-verification.json"), `${json(result)}\n`, { mode: 0o600, flag: "wx" });
  process.stdout.write(`${json(result)}\n`);
  process.exit(0);
}

if (localRehearsal) {
  await l2.request({
    method: "anvil_setBalance",
    params: [account.address, `0x${BRIDGE_AMOUNT_WEI.toString(16)}`],
  });
} else {
  const bridgeResult = JSON.parse(await readFile(path.join(evidenceRoot, "bridge-result.json"), "utf8"));
  if (bridgeResult.status !== "passed" || BigInt(bridgeResult.bridgeAmountWei) !== BRIDGE_AMOUNT_WEI) throw new Error("verified bridge result is required before deployment");
}
const journal = await loadJournal();
const hasDeploymentReceipts = journal.some((record) => record.type === "receipt" && record.phase === "deployment");
if (!hasDeploymentReceipts && (await l2.getBalance({ address: account.address })) < BRIDGE_AMOUNT_WEI) throw new Error("bridged L2 funds are not available");
const startingNonce = await l2.getTransactionCount({ address: account.address, blockTag: "latest" });
if (!hasDeploymentReceipts && startingNonce !== 0) throw new Error("fresh Paused deployment requires L2 deployer nonce zero");
if (!hasDeploymentReceipts) {
  for (const address of Object.values(contracts)) {
    if ((await l2.getCode({ address })) !== undefined && (await l2.getCode({ address })) !== "0x") throw new Error(`predicted address is already occupied: ${address}`);
  }
}

const creationOrder = ["timelock", "daoToken", "governor", "assetRouter", "launchDeployer", "vaultDeployer", "launchFactory", "feeRouter", "tokenSink"];
for (let index = 0; index < creationOrder.length; index += 1) {
  const predicted = getContractAddress({ from: account.address, nonce: BigInt(index + 1) });
  if (predicted !== contracts[creationOrder[index]]) throw new Error(`${creationOrder[index]} predicted address changed`);
}
for (const [name, offset] of [["adapterDeployer", 11], ["lockerDeployer", 12], ["marketDeployer", 13], ["marketFactory", 14], ["coordinator", 15]]) {
  if (getContractAddress({ from: account.address, nonce: BigInt(offset) }) !== contracts[name]) throw new Error(`${name} predicted address changed`);
}

const safeSetupAbi = parseAbi(["function setup(address[] owners,uint256 threshold,address to,bytes data,address fallbackHandler,address paymentToken,uint256 payment,address paymentReceiver)"]);
const safeFactoryAbi = parseAbi(["function createChainSpecificProxyWithNonce(address singleton,bytes initializer,uint256 saltNonce) returns (address proxy)"]);
const initializer = encodeFunctionData({ abi: safeSetupAbi, functionName: "setup", args: [[account.address], 1n, zeroAddress, "0x", getAddress(governance.safeContracts.fallbackHandler.address), zeroAddress, 0n, zeroAddress] });
if (keccak256(initializer) !== governance.initializerHash.toLowerCase()) throw new Error("Safe initializer hash changed");
await tx("deployment", "canonical-safe-proxy", getAddress(governance.safeContracts.proxyFactory.address), encodeFunctionData({ abi: safeFactoryAbi, functionName: "createChainSpecificProxyWithNonce", args: [getAddress(governance.safeContracts.singleton.address), initializer, BigInt(governance.saltNonce)] }));

const timelock = await artifact("TimelockController", "TimelockController.sol");
const dao = await artifact("RobynDaoToken");
const governor = await artifact("RobynGovernor");
const assetRouter = await artifact("RobynV4AssetRouter");
const launchDeployer = await artifact("RobynNativeLaunchDeployerV4");
const vaultDeployer = await artifact("RobynNativeVaultDeployerV4");
const launchFactory = await artifact("RobynNativeLaunchFactoryV4");
const feeRouter = await artifact("RobynNativeProtocolFeeRouterV4");
const tokenSink = await artifact("RobynTokenSink");
await deployTx("timelock", "TimelockController", [172_800n, [], [], account.address], "TimelockController.sol");
await deployTx("rdao", "RobynDaoToken", [[account.address], [1_000_000_000n * 10n ** 18n], 3_600n]);
await deployTx("RobynGovernor", "RobynGovernor", [contracts.daoToken, contracts.timelock]);
await deployTx("RobynV4AssetRouter", "RobynV4AssetRouter", [external.poolManager, external.quoter, external.stateView, contracts.timelock, contracts.safe, external.weth]);
await deployTx("RobynNativeLaunchDeployerV4", "RobynNativeLaunchDeployerV4", [3_600n]);
await deployTx("RobynNativeVaultDeployerV4", "RobynNativeVaultDeployerV4", []);
await deployTx("RobynNativeLaunchFactoryV4", "RobynNativeLaunchFactoryV4", [contracts.assetRouter, contracts.launchDeployer, contracts.vaultDeployer, 1n, 86_400n]);
await deployTx("RobynNativeProtocolFeeRouterV4", "RobynNativeProtocolFeeRouterV4", [contracts.daoToken, contracts.assetRouter, contracts.timelock, contracts.safe, 3_600n]);
await deployTx("RobynTokenSink", "RobynTokenSink", []);

const hook = await artifact("RobynV4FeeAndPhaseHook");
const hookDomain = keccak256(stringToHex(`sherwood-schema16-mainnet:${RELEASE_SHA}`));
const hookInitCode = encodeDeployData({ abi: hook.abi, bytecode: hook.bytecode.object, args: [external.poolManager, contracts.feeRouter, account.address, external.positionManager, hookDomain] });
const create2Deployer = getAddress("0x4e59b44847b379578588920cA78FbF26c0B4956C");
const mined = JSON.parse(command("node", [path.join(repoRoot, "scripts/mine-v4-hook-salt.mjs"), create2Deployer, hookInitCode]));
if (getAddress(mined.address) !== contracts.oracleHook) throw new Error("mined hook address changed");
await tx("deployment", "deploy-v4-hook-create2", create2Deployer, concatHex([mined.salt, hookInitCode]));
await deployTx("RobynV4AdapterDeployer", "RobynV4AdapterDeployer", []);
await deployTx("RobynV4LockerDeployer", "RobynV4LockerDeployer", []);
await deployTx("RobynV4MarketDeployer", "RobynV4MarketDeployer", []);
await deployTx("RobynV4MarketFactory", "RobynV4MarketFactory", [{ launchFactory: contracts.launchFactory, feeRouter: contracts.feeRouter, assetRouter: contracts.assetRouter, oracleHook: contracts.oracleHook, poolManager: external.poolManager, positionManager: external.positionManager, permit2: external.permit2, stateView: external.stateView, adapterDeployer: contracts.adapterDeployer, lockerDeployer: contracts.lockerDeployer, marketDeployer: contracts.marketDeployer, tokenSink: contracts.tokenSink }, { curveTokenAllocation: 800_000_000n * 10n ** 18n, graduationTokenAllocation: 200_000_000n * 10n ** 18n, initialVirtualTokenReserve: 1_066_666_666_666_666_666_666_666_666n, initialVirtualNativeReserve: 2n * 10n ** 18n, graduationThresholdNative: 10n ** 16n, maximumCurvePurchase: 10n ** 15n, curveFeeBps: 100 }, 9_900, 500_000_000_000_000n, 1_000_000_000n, 1_000_000_000_000n]);
await deployTx("RobynV4LaunchCoordinatorV6", "RobynV4LaunchCoordinatorV6", [contracts.launchFactory, contracts.marketFactory, contracts.feeRouter, contracts.timelock, contracts.safe]);

const adapterDeployer = await artifact("RobynV4AdapterDeployer");
const lockerDeployer = await artifact("RobynV4LockerDeployer");
const marketDeployer = await artifact("RobynV4MarketDeployer");
const marketFactory = await artifact("RobynV4MarketFactory");
const coordinator = await artifact("RobynV4LaunchCoordinatorV6");
await callTx("launch-deployer-bind", contracts.launchDeployer, launchDeployer.abi, "bindController", [contracts.launchFactory]);
await callTx("vault-deployer-bind", contracts.vaultDeployer, vaultDeployer.abi, "bindController", [contracts.launchFactory]);
await callTx("adapter-deployer-bind", contracts.adapterDeployer, adapterDeployer.abi, "bindController", [contracts.marketFactory]);
await callTx("locker-deployer-bind", contracts.lockerDeployer, lockerDeployer.abi, "bindController", [contracts.marketFactory]);
await callTx("market-deployer-bind", contracts.marketDeployer, marketDeployer.abi, "bindController", [contracts.marketFactory]);
await callTx("hook-registrar-bind", contracts.oracleHook, hook.abi, "bindRegistrar", [contracts.marketFactory]);
await callTx("asset-router-registrar-bind", contracts.assetRouter, assetRouter.abi, "bindLaunchRegistrar", [contracts.marketFactory]);
await callTx("launch-factory-coordinator-bind", contracts.launchFactory, launchFactory.abi, "bindCoordinator", [contracts.coordinator]);
await callTx("market-factory-coordinator-bind", contracts.marketFactory, marketFactory.abi, "bindCoordinator", [contracts.coordinator]);
await callTx("fee-router-coordinator-bind", contracts.feeRouter, feeRouter.abi, "bindCoordinator", [contracts.coordinator]);
const exclusions = [contracts.timelock, contracts.feeRouter, contracts.governor, contracts.coordinator, contracts.marketFactory, contracts.launchFactory, contracts.launchDeployer, contracts.vaultDeployer, contracts.assetRouter, contracts.oracleHook, contracts.adapterDeployer, contracts.lockerDeployer, contracts.marketDeployer, contracts.tokenSink];
await callTx("dao-exclusions", contracts.daoToken, dao.abi, "sealRewardExclusions", [exclusions]);
await callTx("dao-reward-depositor", contracts.daoToken, dao.abi, "bindRewardDepositor", [contracts.feeRouter]);
await callTx("dao-delegation", contracts.daoToken, dao.abi, "delegate", [account.address]);
const proposer = await read(contracts.timelock, timelock.abi, "PROPOSER_ROLE");
const canceller = await read(contracts.timelock, timelock.abi, "CANCELLER_ROLE");
const executor = await read(contracts.timelock, timelock.abi, "EXECUTOR_ROLE");
const admin = await read(contracts.timelock, timelock.abi, "DEFAULT_ADMIN_ROLE");
await callTx("timelock-governor-proposer", contracts.timelock, timelock.abi, "grantRole", [proposer, contracts.governor]);
await callTx("timelock-safe-canceller", contracts.timelock, timelock.abi, "grantRole", [canceller, contracts.safe]);
await callTx("timelock-open-executor", contracts.timelock, timelock.abi, "grantRole", [executor, zeroAddress]);
await callTx("timelock-renounce-deployer-admin", contracts.timelock, timelock.abi, "renounceRole", [admin, account.address]);
const safeAbi = parseAbi(["function execTransaction(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,bytes signatures) returns (bool success)"]);
const safeSignature = concatHex([pad(account.address, { size: 32 }), zeroHash, "0x01"]);
await callTx("safe-pause-fee-conversions", contracts.safe, safeAbi, "execTransaction", [contracts.feeRouter, 0n, encodeFunctionData({ abi: feeRouter.abi, functionName: "setPaused", args: [true] }), 0, 0n, 0n, 0n, zeroAddress, zeroAddress, safeSignature]);
await callTx("safe-pause-asset-conversions", contracts.safe, safeAbi, "execTransaction", [contracts.assetRouter, 0n, encodeFunctionData({ abi: assetRouter.abi, functionName: "pauseConversions" }), 0, 0n, 0n, 0n, zeroAddress, zeroAddress, safeSignature]);

const state = await verifyState();
const l2Balance = await l2.getBalance({ address: account.address });
if (l2Balance < L2_POST_DEPLOY_RESERVE_WEI) throw new Error("Paused deployment breached the combined operational and canary reserve");
const receipts = (await loadJournal()).filter((record) => record.type === "receipt" && ["deployment", "bindings"].includes(record.phase));
const result = { status: "passed", stage, deployedAt: new Date().toISOString(), releaseSha: RELEASE_SHA, manifestSha256: manifestExpectedHash, deploymentToolingSha: toolingSha, contracts, state, receiptCount: receipts.length, l2BalanceWei: l2Balance, launchMode: "Paused", conversionsPaused: true, routesEnabled: 0, applicationWritesEnabled: false, canaryAuthorized: false, publicActivationAuthorized: false };
await writeFile(
  path.join(
    evidenceRoot,
    localRehearsal
      ? "paused-deployment-rehearsal.json"
      : "paused-deployment-result.json",
  ),
  `${json({ ...result, executionMode: localRehearsal ? "isolated-anvil" : "live-mainnet" })}\n`,
  { mode: 0o600, flag: "wx" },
);
process.stdout.write(`${json(result)}\n`);
