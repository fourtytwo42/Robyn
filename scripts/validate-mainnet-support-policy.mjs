import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getAddress } from "viem";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const policyPath = resolve(
  process.env.ROBYN_MAINNET_SUPPORT_POLICY ??
    resolve(repoRoot, "config/protocol/robinhood-mainnet-support-policy.json"),
);
const policy = JSON.parse(await readFile(policyPath, "utf8"));
const failures = [];

if (policy.schemaVersion !== 14) failures.push("schemaVersion must be 14");
if (policy.chainId !== 4663) failures.push("chainId must be 4663");
if (policy.status !== "candidate-only") {
  failures.push("support policy must remain candidate-only before deployment");
}
if (policy.activationPolicy?.defaultEnabled !== false) {
  failures.push("default asset activation must fail closed");
}

const executionClasses = policy.executionClasses ?? {};
const seen = new Set();
for (const candidate of policy.candidates ?? []) {
  if (!candidate.symbol || seen.has(candidate.symbol)) {
    failures.push(`duplicate or missing candidate symbol ${candidate.symbol}`);
  }
  seen.add(candidate.symbol);
  const execution = executionClasses[candidate.executionClass];
  if (!execution) {
    failures.push(`${candidate.symbol} has an unknown execution class`);
  }
  if (
    !["canonical-v4-single-hop", "direct-native-wrap"].includes(
      candidate.executionClass,
    )
  ) {
    failures.push(`${candidate.symbol} has a non-v4 execution class`);
  }
  if (!/^[1-9][0-9]*$/.test(candidate.maximumNativeInputWei ?? "")) {
    failures.push(`${candidate.symbol} has an invalid maximum input`);
  }
  if (!candidate.activation || !candidate.activation.includes("pending")) {
    failures.push(`${candidate.symbol} must remain pending`);
  }
  if (typeof candidate.required !== "boolean") {
    failures.push(`${candidate.symbol} must declare required true or false`);
  }
  if (candidate.address) {
    try {
      getAddress(candidate.address);
    } catch {
      failures.push(`${candidate.symbol} has an invalid address`);
    }
  }
}

for (const required of [
  "GOOGL",
  "MSFT",
  "NVDA",
  "SPCX",
  "SPY",
  "WETH",
]) {
  const candidate = policy.candidates.find((item) => item.symbol === required);
  if (!candidate) failures.push(`missing required candidate ${required}`);
  else if (!candidate.required) failures.push(`${required} must be required`);
}

for (const optional of ["GME", "USDG", "USDe", "DEGEN", "ARROW"]) {
  const candidate = policy.candidates.find((item) => item.symbol === optional);
  if (!candidate) failures.push(`missing optional candidate ${optional}`);
  else if (candidate.required) failures.push(`${optional} must remain individually optional`);
}

if (failures.length > 0) {
  process.stderr.write(`${failures.join("\n")}\n`);
  process.exit(1);
}

process.stdout.write(
  `${JSON.stringify({
    schemaVersion: 14,
    chainId: policy.chainId,
    candidateCount: seen.size,
    defaultEnabled: policy.activationPolicy.defaultEnabled,
    passed: true,
  })}\n`,
);
