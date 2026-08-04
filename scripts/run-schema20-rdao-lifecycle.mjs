#!/usr/bin/env node
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  createPublicClient, createWalletClient, encodeFunctionData, getAddress, http,
  keccak256, parseEther,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const argv = process.argv.slice(2);
const option = (name) => {
  const index = argv.indexOf(`--${name}`);
  if (index === -1 || !argv[index + 1]) throw new Error(`Missing --${name}`);
  return argv[index + 1];
};
const rpcUrl = option("rpc-url");
const deploymentPath = resolve(option("deployment"));
const output = resolve(option("output"));
if (rpcUrl !== "http://127.0.0.1:28547") {
  throw new Error("Schema-20 lifecycle is restricted to loopback Anvil 28547");
}
const deployment = JSON.parse(readFileSync(deploymentPath, "utf8"));
if (deployment.schemaVersion !== 20 || deployment.chainId !== 31337 || !deployment.passed) {
  throw new Error("Qualified Schema-20 Anvil deployment required");
}
const chain = {
  id: 31337,
  name: "Schema-20 isolated Devnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
};
const owner = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
const participant = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
const ownerWallet = createWalletClient({ account: owner, chain, transport: http(rpcUrl) });
const participantWallet = createWalletClient({ account: participant, chain, transport: http(rpcUrl) });
if ((await publicClient.getChainId()) !== 31337) throw new Error("wrong chain");

const artifact = (path) => JSON.parse(readFileSync(path, "utf8"));
const tokenArtifact = artifact("packages/contracts/out/RobynDaoTokenV3.sol/RobynDaoTokenV3.json");
const saleArtifact = artifact("packages/contracts/out/RobynRdaoBondingSale.sol/RobynRdaoBondingSale.json");
const stakingArtifact = artifact("packages/contracts/out/RobynRdaoStaking.sol/RobynRdaoStaking.json");
const lockerArtifact = artifact("packages/contracts/out/RobynRdaoV4LiquidityLocker.sol/RobynRdaoV4LiquidityLocker.json");
const wethArtifact = artifact("packages/contracts/out/DevnetWrappedNative.sol/DevnetWrappedNative.json");
const traderArtifact = artifact("packages/contracts/out/RobynRdaoV4LiquidityLocker.t.sol/Schema20RdaoV4Trader.json");
const addressOf = (label) => getAddress(deployment.contracts[label].address);
const rdao = addressOf("rdao");
const staking = addressOf("staking");
const sale = addressOf("sale");
const locker = addressOf("liquidityLocker");
const poolManager = addressOf("poolManager");
const wrappedNative = addressOf("wrappedNative");
const transactions = [];

async function record(label, receipt, expectedEffect) {
  if (receipt.status !== "success") throw new Error(`${label} failed`);
  const transaction = await publicClient.getTransaction({ hash: receipt.transactionHash });
  transactions.push({
    phase: label,
    idempotencyKey: `schema20-devnet:${label}`,
    expectedEffect,
    hash: receipt.transactionHash,
    blockNumber: receipt.blockNumber.toString(),
    gasUsed: receipt.gasUsed.toString(),
    effectiveGasPrice: receipt.effectiveGasPrice.toString(),
    nonce: transaction.nonce,
    from: transaction.from,
    to: transaction.to,
    value: transaction.value.toString(),
    calldataHash: keccak256(transaction.input),
    status: receipt.status,
  });
}

async function send(label, wallet, address, abi, functionName, args = [], value = 0n, expectedEffect = label) {
  const data = encodeFunctionData({ abi, functionName, args });
  await publicClient.call({ account: wallet.account.address, to: address, data, value });
  const hash = await wallet.sendTransaction({ to: address, data, value });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  await record(label, receipt, expectedEffect);
  return receipt;
}

async function deploy(label, wallet, abi, bytecode, args, expectedEffect) {
  const hash = await wallet.deployContract({ abi, bytecode, args });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  await record(label, receipt, expectedEffect);
  if (!receipt.contractAddress) throw new Error(`${label} missing address`);
  return receipt.contractAddress;
}

const read = (address, abi, functionName, args = []) =>
  publicClient.readContract({ address, abi, functionName, args });
const increaseTime = async (seconds) => {
  await publicClient.request({ method: "evm_increaseTime", params: [seconds] });
  await publicClient.request({ method: "evm_mine", params: [] });
};
const deadline = async () => (await publicClient.getBlock()).timestamp + 3_600n;

await increaseTime(86_400);
await send("activate-retained-stake", ownerWallet, staking, stakingArtifact.abi, "activateFor", [owner.address], 0n, "make retained 800m reward eligible after warm-up");
await send("participant-curve-buy", participantWallet, sale, saleArtifact.abi, "buy", [0n, await deadline(), participant.address], parseEther("10"), "exercise public curve purchase and fee attribution");
let participantRdao = await read(rdao, tokenArtifact.abi, "balanceOf", [participant.address]);
const firstSell = participantRdao / 2n;
await send("approve-curve-sell", participantWallet, rdao, tokenArtifact.abi, "approve", [sale, firstSell], 0n, "bound curve sell allowance");
await send("participant-curve-sell", participantWallet, sale, saleArtifact.abi, "sell", [firstSell, 0n, await deadline(), participant.address], 0n, "exercise bonding sell and staking fee attribution");
const remaining = parseEther("150000000") - await read(sale, saleArtifact.abi, "sold");
await send("complete-sale-overfill", participantWallet, sale, saleArtifact.abi, "buy", [remaining, await deadline(), participant.address], parseEther("1000"), "fill only remaining inventory and refund excess");
await send("finalize-rdao-graduation", ownerWallet, sale, saleArtifact.abi, "finalizeGraduation", [], 0n, "pay fixed owner proceeds and permanently lock price-continuous RDAO/WETH liquidity");

