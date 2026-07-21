import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";

const isTestnet = process.env.ROBYN_NETWORK_MODE === "testnet";
export const metadata: Metadata = {
  title: isTestnet ? "Robyn | Robinhood Testnet" : "Robyn | Controlled Network",
  description: isTestnet
    ? "Launch and discover tokens with holder reward baskets on Robinhood Chain Testnet."
    : "Launch and discover tokens with holder reward baskets on the controlled Robyn development network.",
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
        {children}
      </body>
    </html>
  );
}
