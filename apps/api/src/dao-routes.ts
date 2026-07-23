import type { FastifyInstance } from "fastify";
import {
  getAddress,
  isAddress,
  parseAbi,
  parseAbiItem,
  type Address,
  type PublicClient,
} from "viem";

type DaoDeployment = {
  deploymentBlock: number;
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
  "function balanceOf(address) view returns (uint256)",
  "function delegates(address) view returns (address)",
  "function getVotes(address) view returns (uint256)",
  "function claimableRewardOf(address) view returns (uint256)",
  "function withdrawnRewards(address) view returns (uint256)",
]);
const routerAbi = parseAbi([
  "function paused() view returns (bool)",
  "function totalCreatorNativeLiability() view returns (uint256)",
  "function totalDaoNativeRewards() view returns (uint256)",
  "function totalTreasuryNative() view returns (uint256)",
  "function creatorNativeClaims(address) view returns (uint256)",
]);
const governorAbi = parseAbi([
  "function votingDelay() view returns (uint256)",
  "function votingPeriod() view returns (uint256)",
  "function proposalThreshold() view returns (uint256)",
  "function quorum(uint256) view returns (uint256)",
  "function state(uint256) view returns (uint8)",
  "function proposalVotes(uint256) view returns (uint256 againstVotes, uint256 forVotes, uint256 abstainVotes)",
  "function hasVoted(uint256,address) view returns (bool)",
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
const launchAccountAbi = parseAbi([
  "function launchAccount(address) view returns ((address creator,address vault,address market,address locker,uint256 pendingCreatorBase,uint256 pendingDaoRewardBase,uint256 pendingTreasuryBase,uint256 cumulativeBaseFees,uint256 cumulativeLaunchFeesConverted,uint256 cumulativeNativeConverted,bool registered))",
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
          rpcClient.readContract({
            address: protocolFeeRouter,
            abi: routerAbi,
            functionName: "creatorNativeClaims",
            args: [account],
          }),
        ])
      : Promise.resolve([0n, zeroAddress, 0n, 0n, 0n, 0n] as const);
    const registeredLogsPromise = rpcClient.getLogs({
      address: protocolFeeRouter,
      event: launchRegisteredEvent,
      fromBlock: BigInt(deployment.deploymentBlock),
      strict: true,
    });
    const [
      totalSupply,
      eligibleRewardSupply,
      totalRewardsDeposited,
      totalRewardsClaimed,
      paused,
      creatorLiability,
      daoRewards,
      treasuryRewards,
      treasuryBalance,
      votingDelay,
      votingPeriod,
      proposalThreshold,
      currentQuorum,
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
      accountCalls,
      registeredLogsPromise,
    ]);
    const launchFees = await Promise.all(
      registeredLogs.map(async (log) => {
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
        pendingCreatorLiability: creatorLiability.toString(),
        totalDaoNativeRewards: daoRewards.toString(),
        totalTreasuryNative: treasuryRewards.toString(),
        treasuryBalance: treasuryBalance.toString(),
        conversionPaused: paused,
        launchFees,
        governance: {
          votingDelaySeconds: votingDelay.toString(),
          votingPeriodSeconds: votingPeriod.toString(),
          proposalThreshold: proposalThreshold.toString(),
          currentQuorum: currentQuorum.toString(),
        },
        account: account
          ? {
              address: account,
              balance: accountValues[0].toString(),
              delegate: accountValues[1],
              votingPower: accountValues[2].toString(),
              claimableRewards: accountValues[3].toString(),
              lifetimeRewards: accountValues[4].toString(),
              claimableCreatorFees: accountValues[5].toString(),
            }
          : null,
      },
    };
  });

  app.get<{ Querystring: { account?: string } }>(
    "/dao/proposals",
    async (request) => ({
      data: await proposals(
        rpcClient,
        deployment,
        accountFromQuery(request.query),
      ),
    }),
  );
  app.get<{ Params: { id: string }; Querystring: { account?: string } }>(
    "/dao/proposals/:id",
    async (request, reply) => {
      if (!/^\d+$/.test(request.params.id))
        return reply.code(400).send({ error: "invalid_proposal_id" });
      const data = (
        await proposals(rpcClient, deployment, accountFromQuery(request.query))
      ).find((item) => item.id === request.params.id);
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
    const logs = await rpcClient.getLogs({
      address: addresses,
      fromBlock: BigInt(deployment.deploymentBlock),
    });
    return {
      data: logs
        .slice(-100)
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
