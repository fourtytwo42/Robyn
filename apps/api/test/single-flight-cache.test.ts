import { describe, expect, it, vi } from "vitest";
import {
  SingleFlightTtlCache,
  StaleWhileRevalidateCache,
} from "../src/single-flight-cache.js";

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

  it("prunes expired generations even when their keys are never requested again", async () => {
    const cache = new SingleFlightTtlCache<number>(100, 16);
    for (let generation = 0; generation < 8; generation += 1) {
      await cache.get(
        `launch-set-${generation}`,
        async () => generation,
        1_000 + generation,
      );
    }
    expect(cache.size).toBe(8);

    await cache.get("current-launch-set", async () => 9, 1_108);

    expect(cache.size).toBe(1);
  });

  it("retains unexpired entries while pruning only stale generations", async () => {
    const cache = new SingleFlightTtlCache<number>(100, 16);
    await cache.get("expired", async () => 1, 1_000);
    await cache.get("current", async () => 2, 1_050);

    await cache.get("new", async () => 3, 1_101);

    expect(cache.size).toBe(2);
    const currentLoader = vi.fn(async () => 4);
    await expect(cache.get("current", currentLoader, 1_102)).resolves.toBe(2);
    expect(currentLoader).not.toHaveBeenCalled();
  });
});

describe("StaleWhileRevalidateCache", () => {
  it("serves the last value while one refresh runs in the background", async () => {
    const cache = new StaleWhileRevalidateCache<number>(100, 500);
    let resolveRefresh: ((value: number) => void) | undefined;
    const loader = vi
      .fn<() => Promise<number>>()
      .mockResolvedValueOnce(1)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveRefresh = resolve;
          }),
      );

    await expect(cache.get(loader, 1_000)).resolves.toBe(1);
    await expect(cache.get(loader, 1_101)).resolves.toBe(1);
    await expect(cache.get(loader, 1_102)).resolves.toBe(1);
    expect(loader).toHaveBeenCalledTimes(2);

    resolveRefresh?.(2);
    await vi.waitFor(() => expect(cache.get(loader, 1_103)).resolves.toBe(2));
  });

  it("blocks for a refresh after the maximum safe age", async () => {
    const cache = new StaleWhileRevalidateCache<number>(100, 500);
    const loader = vi
      .fn<() => Promise<number>>()
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(2);

    await expect(cache.get(loader, 1_000)).resolves.toBe(1);
    await expect(cache.get(loader, 1_501)).resolves.toBe(2);
  });

  it("keeps a fresh value when a background refresh fails", async () => {
    const cache = new StaleWhileRevalidateCache<number>(100, 500);
    const loader = vi
      .fn<() => Promise<number>>()
      .mockResolvedValueOnce(1)
      .mockRejectedValueOnce(new Error("temporary"));

    await expect(cache.get(loader, 1_000)).resolves.toBe(1);
    await expect(cache.get(loader, 1_101)).resolves.toBe(1);
    await vi.waitFor(() => expect(loader).toHaveBeenCalledTimes(2));
    await expect(cache.get(async () => 2, 1_102)).resolves.toBe(1);
  });
});
