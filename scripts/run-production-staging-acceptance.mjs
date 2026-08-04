#!/usr/bin/env node
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const environments = new Map([
  ["devnet", 31_337],
  ["testnet", 46_630],
  ["mainnet-staging", 4_663],
]);

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function check(name, passed, result) {
  if (!passed) throw new Error(`production acceptance failed: ${name}`);
  return result === undefined ? { name, passed } : { name, passed, result };
}

async function rpc(url, method, params = []) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: method, method, params }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`candidate gateway returned HTTP ${response.status}`);
  return response.json();
}

async function waitForHealth(url, child) {
  let lastError = "candidate gateway did not start";
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`candidate gateway exited ${child.exitCode}`);
    }
    try {
      const response = await fetch(`${url}/health`, {
        signal: AbortSignal.timeout(2_000),
      });
      if (response.ok) return response.json();
      lastError = `health returned HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(lastError);
}

async function stop(child) {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

const environment = required("ROBYN_ACCEPTANCE_ENVIRONMENT");
const expectedChainId = environments.get(environment);
if (!expectedChainId) {
  throw new Error("ROBYN_ACCEPTANCE_ENVIRONMENT must be devnet, testnet, or mainnet-staging");
}
const primaryUrl = required("ROBYN_ACCEPTANCE_PRIMARY_RPC_URL");
const fallbackUrl = required("ROBYN_ACCEPTANCE_FALLBACK_RPC_URL");
const changeScope = required("ROBYN_ACCEPTANCE_CHANGE_SCOPE");
if (!["ui", "data", "infrastructure", "mixed", "contracts"].includes(changeScope)) {
  throw new Error("ROBYN_ACCEPTANCE_CHANGE_SCOPE is invalid");
}
const requireFallbackHealthy =
  process.env.ROBYN_ACCEPTANCE_REQUIRE_FALLBACK_HEALTHY === "true";
const requireFallbackReachable =
  process.env.ROBYN_ACCEPTANCE_REQUIRE_FALLBACK_REACHABLE === "true";
const sourceSha = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: repo,
  encoding: "utf8",
}).trim();
const policy = JSON.parse(
  execFileSync("cat", [path.join(repo, "config/production-mainnet.json")], {
    encoding: "utf8",
  }),
);
if (Number(policy.chainId) !== 4_663) {
  throw new Error("production policy chain identity changed");
}
const temporary = mkdtempSync(path.join(tmpdir(), "robyn-production-acceptance-"));
const port = 20_000 + (process.pid % 20_000);
const baseUrl = `http://127.0.0.1:${port}`;
const statusFile = path.join(temporary, "status.json");
let stderr = "";
const child = spawn(
  "pnpm",
  ["--filter", "@robyn/rpc-gateway", "exec", "tsx", "src/failover-server.ts"],
  {
    cwd: repo,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      PRIMARY_RPC_URL: primaryUrl,
      FALLBACK_RPC_URL: fallbackUrl,
      EXPECTED_CHAIN_ID: String(expectedChainId),
      RPC_ACTIVE_PROVIDER: "primary",
      RPC_FALLBACK_TRAFFIC_AUTHORIZED: "false",
      RPC_TRANSACTION_SUBMISSION_AUTHORIZED: "false",
      RPC_PROBE_INTERVAL_MS: "300000",
      RPC_UPSTREAM_TIMEOUT_MS: "5000",
      RPC_UPSTREAM_RETRY_COUNT: "1",
      RPC_STATUS_FILE: statusFile,
      RPC_SERVICE_NAME: `robyn-${environment}-production-acceptance`,
      LOG_LEVEL: "error",
    },
    stdio: ["ignore", "ignore", "pipe"],
  },
);
child.stderr.setEncoding("utf8");
child.stderr.on("data", (chunk) => {
  stderr = `${stderr}${chunk}`.slice(-4_000);
});

try {
  const health = await waitForHealth(baseUrl, child);
  const chain = await rpc(baseUrl, "eth_chainId");
  const head = await rpc(baseUrl, "eth_blockNumber");
  const unlocked = await rpc(baseUrl, "eth_sendTransaction", [
    { from: "0x0000000000000000000000000000000000000001", to: "0x0000000000000000000000000000000000000002", value: "0x0" },
  ]);
  const signed = await rpc(baseUrl, "eth_sendRawTransaction", ["0x00"]);
  const checks = [
    check("candidate gateway started from exact source", health.service === `robyn-${environment}-production-acceptance`),
    check("chain identity matched", chain.result === `0x${expectedChainId.toString(16)}`, chain.result),
    check("bounded read succeeded", typeof head.result === "string" && /^0x[0-9a-f]+$/i.test(head.result)),
    check("unlocked-account method blocked", unlocked.error?.code === -32_601),
    check("signed raw relay disabled by default", signed.error?.code === -32_001),
    check("automatic fallback disabled", health.activeProvider === "primary" && health.fallbackTrafficAuthorized === false),
    check("candidate reports transaction submission disabled", health.publicRpcPolicy?.transactionSubmissionAuthorized === false),
    check("LAN primary is healthy", health.primary?.healthy === true && health.trafficAvailable === true),
  ];
  if (requireFallbackHealthy) {
    checks.push(
      check(
        "comparison provider probe is healthy and receives no application traffic",
        health.fallback?.healthy === true && Number(health.paidFallbackCu) === 0,
      ),
    );
  }
  if (requireFallbackReachable) {
    const comparisonChain = await rpc(fallbackUrl, "eth_chainId");
    const comparisonHead = await rpc(fallbackUrl, "eth_blockNumber");
    checks.push(
      check(
        "comparison provider chain identity matched",
        comparisonChain.result === `0x${expectedChainId.toString(16)}`,
        comparisonChain.result,
      ),
      check(
        "comparison provider block-height probe succeeded without application traffic",
        typeof comparisonHead.result === "string" &&
          /^0x[0-9a-f]+$/i.test(comparisonHead.result) &&
          Number(health.paidFallbackCu) === 0,
      ),
    );
  }
  const evidence = {
    schemaVersion: 1,
    environment,
    sourceSha,
    applicationReleaseSha: policy.applicationReleaseSha,
    changeScope,
    contractClosureHash: policy.contractClosureHash,
    passed: true,
    completedAt: new Date().toISOString(),
    checks,
    rpcPolicy: {
      automaticFallback: false,
      transactionSubmissionDefault: false,
    },
  };
  const output = process.env.ROBYN_ACCEPTANCE_OUTPUT?.trim();
  if (output) writeFileSync(output, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
} catch (error) {
  if (stderr) process.stderr.write(stderr.replaceAll(primaryUrl, "[primary-rpc]").replaceAll(fallbackUrl, "[comparison-rpc]"));
  throw error;
} finally {
  await stop(child);
  rmSync(temporary, { recursive: true, force: true });
}
