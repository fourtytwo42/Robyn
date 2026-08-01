import type { FastifyInstance } from "fastify";
import {
  getAddress,
  isAddress,
  parseAbi,
  parseAbiItem,
  type Address,
  type PublicClient,
} from "viem";
import { SingleFlightTtlCache } from "./single-flight-cache.js";

type DaoDeployment = {
  schemaVersion?: number;
  deploymentBlock: number;
  liquidityVenue?: "uniswap-v4" | "uniswap-v3";
  rewardStreams?: {
    launchTokenDurationSeconds?: number;
    daoDurationSeconds?: number;
    creatorDurationSeconds?: number;
  };
  contracts: {
    daoToken: Address;
    governor: Address;
    timelock: Address;
    guardian: Address;
    protocolFeeRouter: Address;
    nativeFeeConverter: Address;
  };
};

const daoTokenAbi = parseAbi([
  "function totalSupply() view returns (uint256)",
  "function eligibleRewardSupply() view returns (uint256)",
  "function totalRewardsDeposited() view returns (uint256)",
  "function totalRewardsClaimed() view returns (uint256)",
  "function queuedRewards() view returns (uint256)",
  "function streamingRewards() view returns (uint256)",
  "function totalRewardsVested() view returns (uint256)",
  "function rewardRate() view returns (uint256)",
  "function periodFinish() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function delegates(address) view returns (address)",
  "function getVotes(address) view returns (uint256)",
  "function claimableRewardOf(address) view returns (uint256)",
  "function withdrawnRewards(address) view returns (uint256)",
]);
const routerAbi = parseAbi([
  "function paused() view returns (bool)",
  "function totalCreatorNativeLiability() view returns (uint256)",
  "function totalBasketNativeLiability() view returns (uint256)",
  "function totalDaoNativeLiability() view returns (uint256)",
  "function totalTreasuryNativeLiability() view returns (uint256)",
  "function totalNativeLiabilities() view returns (uint256)",
  "function unattributedNative() view returns (uint256)",
  "function totalDaoNativeRewards() view returns (uint256)",
  "function totalTreasuryNative() view returns (uint256)",
]);
const governorAbi = parseAbi([
  "function votingDelay() view returns (uint256)",
  "function votingPeriod() view returns (uint256)",
  "function proposalThreshold() view returns (uint256)",
  "function quorum(uint256) view returns (uint256)",
  "function state(uint256) view returns (uint8)",
  "function proposalVotes(uint256) view returns (uint256 againstVotes, uint256 forVotes, uint256 abstainVotes)",
  "function hasVoted(uint256,address) view returns (bool)",
  "function unanimousNonce() view returns (uint256)",
]);
const timelockAbi = parseAbi([
  "function getMinDelay() view returns (uint256)",
  "function bootstrapActive() view returns (bool)",
  "function bootstrapDeadline() view returns (uint48)",
  "function nextBootstrapStep() view returns (uint8)",
  "function bootstrapFinalized() view returns (bool)",
  "function bootstrapFinalizationReason() view returns (bytes32)",
  "function bootstrapPlanHash(uint8) view returns (bytes32)",
]);
const proposalCreatedEvent = parseAbiItem(
  "event ProposalCreated(uint256 proposalId, address proposer, address[] targets, uint256[] values, string[] signatures, bytes[] calldatas, uint256 voteStart, uint256 voteEnd, string description)",
);
const voteCastEvent = parseAbiItem(
  "event VoteCast(address indexed voter, uint256 proposalId, uint8 support, uint256 weight, string reason)",
);
const proposalQueuedEvent = parseAbiItem(
  "event ProposalQueued(uint256 proposalId, uint256 etaSeconds)",
);
const proposalExecutedEvent = parseAbiItem(
  "event ProposalExecuted(uint256 proposalId)",
);
const proposalCanceledEvent = parseAbiItem(
  "event ProposalCanceled(uint256 proposalId)",
);
const transferEvent = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)",
);
const launchRegisteredEvent = parseAbiItem(
  "event LaunchRegistered(address indexed token, address indexed creator, address indexed vault, address market, address locker)",
);
const nativeLaunchRegisteredEvent = parseAbiItem(
  "event LaunchRegistered(address indexed token, address indexed creator, address indexed vault, address market, address locker, address hook)",
);
const launchAccountAbi = parseAbi([
  "function launchAccount(address) view returns ((address creator,address vault,address market,address locker,uint256 pendingCreatorBase,uint256 pendingDaoRewardBase,uint256 pendingTreasuryBase,uint256 cumulativeBaseFees,uint256 cumulativeLaunchFeesConverted,uint256 cumulativeNativeConverted,uint256 claimableCreatorNative,uint256 cumulativeCreatorNative,uint256 claimedCreatorNative,bool registered))",
]);
const nativeLaunchAccountAbi = parseAbi([
  "function launchAccount(address) view returns ((address creator,address vault,address market,address locker,address hook,uint256 cumulativeNativeFees,uint256 cumulativeLaunchFeesConverted,uint256 cumulativeBondingNativeFees,uint256 cumulativeLockedLpNativeFees,uint256 cumulativeHookNativeFees,uint256 cumulativeLockedLaunchFeesConverted,uint256 cumulativeHookLaunchFeesConverted,uint256 claimableCreatorNative,uint256 cumulativeCreatorNative,uint256 claimedCreatorNative,uint256 pendingBasketNative,uint256 cumulativeBasketNativeSettled,bool registered))",
  "function creatorFeeSplit(address token) view returns (address[] recipients,uint16[] sharesBps,bool locked)",
  "function claimableCreatorNativeByRecipient(address token,address recipient) view returns (uint256)",
  "function creatorRewardStream(address token,address recipient) view returns ((uint256 claimable,uint256 unvested,uint256 assigned,uint256 vested,uint256 claimed,uint256 ratePerSecond,uint256 lastUpdateTime,uint256 streamEnd))",
  "function cumulativeCreatorNativeByRecipient(address token,address recipient) view returns (uint256)",
  "function claimedCreatorNativeByRecipient(address token,address recipient) view returns (uint256)",
  "function MAX_CREATOR_RECIPIENTS() view returns (uint8)",
]);
const hookFeeStateAbi = parseAbi([
  "function pendingNativeFees(address) view returns (uint256)",
  "function pendingTokenFees(address) view returns (uint256)",
]);
const zeroAddress = "0x0000000000000000000000000000000000000000";
const stateNames = [
  "Pending",
  "Active",
  "Canceled",
  "Defeated",
  "Succeeded",
  "Queued",
  "Expired",
  "Executed",
] as const;
const activityLogLimit = 100;

