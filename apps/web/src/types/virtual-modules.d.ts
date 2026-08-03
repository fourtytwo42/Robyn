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
    modalOnly?: boolean;
  }): JSX.Element;
}

declare module "@robyn/network-portfolio" {
  import type { Address } from "viem";
  export function NetworkPortfolioView(props: {
    account?: Address;
    readOnly?: boolean;
  }): JSX.Element;
}

declare module "@robyn/network-portfolio-access" {
  import type { Deployment } from "@/lib/deployment";
  export function NetworkPortfolioNavigation(props: {
    deployment: Deployment;
  }): JSX.Element | null;
}

declare module "@robyn/network-creator-portfolio" {
  import type { Address } from "viem";
  export function NetworkCreatorPortfolio(props: {
    account?: Address;
    readOnly?: boolean;
  }): JSX.Element | null;
}

declare module "@robyn/network-creator-rewards" {
  import type { Address } from "viem";
  export function NetworkCreatorRewardsPanel(props: {
    token: Address;
    creator: Address;
  }): JSX.Element | null;
}

declare module "@robyn/network-holder-rewards" {
  import type { Address } from "viem";
  export function NetworkHolderRewardsPanel(props: {
    token: Address;
    symbol: string;
    claimsRouter?: Address;
  }): JSX.Element;
}

declare module "@robyn/network-dao" {
  import type { Deployment } from "@/lib/deployment";
  export function NetworkDaoView(props: {
    deployment: Deployment;
    proposalId?: string;
  }): JSX.Element;
}

declare module "@robyn/network-dao-access" {
  import type { ReactNode } from "react";
  import type { Deployment } from "@/lib/deployment";
  export function NetworkDaoNavigation(props: {
    deployment: Deployment;
  }): JSX.Element | null;
  export function NetworkDaoAccessGate(props: {
    deployment: Deployment;
    children: ReactNode;
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
