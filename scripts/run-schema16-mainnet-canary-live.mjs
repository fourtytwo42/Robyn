#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, open, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  concatHex, createPublicClient, createWalletClient, encodeFunctionData, getAddress, http,
  keccak256, maxUint160, maxUint256, pad, parseAbi, stringToHex, zeroAddress, zeroHash,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { parseCastDecryptedPrivateKey } from "./lib/campaign-keystore.mjs";
import { encodeUniversalV4SingleSwap } from "./lib/v4-universal-router.mjs";
import { classifyCanaryJournal } from "./lib/mainnet-canary-journal.mjs";

const RELEASE_SHA = "a8d54bb125d091be0cea010262a68a2baaceda30";
const CHAIN_ID = 4663;
const RESERVE = 20_000_000_000_000_000n;
const stages = new Set(["verify", "propose", "vote", "queue", "execute", "routes", "launch", "settle", "claims", "unwind", "shutdown", "reconcile", "status"]);
const stage = process.argv[2];
if (!stages.has(stage)) throw new Error(`usage: ${path.basename(process.argv[1])} ${[...stages].join("|")}`);
const readOnly = new Set(["verify", "status"]);
const required = (name) => { const value = process.env[name]; if (!value) throw new Error(`${name} is required`); return value; };
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const candidateRoot = path.resolve(process.env.ROBYN_SCHEMA16_RELEASE_WORKTREE ?? "/home/hendo420/Robyn-mainnet-a8d54bb");
const manifestPath = path.resolve(required("ROBYN_MAINNET_CANARY_MANIFEST"));
const manifestHash = required("ROBYN_MAINNET_CANARY_MANIFEST_SHA256").toLowerCase();
const evidenceRoot = path.resolve(required("ROBYN_MAINNET_CANARY_LIVE_EVIDENCE"));
const rpc = process.env.ROBYN_MAINNET_GATEWAY_RPC_URL ?? "http://127.0.0.1:18549";
const localRehearsal = process.env.ROBYN_MAINNET_CANARY_LOCAL_REHEARSAL === "true";
if (!/^http:\/\/(127\.0\.0\.1|localhost):[0-9]+$/.test(rpc)) throw new Error("Mainnet canary must use the loopback LAN gateway");

const json = (value) => JSON.stringify(value, (_, item) => typeof item === "bigint" ? item.toString() : item, 2);
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const command = (name, args, options = {}) => execFileSync(name, args, { cwd: options.cwd ?? repoRoot, env: options.env ?? process.env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const git = (root, ...args) => command("git", ["-C", root, ...args]);
const manifestRaw = await readFile(manifestPath, "utf8");
if (sha256(manifestRaw) !== manifestHash) throw new Error("canary manifest checksum mismatch");
const manifest = JSON.parse(manifestRaw);
const toolingSha = git(repoRoot, "rev-parse", "HEAD");
if (git(repoRoot, "status", "--porcelain") !== "" || toolingSha !== git(repoRoot, "rev-parse", "@{upstream}")) throw new Error("canary execution requires a clean pushed checkout");
if (git(candidateRoot, "rev-parse", "HEAD") !== RELEASE_SHA || git(candidateRoot, "status", "--porcelain") !== "") throw new Error("frozen runtime worktree mismatch");
if (manifest.releaseSha !== RELEASE_SHA || manifest.chainId !== CHAIN_ID || manifest.productionRunnerSha !== toolingSha || manifest.authorization?.publicModeAuthorized !== false || manifest.authorization?.applicationWritesAuthorized !== false || manifest.authorization?.furtherBridgeAuthorized !== false) throw new Error("canary manifest identity or authorization boundary mismatch");
if (!readOnly.has(stage) && (manifest.authorization?.canaryProposalAuthorized !== true || manifest.authorization?.canaryTransactionsAuthorized !== true || process.env.ROBYN_MAINNET_CANARY_AUTHORIZED !== manifestHash)) throw new Error("this exact canary manifest is not explicitly authorized");

const l2Chain = { id: CHAIN_ID, name: "Robinhood Chain Mainnet", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [rpc] } } };
const client = createPublicClient({ chain: l2Chain, transport: http(rpc, { timeout: 30_000, retryCount: 0 }) });
if ((await client.getChainId()) !== CHAIN_ID || (await client.request({ method: "eth_syncing", params: [] })) !== false) throw new Error("LAN RPC is wrong-chain or syncing");
const health = localRehearsal
  ? (await client.request({ method: "anvil_nodeInfo", params: [] }), { status: "ok", activeProvider: "primary", providerSelection: "operator", fallbackTrafficAuthorized: false })
  : await fetch(new URL("/health", rpc)).then(async (response) => { if (!response.ok) throw new Error(`gateway health ${response.status}`); return response.json(); });
