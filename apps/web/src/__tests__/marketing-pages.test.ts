import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (path: string) =>
  readFileSync(new URL(path, import.meta.url), "utf8");

describe("marketing pages", () => {
  it("keeps the shared navigation complete", () => {
    const header = source("../components/site-header.tsx");
    for (const route of [
      "/discover",
      "/creators",
      "/security",
      "/whitepaper",
    ]) {
      expect(header).toContain(`href="${route}"`);
    }
  });

  it("states the fee allocation and material limits plainly", () => {
    const security = source("../app/security/page.tsx");
    for (const phrase of [
      "50%",
      "25%",
      "20%",
      "5%",
      "cannot promise",
      "do not create a guarantee",
    ]) {
      expect(security.toLowerCase()).toContain(phrase.toLowerCase());
    }
  });

  it("loads the film asset only after the visitor presses play", () => {
    const film = source("../components/marketing-film.tsx");
    expect(film).toContain("playing ? (");
    expect(film).toContain('preload="metadata"');
    expect(film).toContain('kind="captions"');
    expect(film).toContain("/demo#transcript");
  });

  it("keeps the compact homepage film free of utility links and duration copy", () => {
    const film = source("../components/marketing-film.tsx");
    expect(film).toContain(
      'compact ? "A Sherwood story" : "A Sherwood story · 66 seconds"',
    );
    expect(film).toContain("{compact ? null : (");
    expect(film).not.toContain("Open the film page");
  });

  it("labels the film and fixtures as Devnet-only", () => {
    const home = source("../app/page.tsx");
    const demo = source("../app/demo/page.tsx");
    expect(home).toContain("Devnet");
    expect(demo).toContain("no real-world value");
    expect(demo).not.toContain("Mainnet demonstration");
  });
});
