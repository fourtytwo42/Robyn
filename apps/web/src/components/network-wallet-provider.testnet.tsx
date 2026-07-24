"use client";

import "@rainbow-me/rainbowkit/styles.css";
import { useEffect, useMemo, useRef, type ReactNode } from "react";
import {
  RainbowKitProvider,
  darkTheme,
  getDefaultConfig,
} from "@rainbow-me/rainbowkit";
import {
  coinbaseWallet,
  injectedWallet,
  ledgerWallet,
  metaMaskWallet,
  rabbyWallet,
  rainbowWallet,
  safeWallet,
  trustWallet,
  walletConnectWallet,
} from "@rainbow-me/rainbowkit/wallets";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider, http, useAccount } from "wagmi";
import type { Address } from "viem";
import { robinhoodTestnet } from "./robyn-testnet-wallet";
import { shouldInvalidateWalletSession } from "@/lib/wallet-policy";

const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;
const appUrl = process.env.NEXT_PUBLIC_APP_URL;
if (!projectId || !appUrl) {
  throw new Error(
    "Protected testnet builds require NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID and NEXT_PUBLIC_APP_URL.",
  );
}

const config = getDefaultConfig({
  appName: "Sherwood Forest",
  appDescription: "Launch tokens with holder-selected reward baskets.",
  appUrl,
  appIcon: `${appUrl.replace(/\/$/, "")}/assets/brand/sherwood-mark.webp`,
  projectId,
  chains: [robinhoodTestnet],
  transports: {
    [robinhoodTestnet.id]: http(robinhoodTestnet.rpcUrls.default.http[0]),
  },
  multiInjectedProviderDiscovery: true,
  ssr: true,
  wallets: [
    {
      groupName: "Robinhood Wallet via WalletConnect",
      wallets: [walletConnectWallet],
    },
    {
      groupName: "Popular wallets",
      wallets: [
        metaMaskWallet,
        rabbyWallet,
        coinbaseWallet,
        rainbowWallet,
        trustWallet,
      ],
    },
    {
      groupName: "Hardware and multisig",
      wallets: [safeWallet, ledgerWallet],
    },
    {
      groupName: "Other EVM wallets",
      wallets: [injectedWallet],
    },
  ],
});

function WalletSessionBoundary() {
  const { address, status } = useAccount();
  const previous = useRef<Address | undefined>(undefined);
  const initialized = useRef(false);

  useEffect(() => {
    if (status === "connecting" || status === "reconnecting") return;
    if (!initialized.current) {
      previous.current = address;
      initialized.current = true;
      return;
    }
    if (shouldInvalidateWalletSession(previous.current, address)) {
      void fetch("/api/auth/logout", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
      }).finally(() => {
        window.dispatchEvent(
          new CustomEvent("robyn-auth-invalidated", {
            detail: { previousAddress: previous.current },
          }),
        );
      });
    }
    previous.current = address;
  }, [address, status]);

  return null;
}

export function NetworkWalletProvider({ children }: { children: ReactNode }) {
  const queryClient = useMemo(() => new QueryClient(), []);
  return (
    <WagmiProvider config={config} reconnectOnMount>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider
          initialChain={robinhoodTestnet}
          modalSize="compact"
          theme={darkTheme({
            accentColor: "#23d5c3",
            accentColorForeground: "#061514",
            borderRadius: "medium",
            fontStack: "system",
            overlayBlur: "small",
          })}
        >
          <WalletSessionBoundary />
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
