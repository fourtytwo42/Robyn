import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  scryptSync,
} from "node:crypto";
import { privateKeyToAccount } from "viem/accounts";

const SECP256K1_ORDER =
  0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const ENCRYPTION_VERSION = 1;

function bufferToBigInt(value) {
  return BigInt(`0x${value.toString("hex")}`);
}

function bigIntToBuffer(value) {
  return Buffer.from(value.toString(16).padStart(64, "0"), "hex");
}

export function assertCampaignId(value) {
  if (!/^[a-z0-9][a-z0-9-]{2,63}$/.test(value ?? "")) {
    throw new Error(
      "Campaign ID must be 3-64 lowercase letters, numbers, or hyphens",
    );
  }
  return value;
}

export function createCampaignRoot() {
  return randomBytes(32);
}

export function deriveCampaignPrivateKey(root, campaignId, index) {
  assertCampaignId(campaignId);
  if (!Buffer.isBuffer(root) || root.length !== 32) {
    throw new Error("Campaign root must be exactly 32 bytes");
  }
  if (!Number.isSafeInteger(index) || index < 0) {
    throw new Error("Wallet index must be a nonnegative safe integer");
  }
  const digest = createHmac("sha256", root)
    .update("sherwood-forest-testnet-assurance-wallet-v1\0")
    .update(campaignId)
    .update("\0")
    .update(String(index))
    .digest();
  const scalar = (bufferToBigInt(digest) % (SECP256K1_ORDER - 1n)) + 1n;
  return `0x${bigIntToBuffer(scalar).toString("hex")}`;
}

export function deriveCampaignAccounts(root, campaignId, count = 100) {
  if (!Number.isSafeInteger(count) || count < 1 || count > 512) {
    throw new Error("Wallet count must be between 1 and 512");
  }
  return Array.from({ length: count }, (_, index) => {
    const privateKey = deriveCampaignPrivateKey(root, campaignId, index);
    return {
      index,
      address: privateKeyToAccount(privateKey).address,
      privateKey,
    };
  });
}

export function publicCampaignAccounts(root, campaignId, count = 100) {
  return deriveCampaignAccounts(root, campaignId, count).map(
    ({ index, address }) => ({
      index,
      address,
    }),
  );
}

export function encryptCampaignRoot(root, passphrase) {
  if (!Buffer.isBuffer(root) || root.length !== 32) {
    throw new Error("Campaign root must be exactly 32 bytes");
  }
  if (typeof passphrase !== "string" || passphrase.length < 20) {
    throw new Error(
      "Campaign root passphrase must contain at least 20 characters",
    );
  }
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const scrypt = { N: 1 << 18, r: 8, p: 1, maxmem: 512 * 1024 * 1024 };
  const key = scryptSync(passphrase, salt, 32, scrypt);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(root), cipher.final()]);
  return {
    version: ENCRYPTION_VERSION,
    algorithm: "aes-256-gcm",
    kdf: "scrypt",
    scrypt,
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}

export function decryptCampaignRoot(envelope, passphrase) {
  if (
    envelope?.version !== ENCRYPTION_VERSION ||
    envelope?.algorithm !== "aes-256-gcm" ||
    envelope?.kdf !== "scrypt"
  ) {
    throw new Error("Unsupported campaign-root envelope");
  }
  if (typeof passphrase !== "string" || passphrase.length < 20) {
    throw new Error(
      "Campaign root passphrase must contain at least 20 characters",
    );
  }
  const salt = Buffer.from(envelope.salt, "base64");
  const iv = Buffer.from(envelope.iv, "base64");
  const tag = Buffer.from(envelope.tag, "base64");
  const ciphertext = Buffer.from(envelope.ciphertext, "base64");
  const key = scryptSync(passphrase, salt, 32, envelope.scrypt);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const root = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  if (root.length !== 32)
    throw new Error("Decrypted campaign root has invalid length");
  return root;
}

export function fundingTreeTransfers(
  walletCount,
  perWalletWei,
  transferCostWei,
) {
  if (
    !Number.isSafeInteger(walletCount) ||
    walletCount < 1 ||
    walletCount > 512
  ) {
    throw new Error("Wallet count must be between 1 and 512");
  }
  if (perWalletWei <= 0n || transferCostWei < 0n) {
    throw new Error(
      "Funding amounts must be nonnegative and per-wallet funding must be positive",
    );
  }
  const subtreeSize = (index) => {
    if (index >= walletCount) return 0;
    return 1 + subtreeSize(index * 2 + 1) + subtreeSize(index * 2 + 2);
  };
  const subtreeBudget = (index) => {
    const size = BigInt(subtreeSize(index));
    return size * perWalletWei + (size - 1n) * transferCostWei;
  };
  const transfers = [];
  for (let parent = 0; parent < walletCount; parent += 1) {
    for (const child of [parent * 2 + 1, parent * 2 + 2]) {
      if (child < walletCount) {
        transfers.push({
          parent,
          child,
          amountWei: subtreeBudget(child),
        });
      }
    }
  }
  return {
    rootFundingWei: subtreeBudget(0),
    transfers,
  };
}
