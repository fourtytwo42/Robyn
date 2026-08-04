import { describe, expect, it } from "vitest";
import { resolvePublicEnvironment } from "./public-environment";
import { marketingEnvironmentCopy } from "./marketing-environment";

describe("marketingEnvironmentCopy", () => {
  it("labels Devnet fixtures as having no real-world value", () => {
    const copy = marketingEnvironmentCopy(
      resolvePublicEnvironment({ mode: "devnet" }),
    );
    expect(copy.fixtureNotice).toMatch(/Devnet/);
    expect(copy.fixtureNotice).toMatch(/no real-world value/i);
    expect(copy.assetNoun).toBe("testing assets");
  });

  it("never describes Testnet assets as verified Mainnet assets", () => {
    const copy = marketingEnvironmentCopy(
      resolvePublicEnvironment({ mode: "testnet" }),
    );
    expect(copy.fixtureNotice).toMatch(/Testnet/);
    expect(copy.fixtureNotice).toMatch(/no real-world value/i);
    expect(copy.assetNoun).toBe("test assets");
  });

  it("keeps fixture copy off Mainnet", () => {
    const copy = marketingEnvironmentCopy(
      resolvePublicEnvironment({ mode: "mainnet" }),
    );
    expect(copy.fixtureNotice).toBeNull();
    expect(copy.assetNoun).toBe("supported assets");
  });
});
