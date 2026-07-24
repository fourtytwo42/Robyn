import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { createDatabase } from "@robyn/db";

type DatabaseSql = ReturnType<typeof createDatabase>["sql"];

function authorized(request: FastifyRequest, expected: string) {
  const supplied = request.headers["x-robyn-operator-token"];
  if (typeof supplied !== "string" || expected.length < 32) return false;
  const left = Buffer.from(supplied);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function registerCampaignRoutes(
  app: FastifyInstance,
  options: {
    sql: DatabaseSql;
    chainId: number;
    operatorToken?: string;
    releaseSha: string;
  },
) {
  app.get<{ Params: { campaignId: string } }>(
    "/operator/campaigns/:campaignId",
    async (request, reply) => {
      if (!options.operatorToken || !authorized(request, options.operatorToken))
        return reply.code(404).send({ error: "not_found" });
      if (!/^[a-z0-9][a-z0-9-]{2,63}$/.test(request.params.campaignId))
        return reply.code(400).send({ error: "invalid_campaign_id" });
      const [summary] = await options.sql.unsafe<
        {
          launch_count: string;
          binding_count: string;
          first_block: string | null;
          last_block: string | null;
        }[]
      >(
        "SELECT count(*)::text launch_count,count(*) FILTER (WHERE b.token IS NOT NULL)::text binding_count,min(l.created_block)::text first_block,max(l.updated_block)::text last_block FROM launches l LEFT JOIN launch_metadata_bindings b ON b.chain_id=l.chain_id AND b.token=l.token AND b.campaign_id=l.campaign_id WHERE l.chain_id=$1 AND l.campaign_id=$2 AND l.automated_test_launch=true",
        [options.chainId, request.params.campaignId],
      );
      const preparations = await options.sql.unsafe<
        { status: string; count: string }[]
      >(
        "SELECT status,count(*)::text count FROM prepared_token_metadata WHERE chain_id=$1 AND campaign_id=$2 AND automated_test_launch=true GROUP BY status ORDER BY status",
        [options.chainId, request.params.campaignId],
      );
      return {
        data: {
          campaignId: request.params.campaignId,
          chainId: options.chainId,
          releaseSha: options.releaseSha,
          launchCount: Number(summary?.launch_count ?? "0"),
          verifiedBindingCount: Number(summary?.binding_count ?? "0"),
          firstBlock: summary?.first_block ?? null,
          lastIndexedBlock: summary?.last_block ?? null,
          metadataPreparations: preparations.map((row) => ({
            status: row.status,
            count: Number(row.count),
          })),
        },
      };
    },
  );
}
