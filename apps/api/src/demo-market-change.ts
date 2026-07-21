import type { Address } from "viem";

const MIN_CHANGE_BPS = 125;
const CHANGE_RANGE_BPS = 1_676;

export function isDemoMarketChangeEnabled(chainId: number, flag?: string) {
  return chainId === 31337 && flag === "true";
}

export function demoMarketChangeBps(token: Address) {
  const seed = Number.parseInt(token.slice(-8), 16);
  const magnitude = MIN_CHANGE_BPS + (seed % CHANGE_RANGE_BPS);
  return seed % 2 === 0 ? magnitude : -magnitude;
}
