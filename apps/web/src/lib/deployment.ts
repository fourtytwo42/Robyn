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
    launchDeployer?: Address;
    atomicLaunchCoordinator?: Address;
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
    daoToken: Address;
    governor: Address;
    timelock: Address;
    guardian: Address;
    protocolFeeRouter: Address;
    nativeFeeConverter: Address;
  };
  localUniswapV3?: {
    factory: Address;
    positionManager: Address;
    quoter: Address;
    swapRouter: Address;
    wrappedQuoteAsset: Address;
  };
  assetCatalog?: {
    schemaVersion: number;
    snapshotAt: string;
    disclosure: string;
    assets: Array<{
      address: Address;
      symbol: string;
      mockSymbol?: string;
      name: string;
      category: string;
      logoUrl?: string | null;
      verification: string;
      mockOnly: boolean;
      decimals: number;
      referencePriceUsd?: string | null;
    }>;
  };
  dao?: {
    token: { name: string; symbol: string; fixedSupply: string };
    feePolicy: {
      basketBps: number;
      creatorBps: number;
      daoRewardBps: number;
      treasuryBps: number;
    };
    governance: {
      votingDelaySeconds: number;
      votingPeriodSeconds: number;
      executionDelaySeconds: number;
      quorumBps: number;
      proposalThresholdBps: number;
    };
  };
};
