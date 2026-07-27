import type { Address } from "viem";

export type WakeReason = "event" | "reconciliation";

export class WakeCoordinator {
  private queued = false;
  private waiter:
    | {
        resolve: (reason: WakeReason) => void;
        timer: NodeJS.Timeout;
      }
    | undefined;

  trigger() {
    if (!this.waiter) {
      this.queued = true;
      return;
    }
    const waiter = this.waiter;
    this.waiter = undefined;
    clearTimeout(waiter.timer);
    waiter.resolve("event");
  }

  wait(reconciliationMs: number): Promise<WakeReason> {
    if (!Number.isSafeInteger(reconciliationMs) || reconciliationMs <= 0) {
      throw new Error("Reconciliation interval must be a positive integer");
    }
    if (this.waiter) throw new Error("WakeCoordinator supports one waiter");
    if (this.queued) {
      this.queued = false;
      return Promise.resolve("event");
    }
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.waiter = undefined;
        resolve("reconciliation");
      }, reconciliationMs);
      this.waiter = { resolve, timer };
    });
  }
}

export function createDebouncedWake(trigger: () => void, debounceMs: number) {
  if (!Number.isSafeInteger(debounceMs) || debounceMs < 0) {
    throw new Error("Wake debounce must be a non-negative integer");
  }
  let timer: NodeJS.Timeout | undefined;
  return {
    notify() {
      if (timer) return;
      timer = setTimeout(() => {
        timer = undefined;
        trigger();
      }, debounceMs);
    },
    cancel() {
      if (!timer) return;
      clearTimeout(timer);
      timer = undefined;
    },
  };
}

export function normalizeWakeAddresses(addresses: Address[]) {
  return [...new Set(addresses.map((address) => address.toLowerCase()))].sort();
}

export function wakeAddressFingerprint(addresses: Address[]) {
  return normalizeWakeAddresses(addresses).join(",");
}

export function reconnectDelayMs(
  attempt: number,
  baseMs = 1_000,
  maximumMs = 30_000,
) {
  if (
    !Number.isSafeInteger(attempt) ||
    attempt < 0 ||
    !Number.isSafeInteger(baseMs) ||
    baseMs <= 0 ||
    !Number.isSafeInteger(maximumMs) ||
    maximumMs < baseMs
  ) {
    throw new Error("Invalid WebSocket reconnect policy");
  }
  return Math.min(maximumMs, baseMs * 2 ** Math.min(attempt, 20));
}

type WakeSocketState =
  | "disabled"
  | "connecting"
  | "subscribing"
  | "subscribed"
  | "reconnecting"
  | "stopped";

export type FilteredLogWakeSnapshot = {
  state: WakeSocketState;
  addressCount: number;
  notifications: number;
  reconnects: number;
  lastNotificationAt: string | null;
  lastErrorAt: string | null;
};

type FilteredLogWakeOptions = {
  url: string;
  addresses: Address[];
  onNotification: () => void;
  onStateChange?: (snapshot: FilteredLogWakeSnapshot) => void;
  reconnectBaseMs?: number;
  reconnectMaximumMs?: number;
};

export class FilteredLogWakeClient {
  private readonly url: string;
  private readonly onNotification: () => void;
  private readonly onStateChange:
    ((snapshot: FilteredLogWakeSnapshot) => void) | undefined;
  private readonly reconnectBaseMs: number;
  private readonly reconnectMaximumMs: number;
  private addresses: Address[];
  private fingerprint: string;
  private socket: WebSocket | undefined;
  private reconnectTimer: NodeJS.Timeout | undefined;
  private stopped = true;
  private generation = 0;
  private reconnectAttempt = 0;
  private state: WakeSocketState = "disabled";
  private notifications = 0;
  private reconnects = 0;
  private lastNotificationAt: string | null = null;
  private lastErrorAt: string | null = null;

