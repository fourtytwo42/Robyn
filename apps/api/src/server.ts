import Fastify from "fastify";
import { createDatabase } from "@robyn/db";
import { parseDiscoveryQuery, type DiscoveryQuery } from "./discovery-query.js";

const app = Fastify({
  logger: { level: process.env.LOG_LEVEL ?? "info" },
  bodyLimit: 64 * 1024,
});
const { sql } = createDatabase();
const chainId = Number(process.env.CHAIN_ID ?? "31337");
const port = Number(process.env.PORT ?? "3100");
const host = process.env.HOST ?? "0.0.0.0";

app.addHook("onSend", async (_request, reply, payload) => {
  reply.header("cache-control", "no-store");
  reply.header("x-content-type-options", "nosniff");
  reply.header(
    "access-control-allow-origin",
    process.env.API_CORS_ORIGIN ?? "*",
  );
  return payload;
});

async function freshness() {
  const rows = await sql.unsafe<{ last_block: string; updated_at: string }[]>(
    "SELECT last_block::text,updated_at::text FROM indexer_checkpoints WHERE service='chain-indexer' AND chain_id=$1",
    [chainId],
  );
  return {
    asOfBlock: rows[0]?.last_block ?? null,
    indexedAt: rows[0]?.updated_at ?? null,
  };
}

async function keeperState() {
  const rows = await sql.unsafe<
    { status: string; updated_at: string; fresh: boolean }[]
  >(
    "SELECT status,updated_at::text,(updated_at > now() - interval '30 seconds') fresh FROM service_heartbeats WHERE service='conversion-keeper'",
  );
  return {
    keeperStatus: rows[0]?.status === "ok" && rows[0].fresh ? "ok" : "degraded",
    keeperUpdatedAt: rows[0]?.updated_at ?? null,
  };
}

async function artifactState() {
  const rows = await sql.unsafe<
    { status: string; updated_at: string; fresh: boolean }[]
  >(
    "SELECT status,updated_at::text,(updated_at > now() - interval '30 seconds') fresh FROM service_heartbeats WHERE service='artifact-store'",
  );
  return {
    artifactStatus:
      rows[0]?.status === "ok" && rows[0].fresh ? "ok" : "degraded",
    artifactUpdatedAt: rows[0]?.updated_at ?? null,
  };
}

app.get("/health", async (_request, reply) => {
  const [database, state, keeper, artifact] = await Promise.all([
    sql.unsafe<{ ok: number }[]>("SELECT 1 AS ok"),
    freshness(),
    keeperState(),
    artifactState(),
  ]);
  const healthy =
    database[0]?.ok === 1 &&
    state.asOfBlock !== null &&
    keeper.keeperStatus === "ok" &&
    artifact.artifactStatus === "ok";
  return reply.code(healthy ? 200 : 503).send({
    service: "robyn-api",
    status: healthy ? "ok" : "degraded",
    chainId,
    ...state,
    ...keeper,
    ...artifact,
  });
});

app.get("/status", async () => {
  const [state, counts, keeper, artifact] = await Promise.all([
    freshness(),
    sql.unsafe<{ launches: string; logs: string }[]>(
      "SELECT (SELECT count(*)::text FROM launches WHERE chain_id=$1) launches,(SELECT count(*)::text FROM raw_logs WHERE chain_id=$1) logs",
      [chainId],
    ),
    keeperState(),
    artifactState(),
  ]);
  return {
    service: "robyn-api",
    chainId,
    ...state,
    launchCount: counts[0]?.launches ?? "0",
    rawLogCount: counts[0]?.logs ?? "0",
    formulaVersion: "native-v1",
    ...keeper,
    ...artifact,
  };
});

app.get("/operations", async () => {
  const [keeper, counts, jobs, events] = await Promise.all([
    keeperState(),
    sql.unsafe<{ state: string; count: string }[]>(
      "SELECT state,count(*)::text count FROM job_audit WHERE queue='robyn-conversions' GROUP BY state ORDER BY state",
    ),
    sql.unsafe(
      "SELECT idempotency_key,state,attempts,last_error,result,created_at::text,updated_at::text,completed_at::text FROM job_audit WHERE queue='robyn-conversions' ORDER BY updated_at DESC LIMIT 25",
    ),
    sql.unsafe(
      "SELECT event_id::text,idempotency_key,state,attempts,last_error,result,created_at::text FROM job_audit_events WHERE queue='robyn-conversions' ORDER BY event_id DESC LIMIT 50",
    ),
  ]);
  return {
    service: "robyn-api",
    queue: "robyn-conversions",
    ...keeper,
    counts: Object.fromEntries(counts.map((row) => [row.state, row.count])),
    recent: jobs,
    recentEvents: events,
  };
});

