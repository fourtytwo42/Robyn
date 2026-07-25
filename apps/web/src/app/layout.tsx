import type { Metadata } from "next";
import type { ReactNode } from "react";
import type { Deployment } from "@/lib/deployment";
import { NetworkWalletProvider } from "@robyn/network-wallet-provider";
import { NetworkLaunchpadConsole } from "@robyn/network-launchpad";
import deployment from "@robyn/deployment";

import "./globals.css";

const isTestnet = process.env.ROBYN_NETWORK_MODE === "testnet";
export const metadata: Metadata = {
  title: isTestnet
    ? "Sherwood Forest | Robinhood Testnet"
    : "Sherwood Forest | Controlled Network",
  description: isTestnet
    ? "Launch and discover tokens with community-selected reward baskets on Robinhood Chain Testnet."
    : "Launch and discover tokens with community-selected reward baskets on the controlled development network.",
  icons: {
    icon: "/favicon.ico",
    apple: "/apple-icon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main">
          Skip to main content
        </a>
        <NetworkWalletProvider>
          {children}
          <NetworkLaunchpadConsole
            deployment={deployment as Deployment}
            showRegistry={false}
            modalOnly
          />
        </NetworkWalletProvider>
      </body>
    </html>
  );
}
