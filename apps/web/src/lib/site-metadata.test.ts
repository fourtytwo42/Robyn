import { describe, expect, it } from "vitest";
import { resolvePublicEnvironment } from "./public-environment";
import { createSiteMetadata } from "./site-metadata";

describe("site social metadata", () => {
  it("publishes explicit Mainnet Open Graph and X metadata without Testnet copy", () => {
    const metadata = createSiteMetadata(
      resolvePublicEnvironment({ mode: "mainnet" }),
    );
    const serialized = JSON.stringify(metadata).toLowerCase();

    expect(metadata).toMatchObject({
      title: "Sherwood Forest | Robinhood Chain",
      description:
        "Launch and discover tokens with community-selected reward baskets on Robinhood Chain.",
      alternates: { canonical: "https://sherwoodforest.trade" },
      openGraph: {
        type: "website",
        siteName: "Sherwood Forest",
        url: "https://sherwoodforest.trade",
        title: "Sherwood Forest | Robinhood Chain",
      },
      twitter: {
        card: "summary",
        title: "Sherwood Forest | Robinhood Chain",
      },
    });
    expect(serialized).not.toContain("testnet");
  });

  it("keeps Testnet previews explicitly labeled", () => {
    const metadata = createSiteMetadata(
      resolvePublicEnvironment({ mode: "testnet" }),
    );

    expect(metadata).toMatchObject({
      title: "Sherwood Forest | Robinhood Testnet",
      openGraph: {
        url: "https://testnet.sherwoodforest.trade",
        title: "Sherwood Forest | Robinhood Testnet",
      },
      twitter: { title: "Sherwood Forest | Robinhood Testnet" },
    });
  });
});
