export function databaseText(value: string | null) {
  return value?.replaceAll("\0", "\\0") ?? null;
}

export function redisConnectionOptions(value: string) {
  const redisUrl = new URL(value);
  if (redisUrl.protocol !== "redis:" && redisUrl.protocol !== "rediss:") {
    throw new Error("Redis URL must use redis or rediss");
  }
  const database = redisUrl.pathname.replace(/^\//, "");
  if (database && !/^\d+$/.test(database)) {
    throw new Error("Redis database must be a non-negative integer");
  }
  return {
    host: redisUrl.hostname,
    port: Number(redisUrl.port || "6379"),
    db: Number(database || "0"),
    ...(redisUrl.username
      ? { username: decodeURIComponent(redisUrl.username) }
      : {}),
    ...(redisUrl.password
      ? { password: decodeURIComponent(redisUrl.password) }
      : {}),
    ...(redisUrl.protocol === "rediss:" ? { tls: {} } : {}),
    maxRetriesPerRequest: null,
  };
}
