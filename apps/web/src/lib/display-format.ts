import { formatEther } from "viem";

export function governanceDuration(value: string) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds < 0) return "Unavailable";
  if (seconds === 0) return "No delay";

  const units = [
    { seconds: 86_400, singular: "day", plural: "days" },
    { seconds: 3_600, singular: "hour", plural: "hours" },
    { seconds: 60, singular: "minute", plural: "minutes" },
  ];
  for (const unit of units) {
    if (seconds >= unit.seconds && seconds % unit.seconds === 0) {
      const count = seconds / unit.seconds;
      return `${count.toLocaleString()} ${
        count === 1 ? unit.singular : unit.plural
      }`;
    }
  }
  return `${seconds.toLocaleString()} ${seconds === 1 ? "second" : "seconds"}`;
}

export function marketAmount(value: string, symbol: string) {
  const amount = Number(formatEther(BigInt(value)));
  if (amount > 0 && amount < 0.000001) {
    return `<0.000001 ${symbol}`;
  }
  return `${amount.toLocaleString(undefined, {
    notation: amount >= 1_000 ? "compact" : "standard",
    maximumFractionDigits:
      amount >= 1_000 ? 2 : amount >= 1 ? 2 : amount >= 0.01 ? 4 : 6,
  })} ${symbol}`;
}
