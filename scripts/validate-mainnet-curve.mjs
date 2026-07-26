import { readFile } from "node:fs/promises";

const configUrl = new URL(
  "../config/protocol/robinhood-mainnet-curve.json",
  import.meta.url,
);
const config = JSON.parse(await readFile(configUrl, "utf8"));

const value = (name) => BigInt(config[name]);
const ceilDiv = (numerator, denominator) =>
  (numerator + denominator - 1n) / denominator;
const assert = (condition, message) => {
  if (!condition) {
    throw new Error(`Invalid Robinhood mainnet curve: ${message}`);
  }
};

const bps = 10_000n;
const totalSupply = value("totalTokenSupply");
const curveAllocation = value("curveTokenAllocation");
const graduationAllocation = value("graduationTokenAllocation");
const initialVirtualToken = value("initialVirtualTokenReserve");
const initialVirtualNative = value("initialVirtualNativeReserve");
const configuredThreshold = value("graduationThresholdNative");
const terminalVirtualToken = initialVirtualToken - curveAllocation;
const invariant = initialVirtualToken * initialVirtualNative;
const terminalVirtualNative = ceilDiv(invariant, terminalVirtualToken);
const requiredNetNative = terminalVirtualNative - initialVirtualNative;
const terminalPriceX18 = (terminalVirtualNative * 10n ** 18n) / terminalVirtualToken;
const terminalFdvNative = (terminalPriceX18 * totalSupply) / 10n ** 18n;
const minimumGrossDemand = ceilDiv(
  configuredThreshold * bps,
  bps - BigInt(config.curveFeeBps),
);

assert(config.schemaVersion === 1, "schema version must be 1");
assert(config.environment === "robinhood-mainnet", "environment mismatch");
assert(config.chainId === 4663, "chain ID must be 4663");
assert(config.quoteCurrency === "native-ETH", "quote currency must be native ETH");
assert(curveAllocation + graduationAllocation === totalSupply, "token allocations must equal supply");
assert(terminalVirtualToken === value("terminalVirtualTokenReserve"), "terminal token reserve mismatch");
assert(terminalVirtualNative === value("terminalVirtualNativeReserve"), "terminal native reserve mismatch");
assert(requiredNetNative === configuredThreshold, "curve exhaustion must require exactly 6 ETH net");
assert(terminalPriceX18 === value("terminalNativePerTokenX18"), "terminal price mismatch");
assert(terminalFdvNative === value("terminalFullyDilutedValueNative"), "terminal FDV mismatch");
assert(minimumGrossDemand === value("minimumGrossBuyDemand"), "gross demand mismatch");
assert(BigInt(config.curveFeeBps) === 100n, "bonding fee must remain 1%");
assert(BigInt(config.graduatedProtocolFeeBps) === 100n, "graduated protocol fee must remain 1%");
assert(config.graduatedPoolLpFeePips === 10_000, "graduated LP fee must remain 1%");
assert(value("maximumCurvePurchase") <= configuredThreshold / 10n, "single buy cap must not exceed 10%");
assert(value("maximumNativeSwap") > 0n, "graduated swap cap must be positive");
assert(config.policy === "immutable-per-factory", "curve policy must be immutable per factory");

console.log(
  JSON.stringify(
    {
      chainId: config.chainId,
      graduationThresholdWei: configuredThreshold.toString(),
      minimumGrossBuyDemandWei: minimumGrossDemand.toString(),
      terminalFullyDilutedValueWei: terminalFdvNative.toString(),
      maximumCurvePurchaseWei: value("maximumCurvePurchase").toString(),
      maximumNativeSwapWei: value("maximumNativeSwap").toString(),
      valid: true,
    },
    null,
    2,
  ),
);
