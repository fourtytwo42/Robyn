#!/usr/bin/env node

import { readFileSync } from "node:fs";

export function validatePublicReleaseEnvironment({
  mode,
  manifest,
  appUrl,
  rpcUrl,
  explorerUrl,
}) {
  const errors = [];
  const expectedChainId = mode === "testnet" ? 46630 : mode === "mainnet" ? 4663 : null;
  if (expectedChainId === null) {
    errors.push(`unsupported public release mode: ${mode}`);
    return errors;
  }
  if (Number(manifest.chainId) !== expectedChainId) {
    errors.push(`deployment chainId must be ${expectedChainId} for ${mode}`);
  }
  if (String(manifest.environment ?? "").toLowerCase().includes(
    mode === "mainnet" ? "testnet" : "mainnet",
  )) {
    errors.push(`deployment environment does not match ${mode}`);
  }

  for (const [label, value] of [
    ["application", appUrl],
    ["RPC", rpcUrl],
    ["explorer", explorerUrl],
  ]) {
    try {
      if (new URL(value).protocol !== "https:") {
        errors.push(`${label} URL must use HTTPS`);
      }
    } catch {
      errors.push(`${label} URL must be valid`);
    }
  }

  if (mode === "testnet" && new URL(appUrl).hostname !== "testnet.sherwoodforest.trade") {
    errors.push("testnet application URL must use testnet.sherwoodforest.trade");
  }
  if (mode === "mainnet") {
    if (new URL(appUrl).hostname !== "sherwoodforest.trade") {
      errors.push("mainnet application URL must use sherwoodforest.trade");
    }
    const serializedManifest = JSON.stringify(manifest).toLowerCase();
    if (serializedManifest.includes("testnet")) {
      errors.push("mainnet deployment manifest must not contain testnet markers");
    }
    if (manifest.assetCatalog?.assets?.some((asset) => asset.mockOnly)) {
      errors.push("mainnet deployment manifest must not include mock-only assets");
    }
  }
  return errors;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [mode, manifestPath, appUrl, rpcUrl, explorerUrl] = process.argv.slice(2);
  if (!mode || !manifestPath || !appUrl || !rpcUrl || !explorerUrl) {
    console.error(
      "usage: validate-public-release-environment.mjs MODE MANIFEST APP_URL RPC_URL EXPLORER_URL",
    );
    process.exit(2);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const errors = validatePublicReleaseEnvironment({
    mode,
    manifest,
    appUrl,
    rpcUrl,
    explorerUrl,
  });
  if (errors.length > 0) {
    for (const error of errors) console.error(error);
    process.exit(1);
  }
  console.log(
    `validated ${mode} release environment on chain ${manifest.chainId}`,
  );
}