if (health.status !== "ok" || health.activeProvider !== "primary" || health.providerSelection !== "operator" || health.fallbackTrafficAuthorized !== false) throw new Error("LAN-only gateway is not healthy and selected");

let account;
let wallet;
if (!readOnly.has(stage)) {
  const keystorePath = path.resolve(required("ROBYN_MAINNET_KEYSTORE"));
  const password = (await readFile(path.resolve(required("ROBYN_MAINNET_PASSWORD_FILE")), "utf8")).trimEnd();
  const cast = path.join(process.env.HOME ?? "/home/hendo420", ".foundry", "bin", "cast");
  const decrypted = command(cast, ["wallet", "decrypt-keystore", path.basename(keystorePath), "--keystore-dir", path.dirname(keystorePath)], { env: { ...process.env, CAST_UNSAFE_PASSWORD: password } });
  account = privateKeyToAccount(parseCastDecryptedPrivateKey(decrypted));
  if (account.address.toLowerCase() !== manifest.deployer.toLowerCase()) throw new Error("keystore does not match the sealed deployer");
  wallet = createWalletClient({ account, chain: l2Chain, transport: http(rpc, { timeout: 30_000, retryCount: 0 }) });
}

await mkdir(evidenceRoot, { recursive: true, mode: 0o700 });
const journalPath = path.join(evidenceRoot, "transactions.jsonl");
const statePath = path.join(evidenceRoot, "state.json");
const loadJson = async (file, fallback) => { try { return JSON.parse(await readFile(file, "utf8")); } catch (error) { if (error?.code === "ENOENT") return fallback; throw error; } };
const state = await loadJson(statePath, { schemaVersion: 16, manifestSha256: manifestHash, releaseSha: RELEASE_SHA, completedStages: [], createdAt: new Date().toISOString() });
if (state.manifestSha256 !== manifestHash || state.releaseSha !== RELEASE_SHA) throw new Error("live canary state belongs to another manifest");
const saveState = async () => { const tmp = `${statePath}.tmp`; await writeFile(tmp, `${json({ ...state, updatedAt: new Date().toISOString() })}\n`, { mode: 0o600 }); await rename(tmp, statePath); };
const journal = async () => { try { const raw = (await readFile(journalPath, "utf8")).trim(); return raw ? raw.split("\n").map(JSON.parse) : []; } catch (error) { if (error?.code === "ENOENT") return []; throw error; } };
const append = async (record) => { const handle = await open(journalPath, "a", 0o600); try { await handle.write(`${JSON.stringify(record)}\n`); await handle.sync(); } finally { await handle.close(); } };
const receiptDigest = (receipt) => sha256(json({ transactionHash: receipt.transactionHash, blockNumber: receipt.blockNumber, status: receipt.status, gasUsed: receipt.gasUsed, effectiveGasPrice: receipt.effectiveGasPrice, contractAddress: receipt.contractAddress, logs: receipt.logs.map((log) => ({ address: log.address, topics: log.topics, data: log.data })) }));
const missing = (error) => /not found|could not be found/i.test(String(error?.shortMessage ?? error?.message ?? error));
const phaseSpec = (phase) => manifest.funding.phaseGas[phase] ?? manifest.funding.phaseGas[phase === "routes" || phase === "launch" ? "post-graduation-trades" : phase];
const phaseUsed = async (phase) => (await journal()).filter((item) => item.type === "receipt" && item.phase === phase).reduce((sum, item) => sum + BigInt(item.gasUsed), 0n);

