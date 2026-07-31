import assert from "node:assert/strict";
import test from "node:test";
import { privateKeyToAccount } from "viem/accounts";
import {
  GOVERNANCE_MODES,
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

async function signedGuardian(mode, signerAccounts, purposes) {
  const signers = await Promise.all(
    signerAccounts.map(async (account, index) => {
      const message = guardianControlMessage({
        chainId: 4663,
        releaseSha,
        deploymentManifestHash,
        address: account.address,
        purpose: purposes[index],
        governanceMode: mode,
      });
      return {
        address: account.address,
        purpose: purposes[index],
        controlProofSignature: await account.signMessage({ message }),
      };
    }),
  );
  return {
    schemaVersion: 2,
    chainId: 4663,
    governanceMode: mode,
    threshold: mode === GOVERNANCE_MODES.SOLE_OWNER_BOOTSTRAP ? 1 : 2,
    signers,
  };
}

async function distributedInputs() {
  const mode = GOVERNANCE_MODES.DISTRIBUTED;
  return {
    guardianInput: await signedGuardian(mode, accounts.slice(0, 3), [
      "project-deployer",
      "team-recipient",
      "team-recipient",
    ]),
    allocationInput: {
      schemaVersion: 2,
      chainId: 4663,
      governanceMode: mode,
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

async function bootstrapInputs() {
  const mode = GOVERNANCE_MODES.SOLE_OWNER_BOOTSTRAP;
  return {
    guardianInput: await signedGuardian(
      mode,
      [accounts[0]],
      ["project-deployer"],
    ),
    allocationInput: {
      schemaVersion: 2,
      chainId: 4663,
      governanceMode: mode,
      allocations: [
        {
          recipient: accounts[0].address,
          purpose: "project-deployer",
          basisPoints: 10_000,
        },
      ],
    },
  };
}

async function validate(data) {
  return validateGovernanceInputs({
    ...data,
    deployer: accounts[0].address,
    releaseSha,
    deploymentManifestHash,
  });
}

test("validates distributed three-owner Safe and 20 percent allocations", async () => {
  const result = await validate(await distributedInputs());
  assert.deepEqual(result.failures, []);
  assert.equal(result.governanceMode, GOVERNANCE_MODES.DISTRIBUTED);
  assert.equal(result.threshold, 2);
  assert.equal(result.owners.length, 3);
  assert.equal(result.allocations.length, 5);
});

test("validates sole-owner bootstrap Safe and full deployer allocation", async () => {
  const result = await validate(await bootstrapInputs());
  assert.deepEqual(result.failures, []);
  assert.equal(result.governanceMode, GOVERNANCE_MODES.SOLE_OWNER_BOOTSTRAP);
  assert.equal(result.threshold, 1);
  assert.deepEqual(result.owners, [accounts[0].address]);
  assert.equal(result.allocations[0].recipient, accounts[0].address);
  assert.equal(result.allocations[0].basisPoints, 10_000);
  assert.ok(result.proofEvidence[0].signatureHash);
  assert.ok(!Object.hasOwn(result.proofEvidence[0], "controlProofSignature"));
});

test("rejects mixed governance modes", async () => {
  const data = await bootstrapInputs();
  data.allocationInput.governanceMode = GOVERNANCE_MODES.DISTRIBUTED;
  const result = await validate(data);
  assert.match(result.failures.join("; "), /governance modes must match/);
});

test("rejects an explicit threshold inconsistent with bootstrap mode", async () => {
  const data = await bootstrapInputs();
  data.guardianInput.threshold = 2;
  const result = await validate(data);
  assert.match(
    result.failures.join("; "),
    /threshold must match governance mode/,
  );
});

test("rejects bootstrap extras, partial allocation, and timelock allocation", async () => {
  const data = await bootstrapInputs();
  data.guardianInput.signers.push(data.guardianInput.signers[0]);
  data.allocationInput.allocations = [
    { ...data.allocationInput.allocations[0], basisPoints: 9_000 },
    {
      recipient: "timelock",
      purpose: "governance-reserve",
      basisPoints: 1_000,
    },
  ];
  const result = await validate(data);
  const failures = result.failures.join("; ");
  assert.match(failures, /exactly 1 Safe owner/);
  assert.match(failures, /exactly 1 RDAO allocation/);
  assert.match(failures, /must not allocate RDAO to timelock/);
  assert.match(failures, /10,000 basis points to deployer/);
});

test("rejects a non-deployer bootstrap owner and recipient", async () => {
  const mode = GOVERNANCE_MODES.SOLE_OWNER_BOOTSTRAP;
  const data = await bootstrapInputs();
  data.guardianInput = await signedGuardian(
    mode,
    [accounts[1]],
    ["project-deployer"],
  );
  data.allocationInput.allocations[0].recipient = accounts[1].address;
  const result = await validate(data);
  const failures = result.failures.join("; ");
  assert.match(failures, /Safe owner must be the protected deployer/);
  assert.match(failures, /protected deployer must receive/);
});

test("reports a malformed allocation recipient without escaping validation", async () => {
  const data = await bootstrapInputs();
  data.allocationInput.allocations[0].recipient = "not-an-address";
  const result = await validate(data);
  assert.match(result.failures.join("; "), /invalid RDAO recipient address/);
  assert.equal(result.allocations[0].recipient, "not-an-address");
});

test("rejects an invalid control proof and an inexact distributed allocation", async () => {
  const data = await distributedInputs();
  data.guardianInput.signers[1].controlProofSignature =
    data.guardianInput.signers[0].controlProofSignature;
  data.allocationInput.allocations[4].basisPoints = 1_999;
  const result = await validate(data);
  assert.match(result.failures.join("; "), /control proof signer mismatch/);
  assert.match(result.failures.join("; "), /2,000 basis points/);
  assert.match(result.failures.join("; "), /10,000 basis points/);
});

test("rejects a Safe threshold inconsistent with governance mode", () => {
  assert.throws(
    () =>
      safeSaltNonce({
        chainId: 4663,
        releaseSha,
        deploymentManifestHash,
        owners: [accounts[0].address],
        governanceMode: GOVERNANCE_MODES.SOLE_OWNER_BOOTSTRAP,
        threshold: 2,
      }),
    /threshold does not match governance mode/,
  );
  assert.throws(
    () =>
      safeInitializer({
        owners: [accounts[0].address],
        fallbackHandler: "0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99",
        threshold: 2,
      }),
    /invalid Safe threshold/,
  );
});

test("derives deterministic but mode-bound Safe identities", () => {
  const fallbackHandler = "0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99";
  const bootstrapOwners = [accounts[0].address];
  const initializer = safeInitializer({
    owners: bootstrapOwners,
    fallbackHandler,
    threshold: 1,
  });
  const nonce = safeSaltNonce({
    chainId: 4663,
    releaseSha,
    deploymentManifestHash,
    owners: bootstrapOwners,
    governanceMode: GOVERNANCE_MODES.SOLE_OWNER_BOOTSTRAP,
    threshold: 1,
  });
  const args = {
    chainId: 4663,
    proxyFactory: "0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67",
    singleton: "0x29fcB43b46531BcA003ddC8FCB67FFE91900C762",
    proxyCreationCode: "0x6001600055",
    initializer,
    saltNonce: nonce,
  };
  const first = predictChainSpecificSafe(args);
  const second = predictChainSpecificSafe(args);
  assert.equal(first.address, second.address);
  assert.equal(first.salt, second.salt);

  const distributedNonce = safeSaltNonce({
    chainId: 4663,
    releaseSha,
    deploymentManifestHash,
    owners: accounts.slice(0, 3).map((account) => account.address),
    governanceMode: GOVERNANCE_MODES.DISTRIBUTED,
    threshold: 2,
  });
  assert.notEqual(nonce, distributedNonce);
});
