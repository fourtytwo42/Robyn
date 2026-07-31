#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import {
  createPublicClient,
  encodeFunctionData,
  getAddress,
  http,
  keccak256,
} from "viem";

const argv = process.argv.slice(2);
const option = (name) => {
  const index = argv.indexOf(`--${name}`);
  if (index < 0 || !argv[index + 1]) throw new Error(`Missing --${name}`);
  return argv[index + 1];
};
const rpcUrl = option("rpc-url");
const manifestPath = resolve(option("manifest"));
const campaignPath = resolve(option("campaign-state"));
const outputPath = resolve(option("output"));
if (!/^http:\/\/127\.0\.0\.1:(28546|28547)$/.test(rpcUrl)) {
  throw new Error("Differential capture is restricted to loopback Anvil ports 28546/28547");
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const campaign = JSON.parse(readFileSync(campaignPath, "utf8"));
if (manifest.chainId !== 46630 || manifest.schemaVersion !== 16) {
  throw new Error("Differential capture requires a compatibility-normalized Schema-16 manifest");
}
if (!Array.isArray(campaign.launches) || campaign.launches.length !== 8) {
  throw new Error("Differential capture requires the complete eight-launch campaign state");
}

const client = createPublicClient({ transport: http(rpcUrl) });
if ((await client.getChainId()) !== 46630) throw new Error("Wrong differential chain");
const artifact = (name) =>
  JSON.parse(
    readFileSync(
      resolve(`packages/contracts/out/${name}.sol/${name}.json`),
      "utf8",
    ),
  );
const abis = Object.fromEntries(
  [
    "RobynV4LaunchCoordinatorV6",
    "RobynV4MarketFactory",
    "RobynV4BondingCurveMarket",
    "RobynNativeProtocolFeeRouterV4",
    "RobynLaunchToken",
    "RobynDaoToken",
    "RobynNativeBasketVaultV2",
    "RobynV4FeePositionLocker",
    "RobynV4AssetRouter",
  ].map((name) => [name, artifact(name).abi]),
);
const read = (address, abi, functionName, args = [], account) =>
  client.readContract({ address, abi, functionName, args, account });
const jsonValue = (value) => {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(jsonValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !/^\d+$/.test(key))
        .map(([key, nested]) => [key, jsonValue(nested)]),
    );
  }
  return value;
};

const addressBook = {};
for (const [name, value] of Object.entries(manifest.contracts ?? {})) {
  if (/^0x[0-9a-fA-F]{40}$/.test(value) && !/^0x0{40}$/i.test(value)) {
    addressBook[`protocol.${name}`] = getAddress(value);
  }
}
for (const route of manifest.assetRoutes ?? []) {
  addressBook[`route.${route.symbol}`] = getAddress(route.address);
}
for (const actor of campaign.actors ?? []) {
  addressBook[`actor.${actor.index}`] = getAddress(actor.address);
}
for (const launch of campaign.launches) {
  for (const field of ["token", "vault", "market", "adapter", "locker"]) {
    addressBook[`launch.${launch.index}.${field}`] = getAddress(launch[field]);
  }
}

const stateFunctions = async (address, abi, definitions) =>
  Object.fromEntries(
    await Promise.all(
      definitions.map(async ([name, args = []]) => [
        name,
        jsonValue(await read(address, abi, name, args)),
      ]),
    ),
  );

const dao = manifest.contracts.daoToken;
const feeRouter = manifest.contracts.protocolFeeRouter;
const marketFactory = manifest.contracts.marketFactory;
const coordinator = manifest.contracts.atomicLaunchCoordinator;
const actorAddresses = campaign.actors.map(({ address }) => getAddress(address));
const daoState = await stateFunctions(dao, abis.RobynDaoToken, [
  ["totalSupply"],
  ["eligibleRewardSupply"],
  ["totalRewardsDeposited"],
  ["totalRewardsVested"],
  ["totalRewardsClaimed"],
  ["queuedRewards"],
  ["streamingRewards"],
  ["rewardRate"],
  ["streamTotal"],
  ["streamReleased"],
]);
daoState.actorBalances = await Promise.all(
  actorAddresses.map(async (actor) => ({
    balance: String(await read(dao, abis.RobynDaoToken, "balanceOf", [actor])),
    claimable: String(
      await read(dao, abis.RobynDaoToken, "claimableRewardOf", [actor]),
    ),
    withdrawn: String(
      await read(dao, abis.RobynDaoToken, "withdrawnRewards", [actor]),
    ),
  })),
);