const submit = async ({ phase, label, to, data, value = 0n }) => {
  const key = `schema16-canary:${phase}:${label}`;
  const allRecords = await journal();
  const records = allRecords.filter((item) => item.logicalKey === key);
  const classified = classifyCanaryJournal(allRecords, key);
  const priorReceipt = classified.receipt;
  if (priorReceipt) {
    const receipt = await client.getTransactionReceipt({ hash: priorReceipt.transactionHash });
    if (receipt.status !== "success" || receiptDigest(receipt) !== priorReceipt.receiptDigest) throw new Error(`${key} receipt changed`);
    return receipt;
  }
  const activeIntent = classified.activeIntent;
  if (activeIntent) {
    try {
      const receipt = await client.getTransactionReceipt({ hash: activeIntent.transactionHash });
      if (receipt.status !== "success") throw new Error(`${key} reverted`);
      await append({ type: "receipt", recordedAt: new Date().toISOString(), logicalKey: key, idempotencyKey: activeIntent.idempotencyKey, phase, label, transactionHash: receipt.transactionHash, blockNumber: receipt.blockNumber.toString(), status: receipt.status, gasUsed: receipt.gasUsed.toString(), effectiveGasPriceWei: receipt.effectiveGasPrice.toString(), receiptDigest: receiptDigest(receipt) });
      return receipt;
    } catch (error) { if (!missing(error)) throw error; }
    try { await client.getTransaction({ hash: activeIntent.transactionHash }); throw new Error(`${key} is pending or ambiguous; manual reconciliation required`); } catch (error) { if (!missing(error)) throw error; }
    const [latest, pending] = await Promise.all([client.getTransactionCount({ address: account.address, blockTag: "latest" }), client.getTransactionCount({ address: account.address, blockTag: "pending" })]);
    if (latest !== Number(activeIntent.nonce) || pending !== Number(activeIntent.nonce)) throw new Error(`${key} nonce changed after an unconfirmed intent`);
    throw new Error(`${key} has an unresolved signed intent; automatic replay is prohibited`);
  }
  const [latest, pending, gasPrice] = await Promise.all([client.getTransactionCount({ address: account.address, blockTag: "latest" }), client.getTransactionCount({ address: account.address, blockTag: "pending" }), client.getGasPrice()]);
  if (latest !== pending) throw new Error(`${key} has an unresolved pending nonce`);
  const maxFee = BigInt(manifest.funding.maxFeePerGasWei);
  if (gasPrice > maxFee) throw new Error(`${key} exceeds the sealed fee ceiling`);
  const estimate = await client.estimateGas({ account: account.address, to, data, value });
  const gas = (estimate * 110n + 99n) / 100n;
  const spec = phaseSpec(phase);
  if (!spec || (await phaseUsed(phase)) + estimate > BigInt(spec.ceilingGas)) throw new Error(`${key} exceeds its phase gas ceiling`);
  const balance = await client.getBalance({ address: account.address });
  if (balance < value + gas * maxFee + RESERVE) throw new Error(`${key} would breach the 0.02 ETH reserve`);
  const request = { account, chain: l2Chain, to, data, value, nonce: latest, gas, maxFeePerGas: maxFee, maxPriorityFeePerGas: 0n, type: "eip1559" };
  const serialized = await wallet.signTransaction(request);
  const transactionHash = keccak256(serialized);
  const idempotencyKey = classified.attempt === 1 ? key : `${key}:attempt-${classified.attempt}`;
  await append({ type: "intent", recordedAt: new Date().toISOString(), logicalKey: key, idempotencyKey, phase, label, chainId: CHAIN_ID, nonce: String(latest), to, valueWei: value.toString(), calldataHash: keccak256(data), gasEstimate: estimate.toString(), gasLimit: gas.toString(), maxFeePerGasWei: maxFee.toString(), maxPriorityFeePerGasWei: "0", transactionHash });
  let published;
  try { published = await client.sendRawTransaction({ serializedTransaction: serialized }); }
  catch (error) {
    try { const receipt = await client.getTransactionReceipt({ hash: transactionHash }); if (receipt.status === "success") { await append({ type: "receipt", recordedAt: new Date().toISOString(), logicalKey: key, idempotencyKey, phase, label, transactionHash, blockNumber: receipt.blockNumber.toString(), status: receipt.status, gasUsed: receipt.gasUsed.toString(), effectiveGasPriceWei: receipt.effectiveGasPrice.toString(), receiptDigest: receiptDigest(receipt) }); return receipt; } } catch (receiptError) { if (!missing(receiptError)) throw receiptError; }
    const [afterLatest, afterPending] = await Promise.all([client.getTransactionCount({ address: account.address, blockTag: "latest" }), client.getTransactionCount({ address: account.address, blockTag: "pending" })]);
    if (afterLatest !== latest || afterPending !== latest) throw new Error(`${key} submission is ambiguous; manual reconciliation required`);
    await append({ type: "submission-rejected", recordedAt: new Date().toISOString(), logicalKey: key, idempotencyKey, phase, label, nonce: String(latest), transactionHash, error: String(error?.shortMessage ?? error?.message ?? error).slice(0, 500) });
    throw new Error(`${key} was rejected before admission`);
  }
  if (published !== transactionHash) throw new Error(`${key} returned a different hash`);
  const receipt = await client.waitForTransactionReceipt({ hash: transactionHash, confirmations: 1, timeout: 180_000 });
  if (receipt.status !== "success") throw new Error(`${key} reverted`);
  await append({ type: "receipt", recordedAt: new Date().toISOString(), logicalKey: key, idempotencyKey, phase, label, transactionHash, blockNumber: receipt.blockNumber.toString(), status: receipt.status, gasUsed: receipt.gasUsed.toString(), effectiveGasPriceWei: receipt.effectiveGasPrice.toString(), receiptDigest: receiptDigest(receipt) });
  return receipt;
};

