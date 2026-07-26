import { describe, expect, it } from "vitest";
import { resolvePublicEnvironment } from "./public-environment";

describe("public environment profiles", () => {
  it("keeps testnet on its own chain, host and faucet", () => {
    expect(resolvePublicEnvironment({ mode: "testnet" })).toMatchObject({
      mode: "testnet",
      chainId: 46630,
      appUrl: "https://testnet.sherwoodforest.trade",
      faucetUrl: "https://faucet.testnet.chain.robinhood.com",
      isTestnet: true,
      isMainnet: false,
    });
  });

  it("keeps mainnet on chain 4663 with no faucet or testnet hostname", () => {
    const environment = resolvePublicEnvironment({ mode: "mainnet" });
    expect(environment).toMatchObject({
      mode: "mainnet",
      chainId: 4663,
      appUrl: "https://sherwoodforest.trade",
      isTestnet: false,
      isMainnet: true,
    });
    expect(environment.faucetUrl).toBeUndefined();
    expect(
      [
        environment.chainName,
        environment.networkLabel,
        environment.rpcUrl,
        environment.explorerUrl,
        environment.appUrl,
      ]
        .join(" ")
        .toLowerCase(),
    ).not.toContain("testnet");
  });

  it("allows isolated public RPC and application overrides", () => {
    expect(
      resolvePublicEnvironment({
        mode: "mainnet",
        rpcUrl: "https://rpc.example.com",
        explorerUrl: "https://explorer.example.com",
        appUrl: "https://mainnet.example.com",
      }),
    ).toMatchObject({
      rpcUrl: "https://rpc.example.com",
      explorerUrl: "https://explorer.example.com",
      appUrl: "https://mainnet.example.com",
    });
  });

  it("fails closed on an unknown mode", () => {
    expect(() => resolvePublicEnvironment({ mode: "preview" })).toThrow(
      "Unsupported public network mode",
    );
  });
});
