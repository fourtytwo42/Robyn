import assert from "node:assert/strict";
import test from "node:test";
import { decodeAbiParameters, parseAbiParameters } from "viem";
import {
  encodeUniversalV4SingleSwap,
  V4_SWAP_COMMAND,
} from "../lib/v4-universal-router.mjs";

const zero = "0x0000000000000000000000000000000000000000";
const token = "0x1111111111111111111111111111111111111111";
const hook = "0x2222222222222222222222222222222222222222";
const poolKey = {
  currency0: zero,
  currency1: token,
  fee: 10_000,
  tickSpacing: 200,
  hooks: hook,
};
const planParameters = parseAbiParameters("bytes actions,bytes[] params");
const currencyAmountParameters = parseAbiParameters(
  "address currency,uint256 amount",
);

test("encodes native-to-token exact-input Universal Router actions", () => {
  const encoded = encodeUniversalV4SingleSwap({
    poolKey,
    zeroForOne: true,
    amount: 1_000n,
    limit: 900n,
  });
  assert.equal(encoded.commands, V4_SWAP_COMMAND);
  assert.equal(encoded.actions, "0x060c0f");
  assert.equal(encoded.inputCurrency, zero);
  assert.equal(encoded.outputCurrency, token);

  const [actions, params] = decodeAbiParameters(
    planParameters,
    encoded.inputs[0],
  );
  assert.equal(actions, "0x060c0f");
  assert.equal(params.length, 3);
  assert.deepEqual(decodeAbiParameters(currencyAmountParameters, params[1]), [
    zero,
    1_000n,
  ]);
  assert.deepEqual(decodeAbiParameters(currencyAmountParameters, params[2]), [
    token,
    900n,
  ]);
});

test("encodes token-to-native exact-output Universal Router actions", () => {
  const encoded = encodeUniversalV4SingleSwap({
    poolKey,
    zeroForOne: false,
    exactOutput: true,
    amount: 500n,
    limit: 700n,
  });
  assert.equal(encoded.actions, "0x080c0f");
  assert.equal(encoded.inputCurrency, token);
  assert.equal(encoded.outputCurrency, zero);

  const [, params] = decodeAbiParameters(planParameters, encoded.inputs[0]);
  assert.deepEqual(decodeAbiParameters(currencyAmountParameters, params[1]), [
    token,
    700n,
  ]);
  assert.deepEqual(decodeAbiParameters(currencyAmountParameters, params[2]), [
    zero,
    500n,
  ]);
});

test("adds a native refund sweep to exact-output buys", () => {
  const recipient = "0x3333333333333333333333333333333333333333";
  const encoded = encodeUniversalV4SingleSwap({
    poolKey,
    zeroForOne: true,
    exactOutput: true,
    amount: 500n,
    limit: 700n,
    refundRecipient: recipient,
  });
  assert.equal(encoded.commands, "0x1004");
  assert.equal(encoded.inputs.length, 2);
});

test("rejects zero swap amounts and limits", () => {
  assert.throws(
    () =>
      encodeUniversalV4SingleSwap({
        poolKey,
        zeroForOne: true,
        amount: 0n,
        limit: 1n,
      }),
    /positive/,
  );
});