const artifact = async (name, source = `${name}.sol`) => JSON.parse(await readFile(path.join(candidateRoot, "packages/contracts/out", source, `${name}.json`), "utf8"));
const contracts = Object.fromEntries(Object.entries(manifest.contracts).map(([name, address]) => [name, getAddress(address)]));
const external = Object.fromEntries(Object.entries(manifest.externalContracts).map(([name, address]) => [name, getAddress(address)]));
const built = {
  governor: await artifact("RobynGovernor"), timelock: await artifact("TimelockController", "TimelockController.sol"), dao: await artifact("RobynDaoToken"),
  assetRouter: await artifact("RobynV4AssetRouter"), feeRouter: await artifact("RobynNativeProtocolFeeRouterV4"), coordinator: await artifact("RobynV4LaunchCoordinatorV6"),
  launchFactory: await artifact("RobynNativeLaunchFactoryV4"), marketFactory: await artifact("RobynV4MarketFactory"), hook: await artifact("RobynV4FeeAndPhaseHook"),
};
const read = (address, abi, functionName, args = []) => client.readContract({ address, abi, functionName, args });
const write = (phase, label, address, abi, functionName, args = [], value = 0n) => submit({ phase, label, to: address, data: encodeFunctionData({ abi, functionName, args }), value });
const latestTime = async () => (await client.getBlock({ blockTag: "latest" })).timestamp;
const deadline = async () => (await latestTime()) + 120n;
const codeHash = async (address) => { const code = await client.getCode({ address }); if (!code || code === "0x") throw new Error(`missing runtime at ${address}`); return keccak256(code).toLowerCase(); };
for (const identity of manifest.runtimeIdentities) if ((await codeHash(getAddress(identity.address))) !== identity.runtimeCodeHash.toLowerCase()) throw new Error(`${identity.name} runtime changed`);
const verifyPaused = async () => Number(await read(contracts.coordinator, built.coordinator.abi, "launchMode")) === 0 && await read(contracts.assetRouter, built.assetRouter.abi, "conversionsPaused") && await read(contracts.feeRouter, built.feeRouter.abi, "paused");
const safeAbi = parseAbi(["function execTransaction(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,bytes signatures) returns (bool success)"]);
const safeSignature = () => concatHex([pad(account.address, { size: 32 }), zeroHash, "0x01"]);
const safeExec = (label, target, data) => write("shutdown", label, contracts.safe, safeAbi, "execTransaction", [target, 0n, data, 0, 0n, 0n, 0n, zeroAddress, zeroAddress, safeSignature()]);
const proposal = manifest.activationProposal;
const proposalArgs = [proposal.targets.map((address) => getAddress(address)), proposal.values.map((value) => BigInt(value)), proposal.calldatas, proposal.descriptionHash];
const mark = async (name, extra = {}) => { if (!state.completedStages.includes(name)) state.completedStages.push(name); Object.assign(state, extra); await saveState(); };

const shutdown = async () => {
  const reason = manifest.constraints.shutdown.reasonHash;
  await safeExec("guardian-pause-launches", contracts.coordinator, encodeFunctionData({ abi: built.coordinator.abi, functionName: "pauseLaunches" }));
  await safeExec("guardian-pause-asset-conversions", contracts.assetRouter, encodeFunctionData({ abi: built.assetRouter.abi, functionName: "pauseConversions" }));
  await safeExec("guardian-pause-fee-conversions", contracts.feeRouter, encodeFunctionData({ abi: built.feeRouter.abi, functionName: "setPaused", args: [true] }));
  for (const route of manifest.constraints.shutdown.routes) await safeExec(`guardian-disable-${route}`, contracts.assetRouter, encodeFunctionData({ abi: built.assetRouter.abi, functionName: "disableRoute", args: [getAddress(route), reason] }));
  if (!(await verifyPaused())) throw new Error("guardian shutdown did not restore Paused state");
  await mark("shutdown", { shutdownAt: new Date().toISOString() });
};

