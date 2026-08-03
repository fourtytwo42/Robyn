import { describe, expect, it } from "vitest";
import type { Address } from "viem";
import type { Deployment } from "@/lib/deployment";
import { nativeTradeTarget } from "./schema19-trade-policy";

const market = "0x0000000000000000000000000000000000000011" as Address;
const tradeRouter = "0x0000000000000000000000000000000000000019" as Address;

function deployment(schemaVersion: number, router?: Address) {
  return {
    schemaVersion,
    contracts: { tradeRouter: router },
  } as Deployment;
}

describe("Schema-19 trade submission policy", () => {
  it("routes every native Schema-19 trade through the maintenance-aware router", () => {
    expect(nativeTradeTarget(deployment(19, tradeRouter), market)).toBe(
      tradeRouter,
    );
  });

  it("fails closed when a Schema-19 manifest omits the trade router", () => {
    expect(() => nativeTradeTarget(deployment(19), market)).toThrow(
      "Schema-19 trade router is unavailable.",
    );
  });

  it("preserves the direct market path for archived schemas", () => {
    expect(nativeTradeTarget(deployment(18), market)).toBe(market);
  });
});
