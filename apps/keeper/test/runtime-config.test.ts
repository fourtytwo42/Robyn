import { describe, expect, it } from "vitest";
import { databaseText, redisConnectionOptions } from "../src/runtime-config.js";

describe("keeper runtime configuration", () => {
  it("honors Redis database, authentication, and TLS isolation", () => {
    expect(
      redisConnectionOptions("rediss://keeper:p%40ss@redis.example:6380/15"),
    ).toEqual({
      host: "redis.example",
      port: 6380,
      db: 15,
      username: "keeper",
      password: "p@ss",
      tls: {},
      maxRetriesPerRequest: null,
    });
  });

  it("defaults to Redis database zero and rejects invalid database paths", () => {
    expect(redisConnectionOptions("redis://127.0.0.1")).toMatchObject({
      host: "127.0.0.1",
      port: 6379,
      db: 0,
    });
    expect(() =>
      redisConnectionOptions("redis://127.0.0.1/not-a-database"),
    ).toThrow("Redis database");
  });

  it("removes PostgreSQL-prohibited NUL bytes without hiding the error", () => {
    expect(databaseText("rpc reverted:\0selector")).toBe(
      "rpc reverted:\\0selector",
    );
    expect(databaseText(null)).toBeNull();
  });
});
