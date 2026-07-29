"use client";

import { useCallback, useEffect, useRef } from "react";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import {
  useAccount,
  useDisconnect,
  usePublicClient,
  useSwitchChain,
  useWalletClient,
} from "wagmi";
import {
  createPublicClient,
  defineChain,
  http,
  type Account,
  type Address,
  type Transport,
  type WalletClient,
} from "viem";
import {
  getWalletWriteState,
  normalizeWalletError,
  walletErrorCode,
} from "@/lib/wallet-policy";
import { publicEnvironment } from "@/lib/public-environment";

export const ROBINHOOD_TESTNET_FAUCET_URL = publicEnvironment.faucetUrl;

export const robinhoodTestnet = defineChain({
  id: publicEnvironment.chainId,
  name: publicEnvironment.chainName,
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: {
      http: [publicEnvironment.rpcUrl],
    },
  },
  blockExplorers: {
    default: {
      name: `${publicEnvironment.networkLabel} Explorer`,
      url: publicEnvironment.explorerUrl,
    },
  },
  iconUrl: "/assets/brand/sherwood-hood.webp",
  testnet: publicEnvironment.isTestnet,
});

export const robynTestnetPublicClient = createPublicClient({
  chain: robinhoodTestnet,
  transport: http(robinhoodTestnet.rpcUrls.default.http[0]),
});

type RobynWalletClient = WalletClient<
  Transport,
  typeof robinhoodTestnet,
  Account
>;

export function useRobynTestnetWallet() {
  const accountState = useAccount();
  const automaticSwitchAttempt = useRef<string | undefined>(undefined);
  const { data: walletClient } = useWalletClient({
    chainId: publicEnvironment.chainId,
  });
  const publicClient = usePublicClient({
    chainId: publicEnvironment.chainId,
  });
  const { openConnectModal } = useConnectModal();
  const { switchChainAsync } = useSwitchChain();
  const { disconnectAsync } = useDisconnect();
  const writeState = getWalletWriteState(
    accountState.address,
    accountState.chainId,
    publicEnvironment.chainId,
  );

  const connect = useCallback(async () => {
    if (!openConnectModal) throw new Error("Wallet selection is not ready.");
    openConnectModal();
  }, [openConnectModal]);

  const switchToRobinhoodTestnet = useCallback(async () => {
    try {
      await switchChainAsync({ chainId: publicEnvironment.chainId });
    } catch (error) {
      const provider = await accountState.connector?.getProvider();
      const candidate = provider as
        | {
            request?: (request: {
              method: string;
              params?: unknown[];
            }) => Promise<unknown>;
          }
        | undefined;
      const code = walletErrorCode(error);
      if (code === 4902 && candidate?.request) {
        await candidate.request({
          method: "wallet_addEthereumChain",
          params: [
            {
              chainId: `0x${publicEnvironment.chainId.toString(16)}`,
              chainName: robinhoodTestnet.name,
              nativeCurrency: robinhoodTestnet.nativeCurrency,
              rpcUrls: [...robinhoodTestnet.rpcUrls.default.http],
              blockExplorerUrls: [robinhoodTestnet.blockExplorers.default.url],
            },
          ],
        });
        await switchChainAsync({ chainId: publicEnvironment.chainId });
        return;
      }
      throw new Error(normalizeWalletError(error), { cause: error });
    }
  }, [accountState.connector, switchChainAsync]);

  useEffect(() => {
    if (
      !accountState.isConnected ||
      !accountState.address ||
      !accountState.chainId
    ) {
      automaticSwitchAttempt.current = undefined;
      return;
    }
    if (accountState.chainId === publicEnvironment.chainId) {
      automaticSwitchAttempt.current = undefined;
      return;
    }
    const key = `${accountState.connector?.id ?? "wallet"}:${accountState.address}:${accountState.chainId}`;
    if (automaticSwitchAttempt.current === key) return;
    automaticSwitchAttempt.current = key;
    void switchToRobinhoodTestnet().catch(() => undefined);
  }, [
    accountState.address,
    accountState.chainId,
    accountState.connector?.id,
    accountState.isConnected,
    switchToRobinhoodTestnet,
  ]);

  const disconnect = useCallback(async () => {
    await disconnectAsync();
  }, [disconnectAsync]);

  return {
    account: accountState.address as Address | undefined,
    chainId: accountState.chainId,
    connectorId: accountState.connector?.id,
    connectorName: accountState.connector?.name,
    isConnected: accountState.isConnected,
    isConnecting: accountState.isConnecting || accountState.isReconnecting,
    isWrongChain: writeState === "wrong-chain",
    writeState,
    publicClient: publicClient ?? robynTestnetPublicClient,
    walletClient: walletClient as RobynWalletClient | undefined,
    connect,
    switchToRobinhoodTestnet,
    disconnect,
  };
}
