import { Redis } from "ioredis";
import type { RateLimiter } from "./app.js";

const reserveScript = [
  "local count = redis.call('INCR', KEYS[1])",
  "if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[2]) end",
  "if count > tonumber(ARGV[1]) then redis.call('DECR', KEYS[1]); return 0 end",
  "return 1",
].join("\n");

const releaseScript = [
  "local count = tonumber(redis.call('GET', KEYS[1]) or '0')",
  "if count <= 1 then redis.call('DEL', KEYS[1]); return 0 end",
  "return redis.call('DECR', KEYS[1])",
].join("\n");

export async function createRedisRateLimiter(
  url: string,
): Promise<RateLimiter> {
  const redis = new Redis(url, {
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    connectTimeout: 3_000,
  });
  await redis.connect();
  await redis.ping();

  return {
    reserve: async (key, maximum, windowMs) =>
      Number(
        await redis.eval(
          reserveScript,
          1,
          "robyn:" + key,
          String(maximum),
          String(windowMs),
        ),
      ) === 1,
    release: async (key) => {
      await redis.eval(releaseScript, 1, "robyn:" + key);
    },
    close: async () => {
      await redis.quit();
    },
  };
}
