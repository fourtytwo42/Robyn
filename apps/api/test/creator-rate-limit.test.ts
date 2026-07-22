import { describe, expect, it } from "vitest";
import { consumeWalletUpload } from "../src/creator-rate-limit.js";

describe("creator upload rate limit", () => {
  it("allows ten uploads per wallet-hour and rejects the eleventh", async () => {
    const counts = new Map<string, number>();
    const expirations: Array<[string, number]> = [];
    const redis = {
      async incr(key: string) {
        const count = (counts.get(key) ?? 0) + 1;
        counts.set(key, count);
        return count;
      },
      async expire(key: string, seconds: number) {
        expirations.push([key, seconds]);
      },
    };
    const results = [];
    for (let attempt = 0; attempt < 11; attempt++)
      results.push(
        await consumeWalletUpload(
          redis,
          31337,
          "0xABCDEFabcdefABCDEFabcdefABCDEFabcdefABCD",
          Date.UTC(2026, 6, 22, 19),
        ),
      );
    expect(results.slice(0, 10).every((result) => result.allowed)).toBe(true);
    expect(results[10]).toMatchObject({ allowed: false, count: 11 });
    expect(expirations).toEqual([[results[0].key, 3700]]);
  });

  it("uses independent wallet and hour buckets", async () => {
    const keys: string[] = [];
    const redis = {
      async incr(key: string) {
        keys.push(key);
        return 1;
      },
      async expire() {},
    };
    await consumeWalletUpload(redis, 31337, "0xaaaa", 0);
    await consumeWalletUpload(redis, 31337, "0xbbbb", 0);
    await consumeWalletUpload(redis, 31337, "0xaaaa", 3_600_000);
    expect(new Set(keys).size).toBe(3);
  });
});
