import type { Address } from "viem";
import type { Deployment } from "@/lib/deployment";

export function nativeTradeTarget(
  deployment: Deployment,
  market: Address,
): Address {
  if ((deployment.schemaVersion ?? 0) < 19) return market;
  if (!deployment.contracts.tradeRouter) {
    throw new Error("Schema-19 trade router is unavailable.");
  }
  return deployment.contracts.tradeRouter;
}
