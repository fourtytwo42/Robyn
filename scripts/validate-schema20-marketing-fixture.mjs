#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createPublicClient, http, parseEther } from "viem";

const input = process.argv[2];
const output = process.argv[3];
if (!input || !output) throw new Error("usage: validate <seeded-manifest> <evidence-output>");
const manifest = JSON.parse(readFileSync(input, "utf8"));
if (manifest.schemaVersion !== 20 || manifest.chainId !== 31337 || manifest.devnetOnly !== true) {
  throw new Error("expected an isolated Schema-20 Devnet fixture");
}
const artifactRoot = process.env.ROBYN_CONTRACT_ARTIFACT_ROOT ?? "packages/contracts/out";
const artifact = (name) =>
  JSON.parse(readFileSync(`${artifactRoot}/${name}.sol/${name}.json`, "utf8"));
const factoryAbi = artifact("RobynNativeLaunchFactoryV4").abi;
const tokenAbi = artifact("RobynLaunchToken").abi;
const rdaoAbi = artifact("RobynDaoTokenV3").abi;
const stakingAbi = artifact("RobynRdaoStaking").abi;
const routerAbi = artifact("RobynV4AssetRouter").abi;
const erc20Abi = artifact("DevnetWrappedNative").abi;
const client = createPublicClient({ transport: http("http://127.0.0.1:28549") });
const requireEqual = (actual, expected, label) => {
  if (actual !== expected) throw new Error(`${label}: expected ${expected}, received ${actual}`);
};

requireEqual(await client.getChainId(), 31337, "chain id");
requireEqual(Number(await client.readContract({ address: manifest.contracts.factory, abi: factoryAbi, functionName: "launchCount" })), 4, "launch count");
requireEqual(manifest.demoLaunches.filter((launch) => launch.graduated).length, 1, "graduated launch count");
const policy = { ...manifest.indexingPolicy };
delete policy.policyHash;
const computedPolicyHash = createHash("sha256").update(JSON.stringify({ ...policy, protocolRoots: [...policy.protocolRoots].sort(), launchEventTopics: [...policy.launchEventTopics].sort(), poolEventTopics: [...policy.poolEventTopics].sort() })).digest("hex");
requireEqual(computedPolicyHash, manifest.indexingPolicy.policyHash, "indexing policy hash");

const rdaoSupply = await client.readContract({ address: manifest.contracts.daoToken, abi: rdaoAbi, functionName: "totalSupply" });
requireEqual(rdaoSupply, parseEther("1000000000"), "fixed RDAO supply");
const [principal, eligible, warming, deposited, claimed, liability, stakingWeth] = await Promise.all([
  client.readContract({ address: manifest.contracts.rdaoStaking, abi: stakingAbi, functionName: "totalPrincipal" }),
  client.readContract({ address: manifest.contracts.rdaoStaking, abi: stakingAbi, functionName: "totalEligibleStake" }),
  client.readContract({ address: manifest.contracts.rdaoStaking, abi: stakingAbi, functionName: "totalWarmingStake" }),
  client.readContract({ address: manifest.contracts.rdaoStaking, abi: stakingAbi, functionName: "totalRewardsDeposited" }),
  client.readContract({ address: manifest.contracts.rdaoStaking, abi: stakingAbi, functionName: "totalRewardsClaimed" }),
  client.readContract({ address: manifest.contracts.rdaoStaking, abi: stakingAbi, functionName: "outstandingLiability" }),
  client.readContract({ address: manifest.contracts.wrappedNative, abi: erc20Abi, functionName: "balanceOf", args: [manifest.contracts.rdaoStaking] }),
]);
if (principal < parseEther("800000000") || eligible !== principal || warming !== 0n) throw new Error("RDAO staking fixture is not fully activated");
if (stakingWeth < liability || deposited < claimed) throw new Error("RDAO reward backing failed");

const routes = [];
for (const asset of manifest.assetCatalog.assets) {
  const status = await client.readContract({ address: manifest.contracts.assetRouter, abi: routerAbi, functionName: "routeStatus", args: [asset.address] });
  if (!status.ready) throw new Error(`${asset.symbol} reward route is not ready`);
  routes.push({ symbol: asset.symbol, ready: status.ready, reason: status.reason });
}
const holder = manifest.marketingFixtures.preparedHolder;
const claimable = [];
for (let index = 0; index < 3; index += 1) {
  try {
    claimable.push(await client.readContract({ address: manifest.demoLaunches[0].token, abi: tokenAbi, functionName: "withdrawableRewardOf", args: [holder, BigInt(index)] }));
  } catch { break; }
}
if (!claimable.some((amount) => amount > 0n)) throw new Error("prepared holder has no matured reward");

const report = {
  checkedAt: new Date().toISOString(), chainId: 31337, schemaVersion: 20,
  headBlock: Number(await client.getBlockNumber()), launchCount: 4, graduatedLaunchCount: 1,
  policyHash: computedPolicyHash, fixedRdaoSupply: rdaoSupply.toString(),
  staking: { principal: principal.toString(), eligible: eligible.toString(), warming: warming.toString(), rewardsDeposited: deposited.toString(), rewardsClaimed: claimed.toString(), outstandingLiability: liability.toString(), wethBacking: stakingWeth.toString() },
  preparedHolder: holder, claimable: claimable.map(String), routes,
  checks: { chain: "pass", policy: "pass", launchFixture: "pass", holderReward: "pass", rdaoSupply: "pass", stakingBacking: "pass", rewardRoutes: "pass" },
};
writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600, flag: "wx" });
console.log(JSON.stringify(report));
