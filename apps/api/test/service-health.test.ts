import { describe, expect, it } from "vitest";
import {
  keeperExpectedFromEnvironment,
  keeperHealthSatisfied,
  keeperStatusForHealth,
} from "../src/service-health.js";

describe("keeper health policy", () => {
  it("expects the keeper unless the host explicitly delegates it", () => {
    expect(keeperExpectedFromEnvironment(undefined)).toBe(true);
    expect(keeperExpectedFromEnvironment("true")).toBe(true);
    expect(keeperExpectedFromEnvironment("false")).toBe(false);
    expect(keeperExpectedFromEnvironment(" FALSE ")).toBe(false);
  });

  it("keeps ordinary environments fail-closed", () => {
    expect(keeperHealthSatisfied(true, "ok")).toBe(true);
    expect(keeperHealthSatisfied(true, "degraded")).toBe(false);
    expect(keeperStatusForHealth(true, "degraded")).toBe("degraded");
  });

  it("reports an intentionally external keeper without degrading the app host", () => {
    expect(keeperHealthSatisfied(false, "degraded")).toBe(true);
    expect(keeperStatusForHealth(false, "degraded")).toBe("external");
  });
});
