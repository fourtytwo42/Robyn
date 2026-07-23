#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";

const apiRequire = createRequire(
  new URL("../apps/api/package.json", import.meta.url),
);
const { privateKeyToAccount } = await import(apiRequire.resolve("viem/accounts"));

const authOrigin =
  process.env.ROBYN_API_TEST_AUTH_ORIGIN ?? "http://192.168.50.250:3000";
const baseUrl =
  process.env.ROBYN_API_TEST_URL ?? `${authOrigin.replace(/\/$/, "")}/api`;
const manifestPath =
  process.env.ROBYN_API_TEST_MANIFEST ?? "deployments/31337.json";
const outputPath = process.env.ROBYN_API_TEST_OUTPUT;
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const launch = manifest.demoLaunches?.[0];
if (!launch?.token) throw new Error("manifest requires a demo launch");
const token = launch.token;
const creator =
  manifest.deployer ?? "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266";
const unknownAddress = "0x0000000000000000000000000000000000000001";
const unknownSha = "0".repeat(64);
const testAccount = privateKeyToAccount(
  `0x${randomBytes(32).toString("hex")}`,
);
const authHeaders = {
  origin: authOrigin,
  "content-type": "application/json",
};
const results = [];

async function check({
  name,
  path,
  method = "GET",
  headers,
  body,
  expected = [200],
  validate = () => true,
}) {
  const started = performance.now();
  let status = 0;
  let responseBody = "";
  let error = null;
  try {
    const response = await fetch(
      new URL(`${baseUrl.replace(/\/$/, "")}${path}`),
      {
        method,
        headers,
        body,
        signal: AbortSignal.timeout(10_000),
      },
    );
    status = response.status;
    responseBody = await response.text();
    let parsed = null;
    try {
      parsed = responseBody ? JSON.parse(responseBody) : null;
    } catch {
      // Binary and redirect responses are validated by status.
    }
    if (!expected.includes(status)) {
      throw new Error(`expected ${expected.join("/")} received ${status}`);
    }
    if (!validate(parsed, response)) throw new Error("response validation failed");
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
  }
  results.push({
    name,
    method,
    path,
    status,
    durationMs: performance.now() - started,
    passed: error === null,
    error,
  });
}

await check({
  name: "health",
  path: "/health",
  validate: (body) => body?.service === "robyn-api",
});
await check({
  name: "status",
  path: "/status",
  validate: (body) => body?.chainId === 31337,
});
await check({ name: "operations", path: "/operations" });
await check({
  name: "assets",
  path: "/assets",
  validate: (body) => Array.isArray(body?.data) && body.data.length > 0,
});

for (const sort of [
  "new",
  "trending",
  "near_graduation",
  "graduated",
  "volume",
  "market_cap",
]) {
  await check({
    name: `launches-sort-${sort}`,
    path: `/launches?limit=5&sort=${sort}&window=24h&phase=all`,
    validate: (body) => Array.isArray(body?.data),
  });
}
for (const window of ["24h", "7d", "all"]) {
  await check({
    name: `launches-window-${window}`,
    path: `/launches?limit=5&sort=volume&window=${window}&phase=all`,
    validate: (body) => Array.isArray(body?.data),
  });
}
for (const phase of ["all", "bonding", "graduated"]) {
  await check({
    name: `launches-phase-${phase}`,
    path: `/launches?limit=5&sort=new&window=all&phase=${phase}`,
    validate: (body) => Array.isArray(body?.data),
  });
}
await check({
  name: "launches-creator",
  path: `/launches?creator=${creator}`,
  validate: (body) => Array.isArray(body?.data),
});
await check({
  name: "launches-invalid-creator",
  path: "/launches?creator=not-an-address",
  expected: [400],
});
await check({
  name: "launches-invalid-cursor",
  path: "/launches?cursor=not-a-cursor",
  expected: [400],
});
await check({
  name: "launches-invalid-address-query",
  path: "/launches?q=0x1234",
  validate: (body) => body?.queryStatus === "invalid_address",
});

