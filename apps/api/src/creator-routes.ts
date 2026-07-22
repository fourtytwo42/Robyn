import { randomBytes, randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Redis } from "ioredis";
import type { Address, Hex, PublicClient } from "viem";
import { getAddress } from "viem";
import { parseSiweMessage, verifySiweMessage } from "viem/siwe";
import { createDatabase } from "@robyn/db";
import {
  createCreatorChallenge,
  resolveAuthOrigin,
  validateCreatorChallenge,
} from "./creator-auth.js";
import { sanitizeCreatorImage } from "./creator-media.js";
import { consumeWalletUpload } from "./creator-rate-limit.js";
import {
  validateCreatorProfile,
  validateReportReason,
} from "./profile-validation.js";

type DatabaseSql = ReturnType<typeof createDatabase>["sql"];
type Session = { address: Address; chainId: number; origin: string };
const sessionCookie = "robyn_creator_session";

function header(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function bodyObject(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new Error("json_object_required");
  return body as Record<string, unknown>;
}

function authOriginFor(
  request: FastifyRequest,
  allowedOrigins: ReadonlySet<string>,
  chainId: number,
) {
  const host = header(request.headers.host);
  const origin = header(request.headers.origin);
  return resolveAuthOrigin(
    {
      ...(host ? { host } : {}),
      ...(origin ? { origin } : {}),
      forwardedProto:
        header(request.headers["x-forwarded-proto"]) ?? request.protocol,
    },
    allowedOrigins,
    chainId,
  );
}

async function readSession(
  request: FastifyRequest,
  redis: Redis,
  allowedOrigins: ReadonlySet<string>,
  chainId: number,
) {
  const id = request.cookies[sessionCookie];
  if (!id || !/^[A-Za-z0-9_-]{43}$/.test(id)) return null;
  const stored = await redis.get(`robyn:auth:session:${id}`);
  if (!stored) return null;
  try {
    const session = JSON.parse(stored) as Session;
    if (
      !/^0x[0-9a-f]{40}$/.test(session.address) ||
      !Number.isInteger(session.chainId) ||
      typeof session.origin !== "string"
    )
      return null;
    const requestOrigin = authOriginFor(request, allowedOrigins, chainId);
    return session.origin === requestOrigin.origin ? session : null;
  } catch {
    return null;
  }
}

async function requireSession(
  request: FastifyRequest,
  reply: FastifyReply,
  redis: Redis,
  chainId: number,
  allowedOrigins: ReadonlySet<string>,
) {
  const session = await readSession(request, redis, allowedOrigins, chainId);
  if (!session || session.chainId !== chainId) {
    await reply.code(401).send({ error: "creator_session_required" });
    return null;
  }
  return session;
}

function mediaError(error: unknown) {
  const message = error instanceof Error ? error.message : "invalid_media";
  const clientErrors = new Set([
    "empty_upload",
    "upload_too_large",
    "unsupported_or_malformed_image",
    "content_type_mismatch",
    "image_decode_mismatch",
    "image_dimensions_out_of_range",
    "animated_image_rejected",
  ]);
  return clientErrors.has(message) ? message : "image_processing_failed";
}

export async function registerCreatorRoutes(
  app: FastifyInstance,
  options: {
    chainId: number;
    sql: DatabaseSql;
    redis: Redis;
    rpcClient: PublicClient;
    allowedOrigins: ReadonlySet<string>;
    artifactServiceUrl: string;
  },
) {
  const { chainId, sql, redis, rpcClient, allowedOrigins, artifactServiceUrl } =
    options;

  app.post<{ Body: { address?: unknown } }>(
    "/auth/nonce",
    async (request, reply) => {
      let authOrigin;
      let address: Address;
      try {
        authOrigin = authOriginFor(request, allowedOrigins, chainId);
        if (typeof request.body?.address !== "string")
          throw new Error("address_required");
        address = getAddress(request.body.address).toLowerCase() as Address;
      } catch (error) {
        return reply.code(400).send({
          error: error instanceof Error ? error.message : "invalid_request",
        });
      }
      const nonce = randomBytes(16).toString("hex");
      const message = createCreatorChallenge({
        address,
        chainId,
        nonce,
        authOrigin,
      });
      const stored = JSON.stringify({ address, origin: authOrigin.origin });
      const result = await redis.set(
        `robyn:auth:nonce:${nonce}`,
        stored,
        "EX",
        300,
        "NX",
      );
      if (result !== "OK") throw new Error("nonce_collision");
      return reply.send({ data: { message, expiresInSeconds: 300 } });
    },
  );

  app.post<{ Body: { message?: unknown; signature?: unknown } }>(
    "/auth/verify",
    async (request, reply) => {
      let authOrigin;
      let message: string;
      let signature: Hex;
      let address: Address;
      let nonce: string;
      try {
        authOrigin = authOriginFor(request, allowedOrigins, chainId);
        if (
          typeof request.body?.message !== "string" ||
          typeof request.body.signature !== "string"
        )
          throw new Error("message_and_signature_required");
        message = request.body.message;
        signature = request.body.signature as Hex;
        const parsed = parseSiweMessage(message);
        if (!parsed.address || !parsed.nonce)
          throw new Error("invalid_siwe_message");
        address = getAddress(parsed.address).toLowerCase() as Address;
        nonce = parsed.nonce;
      } catch (error) {
        return reply.code(400).send({
          error: error instanceof Error ? error.message : "invalid_request",
        });
      }
      const storedRaw = await redis.getdel(`robyn:auth:nonce:${nonce}`);
      if (!storedRaw)
        return reply.code(401).send({ error: "nonce_missing_or_replayed" });
      try {
        const stored = JSON.parse(storedRaw) as {
          address: string;
          origin: string;
        };
        if (stored.address !== address || stored.origin !== authOrigin.origin)
          throw new Error("nonce_scope_mismatch");
        validateCreatorChallenge({
          message,
          nonce,
          address,
          chainId,
          authOrigin,
        });
        const valid = await verifySiweMessage(rpcClient, {
          address,
          domain: authOrigin.domain,
          message,
          nonce,
          scheme: authOrigin.scheme,
          signature,
        });
        if (!valid) throw new Error("invalid_signature");
      } catch (error) {
        return reply.code(401).send({
          error:
            error instanceof Error ? error.message : "authentication_failed",
        });
      }
      const sessionId = randomBytes(32).toString("base64url");
      const session: Session = { address, chainId, origin: authOrigin.origin };
      await redis.set(
        `robyn:auth:session:${sessionId}`,
        JSON.stringify(session),
        "EX",
        3600,
      );
      reply.setCookie(sessionCookie, sessionId, {
        httpOnly: true,
        sameSite: "strict",
        path: "/",
        secure: authOrigin.secureCookie,
        maxAge: 3600,
      });
      return reply.send({ data: { address, chainId, expiresInSeconds: 3600 } });
    },
  );

  app.get("/auth/session", async (request) => {
    const session = await readSession(request, redis, allowedOrigins, chainId);
    return {
      data: session
        ? { address: session.address, chainId: session.chainId }
        : null,
    };
  });

  app.post("/auth/logout", async (request, reply) => {
    try {
      authOriginFor(request, allowedOrigins, chainId);
    } catch {
      return reply.code(400).send({ error: "invalid_request_origin" });
    }
    const id = request.cookies[sessionCookie];
    if (id) await redis.del(`robyn:auth:session:${id}`);
    reply.clearCookie(sessionCookie, { path: "/" });
    return reply.send({ ok: true });
  });

  app.get<{ Params: { address: string } }>(
    "/profiles/:address",
    async (request, reply) => {
      if (!/^0x[0-9a-fA-F]{40}$/.test(request.params.address))
        return reply.code(400).send({ error: "invalid_address" });
      const rows = await sql.unsafe(
        "SELECT chain_id,address,display_name,bio,website,x_url,telegram_url,discord_url,avatar_media_id,created_at::text,updated_at::text FROM creator_profiles WHERE chain_id=$1 AND address=$2",
        [chainId, request.params.address.toLowerCase()],
      );
      if (!rows[0]) return reply.code(404).send({ error: "profile_not_found" });
      return reply.send({ data: rows[0] });
    },
  );

  app.put<{ Body: unknown }>("/profile", async (request, reply) => {
    const session = await requireSession(
      request,
      reply,
      redis,
      chainId,
      allowedOrigins,
    );
    if (!session) return;
    let profile;
    try {
      profile = validateCreatorProfile(bodyObject(request.body));
    } catch (error) {
      return reply.code(400).send({
        error: error instanceof Error ? error.message : "invalid_profile",
      });
    }
    if (profile.avatarMediaId) {
      const avatar = await sql.unsafe<{ media_id: string }[]>(
        "SELECT media_id FROM media_assets WHERE media_id=$1 AND chain_id=$2 AND owner_address=$3 AND purpose='avatar' AND status='active'",
        [profile.avatarMediaId, chainId, session.address],
      );
      if (!avatar[0])
        return reply.code(400).send({ error: "invalid_avatar_media" });
    }
    const rows = await sql.unsafe(
      "INSERT INTO creator_profiles(chain_id,address,display_name,bio,website,x_url,telegram_url,discord_url,avatar_media_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(chain_id,address) DO UPDATE SET display_name=EXCLUDED.display_name,bio=EXCLUDED.bio,website=EXCLUDED.website,x_url=EXCLUDED.x_url,telegram_url=EXCLUDED.telegram_url,discord_url=EXCLUDED.discord_url,avatar_media_id=EXCLUDED.avatar_media_id,updated_at=now() RETURNING chain_id,address,display_name,bio,website,x_url,telegram_url,discord_url,avatar_media_id,created_at::text,updated_at::text",
      [
        chainId,
        session.address,
        profile.displayName,
        profile.bio,
        profile.website,
        profile.xUrl,
        profile.telegramUrl,
        profile.discordUrl,
        profile.avatarMediaId,
      ],
    );
    return reply.send({ data: rows[0] });
  });

  app.post<{ Querystring: { purpose?: string } }>(
    "/media",
    async (request, reply) => {
      const session = await requireSession(
        request,
        reply,
        redis,
        chainId,
        allowedOrigins,
      );
      if (!session) return;
      const purpose = request.query.purpose;
      if (purpose !== "token" && purpose !== "avatar")
        return reply.code(400).send({ error: "invalid_media_purpose" });
      const upload = await consumeWalletUpload(redis, chainId, session.address);
      if (!upload.allowed)
        return reply.code(429).send({ error: "wallet_upload_rate_limited" });
      if (!Buffer.isBuffer(request.body))
        return reply.code(415).send({ error: "supported_image_body_required" });
      let sanitized;
      try {
        sanitized = await sanitizeCreatorImage(
          request.body,
          request.headers["content-type"],
        );
      } catch (error) {
        return reply.code(400).send({ error: mediaError(error) });
      }
      const storedResponse = await fetch(
        new URL("/artifacts", artifactServiceUrl),
        {
          method: "PUT",
          headers: {
            "content-type": "application/octet-stream",
            "x-artifact-content-type": sanitized.contentType,
          },
          body: Uint8Array.from(sanitized.output),
        },
      );
      if (!storedResponse.ok)
        throw new Error(`artifact_store_${storedResponse.status}`);
      const stored = (await storedResponse.json()) as {
        data?: { sha256?: string };
      };
      if (!stored.data?.sha256)
        throw new Error("artifact_store_invalid_response");
      const mediaId = randomUUID();
      const rows = await sql.unsafe(
        "INSERT INTO media_assets(media_id,chain_id,owner_address,artifact_sha256,purpose,status,width,height) VALUES($1,$2,$3,$4,$5,'active',1024,1024) RETURNING media_id,chain_id,owner_address,artifact_sha256,purpose,status,width,height,created_at::text",
        [mediaId, chainId, session.address, stored.data.sha256, purpose],
      );
      return reply.code(201).send({ data: rows[0] });
    },
  );

  app.get<{ Params: { mediaId: string } }>(
    "/media/:mediaId",
    async (request, reply) => {
      const rows = await sql.unsafe<
        { artifact_sha256: string; status: string; purpose: string }[]
      >(
        "SELECT artifact_sha256,status,purpose FROM media_assets WHERE media_id=$1 AND chain_id=$2",
        [request.params.mediaId, chainId],
      );
      const media = rows[0];
      if (!media) return reply.code(404).send({ error: "media_not_found" });
      if (media.status !== "active")
        return reply.redirect(
          media.purpose === "avatar"
            ? "/assets/brand/robyn-logo.webp"
            : "/assets/launchpad/token-fallback.webp",
        );
      const response = await fetch(
        new URL(`/artifacts/${media.artifact_sha256}`, artifactServiceUrl),
      );
      if (!response.ok) throw new Error(`artifact_read_${response.status}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      reply.header("content-type", "image/webp");
      reply.header("content-length", String(bytes.length));
      reply.header("cache-control", "no-store");
      reply.header("x-content-type-options", "nosniff");
      return reply.send(bytes);
    },
  );

  app.post<{ Params: { token: string }; Body: unknown }>(
    "/launches/:token/metadata",
    async (request, reply) => {
      const session = await requireSession(
        request,
        reply,
        redis,
        chainId,
        allowedOrigins,
      );
      if (!session) return;
      if (!/^0x[0-9a-fA-F]{40}$/.test(request.params.token))
        return reply.code(400).send({ error: "invalid_token" });
      const token = request.params.token.toLowerCase();
      const body = bodyObject(request.body);
      if (typeof body.mediaId !== "string")
        return reply.code(400).send({ error: "media_id_required" });
      const launch = await sql.unsafe<{ creator: string }[]>(
        "SELECT creator FROM launches WHERE chain_id=$1 AND token=$2",
        [chainId, token],
      );
      if (!launch[0])
        return reply.code(404).send({ error: "launch_not_found" });
      if (launch[0].creator.toLowerCase() !== session.address)
        return reply.code(403).send({ error: "canonical_creator_required" });
      const media = await sql.unsafe<{ media_id: string }[]>(
        "SELECT media_id FROM media_assets WHERE media_id=$1 AND chain_id=$2 AND owner_address=$3 AND purpose='token' AND status='active'",
        [body.mediaId, chainId, session.address],
      );
      if (!media[0])
        return reply.code(400).send({ error: "invalid_token_media" });
      const inserted = await sql.unsafe(
        "INSERT INTO launch_metadata_bindings(chain_id,token,creator_address,media_id) VALUES($1,$2,$3,$4) ON CONFLICT(chain_id,token) DO NOTHING RETURNING chain_id,token,creator_address,media_id,bound_at::text",
        [chainId, token, session.address, body.mediaId],
      );
      if (!inserted[0])
        return reply.code(409).send({ error: "launch_metadata_immutable" });
      return reply.code(201).send({ data: inserted[0] });
    },
  );

  app.get<{ Params: { token: string } }>(
    "/launches/:token/metadata",
    async (request, reply) => {
      if (!/^0x[0-9a-fA-F]{40}$/.test(request.params.token))
        return reply.code(400).send({ error: "invalid_token" });
      const rows = await sql.unsafe(
        "SELECT b.chain_id,b.token,b.creator_address,b.media_id,b.bound_at::text,m.status,p.display_name,p.bio,p.website,p.x_url,p.telegram_url,p.discord_url,p.avatar_media_id FROM launch_metadata_bindings b JOIN media_assets m ON m.media_id=b.media_id LEFT JOIN creator_profiles p ON p.chain_id=b.chain_id AND p.address=b.creator_address WHERE b.chain_id=$1 AND b.token=$2",
        [chainId, request.params.token.toLowerCase()],
      );
      if (!rows[0])
        return reply.code(404).send({ error: "launch_metadata_not_found" });
      return reply.send({ data: rows[0] });
    },
  );

  app.post<{ Params: { mediaId: string }; Body: unknown }>(
    "/media/:mediaId/reports",
    async (request, reply) => {
      let reason;
      try {
        reason = validateReportReason(bodyObject(request.body).reason);
      } catch (error) {
        return reply.code(400).send({
          error: error instanceof Error ? error.message : "invalid_report",
        });
      }
      const exists = await sql.unsafe<{ media_id: string }[]>(
        "SELECT media_id FROM media_assets WHERE media_id=$1 AND chain_id=$2",
        [request.params.mediaId, chainId],
      );
      if (!exists[0]) return reply.code(404).send({ error: "media_not_found" });
      const session = await readSession(
        request,
        redis,
        allowedOrigins,
        chainId,
      );
      const rows = await sql.unsafe(
        "INSERT INTO media_reports(media_id,reporter_address,reason) VALUES($1,$2,$3) RETURNING report_id::text,media_id,created_at::text",
        [request.params.mediaId, session?.address ?? null, reason],
      );
      return reply
        .code(201)
        .send({ data: rows[0], status: "recorded_not_hidden" });
    },
  );
}
