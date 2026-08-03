import type { Metadata } from "next";
import type { ReactNode } from "react";
import type { Deployment } from "@/lib/deployment";
import { createSiteMetadata } from "@/lib/site-metadata";
import { NetworkWalletProvider } from "@robyn/network-wallet-provider";
import { NetworkLaunchpadConsole } from "@robyn/network-launchpad";
import deployment from "@robyn/deployment";
import { publicEnvironment } from "@/lib/public-environment";

import "./globals.css";

export const metadata: Metadata = createSiteMetadata(publicEnvironment);

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
