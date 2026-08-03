import { formatUnits, type Address, type PublicClient } from "viem";

export type ReferencePrice = {
  kind: "chainlink-usd" | "native-parity" | "test-fixture" | "unavailable";
  status: "available" | "unavailable";
  usdPerToken: string | null;
  feedAddress: Address | null;
  feedTimestamp: string | null;
  heartbeatSeconds: number | null;
  reason: string | null;
  sequencerStatus: "healthy" | "unavailable" | "not-published";
};

export type ChainlinkFeedPolicy = {
  kind: "chainlink-usd" | "native-parity" | "test-fixture" | "none";
  feedAddress?: Address | null;
  heartbeatSeconds?: number | null;
  expectedDecimals?: number | null;
  oraclePauseCheck?: boolean;
  fixtureUsd?: string | null;
};

export type ChainlinkPolicy = {
  sequencerUptimeFeed?: Address | null;
  sequencerGracePeriodSeconds?: number;
  cacheTtlSeconds?: number;
};

const aggregatorAbi = [
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint8" }],
  },
  {
    type: "function",
    name: "latestRoundData",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "roundId", type: "uint80" },
      { name: "answer", type: "int256" },
      { name: "startedAt", type: "uint256" },
      { name: "updatedAt", type: "uint256" },
      { name: "answeredInRound", type: "uint80" },
    ],
  },
] as const;
const stockTokenOracleAbi = [
  {
    type: "function",
    name: "oraclePaused",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "bool" }],
  },
] as const;

type RoundData = {
  roundId: bigint;
  answer: bigint;
  startedAt: bigint;
  updatedAt: bigint;
  answeredInRound: bigint;
};
function normalizeRound(value: unknown): RoundData {
  const row = value as Record<string, bigint> & readonly bigint[];
  return {
    roundId: row.roundId ?? row[0] ?? 0n,
    answer: row.answer ?? row[1] ?? 0n,
    startedAt: row.startedAt ?? row[2] ?? 0n,
    updatedAt: row.updatedAt ?? row[3] ?? 0n,
    answeredInRound: row.answeredInRound ?? row[4] ?? 0n,
  };
}

export class ChainlinkReferencePriceService {
  private readonly cache = new Map<
    string,
    { expiresAt: number; value: ReferencePrice }
  >();
  constructor(
    private readonly client: PublicClient,
    private readonly policy: ChainlinkPolicy = {},
  ) {}

  async read(
    token: Address,
    feed?: ChainlinkFeedPolicy,
  ): Promise<ReferencePrice> {
    if (feed?.kind === "test-fixture") {
      return feed.fixtureUsd
        ? {
            kind: "test-fixture",
            status: "available",
            usdPerToken: feed.fixtureUsd,
            feedAddress: null,
            feedTimestamp: null,
            heartbeatSeconds: null,
            reason: null,
            sequencerStatus: "not-published",
          }
        : this.unavailable("Test fixture price is not configured");
    }
    if (
      (feed?.kind !== "chainlink-usd" && feed?.kind !== "native-parity") ||
      !feed.feedAddress
    ) {
      return this.unavailable("Chainlink reference feed is not published");
    }
    const cacheKey = `${token.toLowerCase()}:${feed.feedAddress.toLowerCase()}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    const value = await this.readFresh(token, {
      ...feed,
      feedAddress: feed.feedAddress,
    }).catch((error: unknown) =>
      this.unavailable(
        error instanceof Error
          ? `Chainlink reference unavailable: ${error.message}`
          : "Chainlink reference unavailable",
        feed,
      ),
    );
    if (value.status === "available") {
      const ttlSeconds = Math.min(
        60,
        Math.max(1, this.policy.cacheTtlSeconds ?? 60),
      );
      this.cache.set(cacheKey, {
        value,
        expiresAt: Date.now() + ttlSeconds * 1_000,
      });
    }
    return value;
  }

  private async readFresh(
    token: Address,
    feed: ChainlinkFeedPolicy & { feedAddress: Address },
  ): Promise<ReferencePrice> {
    const sequencerStatus = await this.validateSequencer();
    if (sequencerStatus === "unavailable")
      return this.unavailable("Chainlink sequencer safety check failed", feed);
    if (feed.kind === "chainlink-usd" && feed.oraclePauseCheck) {
      const paused = await this.client.readContract({
        address: token,
        abi: stockTokenOracleAbi,
        functionName: "oraclePaused",
      });
      if (paused) return this.unavailable("Stock Token oracle is paused", feed);
    }
    const [decimalsValue, roundValue] = await Promise.all([
      this.client.readContract({
        address: feed.feedAddress,
        abi: aggregatorAbi,
        functionName: "decimals",
      }),
      this.client.readContract({
        address: feed.feedAddress,
        abi: aggregatorAbi,
        functionName: "latestRoundData",
      }),
    ]);
    const decimals = Number(decimalsValue);
    const round = normalizeRound(roundValue);
    const heartbeat = feed.heartbeatSeconds ?? 0;
    const now = BigInt(Math.floor(Date.now() / 1_000));
    if (feed.expectedDecimals != null && decimals !== feed.expectedDecimals)
      return this.unavailable("Chainlink feed decimals changed", feed);
    if (round.answer <= 0n)
      return this.unavailable("Chainlink answer is not positive", feed);
    if (round.updatedAt <= 0n || round.answeredInRound < round.roundId)
      return this.unavailable("Chainlink round is incomplete", feed);
    if (heartbeat <= 0 || now - round.updatedAt > BigInt(heartbeat))
      return this.unavailable("Chainlink feed is stale", feed);
    return {
      kind: feed.kind === "native-parity" ? "native-parity" : "chainlink-usd",
      status: "available",
      usdPerToken: formatUnits(round.answer, decimals),
      feedAddress: feed.feedAddress,
      feedTimestamp: new Date(Number(round.updatedAt) * 1_000).toISOString(),
      heartbeatSeconds: heartbeat,
      reason: null,
      sequencerStatus,
    };
  }

  private async validateSequencer(): Promise<
    ReferencePrice["sequencerStatus"]
  > {
    const address = this.policy.sequencerUptimeFeed;
    if (!address) return "not-published";
    try {
      const round = normalizeRound(
        await this.client.readContract({
          address,
          abi: aggregatorAbi,
          functionName: "latestRoundData",
        }),
      );
      const now = BigInt(Math.floor(Date.now() / 1_000));
      const grace = BigInt(this.policy.sequencerGracePeriodSeconds ?? 3_600);
      return round.answer === 0n &&
        round.startedAt > 0n &&
        now - round.startedAt > grace
        ? "healthy"
        : "unavailable";
    } catch {
      return "unavailable";
    }
  }

  private unavailable(
    reason: string,
    feed?: ChainlinkFeedPolicy,
  ): ReferencePrice {
    return {
      kind: "unavailable",
      status: "unavailable",
      usdPerToken: null,
      feedAddress: feed?.feedAddress ?? null,
      feedTimestamp: null,
      heartbeatSeconds: feed?.heartbeatSeconds ?? null,
      reason,
      sequencerStatus: this.policy.sequencerUptimeFeed
        ? "unavailable"
        : "not-published",
    };
  }
}
