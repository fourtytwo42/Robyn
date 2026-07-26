import assert from "node:assert/strict";
import test from "node:test";
import { decodeAbiParameters, parseAbiParameters } from "viem";
import {
  alignedConcentratedTicks,
  encodeV4MintPosition,
} from "../lib/v4-position-manager.mjs";

const poolKey = {
  currency0: "0x0000000000000000000000000000000000000000",
  currency1: "0x1111111111111111111111111111111111111111",
  fee: 10_000,
  tickSpacing: 200,
  hooks: "0x2222222222222222222222222222222222222222",
};

test("encodes mint plus settle-pair position actions", () => {
  const encoded = encodeV4MintPosition({
    poolKey,
    tickLower: -887_200,
    tickUpper: 887_200,
    liquidity: 1_000n,
    amount0Max: 2_000n,
    amount1Max: 3_000n,
    owner: "0x3333333333333333333333333333333333333333",
  });
  const [actions, params] = decodeAbiParameters(
    parseAbiParameters("bytes actions,bytes[] params"),
    encoded,
  );
  assert.equal(actions, "0x020d");
  assert.equal(params.length, 2);
});

test("concentrated ticks are aligned and bounded", () => {
  assert.deepEqual(alignedConcentratedTicks(1_237, 200), {
    tickLower: -800,
    tickUpper: 3_200,
  });
  assert.deepEqual(alignedConcentratedTicks(-886_900, 200), {
    tickLower: -887_200,
    tickUpper: -885_000,
  });
});

test("rejects unaligned position ticks", () => {
  assert.throws(
    () =>
      encodeV4MintPosition({
        poolKey,
        tickLower: -199,
        tickUpper: 200,
        liquidity: 1n,
        amount0Max: 1n,
        amount1Max: 1n,
        owner: "0x3333333333333333333333333333333333333333",
      }),
    /spacing aligned/,
  );
});
