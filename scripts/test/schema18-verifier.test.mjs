import assert from "node:assert/strict";
import test from "node:test";
import { encodeFunctionData, keccak256, parseAbi, stringToHex } from "viem";
import { buildSchema18GovernanceManifest } from "../lib/schema18-governance.mjs";
import { validateSchema18DeploymentManifest } from "../lib/schema18-verifier.mjs";

const address = (suffix) => `0x${suffix.toString(16).padStart(40, "0")}`;
const contracts = {
  daoToken: address(1),
  timelock: address(2),
  governor: address(3),
  assetRouter: address(4),
  protocolFeeRouter: address(5),
  factory: address(6),
  atomicLaunchCoordinator: address(7),
};
const coordinatorAbi = parseAbi([
  "function setCanaryMode(address)",
  "function setPublicMode()",
]);

function manifest() {
  const deployer = address(10);
  const prepared = buildSchema18GovernanceManifest({
    schemaVersion: 18,
    chainId: 4663,
    releaseSha: "b".repeat(40),
    deployer,
    guardianSafe: address(11),
    contracts,
    bootstrap: {
      domain: keccak256(stringToHex("schema18-verifier")),
      steps: [
        [
          {
            label: "canary",
            target: contracts.atomicLaunchCoordinator,
            valueWei: "0",
            data: encodeFunctionData({
              abi: coordinatorAbi,
              functionName: "setCanaryMode",
              args: [deployer],
            }),
          },
        ],
        [
          {
            label: "public",
            target: contracts.atomicLaunchCoordinator,
            valueWei: "0",
            data: encodeFunctionData({
              abi: coordinatorAbi,
              functionName: "setPublicMode",
            }),
          },
        ],
      ],
    },
  });
  return {
    ...prepared,
    deploymentBlock: 123,
    contracts,
    runtimeCodeHashes: Object.fromEntries(
      Object.keys(contracts).map((key) => [key, `0x${"12".repeat(32)}`]),
    ),
    routes: [{ symbol: "WETH", asset: address(12) }],
    initialState: {
      launchMode: "Paused",
      assetConversionsPaused: true,
      feeConversionsPaused: true,
      applicationWritesEnabled: false,
    },
  };
}

test("accepts a complete fail-closed Schema-18 deployment shape", () => {
  assert.equal(
    validateSchema18DeploymentManifest(manifest()).schemaVersion,
    18,
  );
});

test("rejects missing runtime identity and any enabled initial state", () => {
  const missing = manifest();
  delete missing.runtimeCodeHashes.governor;
  assert.throws(
    () => validateSchema18DeploymentManifest(missing),
    /runtime hash governor/,
  );
  const enabled = manifest();
  enabled.initialState.applicationWritesEnabled = true;
  assert.throws(
    () => validateSchema18DeploymentManifest(enabled),
    /writes must be disabled/,
  );
});
