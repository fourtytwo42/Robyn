import { getAddress, type Address } from "viem";
import {
  createSiweMessage,
  parseSiweMessage,
  validateSiweMessage,
} from "viem/siwe";

export const creatorStatement =
  "Sign in to manage your Robyn creator profile and token artwork.";

export type AuthOrigin = {
  origin: string;
  domain: string;
  scheme: "http" | "https";
  secureCookie: boolean;
};

export function resolveAuthOrigin(
  headers: {
    host?: string;
    origin?: string;
    forwardedProto?: string;
  },
  allowedOrigins: ReadonlySet<string>,
  chainId: number,
): AuthOrigin {
  const host = headers.host?.trim().toLowerCase();
  const scheme = headers.forwardedProto?.split(",")[0]?.trim().toLowerCase();
  if (!host || (scheme !== "http" && scheme !== "https"))
    throw new Error("invalid_request_origin");
  const origin = `${scheme}://${host}`;
  if (!allowedOrigins.has(origin)) throw new Error("untrusted_request_origin");
  if (headers.origin && headers.origin.toLowerCase() !== origin)
    throw new Error("origin_header_mismatch");
  const secureCookie = scheme === "https";
  if (!secureCookie && chainId !== 31337)
    throw new Error("secure_transport_required");
  return { origin, domain: host, scheme, secureCookie };
}

export function createCreatorChallenge({
  address,
  chainId,
  nonce,
  authOrigin,
  now = new Date(),
}: {
  address: string;
  chainId: number;
  nonce: string;
  authOrigin: AuthOrigin;
  now?: Date;
}) {
  const expirationTime = new Date(now.getTime() + 5 * 60 * 1000);
  return createSiweMessage({
    address: getAddress(address) as Address,
    chainId,
    domain: authOrigin.domain,
    nonce,
    uri: authOrigin.origin,
    version: "1",
    statement: creatorStatement,
    issuedAt: now,
    expirationTime,
    scheme: authOrigin.scheme,
  });
}

export function validateCreatorChallenge({
  message,
  nonce,
  address,
  chainId,
  authOrigin,
  now = new Date(),
}: {
  message: string;
  nonce: string;
  address: Address;
  chainId: number;
  authOrigin: AuthOrigin;
  now?: Date;
}) {
  const parsed = parseSiweMessage(message);
  if (
    parsed.chainId !== chainId ||
    parsed.uri !== authOrigin.origin ||
    parsed.statement !== creatorStatement ||
    parsed.version !== "1"
  )
    throw new Error("invalid_siwe_scope");
  if (
    !validateSiweMessage({
      message: parsed,
      address,
      domain: authOrigin.domain,
      nonce,
      scheme: authOrigin.scheme,
      time: now,
    })
  )
    throw new Error("invalid_siwe_message");
  return parsed;
}
