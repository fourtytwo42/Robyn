#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, open, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient, createWalletClient, defineChain, encodeDeployData, encodeFunctionData, getAddress, http,
  keccak256, parseAbi, parseEther, stringToHex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { parseCastDecryptedPrivateKey } from "./lib/campaign-keystore.mjs";
import { classifyCanaryJournal } from "./lib/mainnet-canary-journal.mjs";

const stages = new Set(["verify", "routes", "stake-activate", "rdao-sale", "rdao-graduate", "rdao-rewards", "launch", "maintenance-claims", "reconcile", "status"]);
const [stage, manifestArgument, evidenceArgument] = process.argv.slice(2);
if (!stages.has(stage) || !manifestArgument || !evidenceArgument) throw new Error(`usage: run-schema20-network-acceptance.mjs ${[...stages].join("|")} <manifest.json> <evidence-dir>`);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const command = (name, args, options = {}) => execFileSync(name, args, { cwd: repoRoot, env: options.env ?? process.env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const git = (...args) => command("git", ["-C", repoRoot, ...args]);
const toolingSha = git("rev-parse", "HEAD");
if (git("status", "--porcelain") !== "" || git("rev-parse", "@{upstream}") !== toolingSha) throw new Error("Schema-20 acceptance requires exact clean pushed tooling");
const manifestRaw = await readFile(path.resolve(manifestArgument), "utf8");
const manifest = JSON.parse(manifestRaw);
if (manifest.schemaVersion !== 20 || ![46630, 4663].includes(manifest.chainId) || manifest.toolingSha !== toolingSha) throw new Error("Schema-20 acceptance manifest identity mismatch");
const fork = process.env.ROBYN_SCHEMA20_ACCEPTANCE_FORK === "true";
if (!fork && manifest.chainId !== 46630) throw new Error("live acceptance transactions are Testnet-only");
const rpc = process.env.ROBYN_SCHEMA20_RPC_URL ?? "http://127.0.0.1:18548";
if (!/^http:\/\/(127\.0\.0\.1|localhost):[0-9]+$/.test(rpc)) throw new Error("acceptance requires loopback RPC");
const chain = defineChain({ id: manifest.chainId, name: manifest.environment, nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [rpc] } } });
const client = createPublicClient({ chain, transport: http(rpc, { timeout: 30_000, retryCount: 0 }) });
if ((await client.getChainId()) !== manifest.chainId || (await client.request({ method: "eth_syncing", params: [] })) !== false) throw new Error("acceptance RPC wrong-chain or syncing");
if (!fork) {
  const gateway = await fetch(new URL("/health", rpc)).then(async (response) => response.ok ? response.json() : Promise.reject(new Error(`gateway health ${response.status}`)));
  if (gateway.status !== "ok" || gateway.activeProvider !== "primary" || gateway.providerSelection !== "operator" || gateway.fallbackTrafficAuthorized !== false) throw new Error("acceptance gateway is not healthy LAN-only");
}
const evidenceRoot = path.resolve(evidenceArgument);
await mkdir(evidenceRoot, { recursive: true, mode: 0o700 });
const journalPath = path.join(evidenceRoot, "transactions.jsonl");
const statePath = path.join(evidenceRoot, "state.json");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const json = (value) => JSON.stringify(value, (_, item) => typeof item === "bigint" ? item.toString() : item, 2);
const loadState = async () => {
  try { return JSON.parse(await readFile(statePath, "utf8")); }
  catch (error) { if (error?.code === "ENOENT") return { schemaVersion: 20, toolingSha, manifestSha256: sha256(manifestRaw), completedStages: [] }; throw error; }
};
const state = await loadState();
if (state.toolingSha !== toolingSha || state.manifestSha256 !== sha256(manifestRaw)) throw new Error("acceptance state belongs to another release");
const saveState = async () => {
  const temporary = `${statePath}.tmp`;
  await writeFile(temporary, `${json({ ...state, updatedAt: new Date().toISOString() })}\n`, { mode: 0o600 });
  await rename(temporary, statePath);
};
const journal = async () => {
  try { const raw = (await readFile(journalPath, "utf8")).trim(); return raw ? raw.split("\n").map(JSON.parse) : []; }
  catch (error) { if (error?.code === "ENOENT") return []; throw error; }
};
const append = async (record) => { const handle = await open(journalPath, "a", 0o600); try { await handle.write(`${JSON.stringify(record)}\n`); await handle.sync(); } finally { await handle.close(); } };
const receiptDigest = (receipt) => sha256(json({ transactionHash: receipt.transactionHash, blockNumber: receipt.blockNumber, status: receipt.status, gasUsed: receipt.gasUsed, effectiveGasPrice: receipt.effectiveGasPrice, logs: receipt.logs.map((log) => ({ address: log.address, topics: log.topics, data: log.data })) }));
const readOnly = new Set(["verify", "status", "reconcile"]);
let account;
let wallet;
if (!readOnly.has(stage)) {
  if (fork) {
    account = { address: getAddress(manifest.deployer), type: "json-rpc" };
  } else {
    const keystore = path.resolve(process.env.ROBYN_SCHEMA20_KEYSTORE ?? "/home/hendo420/.config/robyn/wallets/robinhood-testnet-deployer/keystore/robyn-testnet-deployer");
    const passwordFile = path.resolve(process.env.ROBYN_SCHEMA20_PASSWORD_FILE ?? "/home/hendo420/.config/robyn/wallets/robinhood-testnet-deployer/password");
    const password = (await readFile(passwordFile, "utf8")).trimEnd();
    const cast = path.join(process.env.HOME ?? "/home/hendo420", ".foundry", "bin", "cast");
    const decrypted = command(cast, ["wallet", "decrypt-keystore", path.basename(keystore), "--keystore-dir", path.dirname(keystore)], { env: { ...process.env, CAST_UNSAFE_PASSWORD: password } });
    account = privateKeyToAccount(parseCastDecryptedPrivateKey(decrypted));
  }
  if (getAddress(account.address) !== getAddress(manifest.deployer)) throw new Error("acceptance signer mismatch");
  wallet = createWalletClient({ account, chain, transport: http(rpc, { timeout: 30_000, retryCount: 0 }) });
}
const missing = (error) => /not found|could not be found/i.test(String(error?.shortMessage ?? error?.message ?? error));
const submit = async (phase, label, to, data, value = 0n) => {
  const logicalKey = `schema20-${manifest.chainId}:${phase}:${label}`;
  const classified = classifyCanaryJournal(await journal(), logicalKey);
  if (classified.receipt) {
    const receipt = await client.getTransactionReceipt({ hash: classified.receipt.transactionHash });
    if (receipt.status !== "success" || receiptDigest(receipt) !== classified.receipt.receiptDigest) throw new Error(`${logicalKey} confirmed receipt changed`);
    return receipt;
  }
  if (classified.activeIntent) {
    try {
      const receipt = await client.getTransactionReceipt({ hash: classified.activeIntent.transactionHash });
      if (receipt.status !== "success") throw new Error(`${logicalKey} reverted`);
      await append({ type: "receipt", recordedAt: new Date().toISOString(), logicalKey, idempotencyKey: classified.activeIntent.idempotencyKey, phase, label, transactionHash: receipt.transactionHash, blockNumber: receipt.blockNumber.toString(), status: receipt.status, gasUsed: receipt.gasUsed.toString(), effectiveGasPriceWei: receipt.effectiveGasPrice.toString(), contractAddress: receipt.contractAddress, receiptDigest: receiptDigest(receipt) });
      return receipt;
    } catch (error) { if (!missing(error)) throw error; }
    throw new Error(`${logicalKey} has an unresolved signed intent; replay prohibited`);
  }
  const [latest, pending, fees] = await Promise.all([
    client.getTransactionCount({ address: account.address, blockTag: "latest" }),
    client.getTransactionCount({ address: account.address, blockTag: "pending" }),
    client.estimateFeesPerGas(),
  ]);
  if (latest !== pending) throw new Error(`${logicalKey} pending nonce`);
  const estimate = await client.estimateGas({ account: account.address, to, data, value });
  const gas = estimate * 2n;
  const maxFeePerGas = ((fees.maxFeePerGas ?? fees.gasPrice) * 12_500n + 9_999n) / 10_000n;
  const maxPriorityFeePerGas = (fees.maxPriorityFeePerGas ?? 0n) <= maxFeePerGas ? (fees.maxPriorityFeePerGas ?? 0n) : maxFeePerGas;
  const reserve = fork ? 0n : 1_500_000_000_000_000n;
  if ((await client.getBalance({ address: account.address })) < value + gas * maxFeePerGas + 25_000_000_000_000n + reserve) throw new Error(`${logicalKey} reserve breach`);
  const request = { account, chain, to, data, value, nonce: latest, gas, maxFeePerGas, maxPriorityFeePerGas, type: "eip1559" };
  const idempotencyKey = keccak256(stringToHex(logicalKey));
  if (fork) {
    await append({ type: "intent", recordedAt: new Date().toISOString(), logicalKey, idempotencyKey, phase, label, chainId: manifest.chainId, nonce: String(latest), to, valueWei: value.toString(), calldataHash: keccak256(data), localForkUnsigned: true });
    const transactionHash = await wallet.sendTransaction(request);
    const receipt = await client.waitForTransactionReceipt({ hash: transactionHash, timeout: 180_000 });
    if (receipt.status !== "success") throw new Error(`${logicalKey} reverted`);
    await append({ type: "receipt", recordedAt: new Date().toISOString(), logicalKey, idempotencyKey, phase, label, transactionHash, blockNumber: receipt.blockNumber.toString(), status: receipt.status, gasUsed: receipt.gasUsed.toString(), effectiveGasPriceWei: receipt.effectiveGasPrice.toString(), contractAddress: receipt.contractAddress, receiptDigest: receiptDigest(receipt) });
    return receipt;
  }
  const serialized = await wallet.signTransaction(request);
  const transactionHash = keccak256(serialized);
  await append({ type: "intent", recordedAt: new Date().toISOString(), logicalKey, idempotencyKey, phase, label, chainId: manifest.chainId, nonce: String(latest), to, valueWei: value.toString(), calldataHash: keccak256(data), transactionHash });
  let published;
  try { published = await client.sendRawTransaction({ serializedTransaction: serialized }); }
  catch (error) {
    const [afterLatest, afterPending] = await Promise.all([client.getTransactionCount({ address: account.address, blockTag: "latest" }), client.getTransactionCount({ address: account.address, blockTag: "pending" })]);
    if (afterLatest !== latest || afterPending !== latest) throw new Error(`${logicalKey} ambiguous submission`);
    await append({ type: "submission-rejected", recordedAt: new Date().toISOString(), logicalKey, idempotencyKey, transactionHash, error: String(error?.shortMessage ?? error?.message ?? error).slice(0, 500) });
    throw new Error(`${logicalKey} rejected before admission`);
  }
  if (published !== transactionHash) throw new Error(`${logicalKey} transaction hash changed`);
  const receipt = await client.waitForTransactionReceipt({ hash: transactionHash, timeout: 180_000 });
  if (receipt.status !== "success") throw new Error(`${logicalKey} reverted`);
  await append({ type: "receipt", recordedAt: new Date().toISOString(), logicalKey, idempotencyKey, phase, label, transactionHash, blockNumber: receipt.blockNumber.toString(), status: receipt.status, gasUsed: receipt.gasUsed.toString(), effectiveGasPriceWei: receipt.effectiveGasPrice.toString(), contractAddress: receipt.contractAddress, receiptDigest: receiptDigest(receipt) });
  return receipt;
};
const artifact = async (name) => JSON.parse(await readFile(path.join(repoRoot, "packages/contracts/out", `${name}.sol`, `${name}.json`), "utf8"));
const built = {
  router: await artifact("RobynV4AssetRouter"), staking: await artifact("RobynRdaoStaking"), sale: await artifact("RobynRdaoBondingSale"),
  rdaoLocker: await artifact("RobynRdaoV4LiquidityLocker"), coordinator: await artifact("RobynV4LaunchCoordinatorV7"),
  marketFactory: await artifact("RobynV4MarketFactory"), tradeRouter: await artifact("RobynTradeRouter"),
  feeRouter: await artifact("RobynNativeProtocolFeeRouterV5"), maintenance: await artifact("RobynMaintenanceCoordinator"),
  claims: await artifact("RobynClaimsRouter"),
};
const contracts = manifest.contracts;
const read = (address, abi, functionName, args = []) => client.readContract({ address, abi, functionName, args });
const write = (phase, label, address, abi, functionName, args = [], value = 0n) => submit(phase, label, getAddress(address), encodeFunctionData({ abi, functionName, args }), value);
const latestTime = async () => (await client.getBlock({ blockTag: "latest" })).timestamp;
const deadline = async () => (await latestTime()) + 600n;
const waitUntil = async (target) => {
  if (fork) { await client.request({ method: "evm_setNextBlockTimestamp", params: [Number(target)] }); await client.request({ method: "evm_mine", params: [] }); return; }
  while ((await latestTime()) < target) await new Promise((resolve) => setTimeout(resolve, 10_000));
};
const mark = async (name, extra = {}) => { if (!state.completedStages.includes(name)) state.completedStages.push(name); Object.assign(state, extra); await saveState(); };
const erc20 = parseAbi(["function totalSupply() view returns (uint256)", "function balanceOf(address) view returns (uint256)", "function approve(address,uint256) returns (bool)", "function allowance(address,address) view returns (uint256)"]);
const wethAbi = parseAbi(["function deposit() payable", "function balanceOf(address) view returns (uint256)", "function approve(address,uint256) returns (bool)"]);

