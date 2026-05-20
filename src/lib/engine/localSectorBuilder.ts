// Local sector strength builder (v1.8).
//
// BaoStock's free tier does not expose historical concept/industry boards.
// Pangzi instead derives per-date sector strength from the cached universe:
// group stocks by (industry | synthetic board | prefix), compute group-level
// pct change / breadth / momentum, and rank them.
//
// The output is intentionally NOT marketed as a substitute for
// 同花顺 / 东方财富 concept data — every SectorSnapshot is tagged with
// `sectorType` (INDUSTRY / BOARD / PREFIX) and the adapter surfaces this as
// `sectorMode = GENERATED` so the score engine knows to attach a caveat.

import type { SectorSnapshot } from "@/lib/types/market";
import type { BoardType, StockDailyBar } from "@/lib/types/stock";

export type LocalSectorType = "INDUSTRY" | "BOARD" | "PREFIX";

export interface LocalSectorSnapshot extends SectorSnapshot {
  sectorType: LocalSectorType;
  /** Equal-weighted average of group members' 1-day pct change. */
  equalWeightedReturn1d: number;
  return3d: number;
  return5d: number;
  /** Fraction of group members with pctChange > 0, [0, 1]. */
  breadthUpRatio: number;
  memberCount: number;
  source: "localSectorBuilder";
}

export interface SectorMetaInput {
  symbol: string;
  industry?: string | null;
  /** Synthetic board group label, e.g. BOARD_MAIN. */
  syntheticBoardGroup?: string;
  /** Synthetic prefix group label, e.g. PREFIX_600. */
  syntheticPrefixGroup?: string;
  boardType?: BoardType;
}

export interface LocalSectorBuilderInput {
  /** Symbol-keyed daily bars (chronological). */
  barsBySymbol: Record<string, StockDailyBar[]>;
  /** Per-symbol metadata. */
  metas: SectorMetaInput[];
  config?: Partial<LocalSectorBuilderConfig>;
}

export interface LocalSectorBuilderConfig {
  /** Minimum members per group; below this the group is dropped. */
  minMembers: number;
  /** Hard cap on how many top stocks to record per group. */
  topStocksLimit: number;
  /** Limit-up threshold used for cohort counts; main-board fallback. */
  limitUpThreshold: number;
}

export const DEFAULT_LOCAL_SECTOR_CONFIG: LocalSectorBuilderConfig = {
  minMembers: 3,
  topStocksLimit: 5,
  limitUpThreshold: 0.0995,
};

export interface LocalSectorBuildResult {
  byDate: Map<string, LocalSectorSnapshot[]>;
  warnings: string[];
  totalGroups: number;
  /** Dates with at least one snapshot. */
  datesCovered: string[];
}

interface GroupRow {
  date: string;
  symbol: string;
  close: number;
  prevClose: number;
}

function median(xs: number[]): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
}

function avg(xs: number[]): number {
  return xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : NaN;
}

/**
 * Group key resolver. Returns one or more (sectorType, sectorName) keys per
 * symbol — each symbol contributes to its industry (when present), its
 * synthetic board group, and its synthetic prefix group.
 */
function groupsForSymbol(meta: SectorMetaInput): Array<{ type: LocalSectorType; name: string }> {
  const out: Array<{ type: LocalSectorType; name: string }> = [];
  if (meta.industry && meta.industry.trim().length > 0) {
    out.push({ type: "INDUSTRY", name: meta.industry.trim() });
  }
  if (meta.syntheticBoardGroup) {
    out.push({ type: "BOARD", name: meta.syntheticBoardGroup });
  } else if (meta.boardType) {
    out.push({ type: "BOARD", name: `BOARD_${meta.boardType}` });
  }
  if (meta.syntheticPrefixGroup) {
    out.push({ type: "PREFIX", name: meta.syntheticPrefixGroup });
  } else {
    const code = meta.symbol.split(".")[0];
    if (code.length >= 3) out.push({ type: "PREFIX", name: `PREFIX_${code.slice(0, 3)}` });
  }
  return out;
}

/**
 * momentumScore — combine 1d/3d/5d return, breadth, and limit-up count.
 * Output is clamped to [0, 100]. Tuned so a strong sector (avgR5 ≥ 2%,
 * breadth ≥ 0.7, ≥ 2 limit-ups) lands in the 75-90 band.
 */
function momentumScore(stats: {
  return1d: number;
  return3d: number;
  return5d: number;
  breadth: number;
  limitUpCount: number;
}): number {
  let s = 50;
  if (Number.isFinite(stats.return1d)) s += stats.return1d * 3; // 1d
  if (Number.isFinite(stats.return3d)) s += stats.return3d * 1.5;
  if (Number.isFinite(stats.return5d)) s += stats.return5d * 1.0;
  s += (stats.breadth - 0.5) * 20; // breadth: 0.5 neutral, 1.0 → +10
  s += Math.min(stats.limitUpCount, 5) * 2;
  return Math.max(0, Math.min(100, +s.toFixed(2)));
}

