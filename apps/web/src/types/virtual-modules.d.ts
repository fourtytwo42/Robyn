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
