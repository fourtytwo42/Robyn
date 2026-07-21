import {
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3";
import Fastify from "fastify";
import { createDatabase } from "@robyn/db";
import {
  artifactKey,
  normalizeArtifactContentType,
  sha256Hex,
} from "./content-address.js";

const required = [
  "S3_ENDPOINT",
  "S3_REGION",
  "S3_BUCKET",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
] as const;
for (const name of required) {
  if (!process.env[name]) throw new Error("Missing required setting: " + name);
}
const endpoint = process.env.S3_ENDPOINT as string;
const region = process.env.S3_REGION as string;
const bucket = process.env.S3_BUCKET as string;
const accessKeyId = process.env.S3_ACCESS_KEY_ID as string;
const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY as string;
const maxArtifactBytes = Number(
  process.env.MAX_ARTIFACT_BYTES ?? String(2 * 1024 * 1024),
);
const port = Number(process.env.PORT ?? "3200");
const host = process.env.HOST ?? "127.0.0.1";
if (
  !Number.isSafeInteger(maxArtifactBytes) ||
  maxArtifactBytes <= 0 ||
  maxArtifactBytes > 10 * 1024 * 1024
) {
  throw new Error(
    "MAX_ARTIFACT_BYTES must be an integer from 1 through 10485760",
  );
}
const s3 = new S3Client({
  endpoint,
  region,
  forcePathStyle: true,
  credentials: { accessKeyId, secretAccessKey },
});
const { sql } = createDatabase();
const app = Fastify({
  logger: { level: process.env.LOG_LEVEL ?? "info" },
  bodyLimit: maxArtifactBytes,
});
let stopping = false;

app.addContentTypeParser(
  "application/octet-stream",
  { parseAs: "buffer", bodyLimit: maxArtifactBytes },
  (_request, body, done) => done(null, body),
);

async function verifyStore() {
  await s3.send(new HeadBucketCommand({ Bucket: bucket }));
  const database = await sql.unsafe<{ ok: number }[]>("SELECT 1 AS ok");
  if (database[0]?.ok !== 1) throw new Error("Artifact database unavailable");
}

async function recordHeartbeat() {
  await verifyStore();
  await sql.unsafe(
    "INSERT INTO service_heartbeats (service,status,metadata) VALUES ('artifact-store','ok',$1::jsonb) ON CONFLICT (service) DO UPDATE SET status='ok',metadata=EXCLUDED.metadata,updated_at=now()",
    [JSON.stringify({ bucket, endpoint, maxArtifactBytes })],
  );
}

function isAlreadyStored(error: unknown): boolean {
  return (
    error instanceof S3ServiceException &&
    error.$metadata.httpStatusCode === 412
  );
}

async function verifyExisting(
  key: string,
  digest: string,
  expectedLength: number,
) {
  const object = await s3.send(
    new GetObjectCommand({ Bucket: bucket, Key: key }),
  );
  if (!object.Body) throw new Error("Stored artifact body is unavailable");
  const bytes = await object.Body.transformToByteArray();
  if (bytes.byteLength !== expectedLength || sha256Hex(bytes) !== digest) {
    throw new Error("Stored artifact failed content-address verification");
  }
}

app.get("/health", async (_request, reply) => {
  try {
    await verifyStore();
    return reply.send({
      service: "robyn-artifacts",
      status: "ok",
      bucket,
      maxArtifactBytes,
    });
  } catch (error) {
    return reply.code(503).send({
      service: "robyn-artifacts",
      status: "degraded",
      error: error instanceof Error ? error.message : "unavailable",
    });
  }
});

app.put("/artifacts", async (request, reply) => {
  if (!Buffer.isBuffer(request.body)) {
    return reply.code(415).send({ error: "application_octet_stream_required" });
  }
  const content = request.body;
  if (content.length === 0) {
    return reply.code(400).send({ error: "empty_artifact" });
  }
  const digest = sha256Hex(content);
  const key = artifactKey(digest);
  let contentType: string;
  try {
    contentType = normalizeArtifactContentType(
      request.headers["x-artifact-content-type"],
    );
  } catch {
    return reply.code(400).send({ error: "unsupported_artifact_content_type" });
  }
  let created = true;
  try {
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: content,
        ContentLength: content.length,
        ContentType: contentType,
        IfNoneMatch: "*",
        Metadata: { sha256: digest },
      }),
    );
  } catch (error) {
    if (!isAlreadyStored(error)) throw error;
    created = false;
    await verifyExisting(key, digest, content.length);
  }
  await sql.unsafe(
    "INSERT INTO artifacts (sha256,bucket,object_key,byte_length,content_type) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (sha256) DO NOTHING",
    [digest, bucket, key, content.length, contentType],
  );
  const rows = await sql.unsafe<
    {
      sha256: string;
      bucket: string;
      object_key: string;
      byte_length: string;
      content_type: string;
      created_at: string;
    }[]
  >(
    "SELECT sha256,bucket,object_key,byte_length::text,content_type,created_at::text FROM artifacts WHERE sha256=$1",
    [digest],
  );
  const stored = rows[0];
  if (
    !stored ||
    stored.object_key !== key ||
    stored.byte_length !== String(content.length)
  ) {
    throw new Error("Artifact metadata conflict");
  }
  return reply.code(created ? 201 : 200).send({
    data: stored,
    created,
  });
});

app.get<{ Params: { sha256: string } }>(
  "/artifacts/:sha256",
  async (request, reply) => {
    let key: string;
    try {
      key = artifactKey(request.params.sha256);
    } catch {
      return reply.code(400).send({ error: "invalid_sha256" });
    }
    const rows = await sql.unsafe<
      { content_type: string; byte_length: string }[]
    >("SELECT content_type,byte_length::text FROM artifacts WHERE sha256=$1", [
      request.params.sha256,
    ]);
    if (!rows[0]) return reply.code(404).send({ error: "artifact_not_found" });
    const object = await s3.send(
      new GetObjectCommand({ Bucket: bucket, Key: key }),
    );
    if (!object.Body) throw new Error("Stored artifact body is unavailable");
    reply.header("content-type", rows[0].content_type);
    reply.header("content-length", rows[0].byte_length);
    reply.header("etag", '"' + request.params.sha256 + '"');
    reply.header("cache-control", "public, immutable, max-age=31536000");
    reply.header("x-content-type-options", "nosniff");
    return reply.send(object.Body);
  },
);

async function heartbeatLoop() {
  while (!stopping) {
    try {
      await recordHeartbeat();
    } catch (error) {
      app.log.error(
        {
          event: "artifact_heartbeat_failed",
          message: error instanceof Error ? error.message : String(error),
        },
        "artifact heartbeat failed",
      );
    }
    if (!stopping) await new Promise((resolve) => setTimeout(resolve, 10_000));
  }
}

const close = async () => {
  stopping = true;
  await app.close();
  s3.destroy();
  await sql.end();
};
process.on("SIGTERM", () => void close());
process.on("SIGINT", () => void close());
await recordHeartbeat();
await app.listen({ port, host });
await heartbeatLoop();
