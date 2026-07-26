import { encodeAbiParameters, parseAbiParameters } from "viem";

const mintParameters = parseAbiParameters(
  "(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,int24 tickLower,int24 tickUpper,uint256 liquidity,uint128 amount0Max,uint128 amount1Max,address owner,bytes hookData",
);
const currencyPairParameters = parseAbiParameters(
  "address currency0,address currency1",
);
const planParameters = parseAbiParameters("bytes actions,bytes[] params");

export function encodeV4MintPosition({
  poolKey,
  tickLower,
  tickUpper,
  liquidity,
  amount0Max,
  amount1Max,
  owner,
}) {
  if (
    tickLower >= tickUpper ||
    tickLower % poolKey.tickSpacing !== 0 ||
    tickUpper % poolKey.tickSpacing !== 0
  ) {
    throw new Error("Position ticks must be ordered and spacing aligned");
  }
  if (liquidity <= 0n || amount0Max <= 0n || amount1Max <= 0n) {
    throw new Error("Position amounts must be positive");
  }
  const mint = encodeAbiParameters(mintParameters, [
    poolKey,
    tickLower,
    tickUpper,
    liquidity,
    amount0Max,
    amount1Max,
    owner,
    "0x",
  ]);
  const settlePair = encodeAbiParameters(currencyPairParameters, [
    poolKey.currency0,
    poolKey.currency1,
  ]);
  return encodeAbiParameters(planParameters, ["0x020d", [mint, settlePair]]);
}

export function alignedConcentratedTicks(
  currentTick,
  tickSpacing,
  halfWidthSpacings = 10,
) {
  if (tickSpacing <= 0 || halfWidthSpacings <= 0) {
    throw new Error("Tick spacing and width must be positive");
  }
  const center = Math.floor(currentTick / tickSpacing) * tickSpacing;
  const width = tickSpacing * halfWidthSpacings;
  return {
    tickLower: Math.max(-887_200, center - width),
    tickUpper: Math.min(887_200, center + width),
  };
}
