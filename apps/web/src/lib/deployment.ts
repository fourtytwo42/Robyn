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
    legacyMarketFactories?: Address[];
    bondingMarketFactory?: Address;
    genesisToken: Address;
    genesisVault: Address;
    genesisMarket: Address;
    genesisGraduatedPool?: Address;
  };
};
