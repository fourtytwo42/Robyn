#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import process from "node:process";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  formatEther,
  getAddress,
  http,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  assertCampaignId,
  createCampaignRoot,
  decryptCampaignRoot,
  deriveCampaignAccounts,
  encryptCampaignRoot,
  fundingTreeTransfers,
  publicCampaignAccounts,
} from "./lib/campaign-wallets.mjs";
import {
  assertSchema8Manifest,
  launchBasketPlan,
  projectCampaignCost,
  REQUIRED_HEADROOM_BPS,
  REQUIRED_RESERVE_WEI,
  REQUIRED_SUCCESSFUL_WRITES,
  REQUIRED_WALLET_COUNT,
} from "./lib/campaign-plan.mjs";

const argv = process.argv.slice(2);
const command = argv.shift();
const option = (name, fallback) => {
  const index = argv.indexOf(`--${name}`);
  return index === -1 ? fallback : argv[index + 1];
};
const flag = (name) => argv.includes(`--${name}`);
const campaignId = assertCampaignId(
  option("campaign", process.env.ROBYN_CAMPAIGN_ID),
);
const repoRoot = resolve(new URL("..", import.meta.url).pathname);
const manifestPath = resolve(
  option(
    "manifest",
    process.env.ROBYN_CAMPAIGN_MANIFEST ??
      join(repoRoot, "deployments", "46630-v4.json"),
  ),
);
const stateDir = resolve(
  option(
    "state-dir",
    process.env.ROBYN_CAMPAIGN_STATE_DIR ??
      join(
        process.env.HOME,
        ".local",
        "state",
        "robyn-testnet-campaigns",
        campaignId,
      ),
  ),
);
const rootPath = join(stateDir, "encrypted-root.json");
const statePath = join(stateDir, "state.json");
const evidencePath = join(stateDir, "evidence.json");
const passphrasePath = resolve(
  option(
    "passphrase-file",
    process.env.ROBYN_CAMPAIGN_PASSPHRASE_FILE ?? "/nonexistent",
  ),
);
const rpcUrl =
  option("rpc-url", process.env.ROBYN_TESTNET_RPC_URL) ??
  "https://rpc.testnet.chain.robinhood.com";
const chain = defineChain({
  id: 46630,
  name: "Robinhood Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
});
const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });

function json(value) {
  return JSON.stringify(
    value,
    (_, item) => (typeof item === "bigint" ? item.toString() : item),
    2,
  );
}

