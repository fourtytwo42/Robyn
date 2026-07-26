import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
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
  addAndPinIpfs,
  canonicalTokenMetadata,
  requestRemotePin,
} from "./ipfs.js";
import {
  validateCreatorProfile,
  validateReportReason,
} from "./profile-validation.js";

type DatabaseSql = ReturnType<typeof createDatabase>["sql"];
type Session = { address: Address; chainId: number; origin: string };
const sessionCookie = "robyn_creator_session";
const tokenUriAbi = [
  {
    type: "function",
    name: "tokenURI",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "string" }],
  },
] as const;

function header(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function bodyObject(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new Error("json_object_required");
  return body as Record<string, unknown>;
}

function hasOperatorToken(request: FastifyRequest, expected?: string) {
  if (!expected || expected.length < 32) return false;
  const supplied = header(request.headers["x-robyn-operator-token"]);
  if (!supplied) return false;
  const left = Buffer.from(supplied);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
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
    ipfsApiUrl: string;
    remotePinUrl?: string;
    remotePinToken?: string;
    campaignOperatorToken?: string;
    fallbackArtworkPath?: string;
  },
) {
  const {
    chainId,
    sql,
    redis,
    rpcClient,
    allowedOrigins,
    artifactServiceUrl,
    ipfsApiUrl,
    remotePinUrl,
    remotePinToken,
    campaignOperatorToken,
    fallbackArtworkPath = `${process.cwd()}/apps/web/public/assets/launchpad/token-fallback.webp`,
  } = options;

  async function storeArtifact(bytes: Buffer, contentType: string) {
    const response = await fetch(new URL("/artifacts", artifactServiceUrl), {
      method: "PUT",
      headers: {
        "content-type": "application/octet-stream",
        "x-artifact-content-type": contentType,
      },
      body: Uint8Array.from(bytes),
    });
    if (!response.ok) throw new Error(`artifact_store_${response.status}`);
    const stored = (await response.json()) as {
      data?: { sha256?: string };
    };
    if (!stored.data?.sha256)
      throw new Error("artifact_store_invalid_response");
    return stored.data.sha256;
  }

  async function recordPin(input: {
    cid: string;
    objectKind: string;
    artifactSha256: string;
    name: string;
  }) {
    const remote = await requestRemotePin(
      input.cid,
      input.name,
      remotePinUrl,
      remotePinToken,
    );
    await sql.unsafe(
      "INSERT INTO ipfs_pins(cid,object_kind,artifact_sha256,local_status,remote_status,remote_request_id,attempts,last_error,verified_at) VALUES($1,$2,$3,'pinned',$4,$5,1,$6,now()) ON CONFLICT(cid) DO UPDATE SET local_status='pinned',remote_status=EXCLUDED.remote_status,remote_request_id=COALESCE(EXCLUDED.remote_request_id,ipfs_pins.remote_request_id),attempts=ipfs_pins.attempts+1,last_error=EXCLUDED.last_error,verified_at=now(),updated_at=now()",
      [
        input.cid,
        input.objectKind,
        input.artifactSha256,
        remote.state,
        remote.requestId ?? null,
        remote.error ?? null,
      ],
    );
    return remote.state;
  }

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
      const [webpSha256, pngSha256] = await Promise.all([
        storeArtifact(sanitized.webp, "image/webp"),
        storeArtifact(sanitized.png, "image/png"),
      ]);
      const [webpCid, pngCid] = await Promise.all([
        addAndPinIpfs(sanitized.webp, "token.webp", ipfsApiUrl),
        addAndPinIpfs(sanitized.png, "token.png", ipfsApiUrl),
      ]);
      const [webpRemoteStatus, pngRemoteStatus] = await Promise.all([
        recordPin({
          cid: webpCid,
          objectKind: "token-webp",
          artifactSha256: webpSha256,
          name: `robyn-${chainId}-token-webp`,
        }),
        recordPin({
          cid: pngCid,
          objectKind: "token-png",
          artifactSha256: pngSha256,
          name: `robyn-${chainId}-token-png`,
        }),
      ]);
      const mediaId = randomUUID();
      const rows = await sql.unsafe(
        "INSERT INTO media_assets(media_id,chain_id,owner_address,artifact_sha256,canonical_png_sha256,canonical_png_cid,optimized_webp_cid,has_alpha,purpose,status,width,height) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'active',1024,1024) RETURNING media_id,chain_id,owner_address,artifact_sha256,canonical_png_sha256,canonical_png_cid,optimized_webp_cid,has_alpha,purpose,status,width,height,created_at::text",
        [
          mediaId,
          chainId,
          session.address,
          webpSha256,
          pngSha256,
          pngCid,
          webpCid,
          sanitized.hasAlpha,
          purpose,
        ],
      );
      return reply.code(201).send({
        data: {
          ...rows[0],
          png_uri: `ipfs://${pngCid}`,
          webp_uri: `ipfs://${webpCid}`,
          local_pin_status: "pinned",
          remote_pin_status:
            webpRemoteStatus === "pinned" && pngRemoteStatus === "pinned"
              ? "pinned"
              : webpRemoteStatus === "failed" || pngRemoteStatus === "failed"
                ? "failed"
                : "queued",
        },
      });
    },
  );

  app.post<{ Body: unknown }>(
    "/launch-metadata/prepare",
    async (request, reply) => {
      const session = await requireSession(
        request,
        reply,
        redis,
        chainId,
        allowedOrigins,
      );
      if (!session) return;
      let body: Record<string, unknown>;
      try {
        body = bodyObject(request.body);
      } catch (error) {
        return reply.code(400).send({
          error: error instanceof Error ? error.message : "invalid_request",
        });
      }
      if (
        (body.mediaId !== undefined && typeof body.mediaId !== "string") ||
        typeof body.name !== "string" ||
        typeof body.symbol !== "string" ||
        (body.description !== undefined &&
          typeof body.description !== "string") ||
        (body.website !== undefined && typeof body.website !== "string") ||
        (body.xUrl !== undefined && typeof body.xUrl !== "string")
      )
        return reply.code(400).send({ error: "invalid_metadata_request" });
      const hasCampaignFields =
        body.campaignId !== undefined || body.releaseSha !== undefined;
      if (
        hasCampaignFields &&
        !hasOperatorToken(request, campaignOperatorToken)
      )
        return reply.code(403).send({ error: "campaign_operator_required" });
      const campaign =
        hasCampaignFields &&
        typeof body.campaignId === "string" &&
        typeof body.releaseSha === "string"
          ? {
              campaignId: body.campaignId,
              releaseSha: body.releaseSha,
            }
          : undefined;
      if (hasCampaignFields && !campaign)
        return reply.code(400).send({ error: "invalid_test_campaign" });
      let mediaId = typeof body.mediaId === "string" ? body.mediaId : undefined;
      if (!mediaId) {
        let sanitized;
        try {
          sanitized = await sanitizeCreatorImage(
            await readFile(fallbackArtworkPath),
            "image/webp",
          );
        } catch {
          return reply
            .code(503)
            .send({ error: "fallback_artwork_unavailable" });
        }
        const [webpSha256, pngSha256] = await Promise.all([
          storeArtifact(sanitized.webp, "image/webp"),
          storeArtifact(sanitized.png, "image/png"),
        ]);
        const [webpCid, pngCid] = await Promise.all([
          addAndPinIpfs(sanitized.webp, "token.webp", ipfsApiUrl),
          addAndPinIpfs(sanitized.png, "token.png", ipfsApiUrl),
        ]);
        await Promise.all([
          recordPin({
            cid: webpCid,
            objectKind: "token-webp",
            artifactSha256: webpSha256,
            name: `robyn-${chainId}-fallback-webp`,
          }),
          recordPin({
            cid: pngCid,
            objectKind: "token-png",
            artifactSha256: pngSha256,
            name: `robyn-${chainId}-fallback-png`,
          }),
        ]);
        mediaId = randomUUID();
        await sql.unsafe(
          "INSERT INTO media_assets(media_id,chain_id,owner_address,artifact_sha256,canonical_png_sha256,canonical_png_cid,optimized_webp_cid,has_alpha,purpose,status,width,height) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'token','active',1024,1024)",
          [
            mediaId,
            chainId,
            session.address,
            webpSha256,
            pngSha256,
            pngCid,
            webpCid,
            sanitized.hasAlpha,
          ],
        );
      }
      const media = await sql.unsafe<
        {
          media_id: string;
          canonical_png_cid: string;
          optimized_webp_cid: string;
          has_alpha: boolean;
        }[]
      >(
        "SELECT media_id,canonical_png_cid,optimized_webp_cid,has_alpha FROM media_assets WHERE media_id=$1 AND chain_id=$2 AND owner_address=$3 AND purpose='token' AND status='active'",
        [mediaId, chainId, session.address],
      );
      if (!media[0]?.canonical_png_cid || !media[0].optimized_webp_cid)
        return reply.code(400).send({ error: "ipfs_token_media_required" });
      let metadataBytes: Buffer;
      try {
        metadataBytes = canonicalTokenMetadata({
          name: body.name,
          symbol: body.symbol,
          ...(typeof body.description === "string"
            ? { description: body.description }
            : {}),
          pngCid: media[0].canonical_png_cid,
          webpCid: media[0].optimized_webp_cid,
          hasAlpha: media[0].has_alpha,
          ...(typeof body.website === "string"
            ? { website: body.website }
            : {}),
          ...(typeof body.xUrl === "string" ? { xUrl: body.xUrl } : {}),
          ...(campaign ? { testCampaign: campaign } : {}),
        });
      } catch (error) {
        return reply.code(400).send({
          error: error instanceof Error ? error.message : "invalid_metadata",
        });
      }
      const artifactSha256 = await storeArtifact(
        metadataBytes,
        "application/json",
      );
      const metadataCid = await addAndPinIpfs(
        metadataBytes,
        "token.json",
        ipfsApiUrl,
      );
      const remoteStatus = await recordPin({
        cid: metadataCid,
        objectKind: "token-metadata",
        artifactSha256,
        name: `robyn-${chainId}-${body.symbol}-metadata`,
      });
      const parsedMetadata = JSON.parse(metadataBytes.toString()) as {
        external_url?: string;
        links?: { x?: string };
      };
      const preparationId = randomUUID();
      const metadataUri = `ipfs://${metadataCid}`;
      const rows = await sql.unsafe(
        "INSERT INTO prepared_token_metadata(preparation_id,chain_id,owner_address,media_id,name,symbol,description,metadata_artifact_sha256,metadata_cid,metadata_uri,status,campaign_id,campaign_release_sha,automated_test_launch,project_website,project_x_url) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'ready',$11,$12,$13,$14,$15) RETURNING preparation_id,media_id,name,symbol,description,metadata_cid,metadata_uri,status,campaign_id,campaign_release_sha,automated_test_launch,project_website,project_x_url,created_at::text,expires_at::text",
        [
          preparationId,
          chainId,
          session.address,
          mediaId,
          body.name.trim(),
          body.symbol.trim(),
          typeof body.description === "string" ? body.description.trim() : "",
          artifactSha256,
          metadataCid,
          metadataUri,
          campaign?.campaignId ?? null,
          campaign?.releaseSha ?? null,
          Boolean(campaign),
          parsedMetadata.external_url ?? null,
          parsedMetadata.links?.x ?? null,
        ],
      );
      return reply.code(201).send({
        data: {
          ...rows[0],
          local_pin_status: "pinned",
          remote_pin_status: remoteStatus,
        },
      });
    },
  );

  app.get<{ Params: { preparationId: string } }>(
    "/launch-metadata/:preparationId",
    async (request, reply) => {
      if (!/^[0-9a-f-]{36}$/.test(request.params.preparationId))
        return reply.code(400).send({ error: "invalid_preparation_id" });
      const rows = await sql.unsafe(
        "SELECT p.preparation_id,p.media_id,p.name,p.symbol,p.description,p.metadata_cid,p.metadata_uri,p.status,p.bound_token,p.campaign_id,p.campaign_release_sha,p.automated_test_launch,p.project_website,p.project_x_url,p.created_at::text,p.expires_at::text,i.local_status,i.remote_status,i.last_error FROM prepared_token_metadata p JOIN ipfs_pins i ON i.cid=p.metadata_cid WHERE p.preparation_id=$1 AND p.chain_id=$2",
        [request.params.preparationId, chainId],
      );
      if (!rows[0])
        return reply
          .code(404)
          .send({ error: "metadata_preparation_not_found" });
      return reply.send({ data: rows[0] });
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
      if (
        typeof body.mediaId !== "string" &&
        typeof body.preparationId !== "string"
      )
        return reply
          .code(400)
          .send({ error: "media_or_preparation_id_required" });
      const launch = await sql.unsafe<{ creator: string }[]>(
        "SELECT creator FROM launches WHERE chain_id=$1 AND token=$2",
        [chainId, token],
      );
      if (!launch[0])
        return reply.code(404).send({ error: "launch_not_found" });
      if (launch[0].creator.toLowerCase() !== session.address)
        return reply.code(403).send({ error: "canonical_creator_required" });
      const preparation =
        typeof body.preparationId === "string"
          ? await sql.unsafe<
              {
                preparation_id: string;
                media_id: string;
                metadata_cid: string;
                metadata_uri: string;
                status: string;
                campaign_id: string | null;
                campaign_release_sha: string | null;
                automated_test_launch: boolean;
                project_website: string | null;
                project_x_url: string | null;
              }[]
            >(
              "SELECT preparation_id,media_id,metadata_cid,metadata_uri,status,campaign_id,campaign_release_sha,automated_test_launch,project_website,project_x_url FROM prepared_token_metadata WHERE preparation_id=$1 AND chain_id=$2 AND owner_address=$3 AND status='ready' AND expires_at>now()",
              [body.preparationId, chainId, session.address],
            )
          : [];
      const mediaId =
        preparation[0]?.media_id ??
        (typeof body.mediaId === "string" ? body.mediaId : "");
      const media = await sql.unsafe<{ media_id: string }[]>(
        "SELECT media_id FROM media_assets WHERE media_id=$1 AND chain_id=$2 AND owner_address=$3 AND purpose='token' AND status='active'",
        [mediaId, chainId, session.address],
      );
      if (!media[0])
        return reply.code(400).send({ error: "invalid_token_media" });
      if (typeof body.preparationId === "string" && !preparation[0])
        return reply.code(400).send({ error: "invalid_metadata_preparation" });
      if (preparation[0]) {
        const onchainUri = await rpcClient.readContract({
          address: token as Address,
          abi: tokenUriAbi,
          functionName: "tokenURI",
        });
        if (onchainUri !== preparation[0].metadata_uri)
          return reply.code(409).send({ error: "onchain_metadata_mismatch" });
      }
      const inserted = await sql.begin(async (transaction) => {
        const rows = await transaction.unsafe(
          "INSERT INTO launch_metadata_bindings(chain_id,token,creator_address,media_id,preparation_id,metadata_cid,metadata_uri,verification_status,campaign_id,campaign_release_sha,automated_test_launch,project_website,project_x_url) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT(chain_id,token) DO NOTHING RETURNING chain_id,token,creator_address,media_id,preparation_id,metadata_cid,metadata_uri,verification_status,campaign_id,campaign_release_sha,automated_test_launch,project_website,project_x_url,bound_at::text",
          [
            chainId,
            token,
            session.address,
            mediaId,
            preparation[0]?.preparation_id ?? null,
            preparation[0]?.metadata_cid ?? null,
            preparation[0]?.metadata_uri ?? null,
            preparation[0] ? "robyn-sanitized" : "legacy",
            preparation[0]?.campaign_id ?? null,
            preparation[0]?.campaign_release_sha ?? null,
            preparation[0]?.automated_test_launch ?? false,
            preparation[0]?.project_website ?? null,
            preparation[0]?.project_x_url ?? null,
          ],
        );
        if (rows[0] && preparation[0]) {
          await transaction.unsafe(
            "UPDATE prepared_token_metadata SET status='bound',bound_token=$1,bound_at=now() WHERE preparation_id=$2 AND status='ready'",
            [token, preparation[0].preparation_id],
          );
        }
        return rows;
      });
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
        "SELECT b.chain_id,b.token,b.creator_address,b.media_id,b.preparation_id,b.metadata_cid,b.metadata_uri,b.verification_status,b.campaign_id,b.campaign_release_sha,b.automated_test_launch,b.project_website,b.project_x_url,b.bound_at::text,m.status,m.canonical_png_cid,m.optimized_webp_cid,p.display_name,p.bio,p.website,p.x_url,p.telegram_url,p.discord_url,p.avatar_media_id,ip.local_status,ip.remote_status FROM launch_metadata_bindings b JOIN media_assets m ON m.media_id=b.media_id LEFT JOIN creator_profiles p ON p.chain_id=b.chain_id AND p.address=b.creator_address LEFT JOIN ipfs_pins ip ON ip.cid=b.metadata_cid WHERE b.chain_id=$1 AND b.token=$2",
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
