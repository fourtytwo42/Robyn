import { createHash } from "node:crypto";

export function sha256Hex(content: Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
}

const allowedContentTypes = new Set([
  "application/json",
  "application/octet-stream",
  "image/png",
  "image/webp",
  "text/plain",
]);

export function normalizeArtifactContentType(
  value: string | string[] | undefined,
): string {
  if (value === undefined) return "application/octet-stream";
  if (typeof value !== "string") throw new Error("Unsupported content type");
  const contentType = value.trim().toLowerCase();
  if (!allowedContentTypes.has(contentType))
    throw new Error("Unsupported content type");
  return contentType;
}

export function artifactKey(sha256: string): string {
  if (!/^[0-9a-f]{64}$/.test(sha256)) {
    throw new Error("Invalid SHA-256 digest");
  }
  return "sha256/" + sha256.slice(0, 2) + "/" + sha256;
}
