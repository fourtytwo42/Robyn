import {
  concatHex,
  encodeAbiParameters,
  encodeFunctionData,
  encodePacked,
  getAddress,
  getCreate2Address,
  keccak256,
  pad,
  recoverMessageAddress,
  stringToHex,
  zeroAddress,
} from "viem";

const SAFE_SETUP_ABI = [
  {
    type: "function",
    name: "setup",
    stateMutability: "nonpayable",
    inputs: [
      { name: "_owners", type: "address[]" },
      { name: "_threshold", type: "uint256" },
      { name: "to", type: "address" },
      { name: "data", type: "bytes" },
      { name: "fallbackHandler", type: "address" },
      { name: "paymentToken", type: "address" },
      { name: "payment", type: "uint256" },
      { name: "paymentReceiver", type: "address" },
    ],
    outputs: [],
  },
];

const HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const SHA_PATTERN = /^(?:0x)?[0-9a-fA-F]{40}$/;
export const GOVERNANCE_MODES = Object.freeze({
  SOLE_OWNER_BOOTSTRAP: "sole-owner-bootstrap",
  DISTRIBUTED: "distributed",
});

function governancePolicy(mode) {
  if (mode === GOVERNANCE_MODES.SOLE_OWNER_BOOTSTRAP) {
    return { ownerCount: 1, threshold: 1, allocationCount: 1 };
  }
  if (mode === GOVERNANCE_MODES.DISTRIBUTED) {
    return { ownerCount: 3, threshold: 2, allocationCount: 5 };
  }
  throw new Error("unsupported governance mode");
}

function requireHash(value, label) {
  if (!HASH_PATTERN.test(value ?? "")) throw new Error(`invalid ${label}`);
  return value.toLowerCase();
}

function requireReleaseSha(value) {
  if (!SHA_PATTERN.test(value ?? "")) throw new Error("invalid release SHA");
  return `0x${value.replace(/^0x/, "").toLowerCase()}`;
}

export function guardianControlMessage({
  chainId,
  releaseSha,
  deploymentManifestHash,
  address,
  purpose,
  governanceMode,
}) {
  governancePolicy(governanceMode);
  return [
    "Robyn Schema-16 guardian control proof",
    `chainId:${chainId}`,
    `releaseSha:${requireReleaseSha(releaseSha).slice(2)}`,
    `deploymentManifestHash:${requireHash(
      deploymentManifestHash,
      "deployment manifest hash",
    )}`,
    `address:${getAddress(address)}`,
    `purpose:${purpose}`,
    `governanceMode:${governanceMode}`,
  ].join("\n");
}

export function signerSetHash(owners) {
  const sortedOwners = owners
    .map((owner) => getAddress(owner))
    .sort((left, right) =>
      left.toLowerCase().localeCompare(right.toLowerCase()),
    );
  return keccak256(
    encodeAbiParameters([{ type: "address[]" }], [sortedOwners]),
  );
}

export function safeSaltNonce({
  chainId,
  releaseSha,
  deploymentManifestHash,
  owners,
  governanceMode,
  threshold,
}) {
  const policy = governancePolicy(governanceMode);
  if (Number(threshold) !== policy.threshold) {
    throw new Error("Safe threshold does not match governance mode");
  }
  return BigInt(
    keccak256(
      encodeAbiParameters(
        [
          { type: "uint256" },
          { type: "bytes20" },
          { type: "bytes32" },
          { type: "bytes32" },
          { type: "bytes32" },
          { type: "uint256" },
        ],
        [
          BigInt(chainId),
          requireReleaseSha(releaseSha),
          requireHash(deploymentManifestHash, "deployment manifest hash"),
          signerSetHash(owners),
          keccak256(stringToHex(governanceMode)),
          BigInt(threshold),
        ],
      ),
    ),
  );
}

