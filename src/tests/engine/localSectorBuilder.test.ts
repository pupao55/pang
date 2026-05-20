import { describe, expect, it } from "vitest";
import {
  buildLocalSectors,
  DEFAULT_LOCAL_SECTOR_CONFIG,
  type SectorMetaInput,
} from "@/lib/engine/localSectorBuilder";
import type { StockDailyBar } from "@/lib/types/stock";

function bar(symbol: string, date: string, close: number): StockDailyBar {
  return {
    symbol,
    name: symbol,
    date,
    open: close,
    high: close * 1.01,
    low: close * 0.99,
    close,
    volume: 1000,
    amount: close * 1000,
    turnoverRate: 1,
    pctChange: 0,
  };
}

function ramp(symbol: string, prices: number[]): StockDailyBar[] {
  return prices.map((p, i) =>
    bar(symbol, `2024-01-${String(i + 2).padStart(2, "0")}`, p),
  );
}

function meta(symbol: string, override: Partial<SectorMetaInput> = {}): SectorMetaInput {
  return {
    symbol,
    industry: "",
    syntheticBoardGroup: `BOARD_MAIN`,
    syntheticPrefixGroup: `PREFIX_${symbol.slice(0, 3)}`,
    boardType: "MAIN",
    ...override,
  };
}

describe("buildLocalSectors", () => {
  it("drops groups with fewer than minMembers (3 by default)", () => {
    const bars = {
      "600000.SH": ramp("600000.SH", [10, 11]),
      "600001.SH": ramp("600001.SH", [10, 11]),
    };
    const metas = [meta("600000.SH"), meta("600001.SH")];
    const r = buildLocalSectors({ barsBySymbol: bars, metas });
    // Each group has only 2 members → no snapshots emitted.
    expect(r.totalGroups).toBe(0);
    expect(r.warnings.some((w) => /minMembers/.test(w))).toBe(true);
  });

  it("emits a snapshot when a group has ≥ 3 members", () => {
    const symbols = ["600000.SH", "600001.SH", "600002.SH"];
    const bars: Record<string, StockDailyBar[]> = {};
    for (const s of symbols) bars[s] = ramp(s, [10, 11]);
    const metas = symbols.map((s) => meta(s));
    const r = buildLocalSectors({ barsBySymbol: bars, metas });
    expect(r.totalGroups).toBeGreaterThan(0);
    // Should be one snapshot for the shared BOARD_MAIN group at date 2024-01-03.
    const day2 = r.byDate.get("2024-01-03") ?? [];
    const boardMain = day2.find((s) => s.sectorType === "BOARD" && s.sectorName === "BOARD_MAIN");
    expect(boardMain).toBeDefined();
    expect(boardMain!.memberCount).toBe(3);
    expect(boardMain!.breadthUpRatio).toBeGreaterThan(0); // all moved up 10%
  });

  it("ranks groups by momentum score (best first)", () => {
    const up = ["600000.SH", "600001.SH", "600002.SH"];
    const down = ["000100.SZ", "000101.SZ", "000102.SZ"];
    const bars: Record<string, StockDailyBar[]> = {};
    for (const s of up) bars[s] = ramp(s, [10, 12]); // +20%
    for (const s of down) bars[s] = ramp(s, [10, 9]); // -10%
    const metas = [
      ...up.map((s) => meta(s, { syntheticBoardGroup: "BOARD_UP" })),
      ...down.map((s) => meta(s, { syntheticBoardGroup: "BOARD_DOWN" })),
    ];
    const r = buildLocalSectors({ barsBySymbol: bars, metas });
    const day2 = r.byDate.get("2024-01-03") ?? [];
    const boardUp = day2.find((s) => s.sectorName === "BOARD_UP");
    const boardDown = day2.find((s) => s.sectorName === "BOARD_DOWN");
    expect(boardUp!.strengthRank).toBeLessThan(boardDown!.strengthRank);
    expect(boardUp!.momentumScore).toBeGreaterThan(boardDown!.momentumScore);
  });

  it("respects industry from metadata", () => {
    const symbols = ["A.SH", "B.SH", "C.SH"];
    const bars: Record<string, StockDailyBar[]> = {};
    for (const s of symbols) bars[s] = ramp(s, [10, 11]);
    const metas = symbols.map((s) => meta(s, { industry: "电池" }));
    const r = buildLocalSectors({ barsBySymbol: bars, metas });
    const day2 = r.byDate.get("2024-01-03") ?? [];
    const industry = day2.find((s) => s.sectorType === "INDUSTRY" && s.sectorName === "电池");
    expect(industry).toBeDefined();
    expect(industry!.memberCount).toBe(3);
  });

  it("computes breadth correctly with mixed direction", () => {
    const ups = ["600000.SH", "600001.SH"];
    const downs = ["600002.SH"];
    const bars: Record<string, StockDailyBar[]> = {};
    for (const s of ups) bars[s] = ramp(s, [10, 11]);
    for (const s of downs) bars[s] = ramp(s, [10, 9]);
    const metas = [...ups, ...downs].map((s) => meta(s));
    const r = buildLocalSectors({ barsBySymbol: bars, metas });
    const day2 = r.byDate.get("2024-01-03") ?? [];
    const board = day2.find((s) => s.sectorName === "BOARD_MAIN");
    expect(board!.breadthUpRatio).toBeCloseTo(2 / 3, 2);
  });

  it("DEFAULT_LOCAL_SECTOR_CONFIG.minMembers is 3", () => {
    expect(DEFAULT_LOCAL_SECTOR_CONFIG.minMembers).toBe(3);
  });
});
