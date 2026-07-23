import { describe, expect, it } from "vitest";

import {
  getWalletWriteState,
  normalizeWalletAddress,
  normalizeWalletError,
  shouldInvalidateWalletSession,
  validateWalletBuildConfig,
  walletErrorCode,
} from "./wallet-policy";

describe("wallet policy", () => {
  it("normalizes addresses and gates writes by account and chain", () => {
    const address = "0x00000000000000000000000000000000000000aa";
    expect(normalizeWalletAddress(address)).toBe(
      "0x00000000000000000000000000000000000000AA",
    );
    expect(getWalletWriteState(undefined, 46630)).toBe("disconnected");
    expect(getWalletWriteState(address, 1)).toBe("wrong-chain");
    expect(getWalletWriteState(address, 46630)).toBe("ready");
  });

  it("invalidates SIWE only after an established account changes or disconnects", () => {
    const first = "0x0000000000000000000000000000000000000001";
    const second = "0x0000000000000000000000000000000000000002";
    expect(shouldInvalidateWalletSession(undefined, first)).toBe(false);
    expect(shouldInvalidateWalletSession(first, first.toUpperCase())).toBe(
      false,
    );
    expect(shouldInvalidateWalletSession(first, second)).toBe(true);
    expect(shouldInvalidateWalletSession(first, undefined)).toBe(true);
  });

  it("translates common connector failures without exposing internals", () => {
    expect(normalizeWalletError({ code: 4001 })).toMatch(/rejected/i);
    expect(
      normalizeWalletError({ message: "WalletConnect relay timeout" }),
    ).toMatch(/timed out/i);
    expect(normalizeWalletError({ message: "unsupported chain" })).toMatch(
      /does not currently support/i,
    );
  });

  it("finds provider error codes through connector wrappers", () => {
    expect(walletErrorCode({ code: 4902 })).toBe(4902);
    expect(walletErrorCode({ cause: { cause: { code: "4902" } } })).toBe(4902);
    expect(walletErrorCode({ cause: { code: 4001 } })).toBe(4001);
    expect(walletErrorCode(new Error("no code"))).toBeUndefined();
  });

  it("requires public testnet build metadata and rejects private RPCs", () => {
    expect(
      validateWalletBuildConfig({
        projectId: "a".repeat(32),
        appUrl: "https://testnet.robyn.example",
        rpcUrl: "https://rpc.testnet.chain.robinhood.com",
      }),
    ).toEqual([]);
    expect(
      validateWalletBuildConfig({
        projectId: "bad",
        appUrl: "http://localhost:3000",
        rpcUrl: "http://192.168.50.250:8545",
      }),
    ).toHaveLength(3);
  });
});