app.get<{
  Querystring: DiscoveryQuery;
}>("/launches", async (request, reply) => {
  const {
    limit,
    before,
    query,
    asset,
    basketSize,
    invalidCursor,
    invalidCanonicalAddress,
  } = parseDiscoveryQuery(request.query);
  if (invalidCursor) {
    return reply.code(400).send({ error: "invalid_cursor" });
  }
  const state = await freshness();
  if (invalidCanonicalAddress) {
    return {
      data: [],
      nextCursor: null,
      queryStatus: "invalid_address",
      filters: { q: query, asset, basketSize },
      ...state,
    };
  }
  const rows = await sql.unsafe<{ launch_id: string }[]>(
    "SELECT launch_id::text,token,vault,market,creator,name,symbol,assets,weights_bps,created_block::text,updated_block::text,formula_version FROM launches WHERE chain_id=$1 AND ($2::bigint IS NULL OR launch_id<$2::bigint) AND ($4::text IS NULL OR token=$4 OR strpos(lower(name),$4)>0 OR strpos(lower(symbol),$4)>0) AND ($5::text IS NULL OR assets ? $5) AND ($6::integer IS NULL OR jsonb_array_length(assets)=$6) ORDER BY CASE WHEN token=$4 THEN 0 ELSE 1 END,launch_id DESC LIMIT $3",
    [chainId, before, limit, query, asset, basketSize],
  );
  return {
    data: rows,
    nextCursor:
      rows.length === limit
        ? (rows.at(-1) as { launch_id: string }).launch_id
        : null,
    queryStatus: "ok",
    filters: { q: query, asset, basketSize },
    ...state,
  };
});

app.get<{ Params: { token: string } }>(
  "/launches/:token",
  async (request, reply) => {
    if (!/^0x[0-9a-fA-F]{40}$/.test(request.params.token))
      return reply.code(400).send({ error: "invalid_token" });
    const rows = await sql.unsafe(
      "SELECT launch_id::text,token,vault,market,creator,name,symbol,assets,weights_bps,created_block::text,updated_block::text,formula_version FROM launches WHERE chain_id=$1 AND token=$2",
      [chainId, request.params.token.toLowerCase()],
    );
    if (!rows[0]) return reply.code(404).send({ error: "launch_not_found" });
    return { data: rows[0], ...(await freshness()) };
  },
);

app.get<{ Params: { token: string }; Querystring: { limit?: string } }>(
  "/launches/:token/activity",
  async (request, reply) => {
    if (!/^0x[0-9a-fA-F]{40}$/.test(request.params.token))
      return reply.code(400).send({ error: "invalid_token" });
    const launch = await sql.unsafe<
      { token: string; vault: string; market: string }[]
    >(
      "SELECT token,vault,market FROM launches WHERE chain_id=$1 AND token=$2",
      [chainId, request.params.token.toLowerCase()],
    );
    if (!launch[0]) return reply.code(404).send({ error: "launch_not_found" });
    const limit = Math.min(
      Math.max(Number(request.query.limit ?? "50"), 1),
      200,
    );
    const rows = await sql.unsafe(
      "SELECT block_number::text,block_hash,transaction_hash,transaction_index,log_index,address,topics,data FROM raw_logs WHERE chain_id=$1 AND address=ANY($2::text[]) ORDER BY block_number DESC,transaction_index DESC,log_index DESC LIMIT $3",
      [chainId, [launch[0].token, launch[0].vault, launch[0].market], limit],
    );
    return { data: rows, ...(await freshness()) };
  },
);

app.get<{ Params: { sha256: string } }>(
  "/artifacts/:sha256/metadata",
  async (request, reply) => {
    if (!/^[0-9a-f]{64}$/.test(request.params.sha256)) {
      return reply.code(400).send({ error: "invalid_sha256" });
    }
    const rows = await sql.unsafe(
      "SELECT sha256,bucket,object_key,byte_length::text,content_type,created_at::text FROM artifacts WHERE sha256=$1",
      [request.params.sha256],
    );
    if (!rows[0]) return reply.code(404).send({ error: "artifact_not_found" });
    return { data: rows[0] };
  },
);

app.get("/assets", async () => {
  const rows = await sql.unsafe<{ address: string }[]>(
    "SELECT DISTINCT jsonb_array_elements_text(assets) address FROM launches WHERE chain_id=$1 ORDER BY address",
    [chainId],
  );
  return {
    data: rows.map((row) => ({
      address: row.address,
      environment: "robyn-devnet",
      status: "mock-active",
    })),
    ...(await freshness()),
  };
});

const close = async () => {
  await app.close();
  await sql.end();
};
process.on("SIGTERM", () => void close());
process.on("SIGINT", () => void close());
await app.listen({ port, host });