export function safeInitializer({ owners, fallbackHandler, threshold }) {
  const sortedOwners = owners
    .map((owner) => getAddress(owner))
    .sort((left, right) =>
      left.toLowerCase().localeCompare(right.toLowerCase()),
    );
  if (
    !Number.isInteger(Number(threshold)) ||
    Number(threshold) < 1 ||
    Number(threshold) > sortedOwners.length
  ) {
    throw new Error("invalid Safe threshold");
  }
  return encodeFunctionData({
    abi: SAFE_SETUP_ABI,
    functionName: "setup",
    args: [
      sortedOwners,
      BigInt(threshold),
      zeroAddress,
      "0x",
      getAddress(fallbackHandler),
      zeroAddress,
      0n,
      zeroAddress,
    ],
  });
}

export function predictChainSpecificSafe({
  chainId,
  proxyFactory,
  singleton,
  proxyCreationCode,
  initializer,
  saltNonce,
}) {
  const salt = keccak256(
    encodePacked(
      ["bytes32", "uint256", "uint256"],
      [keccak256(initializer), BigInt(saltNonce), BigInt(chainId)],
    ),
  );
  const deploymentBytecode = concatHex([
    proxyCreationCode,
    pad(getAddress(singleton), { size: 32 }),
  ]);
  return {
    address: getCreate2Address({
      from: getAddress(proxyFactory),
      salt,
      bytecodeHash: keccak256(deploymentBytecode),
    }),
    salt,
    initializerHash: keccak256(initializer),
    deploymentBytecodeHash: keccak256(deploymentBytecode),
  };
}

