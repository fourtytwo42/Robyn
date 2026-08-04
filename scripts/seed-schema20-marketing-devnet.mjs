#!/usr/bin/env node
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  encodeFunctionData,
  getAddress,
  http,
  keccak256,
  parseEther,
  stringToHex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const argv = process.argv.slice(2);
const option = (name, fallback = "") => {
  const index = argv.indexOf(`--${name}`);
  return index === -1 ? fallback : argv[index + 1];
};
const rpcUrl = option("rpc-url");
const input = resolve(option("manifest"));
const output = resolve(option("output"));
if (rpcUrl !== "http://127.0.0.1:28549" || !input || !output || input === output) {
  throw new Error("Schema-20 marketing seed is restricted to isolated Anvil 28549 and a new output");
}
const manifest = JSON.parse(readFileSync(input, "utf8"));
if (manifest.schemaVersion !== 20 || manifest.chainId !== 31337) {
  throw new Error("Schema-20 chain-31337 manifest required");
}
const chain = {
  id: 31337,
  name: "Sherwood Schema-20 marketing Devnet",
  nativeCurrency: { name: "Dev Ether", symbol: "DEV", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
};
const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
const artifactRoot = process.env.ROBYN_CONTRACT_ARTIFACT_ROOT ?? "packages/contracts/out";
const artifact = (name) =>
  JSON.parse(readFileSync(`${artifactRoot}/${name}.sol/${name}.json`, "utf8"));
const coordinatorArtifact = artifact("RobynV4LaunchCoordinatorV7");
const marketArtifact = artifact("RobynV4BondingCurveMarket");
const maintenanceArtifact = artifact("RobynMaintenanceCoordinator");
const saleArtifact = artifact("RobynRdaoBondingSale");
const stakingArtifact = artifact("RobynRdaoStaking");
const rdaoArtifact = artifact("RobynDaoTokenV3");
const tokenArtifact = artifact("RobynLaunchToken");

const accounts = Array.from({ length: 12 }, (_, index) =>
  privateKeyToAccount(keccak256(stringToHex(`schema20-marketing-wallet-${index}`))),
);
for (const account of accounts) {
  await publicClient.request({
    method: "anvil_setBalance",
    params: [account.address, `0x${parseEther("1000").toString(16)}`],
  });
}
const wallets = accounts.map((account) =>
  createWalletClient({ account, chain, transport: http(rpcUrl) }),
);
const transactions = [];
const record = async (label, receipt) => {
  if (receipt.status !== "success") throw new Error(`${label} failed`);
  const transaction = await publicClient.getTransaction({ hash: receipt.transactionHash });
  transactions.push({
    label,
    hash: receipt.transactionHash,
    blockNumber: receipt.blockNumber.toString(),
    gasUsed: receipt.gasUsed.toString(),
    nonce: transaction.nonce,
    from: transaction.from,
    to: transaction.to,
    value: transaction.value.toString(),
    calldataHash: keccak256(transaction.input),
  });
};
const send = async (
  wallet,
  label,
  address,
  abi,
  functionName,
  args = [],
  value = 0n,
  gas,
) => {
  const account = wallet.account;
  const data = encodeFunctionData({ abi, functionName, args });
  await publicClient.call({ account: account.address, to: address, data, value });
  const hash = await wallet.sendTransaction({ account, to: address, data, value, gas });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  await record(label, receipt);
  return receipt;
};

const launchSpecs = [
  {
    name: "Canopy Collective",
    symbol: "CANOPY",
    assetIndexes: [0, 1, 2],
    weights: [4_000, 4_000, 2_000],
    buys: ["0.5", "0.5", "0.5", "0.2"],
  },
  {
    name: "Signal Grove",
    symbol: "SIGNAL",
    assetIndexes: [0, 1],
    weights: [6_000, 4_000],
    buys: ["0.4", "0.3"],
  },
  {
    name: "Moonlit Index",
    symbol: "MOON",
    assetIndexes: [1, 2],
    weights: [7_000, 3_000],
    buys: ["0.25"],
  },
  {
    name: "Founders Trail",
    symbol: "TRAIL",
    assetIndexes: [0],
    weights: [10_000],
    buys: ["0.1"],
  },
];
const createdLaunches = [];
for (const [launchIndex, spec] of launchSpecs.entries()) {
  const creatorWallet = wallets[launchIndex + 1];
  const request = {
    name: spec.name,
    symbol: spec.symbol,
    assets: spec.assetIndexes.map((index) => manifest.contracts.rewardAssets[index]),
    weights: spec.weights,
    metadataUri: "ipfs://bafkreibys2cv4ijpoedcl7qdbi5u66wuwedwg3lsc6pios3wcyaoyz7cau",
    userSalt: keccak256(stringToHex(`schema20-marketing-${spec.symbol}`)),
    expectedGraduationProfileVersion: 1n,
  };
  const receipt = await send(
    creatorWallet,
    `create-${spec.symbol}`,
    manifest.contracts.atomicLaunchCoordinator,
    coordinatorArtifact.abi,
    "createLaunch",
    [request],
  );
  const event = receipt.logs
    .map((log) => {
      try {
        return decodeEventLog({ abi: coordinatorArtifact.abi, data: log.data, topics: log.topics });
      } catch {
        return null;
      }
    })
    .find((decoded) => decoded?.eventName === "AtomicV4LaunchCreated");
  if (!event) throw new Error(`${spec.symbol} launch event missing`);
  const token = getAddress(event.args.token);
  const market = getAddress(event.args.receipt.market);
  const vault = getAddress(event.args.receipt.vault);
  const adapter = getAddress(event.args.receipt.adapter);
  const locker = getAddress(event.args.receipt.locker);
  for (const [buyIndex, amount] of spec.buys.entries()) {
    const buyer = wallets[(launchIndex * 3 + buyIndex + 5) % wallets.length];
    await send(
      buyer,
      `buy-${spec.symbol}-${buyIndex + 1}`,
      market,
      marketArtifact.abi,
      "buy",
      [1n],
      parseEther(amount),
    );
  }
  createdLaunches.push({
    name: spec.name,
    symbol: spec.symbol,
    creator: creatorWallet.account.address,
    token,
    vault,
    market,
    graduationAdapter: adapter,
    positionLocker: locker,
    poolId: event.args.receipt.poolId,
    profileVersion: Number(event.args.receipt.graduationProfile.version),
  });
}

for (const launch of createdLaunches) {
  for (let attempt = 0; attempt < 16; attempt += 1) {
    try {
      await send(
        wallets[0],
        `process-${launch.symbol}-${attempt + 1}`,
        manifest.contracts.maintenanceCoordinator,
        maintenanceArtifact.abi,
      "processRewards",
      [launch.token],
      0n,
      2_500_000n,
    );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("NothingPending") && !message.includes("nothing pending")) throw error;
      break;
    }
  }
}

