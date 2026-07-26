import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const TEXT_EXTENSIONS = new Set([
  ".css",
  ".html",
  ".json",
  ".md",
  ".svg",
  ".ts",
  ".tsx",
]);

function collectEmDashLocations(directory: string): string[] {
  const matches: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      matches.push(...collectEmDashLocations(entryPath));
      continue;
    }
    if (!TEXT_EXTENSIONS.has(path.extname(entry.name))) continue;
    const contents = readFileSync(entryPath, "utf8");
    contents.split(/\r?\n/).forEach((line, index) => {
      if (line.includes("\u2014")) {
        matches.push(`${entryPath}:${index + 1}`);
      }
    });
  }
  return matches;
}

describe("public copy style", () => {
  it("contains no em dashes in the web app or holding page", () => {
    const repoRoot = path.resolve(process.cwd(), "../..");
    const matches = [
      ...collectEmDashLocations(path.join(repoRoot, "apps/web/src")),
      ...collectEmDashLocations(path.join(repoRoot, "apps/web/public")),
      ...collectEmDashLocations(
        path.join(repoRoot, "infrastructure/coming-soon"),
      ),
    ];

    expect(matches).toEqual([]);
  });
});
