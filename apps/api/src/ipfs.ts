const cidV1Pattern = /^b[a-z2-7]{20,120}$/;

export type PinState = "queued" | "pinning" | "pinned" | "failed";

export function assertIpfsUri(value: string) {
  if (!value.startsWith("ipfs://")) throw new Error("invalid_ipfs_uri");
  const cid = value.slice("ipfs://".length).split("/")[0] ?? "";
  if (!cidV1Pattern.test(cid)) throw new Error("invalid_ipfs_cid");
  return cid;
}

export function canonicalTokenMetadata(input: {
  name: string;
  symbol: string;
  description?: string;
  pngCid: string;
  webpCid: string;
  hasAlpha: boolean;
  testCampaign?: {
    campaignId: string;
    releaseSha: string;
  };
}) {
  if (!input.name.trim() || !input.symbol.trim())
    throw new Error("name_and_symbol_required");
  const description = input.description?.trim() ?? "";
  if (description.length > 280) throw new Error("description_too_long");
  if (
    input.testCampaign &&
    (!/^[a-z0-9][a-z0-9-]{2,63}$/.test(input.testCampaign.campaignId) ||
      !/^[0-9a-f]{40}$/.test(input.testCampaign.releaseSha))
  )
    throw new Error("invalid_test_campaign");
  const image = `ipfs://${input.pngCid}`;
  const metadata = {
    interop: { erc1046: true },
    name: input.name.trim(),
    symbol: input.symbol.trim(),
    decimals: 18,
    ...(description ? { description } : {}),
    image,
    images: [`ipfs://${input.webpCid}`],
    ...(input.hasAlpha ? { icons: [image] } : {}),
    ...(input.testCampaign
      ? {
          robynTestCampaign: {
            campaignId: input.testCampaign.campaignId,
            releaseSha: input.testCampaign.releaseSha,
            automatedTestLaunch: true,
          },
        }
      : {}),
  };
  return Buffer.from(JSON.stringify(metadata));
}

export async function addAndPinIpfs(
  bytes: Buffer,
  filename: string,
  apiUrl: string,
) {
  const form = new FormData();
  form.append("file", new Blob([Uint8Array.from(bytes)]), filename);
  const url = new URL("/api/v0/add", apiUrl);
  url.searchParams.set("cid-version", "1");
  url.searchParams.set("hash", "sha2-256");
  url.searchParams.set("pin", "true");
  url.searchParams.set("raw-leaves", "true");
  url.searchParams.set("wrap-with-directory", "false");
  const response = await fetch(url, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`ipfs_add_${response.status}`);
  const line = (await response.text()).trim().split("\n").at(-1);
  if (!line) throw new Error("ipfs_add_invalid_response");
  const parsed = JSON.parse(line) as { Hash?: unknown };
  if (typeof parsed.Hash !== "string" || !cidV1Pattern.test(parsed.Hash))
    throw new Error("ipfs_add_invalid_cid");
  return parsed.Hash;
}

export async function requestRemotePin(
  cid: string,
  name: string,
  remoteUrl?: string,
  remoteToken?: string,
): Promise<{ state: PinState; requestId?: string; error?: string }> {
  if (!remoteUrl || !remoteToken) return { state: "queued" };
  try {
    const response = await fetch(new URL("/pins", remoteUrl), {
      method: "POST",
      headers: {
        authorization: `Bearer ${remoteToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        cid,
        name,
        meta: { application: "robyn", standard: "erc1046" },
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok)
      return { state: "failed", error: `http_${response.status}` };
    const body = (await response.json()) as {
      requestid?: unknown;
      status?: unknown;
    };
    const state =
      body.status === "pinned"
        ? "pinned"
        : body.status === "pinning"
          ? "pinning"
          : "queued";
    return {
      state,
      ...(typeof body.requestid === "string"
        ? { requestId: body.requestid }
        : {}),
    };
  } catch (error) {
    return {
      state: "failed",
      error:
        error instanceof Error
          ? error.message.slice(0, 200)
          : "remote_pin_failed",
    };
  }
}