function accountFromQuery(query: { account?: string }) {
  return query.account && isAddress(query.account)
    ? getAddress(query.account)
    : undefined;
}

async function proposals(
  rpcClient: PublicClient,
  deployment: DaoDeployment,
  account?: Address,
) {
  const address = deployment.contracts.governor;
  const fromBlock = BigInt(deployment.deploymentBlock);
  const [created, votes, queued, executed, canceled] = await Promise.all([
    rpcClient.getLogs({
      address,
      event: proposalCreatedEvent,
      fromBlock,
      strict: true,
    }),
    rpcClient.getLogs({
      address,
      event: voteCastEvent,
      fromBlock,
      strict: true,
    }),
    rpcClient.getLogs({
      address,
      event: proposalQueuedEvent,
      fromBlock,
      strict: true,
    }),
    rpcClient.getLogs({
      address,
      event: proposalExecutedEvent,
      fromBlock,
      strict: true,
    }),
    rpcClient.getLogs({
      address,
      event: proposalCanceledEvent,
      fromBlock,
      strict: true,
    }),
  ]);
  const voteByProposal = new Map<string, typeof votes>();
  for (const vote of votes) {
    const id = vote.args.proposalId.toString();
    voteByProposal.set(id, [...(voteByProposal.get(id) ?? []), vote]);
  }
  const queuedByProposal = new Map(
    queued.map((log) => [log.args.proposalId.toString(), log]),
  );
  const executedIds = new Set(
    executed.map((log) => log.args.proposalId.toString()),
  );
  const canceledIds = new Set(
    canceled.map((log) => log.args.proposalId.toString()),
  );
  return Promise.all(
    created
      .slice()
      .reverse()
      .map(async (log) => {
        const id = log.args.proposalId;
        const [state, tallies, hasVoted] = await Promise.all([
          rpcClient.readContract({
            address,
            abi: governorAbi,
            functionName: "state",
            args: [id],
          }),
          rpcClient.readContract({
            address,
            abi: governorAbi,
            functionName: "proposalVotes",
            args: [id],
          }),
          account
            ? rpcClient.readContract({
                address,
                abi: governorAbi,
                functionName: "hasVoted",
                args: [id, account],
              })
            : Promise.resolve(false),
        ]);
        const proposalVotes = voteByProposal.get(id.toString()) ?? [];
        return {
          id: id.toString(),
          proposer: log.args.proposer,
          title:
            log.args.description.split("\n")[0]?.replace(/^#\s*/, "") ||
            "Untitled proposal",
          description: log.args.description,
          targets: log.args.targets,
          values: log.args.values.map(String),
          calldatas: log.args.calldatas,
          voteStart: log.args.voteStart.toString(),
          voteEnd: log.args.voteEnd.toString(),
          state: stateNames[Number(state)] ?? "Unknown",
          againstVotes: tallies[0].toString(),
          forVotes: tallies[1].toString(),
          abstainVotes: tallies[2].toString(),
          hasVoted,
          eta:
            queuedByProposal.get(id.toString())?.args.etaSeconds.toString() ??
            null,
          executed: executedIds.has(id.toString()),
          canceled: canceledIds.has(id.toString()),
          transactionHash: log.transactionHash,
          votes: proposalVotes.map((vote) => ({
            voter: vote.args.voter,
            support: vote.args.support,
            weight: vote.args.weight.toString(),
            reason: vote.args.reason,
            transactionHash: vote.transactionHash,
          })),
        };
      }),
  );
}

export function registerDaoRoutes(
  app: FastifyInstance,
  rpcClient: PublicClient,
  deployment: DaoDeployment,
) {
  const proposalCache = new SingleFlightTtlCache<
    Awaited<ReturnType<typeof proposals>>
  >(300_000, 64);
  const loadProposals = (account?: Address) =>
    proposalCache.get(account?.toLowerCase() ?? "public", () =>
      proposals(rpcClient, deployment, account),
    );

  app.get<{ Querystring: { account?: string } }>("/dao", async (request) => {
    const account = accountFromQuery(request.query);
    const {
      daoToken,
      governor,
      timelock,
      guardian,
      protocolFeeRouter,
      nativeFeeConverter,
    } = deployment.contracts;
    const block = await rpcClient.getBlock();
    const checkpoint = block.timestamp > 0n ? block.timestamp - 1n : 0n;
    const accountCalls = account
      ? Promise.all([
          rpcClient.readContract({
            address: daoToken,
            abi: daoTokenAbi,
            functionName: "balanceOf",
            args: [account],
          }),
          rpcClient.readContract({
            address: daoToken,
            abi: daoTokenAbi,
            functionName: "delegates",
            args: [account],
          }),
          rpcClient.readContract({
            address: daoToken,
            abi: daoTokenAbi,
            functionName: "getVotes",
            args: [account],
          }),
          rpcClient.readContract({
            address: daoToken,
            abi: daoTokenAbi,
            functionName: "claimableRewardOf",
            args: [account],
          }),
          rpcClient.readContract({
            address: daoToken,
            abi: daoTokenAbi,
            functionName: "withdrawnRewards",
            args: [account],
          }),
        ])
      : Promise.resolve([0n, zeroAddress, 0n, 0n, 0n] as const);
    const registeredLogsPromise = rpcClient.getLogs({
      address: protocolFeeRouter,
      event:
        deployment.liquidityVenue === "uniswap-v4"
          ? nativeLaunchRegisteredEvent
          : launchRegisteredEvent,
      fromBlock: BigInt(deployment.deploymentBlock),
      strict: true,
    });
    const bootstrapPromise =
      deployment.schemaVersion === 17
        ? Promise.all([
            rpcClient.readContract({
              address: timelock,
              abi: timelockAbi,
              functionName: "bootstrapActive",
            }),
            rpcClient.readContract({
              address: timelock,
              abi: timelockAbi,
              functionName: "bootstrapDeadline",
            }),
            rpcClient.readContract({
              address: timelock,
              abi: timelockAbi,
              functionName: "nextBootstrapStep",
            }),
            rpcClient.readContract({
              address: timelock,
              abi: timelockAbi,
              functionName: "bootstrapFinalized",
            }),
            rpcClient.readContract({
              address: timelock,
              abi: timelockAbi,
              functionName: "bootstrapFinalizationReason",
            }),
            rpcClient.readContract({
              address: timelock,
              abi: timelockAbi,
              functionName: "bootstrapPlanHash",
              args: [0],
            }),
            rpcClient.readContract({
              address: timelock,
              abi: timelockAbi,
              functionName: "bootstrapPlanHash",
              args: [1],
            }),
            rpcClient.readContract({
              address: governor,
              abi: governorAbi,
              functionName: "unanimousNonce",
            }),
          ])
        : Promise.resolve(null);
    const [
      totalSupply,
      eligibleRewardSupply,
      totalRewardsDeposited,
      totalRewardsClaimed,
      queuedRewards,
      streamingRewards,
      vestedRewards,
      rewardRate,
      streamEnd,
      paused,
      creatorLiability,
      basketLiability,
      daoLiability,
      treasuryLiability,
      totalNativeLiabilities,
      unattributedNative,
      daoRewards,
      treasuryRewards,
      treasuryBalance,
      votingDelay,
      votingPeriod,
      executionDelay,
      proposalThreshold,
      currentQuorum,
      bootstrapValues,
      accountValues,
      registeredLogs,
    ] = await Promise.all([
      rpcClient.readContract({
        address: daoToken,
        abi: daoTokenAbi,
        functionName: "totalSupply",
      }),
      rpcClient.readContract({
        address: daoToken,
        abi: daoTokenAbi,
        functionName: "eligibleRewardSupply",
      }),
      rpcClient.readContract({
        address: daoToken,
        abi: daoTokenAbi,
        functionName: "totalRewardsDeposited",
      }),
      rpcClient.readContract({
        address: daoToken,
        abi: daoTokenAbi,
        functionName: "totalRewardsClaimed",
      }),
      rpcClient.readContract({
        address: daoToken,
        abi: daoTokenAbi,
        functionName: "queuedRewards",
      }),
      rpcClient.readContract({
        address: daoToken,
        abi: daoTokenAbi,
        functionName: "streamingRewards",
      }),
      rpcClient.readContract({
        address: daoToken,
        abi: daoTokenAbi,
        functionName: "totalRewardsVested",
      }),
      rpcClient.readContract({
        address: daoToken,
        abi: daoTokenAbi,
        functionName: "rewardRate",
      }),
      rpcClient.readContract({
        address: daoToken,
        abi: daoTokenAbi,
        functionName: "periodFinish",
      }),
      rpcClient.readContract({
        address: protocolFeeRouter,
        abi: routerAbi,
        functionName: "paused",
      }),
      rpcClient.readContract({
        address: protocolFeeRouter,
        abi: routerAbi,
        functionName: "totalCreatorNativeLiability",
      }),
      rpcClient.readContract({
        address: protocolFeeRouter,
        abi: routerAbi,
        functionName: "totalBasketNativeLiability",
      }),
      rpcClient.readContract({
        address: protocolFeeRouter,
        abi: routerAbi,
        functionName: "totalDaoNativeLiability",
      }),
      rpcClient.readContract({
        address: protocolFeeRouter,
        abi: routerAbi,
        functionName: "totalTreasuryNativeLiability",
      }),
      rpcClient.readContract({
        address: protocolFeeRouter,
        abi: routerAbi,
        functionName: "totalNativeLiabilities",
      }),
      rpcClient.readContract({
        address: protocolFeeRouter,
        abi: routerAbi,
        functionName: "unattributedNative",
      }),
      rpcClient.readContract({
        address: protocolFeeRouter,
        abi: routerAbi,
        functionName: "totalDaoNativeRewards",
      }),
      rpcClient.readContract({
        address: protocolFeeRouter,
        abi: routerAbi,
        functionName: "totalTreasuryNative",
      }),
      rpcClient.getBalance({ address: timelock }),
      rpcClient.readContract({
        address: governor,
        abi: governorAbi,
        functionName: "votingDelay",
      }),
      rpcClient.readContract({
        address: governor,
        abi: governorAbi,
        functionName: "votingPeriod",
      }),
      rpcClient.readContract({
        address: timelock,
        abi: timelockAbi,
        functionName: "getMinDelay",
      }),
      rpcClient.readContract({
        address: governor,
        abi: governorAbi,
        functionName: "proposalThreshold",
      }),
      rpcClient.readContract({
        address: governor,
        abi: governorAbi,
        functionName: "quorum",
        args: [checkpoint],
      }),
      bootstrapPromise,
      accountCalls,
      registeredLogsPromise,
    ]);
    const launchFees = await Promise.all(
      registeredLogs.map(async (log) => {
        if (deployment.liquidityVenue === "uniswap-v4") {
          const feeAccount = await rpcClient.readContract({
            address: protocolFeeRouter,
            abi: nativeLaunchAccountAbi,
            functionName: "launchAccount",
            args: [log.args.token],
          });
          const [pendingHookNative, pendingHookToken] = await Promise.all([
            rpcClient.readContract({
              address: feeAccount.hook,
              abi: hookFeeStateAbi,
              functionName: "pendingNativeFees",
              args: [log.args.token],
            }),
            rpcClient.readContract({
              address: feeAccount.hook,
              abi: hookFeeStateAbi,
              functionName: "pendingTokenFees",
              args: [log.args.token],
            }),
          ]);
          return {
            token: log.args.token,
            creator: feeAccount.creator,
            vault: feeAccount.vault,
            market: feeAccount.market,
            locker: feeAccount.locker,
            hook: feeAccount.hook,
            pendingHookNative: pendingHookNative.toString(),
            pendingHookToken: pendingHookToken.toString(),
            pendingBasketNative: feeAccount.pendingBasketNative.toString(),
            cumulativeBasketNativeSettled:
              feeAccount.cumulativeBasketNativeSettled.toString(),
            pendingCreatorBase: "0",
            pendingDaoRewardBase: "0",
            pendingTreasuryBase: "0",
            cumulativeBaseFees: feeAccount.cumulativeNativeFees.toString(),
            cumulativeNativeFees: feeAccount.cumulativeNativeFees.toString(),
            cumulativeLaunchFeesConverted:
              feeAccount.cumulativeLaunchFeesConverted.toString(),
            cumulativeBondingNativeFees:
              feeAccount.cumulativeBondingNativeFees.toString(),
            cumulativeLockedLpNativeFees:
              feeAccount.cumulativeLockedLpNativeFees.toString(),
            cumulativeHookNativeFees:
              feeAccount.cumulativeHookNativeFees.toString(),
            cumulativeLockedLaunchFeesConverted:
              feeAccount.cumulativeLockedLaunchFeesConverted.toString(),
            cumulativeHookLaunchFeesConverted:
              feeAccount.cumulativeHookLaunchFeesConverted.toString(),
            cumulativeNativeConverted:
              feeAccount.cumulativeNativeFees.toString(),
            claimableCreatorNative:
              feeAccount.claimableCreatorNative.toString(),
            cumulativeCreatorNative:
              feeAccount.cumulativeCreatorNative.toString(),
            claimedCreatorNative: feeAccount.claimedCreatorNative.toString(),
          };
        }
        const feeAccount = await rpcClient.readContract({
          address: protocolFeeRouter,
          abi: launchAccountAbi,
          functionName: "launchAccount",
          args: [log.args.token],
        });
        return {
          token: log.args.token,
          creator: feeAccount.creator,
          vault: feeAccount.vault,
          market: feeAccount.market,
          locker: feeAccount.locker,
          pendingCreatorBase: feeAccount.pendingCreatorBase.toString(),
          pendingDaoRewardBase: feeAccount.pendingDaoRewardBase.toString(),
          pendingTreasuryBase: feeAccount.pendingTreasuryBase.toString(),
          cumulativeBaseFees: feeAccount.cumulativeBaseFees.toString(),
          cumulativeLaunchFeesConverted:
            feeAccount.cumulativeLaunchFeesConverted.toString(),
          cumulativeNativeConverted:
            feeAccount.cumulativeNativeConverted.toString(),
          claimableCreatorNative: feeAccount.claimableCreatorNative.toString(),
          cumulativeCreatorNative:
            feeAccount.cumulativeCreatorNative.toString(),
          claimedCreatorNative: feeAccount.claimedCreatorNative.toString(),
        };
      }),
    );
    return {
      data: {
        contracts: {
          daoToken,
          governor,
          timelock,
          guardian,
          protocolFeeRouter,
          nativeFeeConverter,
        },
        feePolicy: {
          basketBps: 5000,
          creatorBps: 2500,
          daoRewardsBps: 2000,
          treasuryBps: 500,
        },
        totalSupply: totalSupply.toString(),
        eligibleRewardSupply: eligibleRewardSupply.toString(),
        totalRewardsDeposited: totalRewardsDeposited.toString(),
        totalRewardsClaimed: totalRewardsClaimed.toString(),
        rewardStream: {
          durationSeconds:
            deployment.rewardStreams?.daoDurationSeconds ?? 3_600,
          queued: queuedRewards.toString(),
          streaming: streamingRewards.toString(),
          vested: vestedRewards.toString(),
          claimed: totalRewardsClaimed.toString(),
          ratePerSecond: rewardRate.toString(),
          streamEnd: streamEnd.toString(),
        },
        pendingCreatorLiability: creatorLiability.toString(),
        pendingBasketLiability: basketLiability.toString(),
        pendingDaoLiability: daoLiability.toString(),
        pendingTreasuryLiability: treasuryLiability.toString(),
        totalNativeLiabilities: totalNativeLiabilities.toString(),
        unattributedNative: unattributedNative.toString(),
        totalDaoNativeRewards: daoRewards.toString(),
        totalTreasuryNative: treasuryRewards.toString(),
        treasuryBalance: treasuryBalance.toString(),
        conversionPaused: paused,
        launchFees,
        governance: {
          votingDelaySeconds: votingDelay.toString(),
          votingPeriodSeconds: votingPeriod.toString(),
          executionDelaySeconds: executionDelay.toString(),
          proposalThreshold: proposalThreshold.toString(),
          currentQuorum: currentQuorum.toString(),
        },
        bootstrap: bootstrapValues
          ? {
              active: bootstrapValues[0],
              deadline: bootstrapValues[1].toString(),
              nextStep: Number(bootstrapValues[2]),
              finalized: bootstrapValues[3],
              finalizationReason: bootstrapValues[4],
              planHashes: [bootstrapValues[5], bootstrapValues[6]],
              unanimousNonce: bootstrapValues[7].toString(),
            }
          : null,
        account: account
          ? {
              address: account,
              balance: accountValues[0].toString(),
              delegate: accountValues[1],
              votingPower: accountValues[2].toString(),
              claimableRewards: accountValues[3].toString(),
              lifetimeRewards: accountValues[4].toString(),
            }
          : null,
      },
    };
  });

  app.get<{
    Params: { token: string };
    Querystring: { account?: string };
  }>("/launches/:token/creator-rewards", async (request, reply) => {
    if (!isAddress(request.params.token)) {
      return reply.code(400).send({ error: "invalid_token" });
    }
    if (request.query.account && !isAddress(request.query.account)) {
      return reply.code(400).send({ error: "invalid_account" });
    }
    const token = getAddress(request.params.token);
    const viewer = request.query.account
      ? getAddress(request.query.account)
      : undefined;
    const feeAccount =
      deployment.liquidityVenue === "uniswap-v4"
        ? await rpcClient.readContract({
            address: deployment.contracts.protocolFeeRouter,
            abi: nativeLaunchAccountAbi,
            functionName: "launchAccount",
            args: [token],
          })
        : await rpcClient.readContract({
            address: deployment.contracts.protocolFeeRouter,
            abi: launchAccountAbi,
            functionName: "launchAccount",
            args: [token],
          });
    if (!feeAccount.registered) {
      return reply.code(404).send({ error: "launch_not_found" });
    }
    let claimableNative =
      viewer?.toLowerCase() === feeAccount.creator.toLowerCase()
        ? feeAccount.claimableCreatorNative
        : 0n;
    let lifetimeAccruedNative =
      viewer?.toLowerCase() === feeAccount.creator.toLowerCase()
        ? feeAccount.cumulativeCreatorNative
        : 0n;
    let lifetimeClaimedNative =
      viewer?.toLowerCase() === feeAccount.creator.toLowerCase()
        ? feeAccount.claimedCreatorNative
        : 0n;
    let creatorSplit: {
      recipients: Address[];
      sharesBps: number[];
      locked: boolean;
      maxRecipients: number;
      recipientRewards: Array<{
        recipient: Address;
        shareBps: number;
        claimable: string;
        unvested: string;
        assigned: string;
        vested: string;
        claimed: string;
        ratePerSecond: string;
        lastUpdateTime: string;
        streamEnd: string;
      }>;
    } | null = null;
    let rewardStream = {
      claimable: claimableNative.toString(),
      unvested: "0",
      assigned: lifetimeAccruedNative.toString(),
      vested: (lifetimeClaimedNative + claimableNative).toString(),
      claimed: lifetimeClaimedNative.toString(),
      ratePerSecond: "0",
      lastUpdateTime: "0",
      streamEnd: "0",
    };
    if (deployment.liquidityVenue === "uniswap-v4") {
      const [split, viewerStream, maxRecipients] = await Promise.all([
        rpcClient.readContract({
          address: deployment.contracts.protocolFeeRouter,
          abi: nativeLaunchAccountAbi,
          functionName: "creatorFeeSplit",
          args: [token],
        }),
        viewer
          ? rpcClient.readContract({
              address: deployment.contracts.protocolFeeRouter,
              abi: nativeLaunchAccountAbi,
              functionName: "creatorRewardStream",
              args: [token, viewer],
            })
          : Promise.resolve({
              claimable: 0n,
              unvested: 0n,
              assigned: 0n,
              vested: 0n,
              claimed: 0n,
              ratePerSecond: 0n,
              lastUpdateTime: 0n,
              streamEnd: 0n,
            }),
        rpcClient.readContract({
          address: deployment.contracts.protocolFeeRouter,
          abi: nativeLaunchAccountAbi,
          functionName: "MAX_CREATOR_RECIPIENTS",
        }),
      ]);
      claimableNative = viewerStream.claimable;
      lifetimeAccruedNative = viewerStream.assigned;
      lifetimeClaimedNative = viewerStream.claimed;
      rewardStream = {
        claimable: viewerStream.claimable.toString(),
        unvested: viewerStream.unvested.toString(),
        assigned: viewerStream.assigned.toString(),
        vested: viewerStream.vested.toString(),
        claimed: viewerStream.claimed.toString(),
        ratePerSecond: viewerStream.ratePerSecond.toString(),
        lastUpdateTime: viewerStream.lastUpdateTime.toString(),
        streamEnd: viewerStream.streamEnd.toString(),
      };
      const recipientStreams = await Promise.all(
        split[0].map((recipient) =>
          rpcClient.readContract({
            address: deployment.contracts.protocolFeeRouter,
            abi: nativeLaunchAccountAbi,
            functionName: "creatorRewardStream",
            args: [token, recipient],
          }),
        ),
      );
      creatorSplit = {
        recipients: [...split[0]],
        sharesBps: split[1].map(Number),
        locked: split[2],
        maxRecipients: Number(maxRecipients),
        recipientRewards: split[0].map((recipient, index) => ({
          recipient,
          shareBps: Number(split[1][index]!),
          claimable: recipientStreams[index]!.claimable.toString(),
          unvested: recipientStreams[index]!.unvested.toString(),
          assigned: recipientStreams[index]!.assigned.toString(),
          vested: recipientStreams[index]!.vested.toString(),
          claimed: recipientStreams[index]!.claimed.toString(),
          ratePerSecond: recipientStreams[index]!.ratePerSecond.toString(),
          lastUpdateTime: recipientStreams[index]!.lastUpdateTime.toString(),
          streamEnd: recipientStreams[index]!.streamEnd.toString(),
        })),
      };
    }
    return {
      data: {
        token,
        creator: feeAccount.creator,
        viewerIsCreator:
          viewer?.toLowerCase() === feeAccount.creator.toLowerCase(),
        pendingCreatorBase:
          "pendingCreatorBase" in feeAccount
            ? feeAccount.pendingCreatorBase.toString()
            : "0",
        pendingCreatorNative: "0",
        claimableNative: claimableNative.toString(),
        lifetimeAccruedNative: lifetimeAccruedNative.toString(),
        lifetimeClaimedNative: lifetimeClaimedNative.toString(),
        unlockingNative: rewardStream.unvested,
        rewardStreamDurationSeconds:
          deployment.rewardStreams?.creatorDurationSeconds ?? 3_600,
        rewardStream,
        creatorSplit,
      },
    };
  });

  app.get<{ Querystring: { account?: string } }>(
    "/dao/proposals",
    async (request) => ({
      data: await loadProposals(accountFromQuery(request.query)),
    }),
  );
  app.get<{ Params: { id: string }; Querystring: { account?: string } }>(
    "/dao/proposals/:id",
    async (request, reply) => {
      if (!/^\d+$/.test(request.params.id))
        return reply.code(400).send({ error: "invalid_proposal_id" });
      const data = (await loadProposals(accountFromQuery(request.query))).find(
        (item) => item.id === request.params.id,
      );
      if (!data) return reply.code(404).send({ error: "proposal_not_found" });
      return { data };
    },
  );

  app.get("/dao/members", async () => {
    const logs = await rpcClient.getLogs({
      address: deployment.contracts.daoToken,
      event: transferEvent,
      fromBlock: BigInt(deployment.deploymentBlock),
      strict: true,
    });
    const addresses = new Set<Address>();
    for (const log of logs) {
      if (log.args.from !== zeroAddress)
        addresses.add(getAddress(log.args.from));
      if (log.args.to !== zeroAddress) addresses.add(getAddress(log.args.to));
    }
    const members = await Promise.all(
      [...addresses].slice(0, 2000).map(async (address) => {
        const [balance, delegate, votingPower, claimableRewards] =
          await Promise.all([
            rpcClient.readContract({
              address: deployment.contracts.daoToken,
              abi: daoTokenAbi,
              functionName: "balanceOf",
              args: [address],
            }),
            rpcClient.readContract({
              address: deployment.contracts.daoToken,
              abi: daoTokenAbi,
              functionName: "delegates",
              args: [address],
            }),
            rpcClient.readContract({
              address: deployment.contracts.daoToken,
              abi: daoTokenAbi,
              functionName: "getVotes",
              args: [address],
            }),
            rpcClient.readContract({
              address: deployment.contracts.daoToken,
              abi: daoTokenAbi,
              functionName: "claimableRewardOf",
              args: [address],
            }),
          ]);
        return {
          address,
          balance: balance.toString(),
          delegate,
          votingPower: votingPower.toString(),
          claimableRewards: claimableRewards.toString(),
        };
      }),
    );
    return { data: members.filter((member) => member.balance !== "0") };
  });

  app.get("/dao/activity", async () => {
    const addresses = [
      deployment.contracts.daoToken,
      deployment.contracts.governor,
      deployment.contracts.timelock,
      deployment.contracts.protocolFeeRouter,
      deployment.contracts.nativeFeeConverter,
    ];
    const deploymentBlock = BigInt(deployment.deploymentBlock);
    const logs = await rpcClient.getLogs({
      address: addresses,
      fromBlock: deploymentBlock,
      toBlock: "latest",
    });
    return {
      data: logs
        .slice(-activityLogLimit)
        .reverse()
        .map((log) => ({
          address: log.address,
          blockNumber: log.blockNumber?.toString() ?? null,
          transactionHash: log.transactionHash,
          topic: log.topics[0] ?? null,
        })),
    };
  });
}