function atomicWrite(path, value, mode = 0o600) {
  const temporary = `${path}.tmp-${process.pid}`;
  writeFileSync(temporary, `${json(value)}\n`, { mode });
  renameSync(temporary, path);
  chmodSync(path, mode);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function requireProtectedFile(path, label) {
  const details = statSync(path);
  if (!details.isFile() || (details.mode & 0o077) !== 0) {
    throw new Error(`${label} must be a regular file with mode 0600 or stricter`);
  }
  return readFileSync(path, "utf8").trim();
}

function loadManifest() {
  return assertSchema8Manifest(readJson(manifestPath));
}

function loadState() {
  const state = readJson(statePath);
  if (
    state.campaignId !== campaignId ||
    state.walletCount !== REQUIRED_WALLET_COUNT
  ) {
    throw new Error("Campaign state identity does not match this invocation");
  }
  return state;
}

function saveState(state) {
  state.updatedAt = new Date().toISOString();
  atomicWrite(statePath, state);
  atomicWrite(evidencePath, {
    schemaVersion: 1,
    campaignId: state.campaignId,
    releaseSha: state.releaseSha,
    chainId: state.chainId,
    walletCount: state.walletCount,
    actors: state.actors,
    phases: state.phases,
    transactions: state.transactions,
    preflight: state.preflight ?? null,
    updatedAt: state.updatedAt,
  });
}

function loadAccounts() {
  const passphrase = requireProtectedFile(
    passphrasePath,
    "Campaign passphrase",
  );
  const root = decryptCampaignRoot(readJson(rootPath), passphrase);
  return deriveCampaignAccounts(root, campaignId, REQUIRED_WALLET_COUNT);
}

function projectPrivateKey(manifest) {
  if (flag("rehearsal")) {
    if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?/.test(rpcUrl)) {
      throw new Error("Rehearsal private-key input is restricted to loopback RPC");
    }
    return requireProtectedFile(
      resolve(process.env.ROBYN_CAMPAIGN_REHEARSAL_KEY_FILE ?? "/nonexistent"),
      "Rehearsal key",
    );
  }
  const keystore = resolve(
    process.env.ROBYN_TESTNET_KEYSTORE ?? "/nonexistent",
  );
  const password = requireProtectedFile(
    resolve(process.env.ROBYN_TESTNET_PASSWORD_FILE ?? "/nonexistent"),
    "Project keystore password",
  );
  statSync(keystore);
  const privateKey = execFileSync(
    join(process.env.HOME, ".foundry", "bin", "cast"),
    [
      "wallet",
      "decrypt-keystore",
      basename(keystore),
      "--keystore-dir",
      dirname(keystore),
      "--unsafe-password",
      password,
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ).trim();
  const account = privateKeyToAccount(privateKey);
  if (account.address.toLowerCase() !== manifest.deployer.toLowerCase()) {
    throw new Error("Project keystore does not match manifest deployer");
  }
  return privateKey;
}

async function recordTransaction(state, label, client, request) {
  const previous = state.transactions.find((entry) => entry.label === label);
  if (previous) return previous;
  const hash = await client.sendTransaction(request);
  const receipt = await publicClient.waitForTransactionReceipt({
    hash,
    confirmations: 1,
    timeout: 180_000,
  });
  if (receipt.status !== "success") {
    throw new Error(`Transaction failed: ${label} ${hash}`);
  }
  const entry = {
    label,
    hash,
    blockNumber: receipt.blockNumber.toString(),
    gasUsed: receipt.gasUsed.toString(),
    effectiveGasPrice: receipt.effectiveGasPrice.toString(),
    from: receipt.from,
    to: receipt.to,
    transactionIndex: receipt.transactionIndex,
  };
  state.transactions.push(entry);
  saveState(state);
  return entry;
}

async function init() {
  const manifest = loadManifest();
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  chmodSync(stateDir, 0o700);
  try {
    statSync(statePath);
    throw new Error("Campaign state already exists; refusing to replace it");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const passphrase = requireProtectedFile(
    passphrasePath,
    "Campaign passphrase",
  );
  const root = createCampaignRoot();
  atomicWrite(rootPath, encryptCampaignRoot(root, passphrase));
  const state = {
    schemaVersion: 1,
    campaignId,
    releaseSha: manifest.gitCommit,
    chainId: 46630,
    walletCount: REQUIRED_WALLET_COUNT,
    actors: publicCampaignAccounts(
      root,
      campaignId,
      REQUIRED_WALLET_COUNT,
    ),
    phases: { initialized: new Date().toISOString() },
    transactions: [],
    createdAt: new Date().toISOString(),
  };
  saveState(state);
  console.log(
    json({
      campaignId,
      stateDir,
      walletCount: state.walletCount,
      rootEncrypted: true,
    }),
  );
}

async function verifyRelease(manifest) {
  const chainId = await publicClient.getChainId();
  if (chainId !== 46630) throw new Error(`Wrong chain ID: ${chainId}`);
  const head = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: repoRoot,
    encoding: "utf8",
  }).trim();
  const dirty = execFileSync("git", ["status", "--porcelain"], {
    cwd: repoRoot,
    encoding: "utf8",
  }).trim();
  if (dirty) throw new Error("Campaign requires a clean worktree");
  if (head !== manifest.gitCommit) {
    throw new Error("Manifest release SHA does not match the checked-out commit");
  }
  if (!flag("rehearsal")) {
    execFileSync("git", ["fetch", "origin", "main"], {
      cwd: repoRoot,
      stdio: "ignore",
    });
    const main = execFileSync("git", ["rev-parse", "origin/main"], {
      cwd: repoRoot,
      encoding: "utf8",
    }).trim();
    if (head !== main) throw new Error("Live campaign requires exact origin/main");
  }
  for (const [name, address] of Object.entries(manifest.contracts)) {
    if (
      /^0x[0-9a-fA-F]{40}$/.test(address) &&
      !/^0x0{40}$/i.test(address) &&
      address.toLowerCase() !== manifest.contracts.guardian.toLowerCase()
    ) {
      const code = await publicClient.getCode({ address });
      if (!code || code === "0x") throw new Error(`${name} has no runtime code`);
    }
  }
  return head;
}