  constructor(options: FilteredLogWakeOptions) {
    if (!options.url.startsWith("wss://") && !options.url.startsWith("ws://")) {
      throw new Error("WebSocket wake URL must use ws:// or wss://");
    }
    this.url = options.url;
    this.onNotification = options.onNotification;
    this.onStateChange = options.onStateChange;
    this.reconnectBaseMs = options.reconnectBaseMs ?? 1_000;
    this.reconnectMaximumMs = options.reconnectMaximumMs ?? 30_000;
    this.addresses = normalizeWakeAddresses(options.addresses) as Address[];
    if (this.addresses.length === 0) {
      throw new Error("WebSocket wake filter requires at least one address");
    }
    this.fingerprint = wakeAddressFingerprint(this.addresses);
  }

  start() {
    if (!this.stopped) return;
    this.stopped = false;
    this.connect();
  }

  updateAddresses(addresses: Address[]) {
    const normalized = normalizeWakeAddresses(addresses) as Address[];
    if (normalized.length === 0) {
      throw new Error("WebSocket wake filter requires at least one address");
    }
    const fingerprint = wakeAddressFingerprint(normalized);
    if (fingerprint === this.fingerprint) return false;
    this.addresses = normalized;
    this.fingerprint = fingerprint;
    if (!this.stopped) {
      this.generation += 1;
      this.socket?.close();
      this.clearReconnectTimer();
      this.connect();
    }
    return true;
  }

  snapshot(): FilteredLogWakeSnapshot {
    return {
      state: this.state,
      addressCount: this.addresses.length,
      notifications: this.notifications,
      reconnects: this.reconnects,
      lastNotificationAt: this.lastNotificationAt,
      lastErrorAt: this.lastErrorAt,
    };
  }

  stop() {
    if (this.stopped) return;
    this.stopped = true;
    this.generation += 1;
    this.clearReconnectTimer();
    this.socket?.close();
    this.socket = undefined;
    this.setState("stopped");
  }

  private connect() {
    if (this.stopped) return;
    const generation = ++this.generation;
    this.setState(this.reconnectAttempt === 0 ? "connecting" : "reconnecting");
    let socket: WebSocket;
    try {
      socket = new WebSocket(this.url);
    } catch {
      this.recordFailure();
      this.scheduleReconnect(generation);
      return;
    }
    this.socket = socket;
    socket.addEventListener("open", () => {
      if (this.stopped || generation !== this.generation) return;
      this.setState("subscribing");
      socket.send(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "eth_subscribe",
          params: ["logs", { address: this.addresses }],
        }),
      );
    });
    socket.addEventListener("message", (event) => {
      if (this.stopped || generation !== this.generation) return;
      let payload: {
        id?: number;
        error?: unknown;
        method?: string;
      };
      try {
        payload = JSON.parse(String(event.data)) as typeof payload;
      } catch {
        this.recordFailure();
        socket.close();
        return;
      }
      if (payload.id === 1) {
        if (payload.error) {
          this.recordFailure();
          socket.close();
          return;
        }
        this.reconnectAttempt = 0;
        this.setState("subscribed");
        return;
      }
      if (payload.method !== "eth_subscription") return;
      this.notifications += 1;
      this.lastNotificationAt = new Date().toISOString();
      this.emitState();
      this.onNotification();
    });
    socket.addEventListener("error", () => {
      if (this.stopped || generation !== this.generation) return;
      this.recordFailure();
      socket.close();
    });
    socket.addEventListener("close", () => {
      if (this.stopped || generation !== this.generation) return;
      this.recordFailure();
      this.scheduleReconnect(generation);
    });
  }

  private recordFailure() {
    this.lastErrorAt = new Date().toISOString();
    this.emitState();
  }

  private scheduleReconnect(generation: number) {
    if (this.stopped || generation !== this.generation || this.reconnectTimer) {
      return;
    }
    const delay = reconnectDelayMs(
      this.reconnectAttempt,
      this.reconnectBaseMs,
      this.reconnectMaximumMs,
    );
    this.reconnectAttempt += 1;
    this.reconnects += 1;
    this.setState("reconnecting");
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.connect();
    }, delay);
  }

  private clearReconnectTimer() {
    if (!this.reconnectTimer) return;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
  }

  private setState(state: WakeSocketState) {
    this.state = state;
    this.emitState();
  }

  private emitState() {
    this.onStateChange?.(this.snapshot());
  }
}
