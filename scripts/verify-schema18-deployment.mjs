#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { verifySchema18Deployment } from "./lib/schema18-verifier.mjs";

const manifestPath = path.resolve(process.env.ROBYN_SCHEMA18_MANIFEST ?? process.argv[2] ?? "");
if (!manifestPath || manifestPath === path.resolve(".")) {
  throw new Error("ROBYN_SCHEMA18_MANIFEST or a manifest argument is required");
}
const rpcUrl = process.env.ROBYN_SCHEMA18_RPC_URL ?? "http://127.0.0.1:18549";
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const result = await verifySchema18Deployment({ manifest, rpcUrl });
process.stdout.write(`${JSON.stringify(result)}\n`);
