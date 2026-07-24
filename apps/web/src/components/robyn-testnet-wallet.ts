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
  ROBINHOOD_TESTNET_CHAIN_ID,
  walletErrorCode,
} from "@/lib/wallet-policy";

export const ROBINHOOD_TESTNET_FAUCET_URL =
  "https://faucet.testnet.chain.robinhood.com";

export const robinhoodTestnet = defineChain({
  id: ROBINHOOD_TESTNET_CHAIN_ID,
  name: "Robinhood Chain Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: {
      http: [
        process.env.NEXT_PUBLIC_ROBYN_RPC_URL ??
          "https://rpc.testnet.chain.robinhood.com",
      ],
    },
  },
  blockExplorers: {
    default: {
      name: "Robinhood Testnet Explorer",
      url:
        process.env.NEXT_PUBLIC_ROBYN_EXPLORER_URL ??
        "https://explorer.testnet.chain.robinhood.com",
    },
  },
  iconUrl: "/assets/brand/sherwood-mark.webp",
  testnet: true,
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
    chainId: ROBINHOOD_TESTNET_CHAIN_ID,
  });
  const publicClient = usePublicClient({
    chainId: ROBINHOOD_TESTNET_CHAIN_ID,
  });
  const { openConnectModal } = useConnectModal();
  const { switchChainAsync } = useSwitchChain();
  const { disconnectAsync } = useDisconnect();
  const writeState = getWalletWriteState(
    accountState.address,
    accountState.chainId,
  );

  const connect = useCallback(async () => {
    if (!openConnectModal) throw new Error("Wallet selection is not ready.");
    openConnectModal();
  }, [openConnectModal]);

  const switchToRobinhoodTestnet = useCallback(async () => {
    try {
      await switchChainAsync({ chainId: ROBINHOOD_TESTNET_CHAIN_ID });
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
              chainId: `0x${ROBINHOOD_TESTNET_CHAIN_ID.toString(16)}`,
              chainName: robinhoodTestnet.name,
              nativeCurrency: robinhoodTestnet.nativeCurrency,
              rpcUrls: [...robinhoodTestnet.rpcUrls.default.http],
              blockExplorerUrls: [robinhoodTestnet.blockExplorers.default.url],
            },
          ],
        });
        await switchChainAsync({ chainId: ROBINHOOD_TESTNET_CHAIN_ID });
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
    if (accountState.chainId === ROBINHOOD_TESTNET_CHAIN_ID) {
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
