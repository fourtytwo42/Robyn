import { transactionGasLimit } from "./campaign-plan.mjs";
import { transactionFundingTarget } from "../testnet-endurance-policy.mjs";

export async function prepareFundedTransaction({
  request,
  feeEnvelope,
  estimationGasCeiling,
  transactionGasCeiling,
  additionalFeeReserveWei,
  ensureFunding,
  estimateGas,
}) {
  if (
    typeof ensureFunding !== "function" ||
    typeof estimateGas !== "function" ||
    estimationGasCeiling <= 0n ||
    transactionGasCeiling <= 0n
  ) {
    throw new Error("Funded transaction preparation is invalid");
  }
  const preparedRequest = { ...request, ...feeEnvelope };
  const estimationTargetWei = transactionFundingTarget({
    valueWei: preparedRequest.value ?? 0n,
    estimatedGas: estimationGasCeiling,
    maxFeePerGas: feeEnvelope.maxFeePerGas,
    additionalFeeReserveWei,
  });
  await ensureFunding({
    stage: "estimate",
    targetWei: estimationTargetWei,
    request: preparedRequest,
    estimatedGas: estimationGasCeiling,
  });
  const estimatedGas = await estimateGas(preparedRequest);
  const gas = transactionGasLimit(estimatedGas);
  if (gas > transactionGasCeiling) {
    throw new Error(
      `Transaction exceeds the ${transactionGasCeiling} gas ceiling: ${gas}`,
    );
  }
  const finalTargetWei = transactionFundingTarget({
    valueWei: preparedRequest.value ?? 0n,
    estimatedGas,
    maxFeePerGas: feeEnvelope.maxFeePerGas,
    additionalFeeReserveWei,
  });
  await ensureFunding({
    stage: "final",
    targetWei: finalTargetWei,
    request: preparedRequest,
    estimatedGas,
  });
  return {
    request: { ...preparedRequest, gas },
    estimatedGas,
    gas,
    estimationTargetWei,
    finalTargetWei,
  };
}
