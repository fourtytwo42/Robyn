import { describe, expect, it } from "vitest";
import {
  databaseText,
  keeperHeartbeatHealthy,
  operatorBalanceProjectedDailyCu,
  redisConnectionOptions,
  transactionAccount,
} from "../src/runtime-config.js";

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

  it("uses the local signing account on testnet and the unlocked address on devnet", () => {
    const local = { address: "0xsigner" };
    expect(transactionAccount(true, local, "0xaddress")).toBe(local);
    expect(transactionAccount(false, undefined, "0xaddress")).toBe("0xaddress");
    expect(() => transactionAccount(true, undefined, "0xaddress")).toThrow(
      "signing account",
    );
  });

  it("degrades for failed jobs or a low operator balance", () => {
    expect(
      keeperHeartbeatHealthy({
        failedJobs: 0,
        operatorBalance: 250n,
        minimumOperatorBalance: 250n,
      }),
    ).toBe(true);
    expect(
      keeperHeartbeatHealthy({
        failedJobs: 1,
        operatorBalance: 250n,
        minimumOperatorBalance: 250n,
      }),
    ).toBe(false);
    expect(
      keeperHeartbeatHealthy({
        failedJobs: 0,
        operatorBalance: 249n,
        minimumOperatorBalance: 250n,
      }),
    ).toBe(false);
  });

  it("projects bounded operator-balance polling cost", () => {
    expect(operatorBalanceProjectedDailyCu(60_000)).toBe(28_800);
    expect(operatorBalanceProjectedDailyCu(300_000)).toBe(5_760);
    expect(() => operatorBalanceProjectedDailyCu(59_999)).toThrow(
      "at least 60 seconds",
    );
  });
});