export function buildLocalSectors(
  input: LocalSectorBuilderInput,
): LocalSectorBuildResult {
  const cfg: LocalSectorBuilderConfig = {
    ...DEFAULT_LOCAL_SECTOR_CONFIG,
    ...(input.config ?? {}),
  };
  const warnings: string[] = [];

  const metaBySymbol = new Map<string, SectorMetaInput>();
  for (const m of input.metas) metaBySymbol.set(m.symbol, m);

  // Index bars by (symbol, date) so we can look up close + previous close fast.
  const idxBySymbol = new Map<string, Map<string, number>>();
  for (const sym of Object.keys(input.barsBySymbol)) {
    const m = new Map<string, number>();
    const bars = input.barsBySymbol[sym];
    for (let i = 0; i < bars.length; i++) m.set(bars[i].date, i);
    idxBySymbol.set(sym, m);
  }

  // Collect all dates present in the cache.
  const allDates = new Set<string>();
  for (const sym of Object.keys(input.barsBySymbol)) {
    for (const b of input.barsBySymbol[sym]) allDates.add(b.date);
  }
  const dates = Array.from(allDates).sort();

  const byDate = new Map<string, LocalSectorSnapshot[]>();
  let totalGroups = 0;
  const datesCovered = new Set<string>();

  for (const date of dates) {
    // For each (groupType, groupName), collect rows present on this date.
    const groupRows = new Map<string, GroupRow[]>();
    const groupType = new Map<string, LocalSectorType>();

    for (const sym of Object.keys(input.barsBySymbol)) {
      const idx = idxBySymbol.get(sym)?.get(date);
      if (idx === undefined || idx === 0) continue;
      const bar = input.barsBySymbol[sym][idx];
      const prev = input.barsBySymbol[sym][idx - 1];
      if (!prev || prev.close <= 0) continue;
      const meta = metaBySymbol.get(sym) ?? { symbol: sym };
      const groups = groupsForSymbol(meta);
      for (const g of groups) {
        const key = `${g.type}:${g.name}`;
        groupType.set(key, g.type);
        const row: GroupRow = {
          date,
          symbol: sym,
          close: bar.close,
          prevClose: prev.close,
        };
        const arr = groupRows.get(key) ?? [];
        arr.push(row);
        groupRows.set(key, arr);
      }
    }

    const snaps: LocalSectorSnapshot[] = [];
    for (const [key, rows] of groupRows) {
      if (rows.length < cfg.minMembers) continue;

      const returns1d: number[] = [];
      const topRanker: { symbol: string; ret: number }[] = [];
      let upMembers = 0;
      let limitUps = 0;
      for (const r of rows) {
        const ret = ((r.close - r.prevClose) / r.prevClose) * 100;
        returns1d.push(ret);
        topRanker.push({ symbol: r.symbol, ret });
        if (ret > 0) upMembers += 1;
        if (ret >= cfg.limitUpThreshold * 100 - 0.05) limitUps += 1;
      }
      topRanker.sort((a, b) => b.ret - a.ret);
      const topStocks = topRanker.slice(0, cfg.topStocksLimit).map((x) => x.symbol);

      const breadth = upMembers / rows.length;

      // 3d / 5d cumulative group return — group mean of per-symbol cumulative
      // returns over the prior 3 / 5 trading days (where data exists).
      const cumReturn = (lookback: number): number => {
        const perSymbol: number[] = [];
        for (const r of rows) {
          const idx = idxBySymbol.get(r.symbol)?.get(date);
          if (idx === undefined || idx < lookback) continue;
          const back = input.barsBySymbol[r.symbol][idx - lookback];
          if (!back || back.close <= 0) continue;
          perSymbol.push(((r.close - back.close) / back.close) * 100);
        }
        return perSymbol.length ? avg(perSymbol) : NaN;
      };

      const return3d = cumReturn(3);
      const return5d = cumReturn(5);
      const medPct = median(returns1d);
      const equalWeighted = avg(returns1d);
      const score = momentumScore({
        return1d: equalWeighted,
        return3d,
        return5d,
        breadth,
        limitUpCount: limitUps,
      });

      const [type, ...nameParts] = key.split(":");
      snaps.push({
        date,
        sectorName: nameParts.join(":"),
        sectorType: (type as LocalSectorType) ?? groupType.get(key) ?? "BOARD",
        pctChange: +medPct.toFixed(2),
        equalWeightedReturn1d: +equalWeighted.toFixed(2),
        return3d: Number.isNaN(return3d) ? 0 : +return3d.toFixed(2),
        return5d: Number.isNaN(return5d) ? 0 : +return5d.toFixed(2),
        breadthUpRatio: +breadth.toFixed(3),
        limitUpCount: limitUps,
        memberCount: rows.length,
        topStocks,
        strengthRank: 0, // assigned below
        momentumScore: score,
        source: "localSectorBuilder",
      });
    }

    if (snaps.length === 0) {
      warnings.push(`${date}: no sector groups met the minMembers=${cfg.minMembers} floor.`);
      continue;
    }
    snaps.sort((a, b) => b.momentumScore - a.momentumScore);
    snaps.forEach((s, i) => (s.strengthRank = i + 1));
    byDate.set(date, snaps);
    totalGroups += snaps.length;
    datesCovered.add(date);
  }

  if (datesCovered.size === 0) {
    warnings.unshift(
      "Local sector builder produced no snapshots — the universe likely has fewer than " +
        `${cfg.minMembers} members per group. Grow the cache before relying on sector scores.`,
    );
  }

  return {
    byDate,
    warnings,
    totalGroups,
    datesCovered: Array.from(datesCovered).sort(),
  };
}
