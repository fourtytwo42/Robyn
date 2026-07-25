import type { Address } from "viem";
import { PortfolioView } from "./portfolio-view";

export function NetworkPortfolioView({
  account,
  readOnly,
}: {
  account?: Address;
  readOnly?: boolean;
}) {
  return <PortfolioView account={account} readOnly={readOnly} />;
}
