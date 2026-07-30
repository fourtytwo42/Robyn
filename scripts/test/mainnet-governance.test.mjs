import assert from "node:assert/strict";
import test from "node:test";
import { privateKeyToAccount } from "viem/accounts";
import {
  guardianControlMessage,
  predictChainSpecificSafe,
  safeInitializer,
  safeSaltNonce,
  validateGovernanceInputs,
} from "../lib/mainnet-governance.mjs";

const accounts = [
  privateKeyToAccount(`0x${"11".repeat(32)}`),
  privateKeyToAccount(`0x${"22".repeat(32)}`),
  privateKeyToAccount(`0x${"33".repeat(32)}`),
  privateKeyToAccount(`0x${"44".repeat(32)}`),
];
const releaseSha = "aa".repeat(20);
const deploymentManifestHash = `0x${"bb".repeat(32)}`;

async function inputs() {
  const purposes = ["project-deployer", "team-recipient", "team-recipient"];
  const signers = await Promise.all(
    accounts.slice(0, 3).map(async (account, index) => {
      const message = guardianControlMessage({
        chainId: 4663,
        releaseSha,
        deploymentManifestHash,
        address: account.address,
        purpose: purposes[index],
      });
      return {
        address: account.address,
        purpose: purposes[index],
        controlProofSignature: await account.signMessage({ message }),
      };
    }),
  );
  return {
    guardianInput: { schemaVersion: 1, chainId: 4663, signers },
    allocationInput: {
      schemaVersion: 1,
      chainId: 4663,
      allocations: [
        ...accounts.map((account, index) => ({
          recipient: account.address,
          purpose: index === 0 ? "project-deployer" : "team-recipient",
          basisPoints: 2_000,
        })),
        {
          recipient: "timelock",
          purpose: "governance-reserve",
          basisPoints: 2_000,
        },
      ],
    },
  };
}

test("validates three proven Safe owners and exact 20 percent RDAO allocations", async () => {
  const result = await validateGovernanceInputs({
    ...(await inputs()),
    deployer: accounts[0].address,
    releaseSha,
    deploymentManifestHash,
  });
  assert.deepEqual(result.failures, []);
  assert.equal(result.owners.length, 3);
  assert.equal(result.allocations.length, 5);
  assert.ok(result.proofEvidence.every((proof) => proof.signatureHash));
  assert.ok(
    result.proofEvidence.every(
      (proof) => !Object.hasOwn(proof, "controlProofSignature"),
    ),
  );
});

test("rejects an invalid control proof and an inexact allocation", async () => {
  const data = await inputs();
  data.guardianInput.signers[1].controlProofSignature =
    data.guardianInput.signers[0].controlProofSignature;
  data.allocationInput.allocations[4].basisPoints = 1_999;
  const result = await validateGovernanceInputs({
    ...data,
    deployer: accounts[0].address,
    releaseSha,
    deploymentManifestHash,
  });
  assert.match(result.failures.join("; "), /control proof signer mismatch/);
  assert.match(result.failures.join("; "), /2,000 basis points/);
  assert.match(result.failures.join("; "), /10,000 basis points/);
});

test("derives a deterministic chain-specific Safe identity", () => {
  const owners = accounts.slice(0, 3).map((account) => account.address);
  const initializer = safeInitializer({
    owners,
    fallbackHandler: "0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99",
  });
  const nonce = safeSaltNonce({
    chainId: 4663,
    releaseSha,
    deploymentManifestHash,
    owners,
  });
  const first = predictChainSpecificSafe({
    chainId: 4663,
    proxyFactory: "0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67",
    singleton: "0x29fcB43b46531BcA003ddC8FCB67FFE91900C762",
    proxyCreationCode: "0x6001600055",
    initializer,
    saltNonce: nonce,
  });
  const second = predictChainSpecificSafe({
    chainId: 4663,
    proxyFactory: "0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67",
    singleton: "0x29fcB43b46531BcA003ddC8FCB67FFE91900C762",
    proxyCreationCode: "0x6001600055",
    initializer,
    saltNonce: nonce,
  });
  assert.equal(first.address, second.address);
  assert.equal(first.salt, second.salt);
});
