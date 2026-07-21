import type { Address } from "viem";

export type Deployment = {
  chainId: number;
  environment?: string;
  gitCommit: string;
  contracts: {
    baseAsset: Address;
    rewardAssets: Address[];
    conversionRouter?: Address;
    factory: Address;
    marketFactory: Address;
    genesisToken: Address;
    genesisVault: Address;
    genesisMarket: Address;
  };
};
