export function parseCastDecryptedPrivateKey(output) {
  const matches = String(output).match(/0x[0-9a-fA-F]{64}/g) ?? [];
  if (matches.length !== 1) {
    throw new Error(
      "Cast keystore output must contain exactly one private key",
    );
  }
  return matches[0];
}