await check({
  name: "launch-detail",
  path: `/launches/${token}`,
  validate: (body) => body?.data?.token?.toLowerCase() === token.toLowerCase(),
});
await check({
  name: "launch-detail-invalid",
  path: "/launches/not-a-token",
  expected: [400],
});
await check({
  name: "launch-detail-missing",
  path: `/launches/${unknownAddress}`,
  expected: [404],
});
await check({
  name: "launch-activity",
  path: `/launches/${token}/activity?limit=10`,
  validate: (body) => Array.isArray(body?.data),
});
await check({
  name: "launch-activity-invalid",
  path: "/launches/not-a-token/activity",
  expected: [400],
});
await check({
  name: "launch-analytics",
  path: `/launches/${token}/analytics`,
  validate: (body) => Array.isArray(body?.data?.chart),
});
await check({
  name: "launch-analytics-invalid",
  path: "/launches/not-a-token/analytics",
  expected: [400],
});
await check({
  name: "creator-rewards-creator",
  path: `/launches/${token}/creator-rewards?account=${creator}`,
  validate: (body) => body?.data?.token?.toLowerCase() === token.toLowerCase(),
});
await check({
  name: "creator-rewards-viewer",
  path: `/launches/${token}/creator-rewards?account=${unknownAddress}`,
  validate: (body) => body?.data?.viewerIsCreator === false,
});
await check({
  name: "creator-rewards-invalid-token",
  path: "/launches/not-a-token/creator-rewards",
  expected: [400],
});
await check({
  name: "creator-rewards-invalid-account",
  path: `/launches/${token}/creator-rewards?account=invalid`,
  expected: [400],
});

await check({ name: "dao-overview", path: `/dao?account=${creator}` });
await check({
  name: "dao-proposals",
  path: `/dao/proposals?account=${creator}`,
  validate: (body) => Array.isArray(body?.data),
});
await check({
  name: "dao-proposal-invalid",
  path: "/dao/proposals/not-a-number",
  expected: [400],
});
await check({
  name: "dao-proposal-missing",
  path: "/dao/proposals/999999999999999999",
  expected: [404],
});
await check({
  name: "dao-members",
  path: "/dao/members",
  validate: (body) => Array.isArray(body?.data),
});
await check({
  name: "dao-activity",
  path: "/dao/activity",
  validate: (body) => Array.isArray(body?.data),
});

