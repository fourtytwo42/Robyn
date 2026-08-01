#!/usr/bin/env node

let input = "";
for await (const chunk of process.stdin) input += chunk;

const matches = [...input.matchAll(/0x[0-9a-fA-F]{64}/g)].map(
  (match) => match[0],
);
const unique = [...new Set(matches)];
if (unique.length !== 1) {
  throw new Error("encrypted operator keystore did not yield exactly one key");
}
process.stdout.write(`${unique[0]}\n`);
