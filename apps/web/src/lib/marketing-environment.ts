import type { PublicEnvironment } from "./public-environment";

export type MarketingEnvironmentCopy = {
  eyebrow: string;
  fixtureNotice: string | null;
  assetNoun: string;
};

export function marketingEnvironmentCopy(
  environment: PublicEnvironment,
): MarketingEnvironmentCopy {
  if (environment.isDevnet) {
    return {
      eyebrow: "Devnet testing environment",
      fixtureNotice:
        "Devnet testing environment · assets and transactions have no real-world value.",
      assetNoun: "testing assets",
    };
  }
  if (environment.isTestnet) {
    return {
      eyebrow: "Robinhood Chain Testnet",
      fixtureNotice:
        "Testnet demonstration · test assets and transactions have no real-world value.",
      assetNoun: "test assets",
    };
  }
  return {
    eyebrow: "Robinhood Chain",
    fixtureNotice: null,
    assetNoun: "supported assets",
  };
}
