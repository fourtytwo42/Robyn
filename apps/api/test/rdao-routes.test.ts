import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Address, PublicClient } from "viem";
import { registerRdaoRoutes } from "../src/rdao-routes";

const address = (value: number) =>
  `0x${value.toString(16).padStart(40, "0")}` as Address;
const contracts = {
  daoToken: address(1), governor: address(2), timelock: address(3),
  rdaoSale: address(4), rdaoStaking: address(5),
  rdaoLiquidityLocker: address(6), wrappedNative: address(7),
};
const openApps: Array<ReturnType<typeof Fastify>> = [];

afterEach(async () => {
  await Promise.all(openApps.splice(0).map((app) => app.close()));
});

describe("Schema-20 RDAO workspace API", () => {
  it("fails closed for earlier schema manifests", async () => {
    const app = Fastify();
    openApps.push(app);
    registerRdaoRoutes(app, {} as PublicClient, { schemaVersion: 19, contracts });
    const response = await app.inject({ method: "GET", url: "/rdao" });
    expect(response.statusCode).toBe(404);
  });

  it("reports sale, staking, liquidity and wallet state", async () => {
    const account = address(99);
    const readContract = vi.fn().mockImplementation(({ functionName, address: target }) => {
      if (functionName === "position") {
        return Promise.resolve([address(88), 800n, 200n, 1234n, account, 7n]);
      }
      if (functionName === "delegates") return Promise.resolve(account);
      if (functionName === "getVotes") return Promise.resolve(1000n);
      if (functionName === "balanceOf") {
        return Promise.resolve(target === contracts.wrappedNative ? 9n : 10n);
      }
      if (functionName === "totalSupply") return Promise.resolve(1_000_000_000n);
      if (["buysPaused", "finalized", "graduationReady", "paused", "initialized"].includes(functionName)) {
        return Promise.resolve(functionName === "initialized");
      }
      if (functionName === "poolId") return Promise.resolve(`0x${"ab".repeat(32)}`);
      if (functionName === "ordinaryStream" || functionName === "zeroSupplyStream") {
        return Promise.resolve([1n, 2n, 1n, 3n, 1n]);
      }
      return Promise.resolve(42n);
    });
    const app = Fastify();
    openApps.push(app);
    registerRdaoRoutes(app, { readContract } as unknown as PublicClient, {
      schemaVersion: 20,
      contracts,
      rdao: {
        allocation: { retained: "800", sale: "150", liquidity: "50" },
        pricing: { ethUsdFixture: "1624.95", ownerTargetUsd: "300000", liquidityTargetUsd: "240000" },
        staking: { warmupSeconds: 86400, rewardDurationSeconds: 3600, zeroSupplyDurationSeconds: 604800 },
      },
    });
    const response = await app.inject({ method: "GET", url: `/rdao?account=${account}` });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual(expect.objectContaining({
      totalSupply: "1000000000",
      account: expect.objectContaining({
        eligibleStake: "800", warmingStake: "200", claimableWeth: "7", wethBalance: "9",
      }),
      liquidity: expect.objectContaining({ initialized: true }),
    }));
  });
});
