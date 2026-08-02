#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { classifyProductionChanges } from "./lib/production-release.mjs";

const [base, target = "HEAD"] = process.argv.slice(2);
if (!base) throw new Error("usage: classify-mainnet-release.mjs <base> [target]");
const files = execFileSync("git", ["diff", "--name-only", `${base}..${target}`], {
  encoding: "utf8",
}).trim().split("\n").filter(Boolean);
process.stdout.write(`${JSON.stringify({ base, target, files, scope: classifyProductionChanges(files) }, null, 2)}\n`);
