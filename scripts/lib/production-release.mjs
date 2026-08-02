import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

export const PRODUCTION_MANIFEST_SCHEMA = 1;
export const ALLOWED_SCOPES = new Set([
  "ui",
  "data",
  "infrastructure",
  "mixed",
  "contracts",
]);
export const FORBIDDEN_ARTIFACT_PATTERNS = [
  /(^|[/_.-])private[-_]?key($|[/_.-])/i,
  /(^|[/_.-])mnemonic($|[/_.-])/i,
  /(^|[/_.-])seed[-_]?phrase($|[/_.-])/i,
  /(^|[/_.-])keystore($|[/_.-])/i,
  /deployer/i,
  /signer[-_]?fifo/i,
  /operator[-_]?password/i,
];

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
export const sha256File = (file) => sha256(readFileSync(file));

export function classifyProductionChanges(files) {
  const categories = new Set();
  for (const raw of files) {
    const file = raw.replaceAll("\\", "/");
    if (!file) continue;
    if (
      file.startsWith("packages/contracts/") ||
      file === "foundry.toml" ||
      file.startsWith("deployments/")
    ) {
      categories.add("contracts");
    } else if (
      file.startsWith("apps/api/") ||
      file.startsWith("apps/indexer/") ||
      file.startsWith("apps/artifacts/") ||
      file.startsWith("packages/db/")
    ) {
      categories.add("data");
    } else if (file.startsWith("apps/web/")) {
      categories.add("ui");
    } else {
      categories.add("infrastructure");
    }
  }
  if (categories.has("contracts")) return "contracts";
  if (categories.size === 0) return "infrastructure";
  if (categories.size === 1) return [...categories][0];
  return "mixed";
}

export function hashMigrationSet(directory) {
  const files = readdirSync(directory)
    .filter((file) => /^\d+_[a-z0-9_]+\.sql$/.test(file))
    .sort();
  const payload = files
    .map(
      (file) =>
        `${file}:\0${readFileSync(path.join(directory, file), "utf8")}\0`,
    )
    .join("");
  return sha256(payload);
}

export function assertAdditiveMigrations(directory) {
  const forbidden = /\b(DROP|TRUNCATE)\b|\bALTER\s+TABLE\b[\s\S]*\bDROP\b/i;
  for (const file of readdirSync(directory).filter((name) =>
    name.endsWith(".sql"),
  )) {
    const sql = readFileSync(path.join(directory, file), "utf8");
    if (forbidden.test(sql)) {
      throw new Error(
        `Non-additive migration is forbidden in production release: ${file}`,
      );
    }
  }
}

export function assertSecretFreeTree(root) {
  const violations = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name === "node_modules") {
        continue;
      }
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(root, absolute).replaceAll("\\", "/");
      if (
        FORBIDDEN_ARTIFACT_PATTERNS.some((pattern) => pattern.test(relative))
      ) {
        violations.push(relative);
      }
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile() && statSync(absolute).size <= 2_000_000) {
        const text = readFileSync(absolute, "utf8");
        if (
          /BEGIN (?:OPENSSH|EC|RSA) PRIVATE KEY|\b(?:PRIVATE_KEY|MNEMONIC|SEED_PHRASE)\s*=/i.test(
            text,
          )
        ) {
          violations.push(relative);
        }
      }
    }
  };
  visit(root);
  if (violations.length > 0) {
    throw new Error(
      `Secret-bearing production artifact entries: ${[...new Set(violations)].join(", ")}`,
    );
  }
}

