import type { FastifyInstance } from "fastify";
import type { createDatabase } from "@robyn/db";
import {
  getAddress,
  isAddress,
  parseAbi,
  parseAbiItem,
  toEventSelector,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import {
  deriveRdaoMarketAnalytics,
  type RdaoAnalyticsLog,
} from "./rdao-market-analytics.js";

type SqlClient = ReturnType<typeof createDatabase>["sql"];

type Schema20Deployment = {
  schemaVersion?: number;
  contracts: {
    daoToken: Address;
    governor: Address;
    timelock: Address;
    rdaoSale?: Address;
    rdaoStaking?: Address;
    rdaoLiquidityLocker?: Address;
    wrappedNative?: Address;
    poolManager?: Address;
  };
  rdao?: {
    allocation: { retained: string; sale: string; liquidity: string };
    pricing: {
      ethUsdFixture: string;
      ownerTargetUsd: string;
      liquidityTargetUsd: string;
    };
    staking: {
      warmupSeconds: number;
      rewardDurationSeconds: number;
      zeroSupplyDurationSeconds: number;
    };
  };
};

const saleAbi = parseAbi([
  "function saleInventory() view returns (uint256)",
  "function liquidityInventory() view returns (uint256)",
  "function sold() view returns (uint256)",
  "function curvePrincipal() view returns (uint256)",
  "function curvePrincipalTarget() view returns (uint256)",
  "function deployerPayout() view returns (uint256)",
  "function liquidityNative() view returns (uint256)",
  "function totalBondingFees() view returns (uint256)",
  "function totalFeesSettled() view returns (uint256)",
  "function pendingStakingFees() view returns (uint256)",
  "function buysPaused() view returns (bool)",
  "function finalized() view returns (bool)",
  "function graduationReady() view returns (bool)",
  "function currentPriceE18() view returns (uint256)",
  "function terminalPriceE18() view returns (uint256)",
]);
const stakingAbi = parseAbi([
  "function paused() view returns (bool)",
  "function totalPrincipal() view returns (uint256)",
  "function totalEligibleStake() view returns (uint256)",
  "function totalWarmingStake() view returns (uint256)",
  "function queuedRewards() view returns (uint256)",
  "function totalRewardsDeposited() view returns (uint256)",
  "function totalRewardsClaimed() view returns (uint256)",
  "function outstandingLiability() view returns (uint256)",
  "function ordinaryStream() view returns (uint64 start,uint64 end,uint64 lastUpdate,uint256 total,uint256 released)",
  "function zeroSupplyStream() view returns (uint64 start,uint64 end,uint64 lastUpdate,uint256 total,uint256 released)",
  "function position(address) view returns (address escrow,uint256 eligible,uint256 warming,uint256 activationTime,address delegatee,uint256 claimable)",
]);
const lockerAbi = parseAbi([
  "function initialized() view returns (bool)",
  "function poolId() view returns (bytes32)",
  "function principalLiquidity() view returns (uint128)",
  "function principalWethUsed() view returns (uint256)",
  "function principalRdaoUsed() view returns (uint256)",
  "function lockedRdaoResidual() view returns (uint256)",
  "function cumulativeWethFees() view returns (uint256)",
  "function cumulativeRdaoFees() view returns (uint256)",
  "function cumulativeWethRewardsDeposited() view returns (uint256)",
]);
const tokenAbi = parseAbi([
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function delegates(address) view returns (address)",
  "function getVotes(address) view returns (uint256)",
]);

const transferTopic = toEventSelector(
  parseAbiItem(
    "event Transfer(address indexed from,address indexed to,uint256 value)",
  ),
).toLowerCase();
const boughtTopic = toEventSelector(
  parseAbiItem(
    "event Bought(address indexed buyer,address indexed recipient,uint256 principal,uint256 fee,uint256 tokensOut,uint256 refund,uint256 cumulativeSold)",
  ),
).toLowerCase();
const soldTopic = toEventSelector(
  parseAbiItem(
    "event Sold(address indexed seller,address indexed recipient,uint256 tokensIn,uint256 principalOut,uint256 fee,uint256 nativeOut,uint256 cumulativeSold)",
  ),
).toLowerCase();
const escrowCreatedTopic = toEventSelector(
  parseAbiItem(
    "event EscrowCreated(address indexed account,address indexed escrow,address indexed delegatee)",
  ),
).toLowerCase();
const poolSwapTopic = toEventSelector(
  parseAbiItem(
    "event Swap(bytes32 indexed id,address indexed sender,int128 amount0,int128 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick,uint24 fee)",
  ),
).toLowerCase();

const zeroAddress = "0x0000000000000000000000000000000000000000" as Address;

export function registerRdaoRoutes(
  app: FastifyInstance,
  rpcClient: PublicClient,
  deployment: Schema20Deployment,
  sql: SqlClient,
  chainId: number,
) {
  app.get<{ Querystring: { account?: string } }>(
    "/rdao",
    async (request, reply) => {
      const { rdaoSale, rdaoStaking, rdaoLiquidityLocker } =
        deployment.contracts;
      if (
        deployment.schemaVersion !== 20 ||
        !rdaoSale ||
        !rdaoStaking ||
        !rdaoLiquidityLocker
      ) {
        return reply.code(404).send({ error: "schema20_rdao_unavailable" });
      }
      const account =
        request.query.account && isAddress(request.query.account)
          ? getAddress(request.query.account)
          : undefined;
      const saleReads = [
        "saleInventory",
        "liquidityInventory",
        "sold",
        "curvePrincipal",
        "curvePrincipalTarget",
        "deployerPayout",
        "liquidityNative",
        "totalBondingFees",
        "totalFeesSettled",
        "pendingStakingFees",
        "buysPaused",
        "finalized",
        "graduationReady",
        "currentPriceE18",
        "terminalPriceE18",
      ] as const;
      const stakingReads = [
        "paused",
        "totalPrincipal",
        "totalEligibleStake",
        "totalWarmingStake",
        "queuedRewards",
        "totalRewardsDeposited",
        "totalRewardsClaimed",
        "outstandingLiability",
        "ordinaryStream",
        "zeroSupplyStream",
      ] as const;
      const lockerReads = [
        "initialized",
        "poolId",
        "principalLiquidity",
        "principalWethUsed",
        "principalRdaoUsed",
        "lockedRdaoResidual",
        "cumulativeWethFees",
        "cumulativeRdaoFees",
        "cumulativeWethRewardsDeposited",
      ] as const;
      const [saleValues, stakingValues, lockerValues, supply, accountValues] =
        await Promise.all([
          Promise.all(
            saleReads.map((functionName) =>
              rpcClient.readContract({
                address: rdaoSale,
                abi: saleAbi,
                functionName,
              }),
            ),
          ),
          Promise.all(
            stakingReads.map((functionName) =>
              rpcClient.readContract({
                address: rdaoStaking,
                abi: stakingAbi,
                functionName,
              }),
            ),
          ),
          Promise.all(
            lockerReads.map((functionName) =>
              rpcClient.readContract({
                address: rdaoLiquidityLocker,
                abi: lockerAbi,
                functionName,
              }),
            ),
          ),
          rpcClient.readContract({
            address: deployment.contracts.daoToken,
            abi: tokenAbi,
            functionName: "totalSupply",
          }),
          account
            ? Promise.all([
                rpcClient.readContract({
                  address: deployment.contracts.daoToken,
                  abi: tokenAbi,
                  functionName: "balanceOf",
                  args: [account],
                }),
                rpcClient.readContract({
                  address: deployment.contracts.daoToken,
                  abi: tokenAbi,
                  functionName: "delegates",
                  args: [account],
                }),
                rpcClient.readContract({
                  address: deployment.contracts.daoToken,
                  abi: tokenAbi,
                  functionName: "getVotes",
                  args: [account],
                }),
                rpcClient.readContract({
                  address: rdaoStaking,
                  abi: stakingAbi,
                  functionName: "position",
                  args: [account],
                }),
                deployment.contracts.wrappedNative
                  ? rpcClient.readContract({
                      address: deployment.contracts.wrappedNative,
                      abi: tokenAbi,
                      functionName: "balanceOf",
                      args: [account],
                    })
                  : Promise.resolve(0n),
              ])
            : Promise.resolve([
                0n,
                zeroAddress,
                0n,
                [zeroAddress, 0n, 0n, 0n, zeroAddress, 0n],
                0n,
              ] as const),
        ]);
      const sale = Object.fromEntries(
        saleReads.map((key, index) => [
          key,
          typeof saleValues[index] === "bigint"
            ? saleValues[index].toString()
            : saleValues[index],
        ]),
      );
      const staking = Object.fromEntries(
        stakingReads.map((key, index) => {
          const value = stakingValues[index];
          return [
            key,
            Array.isArray(value)
              ? value.map((item) =>
                  typeof item === "bigint" ? item.toString() : item,
                )
              : typeof value === "bigint"
                ? value.toString()
                : value,
          ];
        }),
      );
      const liquidity = Object.fromEntries(
        lockerReads.map((key, index) => [
          key,
          typeof lockerValues[index] === "bigint"
            ? lockerValues[index].toString()
            : lockerValues[index],
        ]),
      );
      const position = accountValues[3] as readonly [
        Address,
        bigint,
        bigint,
        bigint,
        Address,
        bigint,
      ];
      const poolId = lockerValues[1] as Hex;
      const analyticsLogs = await sql.unsafe<RdaoAnalyticsLog[]>(
        "SELECT l.block_number::text,l.transaction_hash,l.log_index,l.address,l.topics,l.data,b.timestamp::text FROM raw_logs l JOIN chain_blocks b ON b.chain_id=l.chain_id AND b.number=l.block_number AND b.hash=l.block_hash AND b.canonical=true WHERE l.chain_id=$1 AND ((lower(l.address)=$2 AND l.topics->>0=$3) OR (lower(l.address)=$4 AND l.topics->>0=ANY($5::text[])) OR (lower(l.address)=$6 AND l.topics->>0=$7) OR ($8::text IS NOT NULL AND lower(l.address)=$8 AND l.topics->>0=$9 AND l.topics->>1=$10)) ORDER BY l.block_number,l.transaction_index,l.log_index LIMIT 10001",
        [
          chainId,
          deployment.contracts.daoToken.toLowerCase(),
          transferTopic,
          rdaoSale.toLowerCase(),
          [boughtTopic, soldTopic],
          rdaoStaking.toLowerCase(),
          escrowCreatedTopic,
          deployment.contracts.poolManager?.toLowerCase() ?? null,
          poolSwapTopic,
          poolId.toLowerCase(),
        ],
      );
      if (analyticsLogs.length >= 10_001) {
        return reply.code(503).send({
          error: "rdao_analytics_capacity_exceeded",
          message: "RDAO market history exceeds the bounded canonical query.",
        });
      }
      const market = deriveRdaoMarketAnalytics({
        contracts: {
          token: deployment.contracts.daoToken,
          sale: rdaoSale,
          staking: rdaoStaking,
          liquidityLocker: rdaoLiquidityLocker,
          wrappedNative: deployment.contracts.wrappedNative,
          poolManager: deployment.contracts.poolManager,
        },
        logs: analyticsLogs,
        totalSupply: supply,
        poolId,
      });
      return {
        data: {
          contracts: {
            token: deployment.contracts.daoToken,
            sale: rdaoSale,
            staking: rdaoStaking,
            liquidityLocker: rdaoLiquidityLocker,
            governor: deployment.contracts.governor,
            timelock: deployment.contracts.timelock,
            wrappedNative: deployment.contracts.wrappedNative,
          },
          policy: deployment.rdao ?? null,
          totalSupply: supply.toString(),
          sale,
          staking,
          liquidity,
          market,
          account: account
            ? {
                address: account,
                liquidBalance: accountValues[0].toString(),
                liquidDelegate: accountValues[1],
                votingPower: accountValues[2].toString(),
                escrow: position[0],
                eligibleStake: position[1].toString(),
                warmingStake: position[2].toString(),
                activationTime: position[3].toString(),
                stakeDelegate: position[4],
                claimableWeth: position[5].toString(),
                wethBalance: accountValues[4].toString(),
              }
            : null,
        },
      };
    },
  );
}
