import type { Address, Hex } from "viem";

export type Deployment = {
  schemaVersion?: number;
  chainId: number;
  deploymentBlock?: number;
  environment?: string;
  gitCommit: string;
  deployer?: Address;
  liquidityVenue?: "uniswap-v4" | "uniswap-v3";
  kingOfForestPolicy?: {
    version: string;
    activationBlock: number;
    progressThresholdBps: number;
    minimumUniqueTraders: number;
  };
  venueProvenance?: string;
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
    poolManager?: Address;
    positionManager?: Address;
    maintenanceCoordinator?: Address;
    claimsRouter?: Address;
    tradeRouter?: Address;
    daoRewardDistributor?: Address;
    quoter?: Address;
    permit2?: Address;
    stateView?: Address;
    oracleHook?: Address;
    assetRouter?: Address;
  };
  assetRoutes?: Array<{
    symbol: string;
    address: Address;
    poolId: `0x${string}`;
  }>;
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
    policyVersion?: string;
    policyHash?: string;
    chainlink?: {
      cacheTtlSeconds?: number;
      sequencerUptimeFeed?: Address | null;
      sequencerGracePeriodSeconds?: number;
    };
    v4Venue?: { poolManager?: Address; quoter?: Address };
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
      referencePrice?: {
        kind: "chainlink-usd" | "test-fixture" | "none";
        feedAddress?: Address | null;
        heartbeatSeconds?: number | null;
        oraclePauseCheck?: boolean;
        fixtureUsd?: string | null;
      };
      route?: { kind?: string; ready?: boolean };
      pool?: {
        fee: number;
        tickSpacing: number;
        hooks: Address;
        poolId?: Hex | null;
        zeroForOne?: boolean;
        quoteAmountNativeWei?: string;
      };
    }>;
  };
  maintenancePolicy?: {
    tasksPerUserAction: 1;
    taskGasLimit: string;
    failureObservationSpacingSeconds: number;
    fallbackDelaySeconds: number;
    fallbackAsset: Address;
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
      bootstrapWindowSeconds?: number;
      bootstrapPlanHashes?: [Hex, Hex];
      unanimousTimelockRequired?: boolean;
    };
  };
  genesis?: {
    assets: Address[];
    weightsBps: number[];
  };
};
