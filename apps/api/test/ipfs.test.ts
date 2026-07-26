import { describe, expect, it } from "vitest";
import {
  assertIpfsUri,
  canonicalTokenMetadata,
  requestRemotePin,
} from "../src/ipfs.js";

const pngCid = "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3fteh7movd4m5x2m5qv6q";
const webpCid = "bafkreif2akiscaildcwr6zeux4w6i2s5kmibuf6j4jvcrbozme2q";

describe("IPFS token metadata", () => {
  it("produces byte-stable ERC-1046 JSON", () => {
    const first = canonicalTokenMetadata({
      name: "Robyn",
      symbol: "ROBYN",
      description: "Basket rewards",
      pngCid,
      webpCid,
      hasAlpha: true,
    });
    const second = canonicalTokenMetadata({
      name: "Robyn",
      symbol: "ROBYN",
      description: "Basket rewards",
      pngCid,
      webpCid,
      hasAlpha: true,
    });
    expect(first.equals(second)).toBe(true);
    expect(JSON.parse(first.toString())).toEqual({
      interop: { erc1046: true },
      name: "Robyn",
      symbol: "ROBYN",
      decimals: 18,
      description: "Basket rewards",
      image: `ipfs://${pngCid}`,
      images: [`ipfs://${webpCid}`],
      icons: [`ipfs://${pngCid}`],
    });
  });

  it("commits canonical project links to immutable metadata", () => {
    const metadata = JSON.parse(
      canonicalTokenMetadata({
        name: "Sherwood",
        symbol: "WOOD",
        pngCid,
        webpCid,
        hasAlpha: false,
        website: "https://sherwoodforest.trade/project/",
        xUrl: "https://x.com/sherwoodforest/",
      }).toString(),
    );
    expect(metadata.external_url).toBe("https://sherwoodforest.trade/project");
    expect(metadata.links).toEqual({
      website: "https://sherwoodforest.trade/project",
      x: "https://x.com/sherwoodforest",
    });
    expect(() =>
      canonicalTokenMetadata({
        name: "Bad",
        symbol: "BAD",
        pngCid,
        webpCid,
        hasAlpha: false,
        website: "http://unsafe.example",
      }),
    ).toThrow("invalid_project_link");
    expect(() =>
      canonicalTokenMetadata({
        name: "Bad",
        symbol: "BAD",
        pngCid,
        webpCid,
        hasAlpha: false,
        xUrl: "https://example.com/not-x",
      }),
    ).toThrow("invalid_project_link");
  });

  it("validates URI shape and description bounds", () => {
    expect(assertIpfsUri(`ipfs://${pngCid}`)).toBe(pngCid);
    expect(() => assertIpfsUri("https://gateway.example/ipfs/x")).toThrow(
      "invalid_ipfs_uri",
    );
    expect(() =>
      canonicalTokenMetadata({
        name: "Robyn",
        symbol: "ROBYN",
        description: "x".repeat(281),
        pngCid,
        webpCid,
        hasAlpha: false,
      }),
    ).toThrow("description_too_long");
  });

  it("keeps local development usable without a remote provider", async () => {
    await expect(requestRemotePin(pngCid, "image")).resolves.toEqual({
      state: "queued",
    });
  });

  it("commits a validated automated campaign marker to immutable bytes", () => {
    const metadata = JSON.parse(
      canonicalTokenMetadata({
        name: "Assurance Oak",
        symbol: "AOK",
        pngCid,
        webpCid,
        hasAlpha: false,
        testCampaign: {
          campaignId: "schema8-assurance",
          releaseSha: "a".repeat(40),
        },
      }).toString(),
    );
    expect(metadata.robynTestCampaign).toEqual({
      campaignId: "schema8-assurance",
      releaseSha: "a".repeat(40),
      automatedTestLaunch: true,
    });
    expect(() =>
      canonicalTokenMetadata({
        name: "Bad",
        symbol: "BAD",
        pngCid,
        webpCid,
        hasAlpha: false,
        testCampaign: {
          campaignId: "../escape",
          releaseSha: "not-a-sha",
        },
      }),
    ).toThrow("invalid_test_campaign");
  });
});