const poolKey = await read(locker, lockerArtifact.abi, "poolKey");
const trader = await deploy("deploy-qualification-trader", ownerWallet, traderArtifact.abi, traderArtifact.bytecode.object, [poolManager, poolKey], "deploy isolated qualification-only v4 trader");
await send("wrap-trade-native", participantWallet, wrappedNative, wethArtifact.abi, "deposit", [], parseEther("2"), "wrap bounded trade capital");
await send("approve-weth-trader", participantWallet, wrappedNative, wethArtifact.abi, "approve", [trader, parseEther("2")], 0n, "bound trader WETH allowance");
await send("trade-weth-for-rdao", participantWallet, trader, traderArtifact.abi, "swap", [wrappedNative, parseEther("1"), participant.address], 0n, "generate locked-position fees in WETH direction");
participantRdao = await read(rdao, tokenArtifact.abi, "balanceOf", [participant.address]);
const reverseAmount = participantRdao / 100n;
await send("approve-rdao-trader", participantWallet, rdao, tokenArtifact.abi, "approve", [trader, reverseAmount], 0n, "bound trader RDAO allowance");
await send("trade-rdao-for-weth", participantWallet, trader, traderArtifact.abi, "swap", [rdao, reverseAmount, participant.address], 0n, "generate locked-position fees in RDAO direction");
await send("harvest-locked-lp-fees", ownerWallet, locker, lockerArtifact.abi, "harvest", [0n, await deadline()], 0n, "convert and stream both LP fee sides to stakers");

await increaseTime(3_600);
await send("claim-staking-rewards", ownerWallet, staking, stakingArtifact.abi, "claim", [], 0n, "claim vested WETH without affecting principal");
await send("redistribute-founder-principal", ownerWallet, staking, stakingArtifact.abi, "unstake", [parseEther("100000000"), participant.address], 0n, "transfer retained allocation to founder through explicit unstake");
await send("approve-founder-stake", participantWallet, rdao, tokenArtifact.abi, "approve", [staking, parseEther("100000000")], 0n, "bound founder staking allowance");
await send("stake-founder-allocation", participantWallet, staking, stakingArtifact.abi, "stake", [parseEther("100000000"), participant.address], 0n, "apply independent founder warm-up");
await increaseTime(86_400);
await send("activate-founder-stake", participantWallet, staking, stakingArtifact.abi, "activateFor", [participant.address], 0n, "activate founder stake after identical warm-up");

const totalSupply = await read(rdao, tokenArtifact.abi, "totalSupply");
const principal = await read(staking, stakingArtifact.abi, "totalPrincipal");
const eligible = await read(staking, stakingArtifact.abi, "totalEligibleStake");
const locked = await read(locker, lockerArtifact.abi, "principalLiquidity");
const deposited = await read(staking, stakingArtifact.abi, "totalRewardsDeposited");
const claimed = await read(staking, stakingArtifact.abi, "totalRewardsClaimed");
const liability = await read(staking, stakingArtifact.abi, "outstandingLiability");
const backing = await read(wrappedNative, wethArtifact.abi, "balanceOf", [staking]);
if (totalSupply !== parseEther("1000000000")) throw new Error("fixed RDAO supply drift");
if (principal !== parseEther("800000000") || eligible !== principal) throw new Error("stake conservation failure");
if (locked === 0n) throw new Error("liquidity principal not locked");
if (backing < liability || claimed + liability !== deposited) throw new Error("WETH reward conservation failure");
if (new Set(transactions.map((entry) => entry.hash)).size !== transactions.length) throw new Error("reused transaction hash");
if (new Set(transactions.map((entry) => entry.idempotencyKey)).size !== transactions.length) throw new Error("duplicate idempotency key");

const result = {
  schemaVersion: 20,
  chainId: 31337,
  executionMode: "local-anvil-broadcast",
  deploymentEvidence: deploymentPath,
  actors: { owner: owner.address, participant: participant.address },
  contracts: { rdao, staking, sale, locker, poolManager, wrappedNative, trader },
  transactions,
  finalState: {
    totalSupply: totalSupply.toString(),
    stakingPrincipal: principal.toString(),
    eligibleStake: eligible.toString(),
    lockedLiquidity: locked.toString(),
    rewardsDeposited: deposited.toString(),
    rewardsClaimed: claimed.toString(),
    rewardLiability: liability.toString(),
    rewardBacking: backing.toString(),
  },
  passed: true,
};
writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600, flag: "wx" });
chmodSync(output, 0o600);
process.stdout.write(`${JSON.stringify({ output, transactions: transactions.length, passed: true })}\n`);
