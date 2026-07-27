export class SingleFlightTtlCache<Value> {
  private readonly entries = new Map<
    string,
    { expiresAt: number; promise: Promise<Value> }
  >();

  constructor(
    private readonly ttlMs: number,
    private readonly maximumEntries = 32,
  ) {
    if (ttlMs <= 0 || maximumEntries <= 0) {
      throw new Error("cache bounds must be positive");
    }
  }

  get size() {
    return this.entries.size;
  }

  private pruneExpired(now: number) {
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(key);
    }
  }

  get(key: string, loader: () => Promise<Value>, now = Date.now()) {
    this.pruneExpired(now);
    const existing = this.entries.get(key);
    if (existing && existing.expiresAt > now) return existing.promise;

    while (this.entries.size >= this.maximumEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }

    const promise = loader();
    const entry = { expiresAt: now + this.ttlMs, promise };
    this.entries.set(key, entry);
    void promise.catch(() => {
      if (this.entries.get(key) === entry) this.entries.delete(key);
    });
    return promise;
  }

  clear() {
    this.entries.clear();
  }
}

export class StaleWhileRevalidateCache<Value> {
  private value: Value | undefined;
  private refreshedAt = 0;
  private refresh: Promise<Value> | undefined;

  constructor(
    private readonly refreshAfterMs: number,
    private readonly maximumAgeMs: number,
  ) {
    if (
      refreshAfterMs <= 0 ||
      maximumAgeMs <= 0 ||
      refreshAfterMs >= maximumAgeMs
    ) {
      throw new Error("cache refresh bounds are invalid");
    }
  }

  private load(loader: () => Promise<Value>, now: number) {
    if (this.refresh) return this.refresh;
    const refresh = loader().then((value) => {
      this.value = value;
      this.refreshedAt = now;
      return value;
    });
    this.refresh = refresh;
    void refresh.then(
      () => {
        if (this.refresh === refresh) this.refresh = undefined;
      },
      () => {
        if (this.refresh === refresh) this.refresh = undefined;
      },
    );
    return refresh;
  }

  async get(loader: () => Promise<Value>, now = Date.now()) {
    if (this.value === undefined) return this.load(loader, now);

    const age = now - this.refreshedAt;
    if (age >= this.maximumAgeMs) return this.load(loader, now);
    if (age >= this.refreshAfterMs) {
      void this.load(loader, now).catch(() => undefined);
    }
    return this.value;
  }

  clear() {
    this.value = undefined;
    this.refreshedAt = 0;
    this.refresh = undefined;
  }
}