await check({
  name: "auth-session-anonymous",
  path: "/auth/session",
  validate: (body) => body?.data === null,
});
await check({
  name: "auth-nonce-invalid-address",
  path: "/auth/nonce",
  method: "POST",
  headers: authHeaders,
  body: JSON.stringify({ address: "invalid" }),
  expected: [400],
});
let challenge;
await check({
  name: "auth-nonce",
  path: "/auth/nonce",
  method: "POST",
  headers: authHeaders,
  body: JSON.stringify({ address: creator }),
  validate: (body) => {
    challenge = body?.data?.message;
    return typeof challenge === "string";
  },
});
const invalidSignature = `0x${"00".repeat(65)}`;
await check({
  name: "auth-invalid-signature",
  path: "/auth/verify",
  method: "POST",
  headers: authHeaders,
  body: JSON.stringify({ message: challenge, signature: invalidSignature }),
  expected: [401],
});
await check({
  name: "auth-replayed-nonce",
  path: "/auth/verify",
  method: "POST",
  headers: authHeaders,
  body: JSON.stringify({ message: challenge, signature: invalidSignature }),
  expected: [401],
});
let testChallenge;
await check({
  name: "auth-nonce-success-session",
  path: "/auth/nonce",
  method: "POST",
  headers: authHeaders,
  body: JSON.stringify({ address: testAccount.address }),
  validate: (body) => {
    testChallenge = body?.data?.message;
    return typeof testChallenge === "string";
  },
});
const testSignature = await testAccount.signMessage({ message: testChallenge });
let authenticatedCookie;
await check({
  name: "auth-verify-success-session",
  path: "/auth/verify",
  method: "POST",
  headers: authHeaders,
  body: JSON.stringify({ message: testChallenge, signature: testSignature }),
  validate: (body, response) => {
    authenticatedCookie = response.headers.get("set-cookie")?.split(";", 1)[0];
    return (
      body?.data?.address?.toLowerCase() === testAccount.address.toLowerCase() &&
      typeof authenticatedCookie === "string"
    );
  },
});
const authenticatedHeaders = {
  ...authHeaders,
  cookie: authenticatedCookie,
};
await check({
  name: "auth-session-authenticated",
  path: "/auth/session",
  headers: { origin: authOrigin, cookie: authenticatedCookie },
  validate: (body) =>
    body?.data?.address?.toLowerCase() === testAccount.address.toLowerCase(),
});
await check({
  name: "profile-update-authenticated",
  path: "/profile",
  method: "PUT",
  headers: authenticatedHeaders,
  body: JSON.stringify({
    displayName: "Robyn system test",
    bio: "Ephemeral authenticated integration-test profile.",
    website: "https://example.com/robyn-system-test",
  }),
  validate: (body) =>
    body?.data?.address?.toLowerCase() === testAccount.address.toLowerCase(),
});
await check({
  name: "profile-read-authenticated",
  path: `/profiles/${testAccount.address}`,
  validate: (body) => body?.data?.display_name === "Robyn system test",
});
const validImage = await readFile(
  "apps/web/public/assets/brand/robyn-logo.webp",
);
let uploadedMediaId;
await check({
  name: "media-upload-authenticated",
  path: "/media?purpose=avatar",
  method: "POST",
  headers: {
    origin: authOrigin,
    cookie: authenticatedCookie,
    "content-type": "image/webp",
  },
  body: validImage,
  expected: [201],
  validate: (body) => {
    uploadedMediaId = body?.data?.media_id;
    return (
      typeof uploadedMediaId === "string" &&
      body?.data?.status === "active" &&
      body?.data?.width === 1024 &&
      body?.data?.height === 1024
    );
  },
});
await check({
  name: "media-read-authenticated-upload",
  path: `/media/${uploadedMediaId}`,
  validate: (_body, response) =>
    response.headers.get("content-type")?.startsWith("image/webp"),
});
await check({
  name: "media-report-authenticated-upload",
  path: `/media/${uploadedMediaId}/reports`,
  method: "POST",
  headers: authenticatedHeaders,
  body: JSON.stringify({
    reason: "Automated integration-test report; no moderation action required.",
  }),
  expected: [201],
  validate: (body) => body?.status === "recorded_not_hidden",
});
await check({
  name: "auth-logout-authenticated",
  path: "/auth/logout",
  method: "POST",
  headers: authenticatedHeaders,
  body: "{}",
});
await check({
  name: "auth-session-after-logout",
  path: "/auth/session",
  headers: { origin: authOrigin, cookie: authenticatedCookie },
  validate: (body) => body?.data === null,
});
await check({
  name: "auth-logout-anonymous",
  path: "/auth/logout",
  method: "POST",
  headers: authHeaders,
  body: "{}",
});
await check({
  name: "profile-invalid-address",
  path: "/profiles/invalid",
  expected: [400],
});
await check({
  name: "profile-read",
  path: `/profiles/${creator}`,
  expected: [200, 404],
});
await check({
  name: "profile-update-unauthorized",
  path: "/profile",
  method: "PUT",
  headers: authHeaders,
  body: JSON.stringify({ displayName: "Unauthorized" }),
  expected: [401],
});
await check({
  name: "media-upload-unauthorized",
  path: "/media?purpose=token",
  method: "POST",
  headers: { origin: authHeaders.origin, "content-type": "image/png" },
  body: Buffer.from("not-an-image"),
  expected: [401],
});
await check({
  name: "media-missing",
  path: "/media/00000000-0000-0000-0000-000000000000",
  expected: [404],
});
await check({
  name: "metadata-read",
  path: `/launches/${token}/metadata`,
  expected: [200, 404],
});
await check({
  name: "metadata-bind-unauthorized",
  path: `/launches/${token}/metadata`,
  method: "POST",
  headers: authHeaders,
  body: JSON.stringify({ mediaId: "00000000-0000-0000-0000-000000000000" }),
  expected: [401],
});
await check({
  name: "media-report-invalid-reason",
  path: "/media/00000000-0000-0000-0000-000000000000/reports",
  method: "POST",
  headers: authHeaders,
  body: JSON.stringify({ reason: "short" }),
  expected: [400],
});
await check({
  name: "media-report-missing",
  path: "/media/00000000-0000-0000-0000-000000000000/reports",
  method: "POST",
  headers: authHeaders,
  body: JSON.stringify({ reason: "This media does not exist." }),
  expected: [404],
});
await check({
  name: "artifact-invalid-sha",
  path: "/artifacts/invalid/metadata",
  expected: [400],
});
await check({
  name: "artifact-missing",
  path: `/artifacts/${unknownSha}/metadata`,
  expected: [404],
});

const failed = results.filter((result) => !result.passed);
const summary = {
  schemaVersion: 1,
  testedAt: new Date().toISOString(),
  baseUrl,
  manifestPath,
  total: results.length,
  passedCount: results.length - failed.length,
  failedCount: failed.length,
  passed: failed.length === 0,
  resources: {
    authenticatedTestAddress: testAccount.address,
    uploadedMediaId,
  },
  results,
};
const encoded = `${JSON.stringify(summary, null, 2)}\n`;
if (outputPath) await writeFile(outputPath, encoded);
process.stdout.write(encoded);
if (failed.length) process.exitCode = 1;
