import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export type RpcPayload = {
  id?: string | number | null;
  jsonrpc: "2.0";
  method: string;
  params?: unknown[];
};

export type RpcBody = RpcPayload | RpcPayload[];
export type UpstreamRequest = (
  url: string,
  payload: RpcBody,
) => Promise<unknown>;

type Provider = "primary" | "fallback";

type UpstreamState = {
  chainId: number | null;
  head: bigint | null;
  healthy: boolean;
  checkedAt: string | null;
  error: string | null;
};

type PublicUpstreamState = Omit<UpstreamState, "head"> & {
  head: string | null;
};

export type FailoverSnapshot = {
  schemaVersion: 1;
  service: string;
  status: "ok" | "degraded" | "unavailable";
  expectedChainId: number;
  activeProvider: Provider;
  primary: PublicUpstreamState & { name: "lan" };
  fallback: PublicUpstreamState & { name: "alchemy" };
  headLagBlocks: string | null;
  maximumHeadLagBlocks: number;
  recoveryHeadLagBlocks: number;
  recoveryHealthyProbes: number;
  recoveryHealthyProbeTarget: number;
  probeIntervalMs: number;
  lastProviderChangeAt: string;
  providerChanges: number;
  primaryRequestFailures: number;
  paidActualCu: number;
  paidProbeCu: number;
  paidFallbackCu: number;
  paidProjectedDailyCu: number;
  paidProjectedMonthlyCu: number;
  startedAt: string;
  updatedAt: string;
};

export type FailoverOptions = {
  primaryUrl: string;
  fallbackUrl: string;
  expectedChainId: number;
  probeIntervalMs?: number;
  maximumHeadLagBlocks?: number;
  recoveryHeadLagBlocks?: number;
  recoveryHealthyProbeTarget?: number;
  request?: UpstreamRequest;
  now?: () => number;
  statusFile?: string | null;
  serviceName?: string;
};

function parseQuantity(value: unknown, label: string): bigint {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]+$/.test(value)) {
    throw new Error(`${label} returned an invalid quantity`);
  }
  return BigInt(value);
}

function rpcResult(response: unknown, label: string): unknown {
  if (
    !response ||
    typeof response !== "object" ||
    Array.isArray(response) ||
    !("result" in response)
  ) {
    throw new Error(`${label} returned an invalid JSON-RPC response`);
  }
  return (response as { result: unknown }).result;
}

function methodComputeUnits(method: string): number {
  if (method === "eth_getLogs") return 75;
  if (method === "eth_call") return 26;
  if (
    method.startsWith("eth_getBlock") ||
    method === "eth_getTransactionReceipt" ||
    method === "eth_getTransactionByHash"
  ) {
    return 20;
  }
  return 10;
}

function bodyComputeUnits(body: RpcBody): number {
  const entries = Array.isArray(body) ? body : [body];
  return entries.reduce(
    (total, entry) => total + methodComputeUnits(entry.method),
    0,
  );
}

function isReadOnlyBody(body: RpcBody): boolean {
  const entries = Array.isArray(body) ? body : [body];
  return entries.every(
    (entry) =>
      entry.method !== "eth_sendRawTransaction" &&
      entry.method !== "eth_sendTransaction",
  );
}

function hasUnavailableStateError(response: unknown): boolean {
  const entries = Array.isArray(response) ? response : [response];
  return entries.some((entry) => {
    if (!entry || typeof entry !== "object" || !("error" in entry)) {
      return false;
    }
    const error = (entry as { error?: unknown }).error;
    if (!error || typeof error !== "object") return false;
    const code = (error as { code?: unknown }).code;
    const message = (error as { message?: unknown }).message;
    return (
      (code === -32_000 || code === -32_603) &&
      typeof message === "string" &&
      (/missing trie node/i.test(message) ||
        /state .* is not available/i.test(message))
    );
  });
}

export function createHttpUpstreamRequest(timeoutMs = 15_000): UpstreamRequest {
  return async (url, payload) => {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      throw new Error(`upstream returned HTTP ${response.status}`);
    }
    return response.json() as Promise<unknown>;
  };
}

export class TestnetRpcFailover {
  private readonly primaryUrl: string;
  private readonly fallbackUrl: string;
  private readonly expectedChainId: number;
  private readonly probeIntervalMs: number;
  private readonly maximumHeadLagBlocks: number;
  private readonly recoveryHeadLagBlocks: number;
  private readonly recoveryHealthyProbeTarget: number;
  private readonly upstreamRequest: UpstreamRequest;
  private readonly now: () => number;
  private readonly statusFile: string | null;
  private readonly serviceName: string;
  private readonly startedAtMs: number;
  private activeProvider: Provider = "fallback";
  private primary: UpstreamState = {
    chainId: null,
    head: null,
    healthy: false,
    checkedAt: null,
    error: "not checked",
  };
  private fallback: UpstreamState = {
    chainId: null,
    head: null,
    healthy: false,
    checkedAt: null,
    error: "not checked",
  };
  private recoveryHealthyProbes = 0;
  private lastProviderChangeAtMs: number;
  private providerChanges = 0;
  private primaryRequestFailures = 0;
  private paidProbeCu = 0;
  private paidFallbackCu = 0;
  private timer: NodeJS.Timeout | null = null;
  private probePromise: Promise<FailoverSnapshot> | null = null;