const saleBuyer = wallets[0];
const saleInput = parseEther("1");
const quote = await publicClient.readContract({
  address: manifest.contracts.rdaoSale,
  abi: saleArtifact.abi,
  functionName: "quoteBuy",
  args: [saleInput],
});
const saleMinimum = (quote[0] * 99n) / 100n;
const deadline = (await publicClient.getBlock()).timestamp + 3_600n;
await send(
  saleBuyer,
  "buy-rdao-demo-position",
  manifest.contracts.rdaoSale,
  saleArtifact.abi,
  "buy",
  [saleMinimum, deadline, saleBuyer.account.address],
  saleInput,
);
await send(
  wallets[1],
  "process-rdao-sale-fees",
  manifest.contracts.rdaoSale,
  saleArtifact.abi,
  "processFees",
);
const demoRdao = await publicClient.readContract({
  address: manifest.contracts.daoToken,
  abi: rdaoArtifact.abi,
  functionName: "balanceOf",
  args: [saleBuyer.account.address],
});
await send(
  saleBuyer,
  "approve-demo-rdao-stake",
  manifest.contracts.daoToken,
  rdaoArtifact.abi,
  "approve",
  [manifest.contracts.rdaoStaking, demoRdao],
);
await send(
  saleBuyer,
  "stake-demo-rdao",
  manifest.contracts.rdaoStaking,
  stakingArtifact.abi,
  "stake",
  [demoRdao, saleBuyer.account.address],
);
await publicClient.request({ method: "evm_increaseTime", params: [86_401] });
await publicClient.request({ method: "evm_mine", params: [] });
await send(
  wallets[1],
  "activate-demo-rdao",
  manifest.contracts.rdaoStaking,
  stakingArtifact.abi,
  "activateFor",
  [saleBuyer.account.address],
);
await publicClient.request({ method: "evm_increaseTime", params: [3_601] });
await publicClient.request({ method: "evm_mine", params: [] });

const primaryLaunch = createdLaunches[0];
const rewardAssetCount = await publicClient.readContract({
  address: primaryLaunch.token,
  abi: tokenArtifact.abi,
  functionName: "rewardAssetCount",
});
let preparedHolder;
let preparedClaimable = [];
for (const account of accounts) {
  const amounts = await Promise.all(
    Array.from({ length: Number(rewardAssetCount) }, (_, index) =>
      publicClient.readContract({
        address: primaryLaunch.token,
        abi: tokenArtifact.abi,
        functionName: "withdrawableRewardOf",
        args: [account.address, BigInt(index)],
      }),
    ),
  );
  if (amounts.some((amount) => amount > 0n)) {
    preparedHolder = account;
    preparedClaimable = amounts;
    break;
  }
}
if (!preparedHolder) throw new Error("no matured holder reward was prepared for recording");

const head = await publicClient.getBlockNumber();
const seeded = {
  ...manifest,
  demoLaunches: await Promise.all(
    createdLaunches.map(async (launch) => ({
      ...launch,
      graduated: await publicClient.readContract({
        address: launch.market,
        abi: marketArtifact.abi,
        functionName: "graduated",
      }),
    })),
  ),
  demoSeedBlock: Number(head),
  marketingFixtures: {
    devnetOnly: true,
    walletAddress: saleBuyer.account.address,
    preparedHolder: preparedHolder.address,
    preparedHolderClaimable: preparedClaimable.map(String),
    rdaoPosition: saleBuyer.account.address,
    disclosure: "Deterministic Devnet fixtures with no real-world value.",
  },
  seedTransactions: transactions,
};
writeFileSync(output, `${JSON.stringify(seeded, null, 2)}\n`, { mode: 0o600, flag: "wx" });
chmodSync(output, 0o600);
process.stdout.write(
  `${JSON.stringify({ output, launches: createdLaunches.length, transactions: transactions.length, preparedHolder: preparedHolder.address })}\n`,
);
