import type { RpcBody, RpcPayload } from "./failover.js";

const allowedReadMethods = new Set([
  "eth_blockNumber",
  "eth_call",
  "eth_chainId",
  "eth_estimateGas",
  "eth_feeHistory",
  "eth_gasPrice",
  "eth_getBalance",
  "eth_getBlockByHash",
  "eth_getBlockByNumber",
  "eth_getBlockTransactionCountByHash",
  "eth_getBlockTransactionCountByNumber",
  "eth_getCode",
  "eth_getLogs",
  "eth_getProof",
  "eth_getStorageAt",
  "eth_getTransactionByBlockHashAndIndex",
  "eth_getTransactionByBlockNumberAndIndex",
  "eth_getTransactionByHash",
  "eth_getTransactionCount",
  "eth_getTransactionReceipt",
  "eth_maxPriorityFeePerGas",
  "eth_syncing",
  "net_version",
  "web3_clientVersion",
]);

const MAX_BATCH_SIZE = 20;

type PolicyError = {
  jsonrpc: "2.0";
  id: string | number | null;
  error: { code: number; message: string };
};

function isRpcPayload(value: unknown): value is RpcPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const payload = value as Partial<RpcPayload>;
  return (
    payload.jsonrpc === "2.0" &&
    typeof payload.method === "string" &&
    payload.method.length > 0 &&
    payload.method.length <= 80 &&
    (payload.params === undefined || Array.isArray(payload.params)) &&
    (payload.id === undefined ||
      payload.id === null ||
      typeof payload.id === "string" ||
      typeof payload.id === "number")
  );
}

function error(
  id: RpcPayload["id"],
  code: number,
  message: string,
): PolicyError {
  return {
    jsonrpc: "2.0",
    id: id ?? null,
    error: { code, message },
  };
}

function validateEntry(
  value: unknown,
  transactionSubmissionAuthorized: boolean,
): PolicyError | null {
  if (!isRpcPayload(value)) {
    return error(null, -32600, "Invalid JSON-RPC request");
  }
  if (value.method === "eth_sendRawTransaction") {
    return transactionSubmissionAuthorized
      ? null
      : error(value.id, -32001, "Mainnet transaction submission is disabled");
  }
  if (!allowedReadMethods.has(value.method)) {
    return error(value.id, -32601, "JSON-RPC method is not permitted");
  }
  return null;
}

export function publicRpcPolicyError(
  body: RpcBody,
  transactionSubmissionAuthorized: boolean,
): PolicyError | PolicyError[] | null {
  if (Array.isArray(body)) {
    if (body.length === 0 || body.length > MAX_BATCH_SIZE) {
      return [error(null, -32600, "Invalid JSON-RPC batch")];
    }
    const errors = body
      .map((entry) => validateEntry(entry, transactionSubmissionAuthorized))
      .filter((entry): entry is PolicyError => entry !== null);
    return errors.length > 0 ? errors : null;
  }
  return validateEntry(body, transactionSubmissionAuthorized);
}

export function publicRpcPolicySnapshot(
  transactionSubmissionAuthorized: boolean,
) {
  return {
    schemaVersion: 1,
    methodAllowlist: true,
    maximumBatchSize: MAX_BATCH_SIZE,
    readMethods: [...allowedReadMethods].sort(),
    signedRawTransactionRelay: true,
    transactionSubmissionAuthorized,
    blockedNamespaces: [
      "admin",
      "debug",
      "engine",
      "miner",
      "personal",
      "txpool",
      "wallet",
    ],
  };
}
