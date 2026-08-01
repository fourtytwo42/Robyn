import {
  encodeAbiParameters,
  getAddress,
  isAddress,
  isHex,
  keccak256,
  zeroAddress,
  zeroHash,
} from "viem";

export const SCHEMA17 = Object.freeze({
  schemaVersion: 17,
  bootstrapWindowSeconds: 48 * 60 * 60,
  votingDelaySeconds: 60 * 60,
  votingPeriodSeconds: 4 * 60 * 60,
  timelockDelaySeconds: 60 * 60,
  proposalThresholdBps: 100,
  quorumBps: 1_000,
  fixedDaoSupplyWei: "1000000000000000000000000000",
});

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const bytes32 = (value, label) => {
  assert(
    isHex(value, { strict: true }) && value.length === 66,
    `${label} must be bytes32`,
  );
  assert(value.toLowerCase() !== zeroHash, `${label} cannot be zero`);
  return value.toLowerCase();
};

export function normalizeBootstrapStep({
  chainId,
  domain,
  step,
  calls,
  timelock,
}) {
  assert(
    Number.isSafeInteger(chainId) && chainId > 0,
    "invalid bootstrap chain ID",
  );
  assert(step === 0 || step === 1, "bootstrap step must be zero or one");
  const normalizedDomain = bytes32(domain, "bootstrap domain");
  assert(
    Array.isArray(calls) && calls.length > 0,
    "bootstrap step cannot be empty",
  );
  const normalizedTimelock = timelock ? getAddress(timelock) : undefined;
  const normalizedCalls = calls.map((call, index) => {
    assert(
      isAddress(call?.target),
      `bootstrap call ${index} target is invalid`,
    );
    const target = getAddress(call.target);
    assert(target !== zeroAddress, `bootstrap call ${index} target is zero`);
    assert(
      !normalizedTimelock ||
        target.toLowerCase() !== normalizedTimelock.toLowerCase(),
      `bootstrap call ${index} cannot target the bootstrap Timelock`,
    );
    const value = BigInt(call.valueWei ?? 0);
    assert(
      value === 0n,
      `bootstrap call ${index} cannot transfer native value`,
    );
    assert(
      isHex(call.data, { strict: true }) && call.data.length >= 10,
      `bootstrap call ${index} calldata is invalid`,
    );
    assert(
      typeof call.label === "string" && call.label.trim() !== "",
      `bootstrap call ${index} label is required`,
    );
    return {
      label: call.label.trim(),
      target,
      valueWei: "0",
      data: call.data.toLowerCase(),
    };
  });
  const targets = normalizedCalls.map((call) => call.target);
  const values = normalizedCalls.map(() => 0n);
  const payloads = normalizedCalls.map((call) => call.data);
  const encoded = encodeAbiParameters(
    [
      { type: "uint256" },
      { type: "bytes32" },
      { type: "uint8" },
      { type: "address[]" },
      { type: "uint256[]" },
      { type: "bytes[]" },
    ],
    [BigInt(chainId), normalizedDomain, step, targets, values, payloads],
  );
  return {
    step,
    calls: normalizedCalls,
    targets,
    valuesWei: normalizedCalls.map(() => "0"),
    payloads,
    planHash: keccak256(encoded),
  };
}

export function buildSchema17GovernanceManifest(input) {
  assert(input?.schemaVersion === 17, "Schema-17 manifest required");
  assert(
    [46630, 4663].includes(input.chainId),
    "Schema-17 supports only Robinhood Testnet or Mainnet",
  );
  assert(
    /^[0-9a-f]{40}$/.test(input.releaseSha ?? ""),
    "release SHA must be a full lowercase Git SHA",
  );
  assert(isAddress(input.deployer), "invalid deployer");
  assert(isAddress(input.guardianSafe), "invalid guardian Safe");
  assert(
    getAddress(input.deployer) !== getAddress(input.guardianSafe),
    "guardian Safe must be distinct from the deployer EOA",
  );
  for (const key of ["daoToken", "timelock", "governor"]) {
    assert(isAddress(input.contracts?.[key]), `missing predicted ${key}`);
  }
  const domain = bytes32(input.bootstrap?.domain, "bootstrap domain");
  assert(
    Array.isArray(input.bootstrap?.steps) && input.bootstrap.steps.length === 2,
    "exactly two bootstrap steps are required",
  );
  const steps = input.bootstrap.steps.map((calls, step) =>
    normalizeBootstrapStep({
      chainId: input.chainId,
      domain,
      step,
      calls,
      timelock: input.contracts.timelock,
    }),
  );
  assert(
    steps[0].planHash !== steps[1].planHash,
    "bootstrap plan hashes must differ",
  );
  return {
    schemaVersion: 17,
    chainId: input.chainId,
    releaseSha: input.releaseSha,
    deployer: getAddress(input.deployer),
    guardianSafe: getAddress(input.guardianSafe),
    contracts: Object.fromEntries(
      Object.entries(input.contracts).map(([key, value]) => [
        key,
        isAddress(value) ? getAddress(value) : value,
      ]),
    ),
    governance: {
      ...SCHEMA17,
      bootstrapDomain: domain,
      bootstrapPlanHashes: steps.map((entry) => entry.planHash),
      unanimousTimelockRequired: true,
      bootstrapArbitraryCallsAllowed: false,
      bootstrapNativeValueAllowed: false,
    },
    bootstrap: { domain, steps },
    authorization: {
      mainnetTransactionsAuthorized: false,
      bootstrapExecutionAuthorized: false,
      publicActivationAuthorized: false,
    },
  };
}

export function validateSchema17GovernanceManifest(manifest) {
  const rebuilt = buildSchema17GovernanceManifest({
    ...manifest,
    bootstrap: {
      domain: manifest?.bootstrap?.domain,
      steps: manifest?.bootstrap?.steps?.map((step) => step.calls),
    },
  });
  assert(
    JSON.stringify(rebuilt.governance) === JSON.stringify(manifest.governance),
    "Schema-17 governance settings or bootstrap hashes differ from the canonical derivation",
  );
  assert(
    manifest.authorization?.mainnetTransactionsAuthorized === false,
    "preparation manifest cannot authorize Mainnet transactions",
  );
  return rebuilt;
}
