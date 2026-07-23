declare module "@robyn/deployment" {
  import type { Deployment } from "@/lib/deployment";
  const deployment: Deployment;
  export default deployment;
}

declare module "@robyn/network-console" {
  import type { Deployment } from "@/lib/deployment";
  export function NetworkConsole(props: {
    deployment: Deployment;
  }): JSX.Element;
}

declare module "@robyn/network-launchpad" {
  import type { Deployment } from "@/lib/deployment";
  export function NetworkLaunchpadConsole(props: {
    deployment: Deployment;
    openByDefault?: boolean;
    showRegistry?: boolean;
  }): JSX.Element;
}

declare module "@robyn/network-portfolio" {
  export function NetworkPortfolioView(): JSX.Element;
}

declare module "@robyn/network-creator-portfolio" {
  export function NetworkCreatorPortfolio(): JSX.Element | null;
}

declare module "@robyn/network-creator-rewards" {
  import type { Address } from "viem";
  export function NetworkCreatorRewardsPanel(props: {
    token: Address;
    creator: Address;
  }): JSX.Element | null;
}

declare module "@robyn/network-dao" {
  import type { Deployment } from "@/lib/deployment";
  export function NetworkDaoView(props: {
    deployment: Deployment;
    proposalId?: string;
  }): JSX.Element;
}

declare module "@robyn/network-token-trade" {
  import type { Address } from "viem";
  import type { Deployment } from "@/lib/deployment";
  export function NetworkTokenTradePanel(props: {
    deployment: Deployment;
    token: Address;
    market: Address;
    symbol: string;
    feeBps: number;
    basePerToken: string;
    marketPhase: "legacy_fixed" | "bonding" | "graduated";
  }): JSX.Element;
}

declare module "@robyn/network-wallet-provider" {
  import type { ReactNode } from "react";
  export function NetworkWalletProvider(props: {
    children: ReactNode;
  }): JSX.Element;
}

declare module "@robyn/network-wallet-control" {
  export function NetworkWalletControl(): JSX.Element;
}
