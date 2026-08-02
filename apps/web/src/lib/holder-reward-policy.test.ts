import { describe, expect, it } from "vitest";
import {
  holderRewardAction,
  holderRewardActionLabel,
} from "./holder-reward-policy";

describe("holder reward action", () => {
  it.each([
    [false, false, false, false, 2, "connect"],
    [true, false, false, false, 2, "switch-network"],
    [true, true, true, true, 2, "claiming"],
    [true, true, false, false, 2, "wallet-unavailable"],
    [true, true, true, false, 0, "nothing-to-claim"],
    [true, true, true, false, 2, "claim"],
  ] as const)(
    "%s/%s/%s/%s/%s resolves to %s",
    (
      connected,
      correctChain,
      walletReady,
      working,
      claimableAssetCount,
      expected,
    ) => {
      const action = holderRewardAction({
        connected,
        correctChain,
        walletReady,
        working,
        claimableAssetCount,
      });
      expect(action).toBe(expected);
      expect(holderRewardActionLabel(action)).toBeTypeOf("string");
    },
  );
});
