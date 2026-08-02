import { describe, expect, it } from "vitest";

import {
  publicRpcPolicyError,
  publicRpcPolicySnapshot,
} from "../src/public-policy.js";

const read = {
  jsonrpc: "2.0" as const,
  id: 1,
  method: "eth_getBalance",
  params: ["0x0000000000000000000000000000000000000001", "latest"],
};
const write = {
  jsonrpc: "2.0" as const,
  id: 2,
  method: "eth_sendRawTransaction",
  params: ["0x1234"],
};

describe("public Mainnet RPC policy", () => {
  it("permits bounded reads whether writes are disabled or enabled", () => {
    expect(publicRpcPolicyError(read, false)).toBeNull();
    expect(publicRpcPolicyError(read, true)).toBeNull();
  });

  it("gates signed raw transactions independently from reads", () => {
    expect(publicRpcPolicyError(write, false)).toEqual({
      jsonrpc: "2.0",
      id: 2,
      error: {
        code: -32001,
        message: "Mainnet transaction submission is disabled",
      },
    });
    expect(publicRpcPolicyError(write, true)).toBeNull();
  });

  it("blocks unlocked accounts and privileged namespaces", () => {
    for (const method of [
      "eth_sendTransaction",
      "personal_unlockAccount",
      "admin_peers",
      "debug_traceTransaction",
      "txpool_content",
    ]) {
      expect(
        publicRpcPolicyError(
          { jsonrpc: "2.0", id: method, method, params: [] },
          true,
        ),
      ).toMatchObject({ error: { code: -32601 } });
    }
  });

  it("rejects malformed and oversized batches", () => {
    expect(publicRpcPolicyError([], true)).toMatchObject([
      { error: { code: -32600 } },
    ]);
    expect(
      publicRpcPolicyError(
        Array.from({ length: 21 }, () => read),
        true,
      ),
    ).toMatchObject([{ error: { code: -32600 } }]);
    expect(
      publicRpcPolicyError(
        [{ ...read }, { ...write, method: "wallet_importRawKey" }],
        true,
      ),
    ).toMatchObject([{ error: { code: -32601 } }]);
  });

  it("reports a fail-closed public policy snapshot", () => {
    const snapshot = publicRpcPolicySnapshot(false);
    expect(snapshot).toMatchObject({
      schemaVersion: 1,
      methodAllowlist: true,
      maximumBatchSize: 20,
      signedRawTransactionRelay: true,
      transactionSubmissionAuthorized: false,
    });
    expect(snapshot.blockedNamespaces).toEqual(
      expect.arrayContaining(["admin", "debug", "personal", "wallet"]),
    );
  });
});
