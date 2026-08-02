import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const runner = await readFile(
  "scripts/run-schema18-mainnet-public-live.mjs",
  "utf8",
);
const prepare = await readFile(
  "scripts/prepare-schema18-mainnet-public.mjs",
  "utf8",
);
const rehearsal = await readFile(
  "scripts/run-schema18-mainnet-public-rehearsal.mjs",
  "utf8",
);
const applicationManifest = await readFile(
  "scripts/finalize-schema18-mainnet-application-manifest.mjs",
  "utf8",
);
const scopedIndexerVerifier = await readFile(
  "scripts/verify-schema18-mainnet-scoped-indexer.mjs",
  "utf8",
);
const publicNginx = await readFile(
  "infrastructure/nginx/robyn-schema18-mainnet-public.conf",
  "utf8",
);
const mainnetPm2 = await readFile(
  "infrastructure/pm2/ecosystem.mainnet.config.cjs",
  "utf8",
);
const secureKeeper = await readFile(
  "scripts/start-schema18-mainnet-keeper-secure.sh",
  "utf8",
);
const keyPipe = await readFile("scripts/pipe-keystore-private-key.mjs", "utf8");

test("Gate 3 tooling is exact-release, LAN-only, and separately authorized", () => {
  assert.match(runner, /4728cb5cce4b0bad1c275b8bfcc2de3e8fb3f6a4/);
  assert.match(runner, /5ea50ed836d81416a7a6a32c8078a864fca28d0b/);
  assert.match(runner, /ROBYN_SCHEMA18_MAINNET_PUBLIC_AUTHORIZED/);
  assert.match(
    runner,
    /ROBYN_SCHEMA18_MAINNET_PUBLIC_AUTHORIZATION_RECEIPT_SHA256/,
  );
  assert.match(
    runner,
    /unanimous-public-through-application-writes-and-emergency-verification/,
  );
  assert.match(
    runner,
    /exact Gate 3 manifest lacks a matching protected authorization receipt/,
  );
  assert.match(runner, /publicActivationAuthorized !== false/);
  assert.match(runner, /applicationWritesAuthorized !== false/);
  assert.match(
    runner,
    /Gate 3 scoped application or indexer identity mismatch/,
  );
  assert.match(runner, /alchemyApplicationTrafficConfigured !== false/);
  assert.doesNotMatch(runner, /alchemy\.com|automaticAlchemyFallback/);
});

test("runner is restart-safe and preserves the operational reserve", () => {
  assert.match(runner, /automatic replay is prohibited/);
  assert.match(
    runner,
    /submission is ambiguous; manual reconciliation required/,
  );
  assert.match(runner, /has a pending nonce/);
  assert.match(runner, /exceeds sealed phase gas ceiling/);
  assert.match(runner, /exceeds sealed fee ceiling/);
  assert.match(runner, /would breach the fixed Mainnet reserve/);
  assert.match(runner, /const RESERVE = 20_000_000_000_000_000n/);
});

test("runner binds the exact Public batch, route state, profile, and emergency shutdown", () => {
  for (const action of [
    "scheduleUnanimous",
    "executeBatch",
    "pauseLaunches",
    "pauseConversions",
    "disableRoute",
  ]) {
    assert.match(runner, new RegExp(`"${action}"`));
  }
  assert.match(runner, /sealed Public batch hash mismatch/);
  assert.match(runner, /one-hour Public Timelock is not complete/);
  assert.match(runner, /production graduation profile mismatch/);
  assert.match(runner, /maximumReferenceTickDeviation/);
  assert.match(runner, /verificationClass/);
  assert.match(runner, /Canary launch profile snapshot changed/);
  assert.match(runner, /guardian-disable-/);
});

test("manifest sealer requires completed Gate 2, rehearsal receipts, exact app evidence, and no preauthorization", () => {
  for (const stage of [
    "claims",
    "unwind",
    "schedule-reactivation",
    "execute-reactivation",
    "refresh-start",
    "refresh-finish",
    "post-settle",
    "shutdown",
    "reconcile",
  ]) {
    assert.match(prepare, new RegExp(`"${stage}"`));
  }
  assert.match(prepare, /Gate-2 journal is incomplete/);
  assert.match(
    prepare,
    /Gate-2 receipt failure, duplicate key, or reused hash/,
  );
  assert.match(
    prepare,
    /post-graduation Gate-2 recovery did not finish cleanly/,
  );
  assert.match(prepare, /Public rehearsal receipt ledger is incomplete/);
  assert.match(prepare, /exact Mainnet application evidence is incomplete/);
  assert.match(
    prepare,
    /applicationEvidence\.readOnlyProcessesStarted !== true/,
  );
  assert.match(
    prepare,
    /applicationEvidence\.financialSubmissionProcessesStarted !== false/,
  );
  assert.match(
    prepare,
    /applicationEvidence\.applicationWritesEnabled !== false/,
  );
  assert.match(
    prepare,
    /applicationEvidence\.alchemyApplicationTrafficConfigured !== false/,
  );
  assert.match(prepare, /applicationEvidence\.buildValidationSha256/);
  assert.match(prepare, /applicationEvidence\.pm2TopologySha256/);
  assert.match(prepare, /applicationEvidence\.nginxConfigSha256/);
  assert.match(prepare, /applicationEvidence\.databaseIdentity\?\.name/);
  assert.match(runner, /manifest\.application\?\.databaseIdentity\?\.name/);
  assert.match(runner, /manifest\.application\?\.pm2TopologySha256/);
  assert.match(runner, /manifest\.application\?\.nginxConfigSha256/);
  assert.match(prepare, /Public funding shortfall/);
  assert.match(prepare, /additionalBridgeAuthorized:false/);
  assert.match(rehearsal, /factory: source\.contracts\.launchFactory/);
  assert.match(rehearsal, /scopedIndexerAcceptancePassed: true/);
  assert.match(rehearsal, /alchemyApplicationTrafficConfigured: false/);
  assert.match(prepare, /publicActivationAuthorized:false/);
  assert.match(prepare, /applicationWritesAuthorized:false/);
});