async function preflight() {
  const manifest = loadManifest();
  const state = loadState();
  const releaseSha = await verifyRelease(manifest);
  const gasPriceWei = await publicClient.getGasPrice();
  const l1Override = option("l1-base-fee-wei");
  if (
    l1Override !== undefined &&
    (!flag("rehearsal") ||
      !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?/.test(rpcUrl))
  ) {
    throw new Error("L1 base-fee override is restricted to loopback rehearsals");
  }
  const l1BaseFeeWei =
    l1Override !== undefined
      ? BigInt(l1Override)
      : await publicClient.readContract({
          address: "0x000000000000000000000000000000000000006C",
          abi: [
            {
              type: "function",
              name: "getL1BaseFeeEstimate",
              stateMutability: "view",
              inputs: [],
              outputs: [{ type: "uint256" }],
            },
          ],
          functionName: "getL1BaseFeeEstimate",
        });
  const graduationValue =
    BigInt(manifest.market.graduationThresholdNative) * 3n +
    100_000_000_000n;
  const cost = projectCampaignCost({
    gasPriceWei,
    l1BaseFeeWei,
    averageGasPerWrite: 250_000n,
    averageCalldataBytes: 512n,
    transactionValueWei: graduationValue,
  });
  const projectAddress = getAddress(manifest.deployer);
  const projectBalanceWei = await publicClient.getBalance({
    address: projectAddress,
  });
  const actorBalanceWei = (
    await Promise.all(
      state.actors.map(({ address }) =>
        publicClient.getBalance({ address }),
      ),
    )
  ).reduce((total, value) => total + value, 0n);
  const combinedBalanceWei = projectBalanceWei + actorBalanceWei;
  if (combinedBalanceWei < cost.totalRequiredWei) {
    throw new Error(
      `Insufficient combined balance: ${formatEther(combinedBalanceWei)} ETH; ` +
        `${formatEther(cost.totalRequiredWei)} ETH required`,
    );
  }
  state.preflight = {
    checkedAt: new Date().toISOString(),
    releaseSha,
    chainId: 46630,
    headroomBps: REQUIRED_HEADROOM_BPS.toString(),
    requiredSuccessfulWrites: REQUIRED_SUCCESSFUL_WRITES,
    projectAddress,
    projectBalanceWei: projectBalanceWei.toString(),
    actorBalanceWei: actorBalanceWei.toString(),
    combinedBalanceWei: combinedBalanceWei.toString(),
    cost,
    passed: true,
  };
  state.phases.preflight = state.preflight.checkedAt;
  saveState(state);
  console.log(json(state.preflight));
}

async function fund() {
  const manifest = loadManifest();
  const state = loadState();
  if (!state.preflight?.passed) throw new Error("Run a passing preflight first");
  const accounts = loadAccounts();
  const project = privateKeyToAccount(projectPrivateKey(manifest));
  const projectClient = createWalletClient({
    account: project,
    chain,
    transport: http(rpcUrl),
  });
  const gasPriceWei = await publicClient.getGasPrice();
  const l1BaseFeeWei = BigInt(state.preflight.cost.l1DataWei) /
    (BigInt(REQUIRED_SUCCESSFUL_WRITES) * 512n * 16n);
  const transferCostWei =
    21_000n * gasPriceWei + 128n * 16n * l1BaseFeeWei;
  const campaignBudget = BigInt(state.preflight.cost.withHeadroomWei);
  const perWalletWei =
    (campaignBudget + BigInt(REQUIRED_WALLET_COUNT) - 1n) /
    BigInt(REQUIRED_WALLET_COUNT);
  const plan = fundingTreeTransfers(
    REQUIRED_WALLET_COUNT,
    perWalletWei,
    transferCostWei,
  );
  const projectBalance = await publicClient.getBalance({
    address: project.address,
  });
  if (projectBalance < plan.rootFundingWei + transferCostWei + REQUIRED_RESERVE_WEI) {
    throw new Error("Project wallet cannot fund the tree while preserving the reserve");
  }
  await recordTransaction(state, "fund-root", projectClient, {
    account: project,
    to: accounts[0].address,
    value: plan.rootFundingWei,
  });
  for (const transfer of plan.transfers) {
    const sender = privateKeyToAccount(accounts[transfer.parent].privateKey);
    const client = createWalletClient({
      account: sender,
      chain,
      transport: http(rpcUrl),
    });
    await recordTransaction(
      state,
      `fund-tree-${transfer.parent}-${transfer.child}`,
      client,
      {
        account: sender,
        to: accounts[transfer.child].address,
        value: transfer.amountWei,
      },
    );
  }
  state.phases.funded = new Date().toISOString();
  state.funding = {
    perWalletWei: perWalletWei.toString(),
    transferCostWei: transferCostWei.toString(),
    rootFundingWei: plan.rootFundingWei.toString(),
  };
  saveState(state);
  console.log(json(state.funding));
}

async function status() {
  const manifest = loadManifest();
  const state = loadState();
  const balances = await Promise.all(
    state.actors.map(async ({ index, address }) => ({
      index,
      address,
      balanceWei: (
        await publicClient.getBalance({ address })
      ).toString(),
    })),
  );
  const actorBalanceWei = balances.reduce(
    (total, actor) => total + BigInt(actor.balanceWei),
    0n,
  );
  const projectBalanceWei = await publicClient.getBalance({
    address: getAddress(manifest.deployer),
  });
  console.log(
    json({
      campaignId,
      releaseSha: state.releaseSha,
      phases: state.phases,
      successfulTransactions: state.transactions.length,
      requiredSuccessfulWrites: REQUIRED_SUCCESSFUL_WRITES,
      projectBalanceWei,
      actorBalanceWei,
      combinedBalanceWei: projectBalanceWei + actorBalanceWei,
      reserveSatisfied:
        projectBalanceWei + actorBalanceWei >= REQUIRED_RESERVE_WEI,
    }),
  );
}

if (!["init", "preflight", "fund", "status"].includes(command)) {
  throw new Error("Usage: testnet-assurance-campaign.mjs <init|preflight|fund|status> --campaign ID");
}
await { init, preflight, fund, status }[command]();
