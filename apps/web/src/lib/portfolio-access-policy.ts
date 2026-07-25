import type { Address } from "viem";

export type PortfolioAccess =
  | { mode: "connected"; href: "/portfolio" }
  | { mode: "uat-read-only"; href: `/users/${Address}` }
  | { mode: "hidden"; href: null };

export function resolvePortfolioAccess(
  connectedAccount?: Address,
  configuredUatAddress?: Address,
  requestedUatAddress?: string | null,
): PortfolioAccess {
  if (connectedAccount) return { mode: "connected", href: "/portfolio" };
  if (
    configuredUatAddress &&
    requestedUatAddress?.toLowerCase() === configuredUatAddress.toLowerCase()
  ) {
    return {
      mode: "uat-read-only",
      href: `/users/${configuredUatAddress}`,
    };
  }
  return { mode: "hidden", href: null };
}