test("Public rehearsal pins the LAN fork and broadcasts only to Anvil", () => {
  assert.match(rehearsal, /--fork-url/);
  assert.match(rehearsal, /127\.0\.0\.1:28620/);
  assert.match(rehearsal, /anvil_impersonateAccount/);
  assert.match(rehearsal, /evm_increaseTime/);
  assert.match(rehearsal, /mainnetTransactionsBroadcast: 0/);
  assert.match(rehearsal, /local-fork-broadcast/);
  assert.match(rehearsal, /publicActivationAuthorized: false/);
  assert.match(rehearsal, /applicationWritesAuthorized: false/);
});

test("application manifest binds the exact releases and strips test-only route identity", () => {
  assert.match(applicationManifest, /4728cb5cce4b0bad1c275b8bfcc2de3e8fb3f6a4/);
  assert.match(applicationManifest, /8327b250122cd9050a7da6a44e12859e3cf521aa/);
  assert.match(applicationManifest, /5ea50ed836d81416a7a6a32c8078a864fca28d0b/);
  assert.match(
    applicationManifest,
    /factory: lifecycle\.contracts\.launchFactory/,
  );
  assert.match(
    prepare,
    /5e92d61940f39b05f7b61273b0a2d190d77cf204369a224822b098a4f5ca01e1/,
  );
  assert.match(applicationManifest, /robinhood-mainnet-real-liquidity/);
  assert.match(applicationManifest, /canonical-weth-runtime/);
  assert.match(applicationManifest, /mockOnly: false/);
  assert.match(applicationManifest, /applicationWritesEnabled: true/);
  assert.match(applicationManifest, /publicActivationAuthorized: false/);
});

test("scoped indexer acceptance independently proves retained log scope and runway", () => {
  assert.match(scopedIndexerVerifier, /manifest\.contracts\?\.factory/);
  assert.match(scopedIndexerVerifier, /manifest\.contracts\?\.launchFactory/);
  assert.match(scopedIndexerVerifier, /duplicate retained Sherwood log/);
  assert.match(
    scopedIndexerVerifier,
    /excluded or unrelated global source entered raw_logs/,
  );
  assert.match(scopedIndexerVerifier, /unscoped PoolManager log retained/);
  assert.match(
    scopedIndexerVerifier,
    /launch projection differs from direct contract state/,
  );
  assert.match(scopedIndexerVerifier, /scoped log mismatch/);
  assert.match(scopedIndexerVerifier, /MAXIMUM_DATABASE_BYTES/);
  assert.match(scopedIndexerVerifier, /MINIMUM_FREE_BYTES/);
  assert.match(scopedIndexerVerifier, /fallbackTrafficAuthorized !== false/);
});

test("Public ingress keeps browser RPC on the LAN-only loopback gateway", () => {
  assert.match(publicNginx, /listen 127\.0\.0\.1:3082/);
  assert.match(publicNginx, /location = \/rpc/);
  assert.match(publicNginx, /limit_except POST/);
  assert.match(publicNginx, /proxy_pass http:\/\/127\.0\.0\.1:18549/);
  assert.match(publicNginx, /proxy_pass http:\/\/127\.0\.0\.1:3121\//);
  assert.match(publicNginx, /proxy_pass http:\/\/127\.0\.0\.1:3022/);
  assert.doesNotMatch(publicNginx, /alchemy|rpc\.robinhood|fallback/i);
});

test("Mainnet keeper decrypts its operator key through a private FIFO", () => {
  assert.match(mainnetPm2, /ROBYN_MAINNET_OPERATOR_KEYSTORE/);
  assert.match(mainnetPm2, /ROBYN_MAINNET_OPERATOR_PASSWORD_FILE/);
  assert.match(mainnetPm2, /start-schema18-mainnet-keeper-secure\.sh/);
  assert.match(secureKeeper, /mkfifo -m 600/);
  assert.match(secureKeeper, /CAST_UNSAFE_PASSWORD/);
  assert.match(secureKeeper, /ROBYN_OPERATOR_KEY_FILE="\$key_fifo"/);
  assert.match(secureKeeper, /rm -f -- "\$key_fifo"/);
  assert.doesNotMatch(secureKeeper, /set -x|cat\s+["']?\$password_file/i);
  assert.match(keyPipe, /0x\[0-9a-fA-F\]\{64\}/);
  assert.match(keyPipe, /unique\.length !== 1/);
});
