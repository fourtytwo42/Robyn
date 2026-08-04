#!/usr/bin/env node
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  createPublicClient, createWalletClient, encodeFunctionData,
  getAddress, http, keccak256, parseAbi, parseEther,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const argv = process.argv.slice(2);
const option = (name, fallback = "") => {
  const index = argv.indexOf(`--${name}`);
  return index === -1 ? fallback : argv[index + 1];
};
const rpcUrl = option("rpc-url");
const output = resolve(option("output"));
if (rpcUrl !== "http://127.0.0.1:28547" || !output) {
  throw new Error("Schema-20 RDAO broadcaster is restricted to loopback Anvil 28547");
}
const chain = {
  id: 31337,
  name: "Schema-20 isolated Devnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
};
const owner = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
const guardian = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
const wallet = createWalletClient({ account: owner, chain, transport: http(rpcUrl) });
if ((await publicClient.getChainId()) !== 31337) throw new Error("wrong chain");

const artifact = (path) => JSON.parse(readFileSync(path, "utf8"));
const poolArtifact = artifact("node_modules/@uniswap/v4-periphery/foundry-out/PoolManager.sol/PoolManager.default.json");
const wethArtifact = artifact("packages/contracts/out/DevnetWrappedNative.sol/DevnetWrappedNative.json");
const harnessArtifact = artifact("packages/contracts/out/Schema20RdaoDevnetHarness.sol/Schema20RdaoDevnetHarness.json");
const tokenArtifact = artifact("packages/contracts/out/RobynDaoTokenV3.sol/RobynDaoTokenV3.json");
const saleArtifact = artifact("packages/contracts/out/RobynRdaoBondingSale.sol/RobynRdaoBondingSale.json");
const stakingArtifact = artifact("packages/contracts/out/RobynRdaoStaking.sol/RobynRdaoStaking.json");
const timelockArtifact = artifact("packages/contracts/out/RobynBootstrapTimelock.sol/RobynBootstrapTimelock.json");

const transactions = [];
const record = async (label, receipt) => {
  if (receipt.status !== "success") throw new Error(`${label} failed`);
  const transaction = await publicClient.getTransaction({ hash: receipt.transactionHash });
  transactions.push({
    label,
    hash: receipt.transactionHash,
    blockNumber: receipt.blockNumber.toString(),
    gasUsed: receipt.gasUsed.toString(),
    effectiveGasPrice: receipt.effectiveGasPrice.toString(),
    nonce: transaction.nonce,
    to: transaction.to,
    value: transaction.value.toString(),
    calldataHash: keccak256(transaction.input),
    status: receipt.status,
  });
};
const deploy = async (label, abi, bytecode, args = []) => {
  const hash = await wallet.deployContract({ abi, bytecode, args });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  await record(label, receipt);
  if (!receipt.contractAddress) throw new Error(`${label} missing address`);
  return receipt.contractAddress;
};
const send = async (label, address, abi, functionName, args = [], value = 0n) => {
  const data = encodeFunctionData({ abi, functionName, args });
  await publicClient.call({ account: owner.address, to: address, data, value });
  const hash = await wallet.sendTransaction({ to: address, data, value });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  await record(label, receipt);
  return receipt;
};

const poolManager = await deploy(
  "deploy-pinned-pool-manager",
  poolArtifact.abi,
  poolArtifact.bytecode.object,
  [owner.address],
);
const wrappedNative = await deploy("deploy-devnet-weth", wethArtifact.abi, wethArtifact.bytecode.object);
const harness = await deploy(
  "deploy-schema20-rdao-closure",
  harnessArtifact.abi,
  harnessArtifact.bytecode.object,
  [owner.address, guardian.address, poolManager, wrappedNative, 86_400n],
);
const component = async (functionName) => getAddress(await publicClient.readContract({
  address: harness, abi: harnessArtifact.abi, functionName,
}));
const rdao = await component("rdao");
const timelock = await component("timelock");
const governor = await component("governor");
const staking = await component("staking");
const liquidityLocker = await component("liquidityLocker");
const sale = await component("sale");
const saleAllocation = parseEther("200000000");
const retained = parseEther("800000000");
await send("approve-sale-allocation", rdao, tokenArtifact.abi, "approve", [sale, saleAllocation]);
await send("fund-sale-allocation-and-finalize-bootstrap", sale, saleArtifact.abi, "fundAllocation");
await send("approve-retained-stake", rdao, tokenArtifact.abi, "approve", [staking, retained]);
await send("stake-retained-allocation", staking, stakingArtifact.abi, "stake", [retained, owner.address]);

const read = (address, abi, functionName, args = []) =>
  publicClient.readContract({ address, abi, functionName, args });
if ((await read(rdao, tokenArtifact.abi, "totalSupply")) !== parseEther("1000000000")) {
  throw new Error("fixed supply mismatch");
}
if ((await read(rdao, tokenArtifact.abi, "balanceOf", [owner.address])) !== 0n) {
  throw new Error("owner allocation mismatch");
}
if ((await read(staking, stakingArtifact.abi, "totalPrincipal")) !== retained) {
  throw new Error("retained stake mismatch");
}
if ((await read(sale, saleArtifact.abi, "allocationFunded")) !== true) {
  throw new Error("sale allocation not funded");
}
if ((await read(timelock, timelockArtifact.abi, "bootstrapFinalized")) !== true) {
  throw new Error("first distribution did not finalize bootstrap");
}
const runtime = async (address) => ({
  address,
  runtimeHash: keccak256(await publicClient.getCode({ address })),
});
const result = {
  schemaVersion: 20,
  chainId: 31337,
  executionMode: "local-anvil-broadcast",
  owner: owner.address,
  guardian: guardian.address,
  contracts: {
    harness: await runtime(harness), rdao: await runtime(rdao),
    timelock: await runtime(timelock), governor: await runtime(governor),
    staking: await runtime(staking), sale: await runtime(sale),
    liquidityLocker: await runtime(liquidityLocker),
    poolManager: await runtime(poolManager), wrappedNative: await runtime(wrappedNative),
  },
  allocation: { retained: retained.toString(), sale: parseEther("150000000").toString(), liquidity: parseEther("50000000").toString() },
  governance: {
    quorumNumerator: String(await read(governor, parseAbi(["function quorumNumerator() view returns (uint256)"]), "quorumNumerator")),
    votingDelay: String(await read(governor, parseAbi(["function votingDelay() view returns (uint256)"]), "votingDelay")),
    votingPeriod: String(await read(governor, parseAbi(["function votingPeriod() view returns (uint256)"]), "votingPeriod")),
    timelockDelay: String(await read(timelock, timelockArtifact.abi, "getMinDelay")),
  },
  transactions,
  passed: true,
};
writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600, flag: "wx" });
chmodSync(output, 0o600);
process.stdout.write(`${JSON.stringify({ output, transactions: transactions.length, passed: true })}\n`);
