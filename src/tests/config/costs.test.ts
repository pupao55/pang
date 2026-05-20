import { describe, expect, it } from "vitest";
import {
  A_SHARE_DEFAULT_COSTS,
  applySlippage,
  commission,
  stampDuty,
} from "@/lib/config/costs";

describe("cost model", () => {
  it("buy slippage raises fill price, sell slippage lowers it", () => {
    const buy = applySlippage(100, "BUY", 10);
    const sell = applySlippage(100, "SELL", 10);
    expect(buy).toBeGreaterThan(100);
    expect(sell).toBeLessThan(100);
    expect(buy - 100).toBeCloseTo(100 - sell, 6);
  });

  it("commission applies rate per side", () => {
    expect(commission(1_000_000, "BUY", A_SHARE_DEFAULT_COSTS)).toBeCloseTo(300, 2);
    expect(commission(1_000_000, "SELL", A_SHARE_DEFAULT_COSTS)).toBeCloseTo(300, 2);
  });

  it("stamp duty is sell-only", () => {
    expect(stampDuty(1_000_000, "BUY", A_SHARE_DEFAULT_COSTS)).toBe(0);
    expect(stampDuty(1_000_000, "SELL", A_SHARE_DEFAULT_COSTS)).toBeCloseTo(500, 2);
  });
});
