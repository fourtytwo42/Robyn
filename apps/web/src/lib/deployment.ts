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
    adapterDeployer?: Address;
    marketDeployer?: Address;
    legacyMarketFactories?: Address[];
    bondingMarketFactory?: Address;
    genesisToken: Address;
    genesisVault: Address;
    genesisMarket: Address;
    genesisGraduationAdapter?: Address;
    genesisPositionLocker?: Address;
    genesisGraduatedPool?: Address;
  };
  localUniswapV3?: {
    factory: Address;
    positionManager: Address;
    quoter: Address;
    swapRouter: Address;
    wrappedQuoteAsset: Address;
  };
};
