import { describe, expect, it, vi } from "vitest";
import { SingleFlightTtlCache } from "../src/single-flight-cache.js";

describe("SingleFlightTtlCache", () => {
  it("coalesces concurrent work and refreshes after expiry", async () => {
    const cache = new SingleFlightTtlCache<number>(100);
    const loader = vi.fn(async () => 42);
    const first = cache.get("same", loader, 1_000);
    const second = cache.get("same", loader, 1_001);

    await expect(Promise.all([first, second])).resolves.toEqual([42, 42]);
    expect(loader).toHaveBeenCalledTimes(1);
    await expect(cache.get("same", loader, 1_101)).resolves.toBe(42);
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("evicts rejected work so a retry can recover", async () => {
    const cache = new SingleFlightTtlCache<number>(100);
    const loader = vi
      .fn<() => Promise<number>>()
      .mockRejectedValueOnce(new Error("transient"))
      .mockResolvedValueOnce(7);

    await expect(cache.get("key", loader, 1_000)).rejects.toThrow("transient");
    await expect(cache.get("key", loader, 1_001)).resolves.toBe(7);
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("keeps keys isolated and bounds retained entries", async () => {
    const cache = new SingleFlightTtlCache<number>(100, 2);
    await cache.get("one", async () => 1, 1_000);
    await cache.get("two", async () => 2, 1_000);
    await cache.get("three", async () => 3, 1_000);
    const loader = vi.fn(async () => 11);
    await expect(cache.get("one", loader, 1_001)).resolves.toBe(11);
    expect(loader).toHaveBeenCalledOnce();
  });
});
