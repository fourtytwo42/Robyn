import { getAddress, type Address } from "viem";
import { publicEnvironment } from "./public-environment";

export const ROBINHOOD_TESTNET_CHAIN_ID = 46630;

export type WalletWriteState = "disconnected" | "wrong-chain" | "ready";

export function normalizeWalletAddress(
  address: string | undefined,
): Address | undefined {
  if (!address) return undefined;
  return getAddress(address);
}

export function getWalletWriteState(
  address: string | undefined,
  chainId: number | undefined,
  expectedChainId = ROBINHOOD_TESTNET_CHAIN_ID,
): WalletWriteState {
  if (!address) return "disconnected";
  return chainId === expectedChainId ? "ready" : "wrong-chain";
}

export function shouldInvalidateWalletSession(
  previousAddress: string | undefined,
  nextAddress: string | undefined,
): boolean {
  if (!previousAddress) return false;
  return previousAddress.toLowerCase() !== nextAddress?.toLowerCase();
}
export function walletErrorCode(error: unknown, depth = 0): number | undefined {
  if (depth > 4 || typeof error !== "object" || error === null)
    return undefined;
  const value = error as { code?: unknown; cause?: unknown; details?: unknown };
  if (typeof value.code === "number") return value.code;
  if (typeof value.code === "string" && /^-?\d+$/.test(value.code)) {
    return Number(value.code);
  }
  return (
    walletErrorCode(value.cause, depth + 1) ??
    walletErrorCode(value.details, depth + 1)
  );
}

export function normalizeWalletError(error: unknown): string {
  const value = error as {
    code?: number;
    name?: string;
    message?: string;
    shortMessage?: string;
  };
  const message = value?.shortMessage ?? value?.message ?? "";
  const code = walletErrorCode(error);
  if (code === 4001 || /user rejected|user denied/i.test(message)) {
    return "The wallet request was rejected.";
  }
  if (
    /unsupported chain|chain not configured|unrecognized chain/i.test(message)
  ) {
    return `This wallet does not currently support ${publicEnvironment.chainName}.`;
  }
  if (/timeout|timed out|relay/i.test(message)) {
    return "The wallet connection timed out. Reopen the wallet and try again.";
  }
  if (/disconnected|stale session/i.test(message)) {
    return "The wallet session disconnected. Connect again to continue.";
  }
  if (/rpc|network request|fetch failed/i.test(message)) {
    return `The public ${publicEnvironment.chainName} RPC is unavailable. Try again shortly.`;
  }
  return message || "The wallet request failed.";
}

export function validateWalletBuildConfig(config: {
  projectId?: string;
  appUrl?: string;
  rpcUrl?: string;
}): string[] {
  const errors: string[] = [];
  if (!/^[a-f0-9]{32}$/i.test(config.projectId ?? "")) {
    errors.push(
      "NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID must be a 32-character project ID.",
    );
  }
  try {
    if (!config.appUrl || new URL(config.appUrl).protocol !== "https:") {
      errors.push("NEXT_PUBLIC_APP_URL must be an HTTPS URL.");
    }
  } catch {
    errors.push("NEXT_PUBLIC_APP_URL must be an HTTPS URL.");
  }
  try {
    const rpc = new URL(config.rpcUrl ?? "");
    const forbidden =
      rpc.protocol !== "https:" ||
      rpc.hostname === "localhost" ||
      rpc.hostname === "127.0.0.1" ||
      rpc.hostname === "::1" ||
      /^10\./.test(rpc.hostname) ||
      /^192\.168\./.test(rpc.hostname) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(rpc.hostname);
    if (forbidden) {
      errors.push("NEXT_PUBLIC_ROBYN_RPC_URL must be a public HTTPS RPC URL.");
    }
  } catch {
    errors.push("NEXT_PUBLIC_ROBYN_RPC_URL must be a public HTTPS RPC URL.");
  }
  return errors;
}