export function validateProductionRelease(manifest, policy, options = {}) {
  const errors = [];
  const hex = (value, length) =>
    typeof value === "string" &&
    new RegExp(`^[0-9a-f]{${length}}$`).test(value);
  if (manifest.schemaVersion !== PRODUCTION_MANIFEST_SCHEMA)
    errors.push("schemaVersion");
  if (manifest.chainId !== policy.chainId) errors.push("chainId");
  if (!hex(manifest.sourceSha, 40)) errors.push("sourceSha");
  if (!hex(manifest.applicationArtifactHash, 64))
    errors.push("applicationArtifactHash");
  if (!hex(manifest.runtimeArchiveHash, 64)) errors.push("runtimeArchiveHash");
  if (!ALLOWED_SCOPES.has(manifest.changeScope)) errors.push("changeScope");
  if (manifest.contractClosureHash !== policy.contractClosureHash)
    errors.push("contractClosureHash");
  if (manifest.deploymentManifestHash !== policy.deploymentManifestHash)
    errors.push("deploymentManifestHash");
  if (!hex(manifest.migrationSetHash, 64)) errors.push("migrationSetHash");
  if (!hex(manifest.processTopologyHash, 64))
    errors.push("processTopologyHash");
  if (
    !Array.isArray(manifest.acceptanceReferences) ||
    manifest.acceptanceReferences.length !== 3 ||
    new Set(
      manifest.acceptanceReferences.map((reference) => reference.environment),
    ).size !== 3 ||
    !["devnet", "testnet", "mainnet-staging"].every((environment) =>
      manifest.acceptanceReferences.some(
        (reference) =>
          reference.environment === environment && hex(reference.sha256, 64),
      ),
    )
  ) {
    errors.push("acceptanceReferences");
  }
  if (
    manifest.rpcPolicy?.primary !== "lan-only" ||
    manifest.rpcPolicy?.probeOnly !== true ||
    manifest.rpcPolicy?.automaticFallback !== false
  ) {
    errors.push("rpcPolicy");
  }
  if (
    options.currentRelease &&
    manifest.requiredPreviousRelease !== options.currentRelease
  ) {
    errors.push("requiredPreviousRelease");
  }
  if (errors.length > 0)
    throw new Error(`Invalid production release: ${errors.join(", ")}`);
  return manifest;
}

export function validateProductionAcceptance(evidence, expected) {
  const errors = [];
  if (evidence.schemaVersion !== 1) errors.push("schemaVersion");
  if (evidence.environment !== expected.environment) errors.push("environment");
  if (evidence.sourceSha !== expected.sourceSha) errors.push("sourceSha");
  if (evidence.changeScope !== expected.changeScope) errors.push("changeScope");
  if (evidence.contractClosureHash !== expected.contractClosureHash)
    errors.push("contractClosureHash");
  if (evidence.passed !== true) errors.push("passed");
  if (
    typeof evidence.completedAt !== "string" ||
    !Number.isFinite(Date.parse(evidence.completedAt))
  ) {
    errors.push("completedAt");
  }
  if (
    !Array.isArray(evidence.checks) ||
    evidence.checks.length === 0 ||
    evidence.checks.some(
      (check) =>
        typeof check?.name !== "string" ||
        check.name.length === 0 ||
        check.passed !== true,
    )
  ) {
    errors.push("checks");
  }
  if (
    evidence.rpcPolicy?.automaticFallback !== false ||
    evidence.rpcPolicy?.transactionSubmissionDefault !== false
  ) {
    errors.push("rpcPolicy");
  }
  if (errors.length > 0) {
    throw new Error("Invalid production acceptance: " + errors.join(", "));
  }
  return evidence;
}

export function assertReleaseTreeIntegrity(root, manifest) {
  const checksumFile = path.join(root, "release-files.sha256");
  if (sha256File(checksumFile) !== manifest.applicationArtifactHash) {
    throw new Error("Application artifact hash mismatch");
  }

  const lines = readFileSync(checksumFile, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean);
  if (lines.length === 0) throw new Error("Release checksum list is empty");
  for (const line of lines) {
    const match = /^([0-9a-f]{64})  (.+)$/.exec(line);
    if (!match) throw new Error("Malformed release checksum: " + line);
    const relative = match[2].replace(/^\.\//, "");
    const absolute = path.resolve(root, relative);
    if (
      path.isAbsolute(relative) ||
      (absolute !== root && !absolute.startsWith(root + path.sep)) ||
      !existsSync(absolute) ||
      !statSync(absolute).isFile()
    ) {
      throw new Error("Unsafe or missing release file: " + relative);
    }
    if (sha256File(absolute) !== match[1]) {
      throw new Error("Release file checksum mismatch: " + relative);
    }
  }

  for (const reference of manifest.acceptanceReferences) {
    const file = path.join(
      root,
      "release-evidence",
      reference.environment + ".json",
    );
    if (sha256File(file) !== reference.sha256) {
      throw new Error(
        "Acceptance evidence checksum mismatch: " + reference.environment,
      );
    }
    const evidence = JSON.parse(readFileSync(file, "utf8"));
    if (evidence.passed !== true || evidence.sourceSha !== manifest.sourceSha) {
      throw new Error(
        "Acceptance evidence identity mismatch: " + reference.environment,
      );
    }
  }
}
