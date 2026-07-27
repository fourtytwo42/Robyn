#!/usr/bin/env node
import process from "node:process";
import { concatHex, getAddress, keccak256, numberToHex, sliceHex } from "viem";

const [deployerInput, initCode, flagsInput = "0x18e4"] = process.argv.slice(2);
if (!deployerInput || !initCode?.startsWith("0x")) {
  throw new Error("usage: mine-v4-hook-salt.mjs <create2-deployer> <init-code> [flags]");
}

const deployer = getAddress(deployerInput);
const initCodeHash = keccak256(initCode);
const requiredFlags = BigInt(flagsInput) & 0x3fffn;
const maxIterations = 160_444;

for (let candidate = 0; candidate < maxIterations; candidate += 1) {
  const salt = numberToHex(candidate, { size: 32 });
  const digest = keccak256(concatHex(["0xff", deployer, salt, initCodeHash]));
  const address = getAddress(sliceHex(digest, 12));
  if ((BigInt(address) & 0x3fffn) === requiredFlags) {
    process.stdout.write(
      `${JSON.stringify({
        deployer,
        salt,
        address,
        flags: numberToHex(requiredFlags),
        initCodeHash,
        iterations: candidate + 1,
      })}\n`,
    );
    process.exit(0);
  }
}

throw new Error(`no hook salt found within ${maxIterations} iterations`);
