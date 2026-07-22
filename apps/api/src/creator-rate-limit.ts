export type RateLimitRedis = {
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<unknown>;
};

export async function consumeWalletUpload(
  redis: RateLimitRedis,
  chainId: number,
  address: string,
  now = Date.now(),
) {
  const bucket = Math.floor(now / 3_600_000);
  const key = `robyn:media:uploads:${chainId}:${address.toLowerCase()}:${bucket}`;
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, 3700);
  return { allowed: count <= 10, count, key };
}