if (stage === "verify" || stage === "status") {
  process.stdout.write(`${json({ stage, chainId: manifest.chainId, toolingSha, blockNumber: await client.getBlockNumber(), balanceWei: await client.getBalance({ address: manifest.deployer }), launchMode: Number(await read(contracts.coordinator, built.coordinator.abi, "launchMode")), conversionsPaused: await read(contracts.assetRouter, built.router.abi, "conversionsPaused"), state })}\n`);
  process.exit(0);
}
if (state.completedStages.includes(stage)) { process.stdout.write(`${JSON.stringify({ stage, status: "already-completed" })}\n`); process.exit(0); }
if (Number(await read(contracts.coordinator, built.coordinator.abi, "launchMode")) !== 2 || await read(contracts.assetRouter, built.router.abi, "conversionsPaused")) throw new Error(`${stage} requires Public mode and active conversions`);

if (stage === "routes") {
  for (const route of manifest.assetRoutes) {
    const input = BigInt(route.maximumNativeInput);
    if (input < 1_000_000_000_000_000n) throw new Error(`${route.symbol} route cap is below 0.001 ETH`);
    const token = getAddress(route.asset ?? route.address);
    if (route.kind === "wrapped-native") {
      await write(stage, "WETH-wrap", contracts.assetRouter, built.router.abi, "swapExactNativeForAsset", [token, input, account.address, await deadline()], input);
      await write(stage, "WETH-approve", token, erc20, "approve", [contracts.assetRouter, input]);
      await write(stage, "WETH-unwrap", contracts.assetRouter, built.router.abi, "swapExactAssetForNative", [token, input, input, account.address, await deadline()]);
      continue;
    }
    const quote = await read(contracts.assetRouter, built.router.abi, "quoteNativeToAsset", [token, input]);
    const before = await read(token, erc20, "balanceOf", [account.address]);
    await write(stage, `${route.symbol}-buy`, contracts.assetRouter, built.router.abi, "swapExactNativeForAsset", [token, (quote[0] * 99n) / 100n, account.address, await deadline()], input);
    const sell = (await read(token, erc20, "balanceOf", [account.address])) - before;
    await write(stage, `${route.symbol}-approve`, token, erc20, "approve", [contracts.assetRouter, sell]);
    const reverse = await read(contracts.assetRouter, built.router.abi, "quoteAssetToNative", [token, sell]);
    if ((reverse[0] * 10_000n) / input < 9_500n) throw new Error(`${route.symbol} live round-trip recovery is below 95%`);
    await write(stage, `${route.symbol}-sell`, contracts.assetRouter, built.router.abi, "swapExactAssetForNative", [token, sell, (reverse[0] * 99n) / 100n, account.address, await deadline()]);
    if (await read(token, erc20, "allowance", [account.address, contracts.assetRouter]) !== 0n) throw new Error(`${route.symbol} allowance remained`);
  }
  await mark(stage); process.exit(0);
}
if (stage === "stake-activate") {
  const lot = await read(contracts.rdaoStaking, built.staking.abi, "warmupLot", [account.address, 0n]);
  await waitUntil(lot[1]);
  await write(stage, "activate-retained", contracts.rdaoStaking, built.staking.abi, "activateFor", [account.address]);
  if (await read(contracts.rdaoStaking, built.staking.abi, "totalEligibleStake") !== parseEther("800000000")) throw new Error("retained stake activation mismatch");
  await mark(stage); process.exit(0);
}
if (stage === "rdao-sale") {
  if (!state.completedStages.includes("stake-activate")) throw new Error("sale requires active retained stake");
  const gross = manifest.chainId === 46630 ? parseEther("0.0005") : parseEther("1");
  const quote = await read(contracts.rdaoSale, built.sale.abi, "quoteBuy", [gross]);
  const before = await read(contracts.daoToken, erc20, "balanceOf", [account.address]);
  await write(stage, "buy", contracts.rdaoSale, built.sale.abi, "buy", [(quote[0] * 99n) / 100n, await deadline(), account.address], gross);
  const bought = (await read(contracts.daoToken, erc20, "balanceOf", [account.address])) - before;
  const sell = bought / 2n;
  await write(stage, "approve-sell", contracts.daoToken, erc20, "approve", [contracts.rdaoSale, sell]);
  const sellQuote = await read(contracts.rdaoSale, built.sale.abi, "quoteSell", [sell]);
  await write(stage, "sell", contracts.rdaoSale, built.sale.abi, "sell", [sell, (sellQuote[2] * 99n) / 100n, await deadline(), account.address]);
  if (await read(contracts.daoToken, erc20, "allowance", [account.address, contracts.rdaoSale]) !== 0n) throw new Error("sale allowance remained");
  await mark(stage); process.exit(0);
}
if (stage === "rdao-graduate") {
  if (!state.completedStages.includes("rdao-sale")) throw new Error("graduation requires sale roundtrip");
  const remaining = parseEther("150000000") - await read(contracts.rdaoSale, built.sale.abi, "sold");
  const quote = await read(contracts.rdaoSale, built.sale.abi, "quoteBuy", [manifest.chainId === 46630 ? parseEther("0.01") : parseEther("600")]);
  if (quote[0] < remaining) throw new Error("bounded overfill does not complete sale");
  await write(stage, "complete-sale", contracts.rdaoSale, built.sale.abi, "buy", [remaining, await deadline(), account.address], manifest.chainId === 46630 ? parseEther("0.01") : parseEther("600"));
  await write(stage, "finalize", contracts.rdaoSale, built.sale.abi, "finalizeGraduation");
  if (!(await read(contracts.rdaoSale, built.sale.abi, "finalized"))) throw new Error("RDAO graduation not finalized");
  await mark(stage); process.exit(0);
}
if (stage === "rdao-rewards") {
  if (!state.completedStages.includes("rdao-graduate")) throw new Error("RDAO rewards require graduation");
  const poolKey = await read(contracts.rdaoLiquidityLocker, built.rdaoLocker.abi, "poolKey");
  const input = manifest.chainId === 46630 ? 100_000_000_000_000n : 1_000_000_000_000_000n;
  await write(stage, "wrap", contracts.wrappedNative, wethAbi, "deposit", [], input);
  const traderArtifact = JSON.parse(await readFile(path.join(repoRoot, "packages/contracts/out/RobynRdaoV4LiquidityLocker.t.sol/Schema20RdaoV4Trader.json"), "utf8"));
  const traderReceipt = await submit(stage, "deploy-pool-bound-trader", undefined, encodeDeployData({ abi: traderArtifact.abi, bytecode: traderArtifact.bytecode.object, args: [contracts.poolManager, poolKey] }));
  const trader = getAddress(traderReceipt.contractAddress);
  await write(stage, "approve-weth-trader", contracts.wrappedNative, erc20, "approve", [trader, input]);
  await write(stage, "v4-trade", trader, traderArtifact.abi, "swap", [contracts.wrappedNative, input, account.address]);
  if (await read(contracts.wrappedNative, erc20, "allowance", [account.address, trader]) !== 0n) throw new Error("qualification trader allowance remained");
  await write(stage, "harvest", contracts.rdaoLiquidityLocker, built.rdaoLocker.abi, "harvest", [0n, await deadline()]);
  const stream = await read(contracts.rdaoStaking, built.staking.abi, "ordinaryStream");
  await waitUntil(stream[1]);
  await write(stage, "claim", contracts.rdaoStaking, built.staking.abi, "claim");
  await mark(stage); process.exit(0);
}
if (stage === "launch") {
  if (!state.completedStages.includes("routes")) throw new Error("launch requires route checks");
  const basket = manifest.assetRoutes.filter((route) => route.kind !== "wrapped-native").slice(0, 2);
  const request = {
    name: "Schema 20 Testnet Lifecycle", symbol: "S20TL",
    assets: [contracts.wrappedNative, getAddress(basket[0].asset), getAddress(basket[1].asset)],
    weights: [4000, 3000, 3000],
    metadataUri: "ipfs://bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku",
    userSalt: keccak256(stringToHex(`schema20-acceptance-${toolingSha}-${manifest.chainId}`)),
    expectedGraduationProfileVersion: 1,
  };
  const predicted = await read(contracts.coordinator, built.coordinator.abi, "predictLaunchAddresses", [account.address, request]);
  await write(stage, "create", contracts.coordinator, built.coordinator.abi, "createLaunch", [request], manifest.chainId === 46630 ? parseEther("0.001") : parseEther("0.5"));
  const token = getAddress(predicted[0]);
  const vault = getAddress(predicted[1]);
  const market = getAddress(await read(contracts.marketFactory, built.marketFactory.abi, "marketByToken", [token]));
  const marketArtifact = await artifact("RobynV4BondingCurveMarket");
  let buys = 0;
  while (!(await read(market, marketArtifact.abi, "graduated"))) {
    if (++buys > 20) throw new Error("bounded graduation exceeded");
    await write(stage, `bonding-buy-${buys}`, contracts.tradeRouter, built.tradeRouter.abi, "buy", [market, 1n], manifest.chainId === 46630 ? parseEther("0.001") : parseEther("0.5"));
  }
  const balance = await read(token, erc20, "balanceOf", [account.address]);
  const sellAmount = balance / 100n;
  await write(stage, "approve-sell", token, erc20, "approve", [contracts.tradeRouter, sellAmount]);
  const quote = await read(market, marketArtifact.abi, "quoteSell", [sellAmount]);
  await write(stage, "sherwood-sell", contracts.tradeRouter, built.tradeRouter.abi, "sell", [market, sellAmount, (quote[1] * 99n) / 100n]);
  await mark(stage, { token, vault, market }); process.exit(0);
}
if (stage === "maintenance-claims") {
  if (!state.completedStages.includes("launch")) throw new Error("maintenance requires launch");
  for (let index = 0; index < 8; index += 1) await write(stage, `process-${index}`, contracts.maintenanceCoordinator, built.maintenance.abi, "processRewards", [state.token]);
  const target = (await latestTime()) + BigInt(manifest.settings.rewardDuration) + 1n;
  await waitUntil(target);
  await write(stage, "holder-claim", contracts.claimsRouter, built.claims.abi, "claimAll", [state.token]);
  await write(stage, "creator-claim", contracts.protocolFeeRouter, built.feeRouter.abi, "claimCreatorFees", [state.token]);
  await mark(stage); process.exit(0);
}
if (stage === "reconcile") {
  const totalSupply = await read(contracts.daoToken, erc20, "totalSupply");
  const principal = await read(contracts.rdaoStaking, built.staking.abi, "totalPrincipal");
  const liability = await read(contracts.rdaoStaking, built.staking.abi, "outstandingLiability");
  const backing = await read(contracts.wrappedNative, wethAbi, "balanceOf", [contracts.rdaoStaking]);
  const locked = await read(contracts.rdaoLiquidityLocker, built.rdaoLocker.abi, "principalLiquidity");
  if (totalSupply !== parseEther("1000000000") || principal !== parseEther("800000000") || backing < liability || locked === 0n) throw new Error("Schema-20 reconciliation failed");
  if (state.token) {
    const tokenArtifact = await artifact("RobynLaunchToken");
    if (await read(state.token, tokenArtifact.abi, "totalSupply") !== parseEther("1000000000")) throw new Error("launch supply drift");
  }
  await mark(stage, { reconciled: { totalSupply: totalSupply.toString(), principal: principal.toString(), liability: liability.toString(), backing: backing.toString(), lockedLiquidity: locked.toString() } });
  process.stdout.write(`${json({ passed: true, state })}\n`); process.exit(0);
}
