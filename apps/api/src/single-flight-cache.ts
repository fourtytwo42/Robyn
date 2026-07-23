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

  get(key: string, loader: () => Promise<Value>, now = Date.now()) {
    const existing = this.entries.get(key);
    if (existing && existing.expiresAt > now) return existing.promise;
    if (existing) this.entries.delete(key);

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
