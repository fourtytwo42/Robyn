import type { Metadata } from "next";
import type { ReactNode } from "react";
import type { Deployment } from "@/lib/deployment";
import { NetworkWalletProvider } from "@robyn/network-wallet-provider";
import { NetworkLaunchpadConsole } from "@robyn/network-launchpad";
import deployment from "@robyn/deployment";
import { publicEnvironment } from "@/lib/public-environment";

import "./globals.css";

export const metadata: Metadata = {
  title: `Sherwood Forest | ${publicEnvironment.networkLabel}`,
  description: `Launch and discover tokens with community-selected reward baskets on ${publicEnvironment.chainName}.`,
  metadataBase: new URL(publicEnvironment.appUrl),
  icons: {
    icon: "/favicon.ico?v=3",
    apple: "/apple-icon.png?v=3",
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
