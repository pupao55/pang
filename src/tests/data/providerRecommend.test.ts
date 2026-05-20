import { describe, expect, it } from "vitest";
import {
  recommendProvider,
  type ProviderSnapshot,
} from "@/lib/data/providers/recommend";

function snap(
  providerId: "akshareLocal" | "baostockLocal",
  partial: Partial<ProviderSnapshot> = {},
): ProviderSnapshot {
  return {
    providerId,
    cacheOk: false,
    symbolCount: 0,
    succeeded: 0,
    failed: 0,
    empty: 0,
    skipped: 0,
    ...partial,
  };
}

describe("recommendProvider", () => {
  it("recommends BaoStock setup when AkShare is sparse and BaoStock missing", () => {
    const r = recommendProvider(
      snap("akshareLocal", { cacheOk: true, symbolCount: 1, succeeded: 1, failed: 0 }),
      snap("baostockLocal", { cacheOk: false }),
    );
    expect(r.provider).toBe("baostockLocal");
    expect(r.command).toMatch(/setup:baostock/);
  });

  it("recommends BaoStock when AkShare has many failures", () => {
    const r = recommendProvider(
      snap("akshareLocal", { cacheOk: true, symbolCount: 10, succeeded: 1, failed: 9 }),
      snap("baostockLocal", { cacheOk: false }),
    );
    expect(r.provider).toBe("baostockLocal");
  });

  it("recommends growing BaoStock when AkShare blocked and BaoStock < 30", () => {
    const r = recommendProvider(
      snap("akshareLocal", { cacheOk: true, symbolCount: 1 }),
      snap("baostockLocal", { cacheOk: true, symbolCount: 10, succeeded: 10 }),
    );
    expect(r.provider).toBe("baostockLocal");
    expect(r.command).toMatch(/fetch:baostock:resume/);
  });

  it("recommends BaoStock validation when its cache is large", () => {
    const r = recommendProvider(
      snap("akshareLocal", { cacheOk: true, symbolCount: 1 }),
      snap("baostockLocal", { cacheOk: true, symbolCount: 60, succeeded: 60 }),
    );
    expect(r.provider).toBe("baostockLocal");
    expect(r.command).toMatch(/validate:baostock/);
  });

  it("falls back to AkShare resume when AkShare is fine but small", () => {
    const r = recommendProvider(
      snap("akshareLocal", { cacheOk: true, symbolCount: 10, succeeded: 10, failed: 0 }),
      snap("baostockLocal", { cacheOk: false }),
    );
    expect(r.provider).toBe("akshareLocal");
    expect(r.command).toMatch(/fetch:akshare:resume/);
  });

  it("recommends refresh + calibrate when AkShare is healthy at 30+", () => {
    const r = recommendProvider(
      snap("akshareLocal", { cacheOk: true, symbolCount: 100, succeeded: 100, failed: 0 }),
      snap("baostockLocal", { cacheOk: false }),
    );
    expect(r.provider).toBe("akshareLocal");
    expect(r.command).toMatch(/refresh:akshare-context/);
  });
});
