import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Address, Hex, PublicClient } from "viem";
import { registerDaoRoutes } from "../src/dao-routes";

const addresses = {
  daoToken: "0x0000000000000000000000000000000000000001",
  governor: "0x0000000000000000000000000000000000000002",
  timelock: "0x0000000000000000000000000000000000000003",
  guardian: "0x0000000000000000000000000000000000000004",
  protocolFeeRouter: "0x0000000000000000000000000000000000000005",
  nativeFeeConverter: "0x0000000000000000000000000000000000000006",
} satisfies Record<string, Address>;

const openApps: Array<ReturnType<typeof Fastify>> = [];

afterEach(async () => {
  await Promise.all(openApps.splice(0).map((app) => app.close()));
});

describe("DAO activity", () => {
  it("reads the address-filtered deployment range once and returns newest logs first", async () => {
    const getLogs = vi.fn().mockResolvedValue([
      {
        address: addresses.daoToken,
        blockNumber: 101n,
        transactionHash: ("0x" + "11".repeat(32)) as Hex,
        topics: [("0x" + "aa".repeat(32)) as Hex],
      },
      {
        address: addresses.governor,
        blockNumber: 102n,
        transactionHash: ("0x" + "22".repeat(32)) as Hex,
        topics: [("0x" + "bb".repeat(32)) as Hex],
      },
    ]);
    const app = Fastify();
    openApps.push(app);
    registerDaoRoutes(app, { getLogs } as unknown as PublicClient, {
      deploymentBlock: 100,
      contracts: addresses,
    });

    const response = await app.inject({
      method: "GET",
      url: "/dao/activity",
    });

    expect(response.statusCode).toBe(200);
    expect(getLogs).toHaveBeenCalledOnce();
    expect(getLogs).toHaveBeenCalledWith({
      address: [
        addresses.daoToken,
        addresses.governor,
        addresses.timelock,
        addresses.protocolFeeRouter,
        addresses.nativeFeeConverter,
      ],
      fromBlock: 100n,
      toBlock: "latest",
    });
    expect(response.json().data).toEqual([
      expect.objectContaining({
        address: addresses.governor,
        blockNumber: "102",
      }),
      expect.objectContaining({
        address: addresses.daoToken,
        blockNumber: "101",
      }),
    ]);
  });
});

describe("DAO proposals", () => {
  it("shares one cached event scan between the list and detail routes", async () => {
    const proposalId = 42n;
    const getLogs = vi.fn().mockImplementation(({ event }) =>
      Promise.resolve(
        event.name === "ProposalCreated"
          ? [
              {
                address: addresses.governor,
                args: {
                  proposalId,
                  proposer: addresses.guardian,
                  targets: [addresses.timelock],
                  values: [0n],
                  signatures: [""],
                  calldatas: ["0x" as Hex],
                  voteStart: 1000n,
                  voteEnd: 2000n,
                  description: "# Cached proposal",
                },
                transactionHash: ("0x" + "33".repeat(32)) as Hex,
              },
            ]
          : [],
      ),
    );
    const readContract = vi.fn().mockImplementation(({ functionName }) => {
      if (functionName === "state") return Promise.resolve(4);
      if (functionName === "proposalVotes")
        return Promise.resolve([1n, 2n, 3n]);
      throw new Error(`unexpected read ${functionName}`);
    });
    const app = Fastify();
    openApps.push(app);
    registerDaoRoutes(
      app,
      { getLogs, readContract } as unknown as PublicClient,
      {
        deploymentBlock: 100,
        contracts: addresses,
      },
    );

    const list = await app.inject({
      method: "GET",
      url: "/dao/proposals",
    });
    const detail = await app.inject({
      method: "GET",
      url: `/dao/proposals/${proposalId}`,
    });

    expect(list.statusCode).toBe(200);
    expect(detail.statusCode).toBe(200);
    expect(detail.json().data).toEqual(
      expect.objectContaining({
        id: proposalId.toString(),
        title: "Cached proposal",
      }),
    );
    expect(getLogs).toHaveBeenCalledTimes(5);
  });
});