const run = async () => {
  if (stage === "verify" || stage === "status") {
    const report = { stage, releaseSha: RELEASE_SHA, manifestSha256: manifestHash, toolingSha, chainId: await client.getChainId(), blockNumber: await client.getBlockNumber(), balanceWei: await client.getBalance({ address: manifest.deployer }), paused: await verifyPaused(), state, gateway: { status: health.status, activeProvider: health.activeProvider, fallbackTrafficAuthorized: health.fallbackTrafficAuthorized }, applicationWritesAuthorized: false, publicModeAuthorized: false };
    process.stdout.write(`${json(report)}\n`); return;
  }
  if (state.completedStages.includes(stage)) {
    process.stdout.write(`${json({ stage, status: "already-completed", manifestSha256: manifestHash })}\n`);
    return;
  }
  if (stage === "propose") {
    if (!(await verifyPaused())) throw new Error("proposal requires the initial Paused state");
    const receipt = await write("canary-activation", "activation-propose", contracts.governor, built.governor.abi, "propose", [proposal.targets, proposal.values.map(BigInt), proposal.calldatas, proposal.description]);
    await mark("propose", { proposalId: proposal.proposalId, proposalTransactionHash: receipt.transactionHash }); return;
  }
  const proposalState = Number(await read(contracts.governor, built.governor.abi, "state", [BigInt(proposal.proposalId)]));
  if (stage === "vote") { if (proposalState !== 1) throw new Error(`proposal is not Active: ${proposalState}`); await write("canary-activation", "activation-vote", contracts.governor, built.governor.abi, "castVoteWithReason", [BigInt(proposal.proposalId), 1, "Schema-16 controlled Mainnet canary"]); await mark("vote"); return; }
  if (stage === "queue") { if (proposalState !== 4) throw new Error(`proposal is not Succeeded: ${proposalState}`); await write("canary-activation", "activation-queue", contracts.governor, built.governor.abi, "queue", proposalArgs); await mark("queue"); return; }
  if (stage === "execute") { if (proposalState !== 5) throw new Error(`proposal is not Queued: ${proposalState}`); await write("canary-activation", "activation-execute", contracts.governor, built.governor.abi, "execute", proposalArgs); if (Number(await read(contracts.coordinator, built.coordinator.abi, "launchMode")) !== 1) throw new Error("activation did not enter Canary"); await mark("execute"); return; }
  if (stage === "shutdown") { await shutdown(); return; }
  if (!state.completedStages.includes("execute")) throw new Error(`${stage} requires executed canary governance`);

  if (stage === "routes") {
    const erc20 = parseAbi(["function balanceOf(address) view returns (uint256)", "function approve(address,uint256) returns (bool)", "function allowance(address,address) view returns (uint256)"]);
    for (const route of manifest.qualifiedRoutes.filter((item) => item.symbol !== "WETH")) {
      const token = getAddress(route.address); const input = BigInt(manifest.constraints.stockRouteInputWei);
      const quote = await read(contracts.assetRouter, built.assetRouter.abi, "quoteNativeToAsset", [token, input]);
      const before = await read(token, erc20, "balanceOf", [account.address]);
      await write("routes", `${route.symbol}-buy`, contracts.assetRouter, built.assetRouter.abi, "swapExactNativeForAsset", [token, quote[0] * 99n / 100n, account.address, await deadline()], input);
      const received = await read(token, erc20, "balanceOf", [account.address]) - before; const sell = received / 2n;
      await write("routes", `${route.symbol}-approve`, token, erc20, "approve", [contracts.assetRouter, sell]);
      const reverse = await read(contracts.assetRouter, built.assetRouter.abi, "quoteAssetToNative", [token, sell]);
      await write("routes", `${route.symbol}-sell`, contracts.assetRouter, built.assetRouter.abi, "swapExactAssetForNative", [token, sell, reverse[0] * 99n / 100n, account.address, await deadline()]);
      if ((await read(token, erc20, "allowance", [account.address, contracts.assetRouter])) !== 0n) throw new Error(`${route.symbol} allowance remained`);
    }
    const weth = external.weth; const input = BigInt(manifest.constraints.wethRouteInputWei);
    await write("routes", "WETH-wrap", contracts.assetRouter, built.assetRouter.abi, "swapExactNativeForAsset", [weth, input, account.address, await deadline()], input);
    await write("routes", "WETH-approve", weth, erc20, "approve", [contracts.assetRouter, input]);
    await write("routes", "WETH-unwrap", contracts.assetRouter, built.assetRouter.abi, "swapExactAssetForNative", [weth, input, input, account.address, await deadline()]);
    await mark("routes"); return;
  }

  if (stage === "launch") {
    if (!state.completedStages.includes("routes")) throw new Error("launch requires route round trips");
    const request = manifest.canaryLaunchRequest;
    const predicted = await read(contracts.coordinator, built.coordinator.abi, "predictLaunchAddresses", [account.address, request]);
    await write("canary-launch", "create-canary-launch", contracts.coordinator, built.coordinator.abi, "createLaunch", [request], 1_000_000_000_000_000n);
    const token = getAddress(predicted[0]); const vault = getAddress(predicted[1]); const market = getAddress(await read(contracts.marketFactory, built.marketFactory.abi, "marketByToken", [token])); const marketAbi = (await artifact("RobynV4BondingCurveMarket")).abi;
    let buys = 0; while (!(await read(market, marketAbi, "graduated"))) { if (++buys > 20) throw new Error("graduation exceeded bounded purchases"); await write("bonding-graduation", `bonding-buy-${buys}`, market, marketAbi, "buy", [1n], 1_000_000_000_000_000n); }
    const adapter = getAddress(await read(market, marketAbi, "graduationAdapter")); const adapterAbi = (await artifact("RobynV4GraduationAdapter")).abi; const locker = getAddress(await read(adapter, adapterAbi, "locker")); const lockerAbi = (await artifact("RobynV4FeePositionLocker")).abi; const locked = await read(locker, lockerAbi, "principalLiquidity");
    const tokenAbi = parseAbi(["function balanceOf(address) view returns (uint256)", "function approve(address,uint256) returns (bool)", "function allowance(address,address) view returns (uint256)", "function totalSupply() view returns (uint256)"]);
    await write("post-graduation-trades", "sherwood-buy", market, marketAbi, "buy", [1n], 1_000_000_000_000n);
    let balance = await read(token, tokenAbi, "balanceOf", [account.address]); const amount = balance / 50n;
    await write("post-graduation-trades", "sherwood-approve", token, tokenAbi, "approve", [market, amount]); const quote = await read(market, marketAbi, "quoteSell", [amount]); const receipt = await write("post-graduation-trades", "sherwood-sell", market, marketAbi, "sell", [amount, quote[1] * 99n / 100n]); const before = await client.getBalance({ address: account.address, blockNumber: receipt.blockNumber - 1n }); const after = await client.getBalance({ address: account.address, blockNumber: receipt.blockNumber }); const recovered = after - before + receipt.gasUsed * receipt.effectiveGasPrice;
    await write("post-graduation-trades", "creator-split-lock", contracts.feeRouter, built.feeRouter.abi, "setCreatorFeeSplit", [token, [account.address], [10_000], true]);
    const poolKey = await read(adapter, adapterAbi, "poolKey"); const quoterAbi = parseAbi(["function quoteExactInputSingle(((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 exactAmount,bytes hookData) params) returns (uint256 amountOut,uint256 gasEstimate)"]); const input = 100_000_000_000n; const directQuote = await read(external.quoter, quoterAbi, "quoteExactInputSingle", [{ poolKey, zeroForOne: true, exactAmount: input, hookData: "0x" }]); const directBuy = encodeUniversalV4SingleSwap({ poolKey, zeroForOne: true, amount: input, limit: directQuote[0] * 99n / 100n, refundRecipient: account.address }); const universalAbi = parseAbi(["function execute(bytes commands,bytes[] inputs,uint256 deadline) payable"]); const directBefore = await read(token, tokenAbi, "balanceOf", [account.address]); await write("post-graduation-trades", "direct-buy", external.universalRouter, universalAbi, "execute", [directBuy.commands, directBuy.inputs, await deadline()], input); const directTokens = await read(token, tokenAbi, "balanceOf", [account.address]) - directBefore;
    await write("post-graduation-trades", "permit2-token-approve", token, tokenAbi, "approve", [external.permit2, maxUint256]); const permit2Abi = parseAbi(["function approve(address token,address spender,uint160 amount,uint48 expiration)"]); await write("post-graduation-trades", "permit2-router-approve", external.permit2, permit2Abi, "approve", [token, external.universalRouter, maxUint160, (await latestTime()) + 86_400n]); const sellQuote = await read(external.quoter, quoterAbi, "quoteExactInputSingle", [{ poolKey, zeroForOne: false, exactAmount: directTokens, hookData: "0x" }]); const directSell = encodeUniversalV4SingleSwap({ poolKey, zeroForOne: false, amount: directTokens, limit: sellQuote[0] * 99n / 100n, refundRecipient: account.address }); await write("post-graduation-trades", "direct-sell", external.universalRouter, universalAbi, "execute", [directSell.commands, directSell.inputs, await deadline()]); await write("post-graduation-trades", "permit2-router-clear", external.permit2, permit2Abi, "approve", [token, external.universalRouter, 0n, 0n]); await write("post-graduation-trades", "permit2-token-clear", token, tokenAbi, "approve", [external.permit2, 0n]);
    await mark("launch", { token, vault, market, adapter, locker, lockedPrincipal: locked.toString(), roundTripRecoveredWei: recovered.toString(), graduatedAt: (await latestTime()).toString() }); return;
  }

  if (!state.token) throw new Error(`${stage} requires the canary launch state`);
  const token = getAddress(state.token), vault = getAddress(state.vault), market = getAddress(state.market), adapter = getAddress(state.adapter), locker = getAddress(state.locker);
  const marketAbi = (await artifact("RobynV4BondingCurveMarket")).abi, adapterAbi = (await artifact("RobynV4GraduationAdapter")).abi, lockerAbi = (await artifact("RobynV4FeePositionLocker")).abi, vaultAbi = (await artifact("RobynNativeBasketVaultV2")).abi;
  const tokenAbi = parseAbi(["function balanceOf(address) view returns (uint256)", "function approve(address,uint256) returns (bool)", "function allowance(address,address) view returns (uint256)", "function totalSupply() view returns (uint256)", "function claimAll() returns (uint256)"]);

  const settleFees = async (phase) => {
    const native = await read(contracts.oracleHook, built.hook.abi, "pendingNativeFees", [token]); if (native > 0n) await write(phase, `${phase}-hook-native`, contracts.oracleHook, built.hook.abi, "settleNativeFees", [token, native]);
    const tokenFees = await read(contracts.oracleHook, built.hook.abi, "pendingTokenFees", [token]); if (tokenFees > 0n) { const quote = await read(contracts.assetRouter, built.assetRouter.abi, "quoteAssetToNative", [token, tokenFees]); await write(phase, `${phase}-hook-token`, contracts.oracleHook, built.hook.abi, "convertTokenFees", [token, tokenFees, quote[0] * 99n / 100n, await deadline()]); }
    await write(phase, `${phase}-collect-locker`, locker, lockerAbi, "collectFees", [0n, 0n]);
    const lockerNative = await read(locker, lockerAbi, "pendingCollectedNativeFees"); if (lockerNative > 0n) await write(phase, `${phase}-locker-native`, locker, lockerAbi, "routeCollectedNative", [lockerNative]);
    const lockerToken = await read(locker, lockerAbi, "pendingCollectedTokenFees"); if (lockerToken > 0n) { const quote = await read(contracts.assetRouter, built.assetRouter.abi, "quoteAssetToNative", [token, lockerToken]); await write(phase, `${phase}-locker-token`, locker, lockerAbi, "convertCollectedToken", [lockerToken, quote[0] * 99n / 100n, await deadline()]); }
    const accountState = await read(contracts.feeRouter, built.feeRouter.abi, "launchAccount", [token]); if (accountState.pendingBasketNative > 0n) await write(phase, `${phase}-basket`, contracts.feeRouter, built.feeRouter.abi, "settleBasketFees", [token, accountState.pendingBasketNative]);
    const dao = await read(contracts.feeRouter, built.feeRouter.abi, "totalDaoNativeLiability"); if (dao > 0n) await write(phase, `${phase}-dao`, contracts.feeRouter, built.feeRouter.abi, "settleDaoFees", [dao]); const treasury = await read(contracts.feeRouter, built.feeRouter.abi, "totalTreasuryNativeLiability"); if (treasury > 0n) await write(phase, `${phase}-treasury`, contracts.feeRouter, built.feeRouter.abi, "settleTreasuryFees", [treasury]);
    const leg = await read(vault, vaultAbi, "leg", [0n]); if (leg.pendingNative > 0n) { const quote = await read(contracts.assetRouter, built.assetRouter.abi, "quoteNativeToAsset", [external.weth, leg.pendingNative]); await write(phase, `${phase}-weth-leg`, vault, vaultAbi, "convertLeg", [0n, leg.pendingNative, quote[0] * 99n / 100n, await deadline()]); }
  };
  if (stage === "settle") {
    if (await latestTime() < BigInt(state.graduatedAt) + 301n) throw new Error("fee settlement delay is not complete");
    await write("fee-settlement", "create-convertible-token-fees", market, marketAbi, "buy", [1n], 1_000_000_000_000n);
    await settleFees("fee-settlement");
    await mark("settle", { streamStartedAt: (await latestTime()).toString() });
    return;
  }
  if (stage === "claims") { if (!state.streamStartedAt || await latestTime() < BigInt(state.streamStartedAt) + 3_600n) throw new Error("one-hour reward release is not complete"); await write("reward-claims", "holder", token, tokenAbi, "claimAll"); await write("reward-claims", "creator", contracts.feeRouter, built.feeRouter.abi, "claimCreatorFees", [token]); await write("reward-claims", "dao", contracts.daoToken, built.dao.abi, "claimRewards"); await mark("claims"); return; }
  if (stage === "unwind") { if (!state.completedStages.includes("claims")) throw new Error("unwind requires completed claims"); const balance = await read(token, tokenAbi, "balanceOf", [account.address]); const quote = await read(market, marketAbi, "quoteSell", [balance]); await write("canary-unwind", "approve", token, tokenAbi, "approve", [market, balance]); const receipt = await write("canary-unwind", "sale", market, marketAbi, "sell", [balance, quote[1] * 99n / 100n]); const before = await client.getBalance({ address: account.address, blockNumber: receipt.blockNumber - 1n }); const after = await client.getBalance({ address: account.address, blockNumber: receipt.blockNumber }); const recovered = BigInt(state.roundTripRecoveredWei) + after - before + receipt.gasUsed * receipt.effectiveGasPrice; const recoveryBps = recovered * 10_000n / BigInt(manifest.funding.canaryPrincipalWei); if (recoveryBps < BigInt(manifest.constraints.minimumRecoveryBps)) throw new Error(`recovery ${recoveryBps} bps is below the sealed minimum`); if ((await read(token, tokenAbi, "allowance", [account.address, market])) !== 0n) throw new Error("unwind allowance remained"); await settleFees("post-unwind-settlement"); await mark("unwind", { recoveredWei: recovered.toString(), recoveryBps: recoveryBps.toString() }); await shutdown(); return; }
  if (stage === "reconcile") { if (!(await verifyPaused())) throw new Error("reconciliation requires Paused state"); const positionAbi = parseAbi(["function getPositionLiquidity(uint256 tokenId) view returns (uint128)"]); const tokenId = await read(locker, lockerAbi, "positionTokenId"); const locked = await read(external.positionManager, positionAbi, "getPositionLiquidity", [tokenId]); if (locked !== BigInt(state.lockedPrincipal)) throw new Error("locked principal changed"); if ((await read(token, tokenAbi, "totalSupply")) !== 1_000_000_000n * 10n ** 18n || (await read(contracts.daoToken, built.dao.abi, "totalSupply")) !== 1_000_000_000n * 10n ** 18n) throw new Error("fixed supply changed"); if ((await read(token, tokenAbi, "allowance", [account.address, market])) !== 0n || (await read(token, tokenAbi, "allowance", [account.address, external.permit2])) !== 0n) throw new Error("canary left a residual ERC-20 allowance"); const liabilities = await read(contracts.feeRouter, built.feeRouter.abi, "totalNativeLiabilities"); if (liabilities !== await client.getBalance({ address: contracts.feeRouter })) throw new Error("fee router is not exactly solvent"); const accountState = await read(contracts.feeRouter, built.feeRouter.abi, "launchAccount", [token]); if ((await read(contracts.feeRouter, built.feeRouter.abi, "totalBasketNative")) + accountState.cumulativeCreatorNative + (await read(contracts.feeRouter, built.feeRouter.abi, "totalDaoNativeRewards")) + (await read(contracts.feeRouter, built.feeRouter.abi, "totalTreasuryNative")) !== accountState.cumulativeNativeFees) throw new Error("50/25/20/5 conservation failed"); await mark("reconcile", { reconciledAt: new Date().toISOString(), finalBalanceWei: (await client.getBalance({ address: account.address })).toString() }); return; }
};

try { await run(); }
catch (error) {
  await writeFile(path.join(evidenceRoot, `failure-${new Date().toISOString().replace(/[:.]/g, "")}.json`), `${json({ stage, failedAt: new Date().toISOString(), error: error.stack ?? error.message, manifestSha256: manifestHash })}\n`, { mode: 0o600 }).catch(() => {});
  if (!readOnly.has(stage) && state.completedStages.includes("execute") && !state.completedStages.includes("shutdown") && stage !== "shutdown") { try { await shutdown(); } catch (shutdownError) { await append({ type: "shutdown-failed", recordedAt: new Date().toISOString(), stage, error: String(shutdownError?.stack ?? shutdownError) }).catch(() => {}); } }
  throw error;
}