const feeRouterState = await stateFunctions(
  feeRouter,
  abis.RobynNativeProtocolFeeRouterV4,
  [
    ["paused"],
    ["totalBasketNative"],
    ["totalBasketNativeLiability"],
    ["totalCreatorNativeLiability"],
    ["totalDaoNativeLiability"],
    ["totalDaoNativeRewards"],
    ["totalTreasuryNative"],
    ["totalTreasuryNativeLiability"],
    ["totalNativeLiabilities"],
    ["unattributedNative"],
  ],
);

const launches = [];
for (const launch of campaign.launches) {
  const token = getAddress(launch.token);
  const market = getAddress(launch.market);
  const vault = getAddress(launch.vault);
  const locker = getAddress(launch.locker);
  const creator = getAddress(launch.creator);
  const rewardCount = Number(
    await read(token, abis.RobynLaunchToken, "rewardAssetCount"),
  );
  const tokenState = await stateFunctions(token, abis.RobynLaunchToken, [
    ["totalSupply"],
    ["eligibleSupply"],
    ["rewardAssetCount"],
  ]);
  tokenState.rewards = [];
  for (let index = 0; index < rewardCount; index += 1) {
    tokenState.rewards.push(
      await stateFunctions(token, abis.RobynLaunchToken, [
        ["rewardAsset", [BigInt(index)]],
        ["totalRewardsReceived", [BigInt(index)]],
        ["totalRewardsDistributed", [BigInt(index)]],
        ["totalRewardsVested", [BigInt(index)]],
        ["totalRewardsClaimed", [BigInt(index)]],
        ["pendingWithoutSupply", [BigInt(index)]],
        ["streamingRewards", [BigInt(index)]],
      ]),
    );
  }
  tokenState.actorBalances = await Promise.all(
    actorAddresses.map(async (actor) => ({
      balance: String(
        await read(token, abis.RobynLaunchToken, "balanceOf", [actor]),
      ),
      rewards: await Promise.all(
        Array.from({ length: rewardCount }, async (_, index) => ({
          withdrawable: String(
            await read(token, abis.RobynLaunchToken, "withdrawableRewardOf", [
              actor,
              BigInt(index),
            ]),
          ),
          withdrawn: String(
            await read(token, abis.RobynLaunchToken, "withdrawnRewardOf", [
              actor,
              BigInt(index),
            ]),
          ),
        })),
      ),
    })),
  );
  const marketState = await stateFunctions(
    market,
    abis.RobynV4BondingCurveMarket,
    [
      ["graduated"],
      ["seeded"],
      ["nativeRaised"],
      ["curveNativePrincipal"],
      ["realCurveTokenReserve"],
      ["virtualTokenReserve"],
      ["virtualNativeReserve"],
      ["graduationProgressBps"],
      ["graduationThresholdNative"],
      ["maximumCurvePurchase"],
      ["poolId"],
      ["unattributedNative"],
    ],
  );
  const vaultState = await stateFunctions(
    vault,
    abis.RobynNativeBasketVaultV2,
    [
      ["legCount"],
      ["totalFeesReceived"],
      ["totalNativeConsumed"],
      ["totalPendingNative"],
    ],
  );
  vaultState.legs = await Promise.all(
    Array.from({ length: Number(vaultState.legCount) }, (_, index) =>
      read(vault, abis.RobynNativeBasketVaultV2, "leg", [BigInt(index)]).then(
        jsonValue,
      ),
    ),
  );
  const lockerState = await stateFunctions(
    locker,
    abis.RobynV4FeePositionLocker,
    [
      ["initialized"],
      ["positionTokenId"],
      ["principalLiquidity"],
      ["nativeLiquidityUsed"],
      ["tokenLiquidityUsed"],
      ["principalNativeResidual"],
      ["principalTokenResidual"],
      ["pendingCollectedNativeFees"],
      ["pendingCollectedTokenFees"],
      ["cumulativeCollectedNativeFees"],
      ["cumulativeCollectedTokenFees"],
      ["unattributedNative"],
      ["unattributedLaunchTokens"],
    ],
  );
  launches.push({
    index: launch.index,
    launchId: launch.launchId,
    poolId: launch.poolId,
    profileHash: await read(
      marketFactory,
      abis.RobynV4MarketFactory,
      "graduationProfileHashByToken",
      [token],
    ),
    profile: jsonValue(
      await read(
        marketFactory,
        abis.RobynV4MarketFactory,
        "graduationProfileByToken",
        [token],
      ),
    ),
    token: tokenState,
    market: marketState,
    vault: vaultState,
    locker: lockerState,
    creatorSplit: jsonValue(
      await read(
        feeRouter,
        abis.RobynNativeProtocolFeeRouterV4,
        "creatorFeeSplit",
        [token],
      ),
    ),
    creatorStream: jsonValue(
      await read(
        feeRouter,
        abis.RobynNativeProtocolFeeRouterV4,
        "creatorRewardStream",
        [token, creator],
      ),
    ),
    creatorClaimable: String(
      await read(
        feeRouter,
        abis.RobynNativeProtocolFeeRouterV4,
        "claimableCreatorNativeByRecipient",
        [token, creator],
      ),
    ),
    creatorClaimed: String(
      await read(
        feeRouter,
        abis.RobynNativeProtocolFeeRouterV4,
        "claimedCreatorNativeByRecipient",
        [token, creator],
      ),
    ),
  });
}

