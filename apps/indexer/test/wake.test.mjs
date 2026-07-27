import assert from "node:assert/strict";
import test from "node:test";
import {
  createDebouncedWake,
  normalizeWakeAddresses,
  reconnectDelayMs,
  WakeCoordinator,
  wakeAddressFingerprint,
} from "../dist/wake.js";

const first = "0x0000000000000000000000000000000000000001";
const second = "0x0000000000000000000000000000000000000002";

test("wake address filters are normalized, deduplicated, and stable", () => {
  assert.deepEqual(
    normalizeWakeAddresses([second, first, second.toUpperCase()]),
    [first, second],
  );
  assert.equal(
    wakeAddressFingerprint([second, first]),
    wakeAddressFingerprint([first, second, first]),
  );
});

test("websocket reconnect backoff is bounded", () => {
  assert.equal(reconnectDelayMs(0), 1_000);
  assert.equal(reconnectDelayMs(1), 2_000);
  assert.equal(reconnectDelayMs(20), 30_000);
  assert.throws(() => reconnectDelayMs(-1), /Invalid/);
});

test("wake coordinator coalesces queued events and retains reconciliation", async () => {
  const coordinator = new WakeCoordinator();
  coordinator.trigger();
  coordinator.trigger();
  assert.equal(await coordinator.wait(50), "event");
  assert.equal(await coordinator.wait(5), "reconciliation");
});

test("debounced wake collapses an event burst", async () => {
  let wakes = 0;
  const debounced = createDebouncedWake(() => {
    wakes += 1;
  }, 5);
  debounced.notify();
  debounced.notify();
  debounced.notify();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(wakes, 1);
  debounced.cancel();
});
