import { encodeAbiParameters, parseAbiParameters } from "viem";

export const V4_SWAP_COMMAND = "0x10";
export const V4_SWAP_EXACT_IN_SINGLE = 0x06;
export const V4_SWAP_EXACT_OUT_SINGLE = 0x08;
export const V4_SETTLE_ALL = 0x0c;
export const V4_TAKE_ALL = 0x0f;

const swapParameters = parseAbiParameters(
  "((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 amount,uint128 limit,bytes hookData) params",
);
const currencyAmountParameters = parseAbiParameters(
  "address currency,uint256 amount",
);
const sweepParameters = parseAbiParameters(
  "address token,address recipient,uint256 amountMinimum",
);
const planParameters = parseAbiParameters("bytes actions,bytes[] params");

function actionByte(action) {
  return action.toString(16).padStart(2, "0");
}

export function encodeUniversalV4SingleSwap({
  poolKey,
  zeroForOne,
  exactOutput = false,
  amount,
  limit,
  refundRecipient,
}) {
  if (amount <= 0n || limit <= 0n) {
    throw new Error("Universal v4 swap amounts must be positive");
  }
  const inputCurrency = zeroForOne ? poolKey.currency0 : poolKey.currency1;
  const outputCurrency = zeroForOne ? poolKey.currency1 : poolKey.currency0;
  const swapAction = exactOutput
    ? V4_SWAP_EXACT_OUT_SINGLE
    : V4_SWAP_EXACT_IN_SINGLE;
  const actions = `0x${actionByte(swapAction)}${actionByte(V4_SETTLE_ALL)}${actionByte(V4_TAKE_ALL)}`;
  const swap = encodeAbiParameters(swapParameters, [
    { poolKey, zeroForOne, amount, limit, hookData: "0x" },
  ]);
  const settle = encodeAbiParameters(currencyAmountParameters, [
    inputCurrency,
    exactOutput ? limit : amount,
  ]);
  const take = encodeAbiParameters(currencyAmountParameters, [
    outputCurrency,
    exactOutput ? amount : limit,
  ]);

  const inputs = [
    encodeAbiParameters(planParameters, [actions, [swap, settle, take]]),
  ];
  let commands = V4_SWAP_COMMAND;
  if (
    exactOutput &&
    inputCurrency === "0x0000000000000000000000000000000000000000"
  ) {
    if (!refundRecipient) {
      throw new Error("Exact-output native swaps require a refund recipient");
    }
    commands = "0x1004";
    inputs.push(
      encodeAbiParameters(sweepParameters, [
        inputCurrency,
        refundRecipient,
        0n,
      ]),
    );
  }

  return {
    commands,
    inputs,
    actions,
    inputCurrency,
    outputCurrency,
  };
}