function nestedHex(value, seen = new WeakSet()) {
  if (typeof value === "string") {
    return value.match(/0x[0-9a-fA-F]{8,}/)?.[0] ?? null;
  }
  if (!value || typeof value !== "object" || seen.has(value)) return null;
  seen.add(value);
  for (const key of ["data", "cause", "details", "shortMessage", "message"]) {
    const found = nestedHex(value[key], seen);
    if (found) return found;
  }
  for (const nested of Object.values(value)) {
    const found = nestedHex(nested, seen);
    if (found) return found;
  }
  return null;
}
async function revertSelector(label, request) {
  try {
    await client.call(request);
    throw new Error(`${label} unexpectedly succeeded`);
  } catch (error) {
    if (String(error.message).includes("unexpectedly succeeded")) throw error;
    const data = nestedHex(error);
    if (!data) throw new Error(`${label} did not expose revert data`);
    return data.slice(0, 10).toLowerCase();
  }
}
const firstBonding = campaign.launches.find((launch) => launch.index >= 3);
const failureSelectors = {
  unauthorizedPublicMode: await revertSelector("unauthorized public mode", {
    account: actorAddresses[50],
    to: coordinator,
    data: encodeFunctionData({
      abi: abis.RobynV4LaunchCoordinatorV6,
      functionName: "setPublicMode",
    }),
  }),
  zeroValueBuy: await revertSelector("zero-value buy", {
    account: actorAddresses[50],
    to: firstBonding.market,
    data: encodeFunctionData({
      abi: abis.RobynV4BondingCurveMarket,
      functionName: "buy",
      args: [1n],
    }),
    value: 0n,
  }),
  foreignCreatorClaim: await revertSelector("foreign creator claim", {
    account: actorAddresses[50],
    to: feeRouter,
    data: encodeFunctionData({
      abi: abis.RobynNativeProtocolFeeRouterV4,
      functionName: "claimCreatorFees",
      args: [campaign.launches[0].token],
    }),
  }),
};

const currentBlock = await client.getBlockNumber();
const logAddresses = Object.values(addressBook);
const logs = [];
for (const address of logAddresses) {
  const observed = await client.getLogs({
    address,
    fromBlock: BigInt(manifest.deploymentBlock),
    toBlock: currentBlock,
  });
  for (const entry of observed) {
    logs.push({
      address,
      blockNumber: entry.blockNumber.toString(),
      logIndex: Number(entry.logIndex),
      topics: entry.topics,
      data: entry.data,
    });
  }
}
logs.sort(
  (left, right) =>
    Number(BigInt(left.blockNumber) - BigInt(right.blockNumber)) ||
    left.logIndex - right.logIndex,
);

const snapshot = {
  schemaVersion: 1,
  chainId: 46630,
  addressBook,
  manifestIdentity: {
    currentProfileHash: manifest.graduationProfiles.current.hash,
    assetRoutes: manifest.assetRoutes,
    allocationBps: manifest.liabilityModel.allocationBps,
  },
  coordinator: await stateFunctions(
    coordinator,
    abis.RobynV4LaunchCoordinatorV6,
    [["launchMode"], ["canaryLauncher"]],
  ),
  marketFactory: await stateFunctions(
    marketFactory,
    abis.RobynV4MarketFactory,
    [
      ["graduationProfileVersion"],
      ["currentGraduationProfileHash"],
      ["currentGraduationProfile"],
      ["requiredTokenSupply"],
    ],
  ),
  dao: daoState,
  feeRouter: feeRouterState,
  launches,
  failureSelectors,
  logs,
};
snapshot.fingerprint = createHash("sha256")
  .update(JSON.stringify(snapshot))
  .digest("hex");
writeFileSync(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, {
  mode: 0o600,
});
