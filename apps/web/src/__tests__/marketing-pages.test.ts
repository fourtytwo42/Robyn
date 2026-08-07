import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (path: string) =>
  readFileSync(new URL(path, import.meta.url), "utf8");

describe("marketing pages", () => {
  it("keeps the shared navigation complete", () => {
    const header = source("../components/site-header.tsx");
    for (const route of [
      "/discover",
      "/rdao",
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

  it("makes the Schema-20 RDAO sale public from the homepage and its own page", () => {
    const home = source("../app/page.tsx");
    const rdao = source("../app/rdao/page.tsx");
    const market = source("../components/rdao-token-market.tsx");
    const devnetAccess = source("../components/network-dao-access.devnet.tsx");
    const publicAccess = source("../components/network-dao-access.testnet.tsx");
    const publicView = source("../components/network-dao.testnet.tsx");
    expect(home).toContain("<RdaoSaleSpotlight />");
    expect(rdao).toContain('surface="market"');
    expect(rdao).not.toContain("NetworkDaoAccessGate");
    expect(rdao).not.toContain("RdaoSaleSpotlight");
    expect(market).toContain("BondingCurveChart");
    expect(market).toContain("Trade RDAO");
    expect(market).toContain('href="/dao"');
    expect(market).not.toContain('label: "Stake"');
    expect(market).not.toContain('label: "Governance"');
    expect(devnetAccess).toContain("deployment.schemaVersion === 20");
    expect(publicAccess).toContain("deployment.schemaVersion === 20");
    expect(publicView).toContain("<RdaoTokenMarket");
    expect(publicView).toContain("<RdaoWorkspace");
    expect(publicView).toContain('surface === "market"');
  });

  it("keeps Schema-20 RDAO labels environment-aware", () => {
    const page = source("../app/rdao/page.tsx");
    const workspace = source("../components/rdao-workspace.tsx");
    expect(page).toContain("publicEnvironment.networkLabel");
    expect(workspace).toContain("publicEnvironment.networkLabel");
    expect(workspace).not.toContain("Schema-20 Devnet only");
  });

  it("proxies direct Devnet browser API requests to the scoped data API", () => {
    const nextConfig = source("../../next.config.ts");
    expect(nextConfig).toContain('networkMode !== "devnet"');
    expect(nextConfig).toContain('source: "/api/:path*"');
    expect(nextConfig).toContain('"http://127.0.0.1:3101"');
  });

  it("labels the film and fixtures as Devnet-only", () => {
    const home = source("../app/page.tsx");
    const demo = source("../app/demo/page.tsx");
    expect(home).toContain("Devnet");
    expect(demo).toContain("no real-world value");
    expect(demo).not.toContain("Mainnet demonstration");
  });
});