export async function validateGovernanceInputs({
  guardianInput,
  allocationInput,
  deployer,
  releaseSha,
  deploymentManifestHash,
  verifySignatures = true,
}) {
  const failures = [];
  const chainId = 4663;
  const normalizedDeployer = getAddress(deployer);
  const guardianMode = guardianInput?.governanceMode;
  const allocationMode = allocationInput?.governanceMode;
  let policy = null;
  try {
    policy = governancePolicy(guardianMode);
  } catch (error) {
    failures.push(error.message);
  }
  if (allocationMode !== guardianMode) {
    failures.push("guardian and RDAO governance modes must match");
  }
  if (policy && Number(guardianInput?.threshold) !== policy.threshold) {
    failures.push("guardian threshold must match governance mode");
  }
  if (
    guardianInput?.schemaVersion !== 2 ||
    Number(guardianInput?.chainId) !== chainId
  ) {
    failures.push("guardian input must use schema 2 on chain 4663");
  }
  const signers = guardianInput?.signers ?? [];
  if (policy && signers.length !== policy.ownerCount) {
    failures.push(
      `governance mode ${guardianMode} requires exactly ${policy.ownerCount} Safe owner(s)`,
    );
  }
  const owners = [];
  const purposes = [];
  const proofEvidence = [];
  for (const signer of signers) {
    try {
      const address = getAddress(signer.address);
      owners.push(address);
      purposes.push(signer.purpose);
      const message = guardianControlMessage({
        chainId,
        releaseSha,
        deploymentManifestHash,
        address,
        purpose: signer.purpose,
        governanceMode: guardianMode,
      });
      if (verifySignatures) {
        const recovered = await recoverMessageAddress({
          message,
          signature: signer.controlProofSignature,
        });
        if (recovered !== address) {
          failures.push(`control proof signer mismatch for ${address}`);
        }
      }
      proofEvidence.push({
        address,
        purpose: signer.purpose,
        messageHash: keccak256(stringToHex(message)),
        signatureHash: signer.controlProofSignature
          ? keccak256(signer.controlProofSignature)
          : null,
      });
    } catch (error) {
      failures.push(`invalid guardian signer: ${error.message}`);
    }
  }
  const uniqueOwners = new Set(owners.map((item) => item.toLowerCase()));
  if (uniqueOwners.size !== owners.length)
    failures.push("Safe owners must be unique");
  if (!uniqueOwners.has(normalizedDeployer.toLowerCase())) {
    failures.push("protected deployer must be a Safe owner");
  }
  if (purposes.filter((value) => value === "project-deployer").length !== 1) {
    failures.push("one Safe owner must have project-deployer purpose");
  }
  if (
    guardianMode === GOVERNANCE_MODES.DISTRIBUTED &&
    purposes.filter((value) => value === "team-recipient").length !== 2
  ) {
    failures.push("two Safe owners must have team-recipient purpose");
  }
  if (
    guardianMode === GOVERNANCE_MODES.SOLE_OWNER_BOOTSTRAP &&
    (owners.length !== 1 ||
      owners[0]?.toLowerCase() !== normalizedDeployer.toLowerCase())
  ) {
    failures.push(
      "sole-owner bootstrap Safe owner must be the protected deployer",
    );
  }

  if (
    allocationInput?.schemaVersion !== 2 ||
    Number(allocationInput?.chainId) !== chainId
  ) {
    failures.push("RDAO allocation must use schema 2 on chain 4663");
  }
  const allocations = allocationInput?.allocations ?? [];
  if (policy && allocations.length !== policy.allocationCount) {
    failures.push(
      `governance mode ${guardianMode} requires exactly ${policy.allocationCount} RDAO allocation(s)`,
    );
  }
  const addressRecipients = [];
  let timelockCount = 0;
  for (const allocation of allocations) {
    if (
      guardianMode === GOVERNANCE_MODES.DISTRIBUTED &&
      Number(allocation.basisPoints) !== 2_000
    ) {
      failures.push("every RDAO allocation must equal 2,000 basis points");
    }
    if (allocation.recipient === "timelock") {
      timelockCount += 1;
      continue;
    }
    try {
      addressRecipients.push(getAddress(allocation.recipient));
    } catch {
      failures.push("invalid RDAO recipient address");
    }
  }
  if (guardianMode === GOVERNANCE_MODES.DISTRIBUTED && timelockCount !== 1) {
    failures.push("exactly one RDAO allocation must resolve to timelock");
  }
  if (
    guardianMode === GOVERNANCE_MODES.SOLE_OWNER_BOOTSTRAP &&
    timelockCount !== 0
  ) {
    failures.push("sole-owner bootstrap must not allocate RDAO to timelock");
  }
  const uniqueRecipients = new Set(
    addressRecipients.map((item) => item.toLowerCase()),
  );
  if (
    guardianMode === GOVERNANCE_MODES.DISTRIBUTED &&
    uniqueRecipients.size !== 4
  ) {
    failures.push("RDAO must have four unique address recipients");
  }
  for (const owner of uniqueOwners) {
    if (!uniqueRecipients.has(owner)) {
      failures.push("every Safe owner must receive an RDAO allocation");
    }
  }
  if (!uniqueRecipients.has(normalizedDeployer.toLowerCase())) {
    failures.push("protected deployer must receive an RDAO allocation");
  }
  if (
    guardianMode === GOVERNANCE_MODES.SOLE_OWNER_BOOTSTRAP &&
    (uniqueRecipients.size !== 1 ||
      addressRecipients[0]?.toLowerCase() !==
        normalizedDeployer.toLowerCase() ||
      Number(allocations[0]?.basisPoints) !== 10_000 ||
      allocations[0]?.purpose !== "project-deployer")
  ) {
    failures.push(
      "sole-owner bootstrap must allocate 10,000 basis points to deployer",
    );
  }
  if (
    allocations.reduce(
      (total, allocation) => total + Number(allocation.basisPoints ?? 0),
      0,
    ) !== 10_000
  ) {
    failures.push("RDAO allocation must total exactly 10,000 basis points");
  }
  return {
    failures,
    chainId,
    governanceMode: guardianMode,
    threshold: policy?.threshold ?? null,
    deployer: normalizedDeployer,
    owners: [...owners].sort((left, right) =>
      left.toLowerCase().localeCompare(right.toLowerCase()),
    ),
    signerSetHash:
      policy && owners.length === policy.ownerCount
        ? signerSetHash(owners)
        : null,
    proofEvidence,
    allocations: allocations.map((allocation) => {
      let recipient = allocation.recipient;
      if (recipient !== "timelock") {
        try {
          recipient = getAddress(recipient);
        } catch {
          // The recorded validation failure is authoritative. Retaining the raw
          // value keeps malformed input inside the fail-closed report path.
        }
      }
      return {
        recipient,
        purpose: allocation.purpose,
        basisPoints: Number(allocation.basisPoints),
      };
    }),
  };
}