  constructor(options: FailoverOptions) {
    this.primaryUrl = options.primaryUrl;
    this.fallbackUrl = options.fallbackUrl;
    this.expectedChainId = options.expectedChainId;
    this.probeIntervalMs = options.probeIntervalMs ?? 30_000;
    this.maximumHeadLagBlocks = options.maximumHeadLagBlocks ?? 50;
    this.recoveryHeadLagBlocks = options.recoveryHeadLagBlocks ?? 10;
    this.recoveryHealthyProbeTarget = options.recoveryHealthyProbeTarget ?? 2;
    this.upstreamRequest = options.request ?? createHttpUpstreamRequest(15_000);
    this.now = options.now ?? Date.now;
    this.statusFile = options.statusFile ?? null;
    this.serviceName = options.serviceName ?? "robyn-testnet-rpc-failover";
    this.startedAtMs = this.now();
    this.lastProviderChangeAtMs = this.startedAtMs;
  }

  private async inspect(url: string, paid: boolean): Promise<UpstreamState> {
    const checkedAt = new Date(this.now()).toISOString();
    try {
      const [chainResponse, headResponse] = await Promise.all([
        this.upstreamRequest(url, {
          jsonrpc: "2.0",
          id: "health-chain",
          method: "eth_chainId",
          params: [],
        }),
        this.upstreamRequest(url, {
          jsonrpc: "2.0",
          id: "health-head",
          method: "eth_blockNumber",
          params: [],
        }),
      ]);
      if (paid) this.paidProbeCu += 20;
      const chainId = Number(
        parseQuantity(rpcResult(chainResponse, "eth_chainId"), "eth_chainId"),
      );
      const head = parseQuantity(
        rpcResult(headResponse, "eth_blockNumber"),
        "eth_blockNumber",
      );
      if (chainId !== this.expectedChainId) {
        throw new Error(`wrong chain ${chainId}`);
      }
      return { chainId, head, healthy: true, checkedAt, error: null };
    } catch (error) {
      if (paid) this.paidProbeCu += 20;
      return {
        chainId: null,
        head: null,
        healthy: false,
        checkedAt,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private use(provider: Provider): void {
    if (provider === this.activeProvider) return;
    this.activeProvider = provider;
    this.lastProviderChangeAtMs = this.now();
    this.providerChanges += 1;
  }

  async probe(): Promise<FailoverSnapshot> {
    if (this.probePromise) return this.probePromise;
    this.probePromise = (async () => {
      const initialProbe =
        this.primary.checkedAt === null && this.fallback.checkedAt === null;
      const [primary, fallback] = await Promise.all([
        this.inspect(this.primaryUrl, false),
        this.inspect(this.fallbackUrl, true),
      ]);
      this.primary = primary;
      this.fallback = fallback;

      const headLag =
        primary.head !== null && fallback.head !== null
          ? fallback.head > primary.head
            ? fallback.head - primary.head
            : 0n
          : null;
      const primaryWithinMaximum =
        primary.healthy &&
        (headLag === null || headLag <= BigInt(this.maximumHeadLagBlocks));
      const primaryRecovered =
        primary.healthy &&
        fallback.healthy &&
        headLag !== null &&
        headLag <= BigInt(this.recoveryHeadLagBlocks);

      if (initialProbe && primaryWithinMaximum) {
        this.recoveryHealthyProbes = this.recoveryHealthyProbeTarget;
        this.use("primary");
      } else if (!primaryWithinMaximum && fallback.healthy) {
        this.recoveryHealthyProbes = 0;
        this.use("fallback");
      } else if (this.activeProvider === "primary" && primaryWithinMaximum) {
        this.recoveryHealthyProbes = this.recoveryHealthyProbeTarget;
      } else if (this.activeProvider === "fallback" && primaryRecovered) {
        this.recoveryHealthyProbes += 1;
        if (this.recoveryHealthyProbes >= this.recoveryHealthyProbeTarget) {
          this.use("primary");
        }
      } else if (primaryWithinMaximum && !fallback.healthy) {
        this.recoveryHealthyProbes = this.recoveryHealthyProbeTarget;
        this.use("primary");
      } else {
        this.recoveryHealthyProbes = 0;
      }

      const snapshot = this.snapshot();
      await this.persist(snapshot);
      return snapshot;
    })().finally(() => {
      this.probePromise = null;
    });
    return this.probePromise;
  }

  async request(payload: RpcBody): Promise<unknown> {
    if (!this.primary.checkedAt && !this.fallback.checkedAt) {
      await this.probe();
    }
    if (this.activeProvider === "primary") {
      try {
        const response = await this.upstreamRequest(this.primaryUrl, payload);
        if (isReadOnlyBody(payload) && hasUnavailableStateError(response)) {
          throw new Error("primary state unavailable");
        }
        return response;
      } catch {
        this.primaryRequestFailures += 1;
        this.primary = {
          ...this.primary,
          healthy: false,
          checkedAt: new Date(this.now()).toISOString(),
          error: "request failed",
        };
        this.recoveryHealthyProbes = 0;
        this.use("fallback");
        const cost = bodyComputeUnits(payload);
        this.paidFallbackCu += cost;
        try {
          const response = await this.upstreamRequest(
            this.fallbackUrl,
            payload,
          );
          await this.persist(this.snapshot());
          return response;
        } catch (error) {
          this.fallback = {
            ...this.fallback,
            healthy: false,
            checkedAt: new Date(this.now()).toISOString(),
            error: "request failed",
          };
          await this.persist(this.snapshot());
          throw error;
        }
      }
    }
    const cost = bodyComputeUnits(payload);
    this.paidFallbackCu += cost;
    try {
      const response = await this.upstreamRequest(this.fallbackUrl, payload);
      await this.persist(this.snapshot());
      return response;
    } catch (error) {
      this.fallback = {
        ...this.fallback,
        healthy: false,
        checkedAt: new Date(this.now()).toISOString(),
        error: "request failed",
      };
      await this.persist(this.snapshot());
      throw error;
    }
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.probe();
    }, this.probeIntervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  snapshot(): FailoverSnapshot {
    const nowMs = this.now();
    const elapsedMs = Math.max(3_600_000, nowMs - this.startedAtMs);
    const probeProjectedDailyCu = Math.ceil(
      20 * (86_400_000 / this.probeIntervalMs),
    );
    const fallbackProjectedDailyCu = Math.ceil(
      this.paidFallbackCu * (86_400_000 / elapsedMs),
    );
    const paidProjectedDailyCu =
      probeProjectedDailyCu + fallbackProjectedDailyCu;
    const serving =
      this.activeProvider === "primary"
        ? this.primary.healthy
        : this.fallback.healthy;
    const status: FailoverSnapshot["status"] = !serving
      ? "unavailable"
      : this.activeProvider === "primary" && this.fallback.healthy
        ? "ok"
        : "degraded";
    const headLag =
      this.primary.head !== null && this.fallback.head !== null
        ? this.fallback.head > this.primary.head
          ? this.fallback.head - this.primary.head
          : 0n
        : null;
    return {
      schemaVersion: 1,
      service: this.serviceName,
      status,
      expectedChainId: this.expectedChainId,
      activeProvider: this.activeProvider,
      primary: {
        ...this.primary,
        head: this.primary.head?.toString() ?? null,
        name: "lan",
      },
      fallback: {
        ...this.fallback,
        head: this.fallback.head?.toString() ?? null,
        name: "alchemy",
      },
      headLagBlocks: headLag?.toString() ?? null,
      maximumHeadLagBlocks: this.maximumHeadLagBlocks,
      recoveryHeadLagBlocks: this.recoveryHeadLagBlocks,
      recoveryHealthyProbes: this.recoveryHealthyProbes,
      recoveryHealthyProbeTarget: this.recoveryHealthyProbeTarget,
      probeIntervalMs: this.probeIntervalMs,
      lastProviderChangeAt: new Date(this.lastProviderChangeAtMs).toISOString(),
      providerChanges: this.providerChanges,
      primaryRequestFailures: this.primaryRequestFailures,
      paidActualCu: this.paidProbeCu + this.paidFallbackCu,
      paidProbeCu: this.paidProbeCu,
      paidFallbackCu: this.paidFallbackCu,
      paidProjectedDailyCu,
      paidProjectedMonthlyCu: paidProjectedDailyCu * 30,
      startedAt: new Date(this.startedAtMs).toISOString(),
      updatedAt: new Date(nowMs).toISOString(),
    };
  }

  private async persist(snapshot: FailoverSnapshot): Promise<void> {
    if (!this.statusFile) return;
    await mkdir(path.dirname(this.statusFile), { recursive: true });
    const temporary = `${this.statusFile}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(snapshot)}\n`, {
      mode: 0o600,
    });
    await rename(temporary, this.statusFile);
  }
}
