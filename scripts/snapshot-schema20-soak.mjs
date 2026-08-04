#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createPublicClient, http, parseEther } from "viem";

const argv = process.argv.slice(2);
const option = (name) => {
  const index = argv.indexOf(`--${name}`);
  if (index === -1 || !argv[index + 1]) throw new Error(`Missing --${name}`);
  return argv[index + 1];
};
const rpcUrl = option("rpc-url");
const lifecycle = JSON.parse(readFileSync(resolve(option("lifecycle")), "utf8"));
if (rpcUrl !== "http://127.0.0.1:28547" || lifecycle.schemaVersion !== 20 || !lifecycle.passed) {
  throw new Error("Invalid Schema-20 soak snapshot input");
}
const client = createPublicClient({ transport: http(rpcUrl) });
if ((await client.getChainId()) !== 31337) throw new Error("wrong chain");
const artifact = (path) => JSON.parse(readFileSync(path, "utf8")).abi;
const tokenAbi = artifact("packages/contracts/out/RobynDaoTokenV3.sol/RobynDaoTokenV3.json");
const stakingAbi = artifact("packages/contracts/out/RobynRdaoStaking.sol/RobynRdaoStaking.json");
const lockerAbi = artifact("packages/contracts/out/RobynRdaoV4LiquidityLocker.sol/RobynRdaoV4LiquidityLocker.json");
const wethAbi = artifact("packages/contracts/out/DevnetWrappedNative.sol/DevnetWrappedNative.json");
const { rdao, staking, locker, wrappedNative } = lifecycle.contracts;
const read = (address, abi, functionName, args = []) => client.readContract({ address, abi, functionName, args });
const [block, totalSupply, principal, eligible, warming, deposited, claimed, liability, backing, locked] = await Promise.all([
  client.getBlock(),
  read(rdao, tokenAbi, "totalSupply"),
  read(staking, stakingAbi, "totalPrincipal"),
  read(staking, stakingAbi, "totalEligibleStake"),
  read(staking, stakingAbi, "totalWarmingStake"),
  read(staking, stakingAbi, "totalRewardsDeposited"),
  read(staking, stakingAbi, "totalRewardsClaimed"),
  read(staking, stakingAbi, "outstandingLiability"),
  read(wrappedNative, wethAbi, "balanceOf", [staking]),
  read(locker, lockerAbi, "principalLiquidity"),
]);
if (totalSupply !== parseEther("1000000000")) throw new Error("RDAO supply drift");
if (principal !== parseEther("800000000") || eligible + warming !== principal) throw new Error("stake conservation drift");
if (claimed + liability !== deposited || backing < liability) throw new Error("reward backing drift");
if (locked === 0n) throw new Error("locked principal missing");
process.stdout.write(`${JSON.stringify({
  at: new Date().toISOString(),
  blockNumber: block.number.toString(),
  chainTimestamp: block.timestamp.toString(),
  totalSupply: totalSupply.toString(),
  principal: principal.toString(),
  eligible: eligible.toString(),
  warming: warming.toString(),
  deposited: deposited.toString(),
  claimed: claimed.toString(),
  liability: liability.toString(),
  backing: backing.toString(),
  lockedLiquidity: locked.toString(),
  passed: true,
})}\n`);
