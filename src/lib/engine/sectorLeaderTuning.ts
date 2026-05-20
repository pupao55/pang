// SectorLeader tightening experiment (v1.9).
//
// The shipped sectorLeader strategy currently fires ~18,800 signals on the
// BaoStock 169-symbol cache — far too many. This module sweeps parameter
// variants that NARROW the strategy and reports per-variant returns so the
// human can pick a tightening direction. It never mutates the live strategy.
//
// We re-evaluate over the existing sectorLeader historical signals only —
// the sweep can therefore only TIGHTEN the strategy (drop signals). Loosening
// is out of scope because we lack the negative samples on disk.

import type { ForwardReturnResolver, HistoricalSignalRecord } from "./scoreCalibration";
import type { SectorSnapshot } from "@/lib/types/market";
import type { LocalSectorSnapshot, LocalSectorType } from "./localSectorBuilder";
import type { StockMeta } from "@/lib/types/stock";

export type SectorTypeAllowed = "INDUSTRY_ONLY" | "INDUSTRY_AND_BOARD" | "ALL";
export type SectorLeaderRecommendation =
  | "KEEP_VARIANT"
  | "TOO_BROAD"
  | "TOO_SPARSE"
  | "NO_EDGE";

export interface SectorLeaderVariant {
  /** Sector must be in top X% of sectors that day (by strengthRank). */
  minSectorRankPercentile: number;
  /** Symbol must be in top Y% of its sector's topStocks. */
  minStockRankWithinSectorPercentile: number;
  /** Sector must have ≥ N members. */
  minMemberCount: number;
  /** Allow BOARD_* / PREFIX_* synthetic groups, not just real industries. */
  allowSyntheticGroups: boolean;
  sectorTypeAllowed: SectorTypeAllowed;
}

export interface SectorLeaderVariantResult {
  variant: SectorLeaderVariant;
  signalCount: number;
  avgReturn1d: number;
  avgReturn3d: number;
  avgReturn5d: number;
  winRate1d: number;
  winRate3d: number;
  winRate5d: number;
  worstReturn5d: number;
  bestHorizon: "1d" | "3d" | "5d" | "none";
  recommendedAction: SectorLeaderRecommendation;
}

export interface SectorLeaderTuningInput {
  signals: HistoricalSignalRecord[];
  resolver: ForwardReturnResolver;
  /** sectorSnapshotsByDate[date] = SectorSnapshot[] for that day. */
  sectorSnapshotsByDate: Map<string, SectorSnapshot[]>;
  metas: StockMeta[];
}

export interface SectorLeaderTuningResult {
  baseline: SectorLeaderVariantResult;
  variants: SectorLeaderVariantResult[];
  /** Best variant by 5d avg return with signalCount >= 100. */
  bestVariant?: SectorLeaderVariantResult;
  warning?: string;
}

const SECTOR_RANK_PCT = [10, 20, 30, 50];
const STOCK_RANK_WITHIN_SECTOR_PCT = [10, 20, 30];
const MIN_MEMBER = [3, 5, 10];
const ALLOW_SYNTH = [true, false];
const SECTOR_TYPES: SectorTypeAllowed[] = [
  "INDUSTRY_ONLY",
  "INDUSTRY_AND_BOARD",
  "ALL",
];

function avg(xs: number[]): number {
  return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : NaN;
}

function winRate(xs: number[]): number {
  if (xs.length === 0) return NaN;
  let w = 0;
  for (const x of xs) if (x > 0) w++;
  return w / xs.length;
}

function resolveSectorForStock(
  symbol: string,
  meta: StockMeta | undefined,
  sectors: SectorSnapshot[],
): SectorSnapshot | undefined {
  if (!meta) {
    // Fallback: pick the first sector whose topStocks include this symbol.
    return sectors.find((s) => s.topStocks.includes(symbol));
  }
  const byIndustry = sectors.find((s) => s.sectorName === meta.industry);
  if (byIndustry) return byIndustry;
  for (const concept of meta.concepts ?? []) {
    const m = sectors.find((s) => s.sectorName === concept);
    if (m) return m;
  }
  return sectors.find((s) => s.topStocks.includes(symbol));
}

interface EnrichedSignal {
  symbol: string;
  date: string;
  /** strengthRank within all sectors on that date. */
  strengthRank: number;
  /** Total number of sectors on that date (for percentile math). */
  totalSectors: number;
  /** Rank within sector.topStocks (1-based). NaN if not in topStocks. */
  rankInSector: number;
  /** Members of the sector. */
  sectorMemberCount: number;
  sectorType: LocalSectorType | "UNKNOWN";
  isSynthetic: boolean;
}

function enrichSignals(
  signals: HistoricalSignalRecord[],
  sectorSnapshotsByDate: Map<string, SectorSnapshot[]>,
  metas: StockMeta[],
): EnrichedSignal[] {
  const metaBySymbol = new Map<string, StockMeta>();
  for (const m of metas) metaBySymbol.set(m.symbol, m);

  const out: EnrichedSignal[] = [];
  for (const s of signals) {
    const sectors = sectorSnapshotsByDate.get(s.date) ?? [];
    if (sectors.length === 0) continue;
    const sec = resolveSectorForStock(s.symbol, metaBySymbol.get(s.symbol), sectors);
    if (!sec) continue;
    const local = sec as Partial<LocalSectorSnapshot> & SectorSnapshot;
    const sectorType: LocalSectorType | "UNKNOWN" = local.sectorType ?? "UNKNOWN";
    const memberCount = local.memberCount ?? sec.topStocks.length;
    const isSynthetic =
      sectorType === "BOARD" || sectorType === "PREFIX";
    const idxInTop = sec.topStocks.indexOf(s.symbol);
    const rankInSector = idxInTop === -1 ? NaN : idxInTop + 1;
    out.push({
      symbol: s.symbol,
      date: s.date,
      strengthRank: sec.strengthRank,
      totalSectors: sectors.length,
      rankInSector,
      sectorMemberCount: memberCount,
      sectorType,
      isSynthetic,
    });
  }
  return out;
}

function passesVariant(
  e: EnrichedSignal,
  v: SectorLeaderVariant,
): boolean {
  // Sector rank percentile.
  const sectorPctLimit = Math.max(
    1,
    Math.ceil((e.totalSectors * v.minSectorRankPercentile) / 100),
  );
  if (e.strengthRank > sectorPctLimit) return false;

  // Member count.
  if (e.sectorMemberCount < v.minMemberCount) return false;

  // Sector type.
  if (v.sectorTypeAllowed === "INDUSTRY_ONLY" && e.sectorType !== "INDUSTRY")
    return false;
  if (
    v.sectorTypeAllowed === "INDUSTRY_AND_BOARD" &&
    !(e.sectorType === "INDUSTRY" || e.sectorType === "BOARD")
  )
    return false;

  // Synthetic groups.
  if (!v.allowSyntheticGroups && e.isSynthetic) return false;

  // Stock rank within sector. NaN (not in topStocks) fails any percentile gate.
  if (!Number.isFinite(e.rankInSector)) return false;
  const memberLimit = Math.max(
    1,
    Math.ceil((e.sectorMemberCount * v.minStockRankWithinSectorPercentile) / 100),
  );
  if (e.rankInSector > memberLimit) return false;
  return true;
}

function evaluateVariant(
  v: SectorLeaderVariant,
  enriched: EnrichedSignal[],
  originalSignals: HistoricalSignalRecord[],
  resolver: ForwardReturnResolver,
): SectorLeaderVariantResult {
  // Index enriched by (symbol|date) so we can join to the source record.
  const passingIdx = new Set<string>();
  for (const e of enriched) {
    if (passesVariant(e, v)) passingIdx.add(`${e.symbol}|${e.date}`);
  }
  const r1: number[] = [];
  const r3: number[] = [];
  const r5: number[] = [];
  for (const s of originalSignals) {
    if (!passingIdx.has(`${s.symbol}|${s.date}`)) continue;
    const x1 = resolver.resolve(s.symbol, s.date, 1);
    const x3 = resolver.resolve(s.symbol, s.date, 3);
    const x5 = resolver.resolve(s.symbol, s.date, 5);
    if (!Number.isNaN(x1)) r1.push(x1);
    if (!Number.isNaN(x3)) r3.push(x3);
    if (!Number.isNaN(x5)) r5.push(x5);
  }
  const a1 = avg(r1);
  const a3 = avg(r3);
  const a5 = avg(r5);
  type H = "1d" | "3d" | "5d";
  const horizonAvgs: { k: H; v: number }[] = (
    [
      { k: "1d" as H, v: a1 },
      { k: "3d" as H, v: a3 },
      { k: "5d" as H, v: a5 },
    ]
  ).filter((x) => !Number.isNaN(x.v));
  const bestHorizon =
    horizonAvgs.length === 0
      ? "none"
      : horizonAvgs.reduce((b, x) => (x.v > b.v ? x : b)).k;

  const signalCount = passingIdx.size;
  let recommendedAction: SectorLeaderRecommendation;
  if (signalCount < 50) recommendedAction = "TOO_SPARSE";
  else if (signalCount > 8000) recommendedAction = "TOO_BROAD";
  else if (
    (Number.isFinite(a5) && a5 > 0 && winRate(r5) > 0.52) ||
    (Number.isFinite(a3) && a3 > 0 && winRate(r3) > 0.52) ||
    (Number.isFinite(a1) && a1 > 0 && winRate(r1) > 0.55)
  )
    recommendedAction = "KEEP_VARIANT";
  else recommendedAction = "NO_EDGE";

  return {
    variant: v,
    signalCount,
    avgReturn1d: Number.isFinite(a1) ? +a1.toFixed(2) : NaN,
    avgReturn3d: Number.isFinite(a3) ? +a3.toFixed(2) : NaN,
    avgReturn5d: Number.isFinite(a5) ? +a5.toFixed(2) : NaN,
    winRate1d: Number.isFinite(a1) ? +winRate(r1).toFixed(3) : NaN,
    winRate3d: Number.isFinite(a3) ? +winRate(r3).toFixed(3) : NaN,
    winRate5d: Number.isFinite(a5) ? +winRate(r5).toFixed(3) : NaN,
    worstReturn5d: r5.length ? +Math.min(...r5).toFixed(2) : NaN,
    bestHorizon,
    recommendedAction,
  };
}

/**
 * Classify a variant given its result — pure, exported for tests.
 */
export function classifySectorLeaderRecommendation(args: {
  signalCount: number;
  avgReturn1d: number;
  avgReturn3d: number;
  avgReturn5d: number;
  winRate1d: number;
  winRate3d: number;
  winRate5d: number;
}): SectorLeaderRecommendation {
  if (args.signalCount < 50) return "TOO_SPARSE";
  if (args.signalCount > 8000) return "TOO_BROAD";
  if (
    (Number.isFinite(args.avgReturn5d) && args.avgReturn5d > 0 && args.winRate5d > 0.52) ||
    (Number.isFinite(args.avgReturn3d) && args.avgReturn3d > 0 && args.winRate3d > 0.52) ||
    (Number.isFinite(args.avgReturn1d) && args.avgReturn1d > 0 && args.winRate1d > 0.55)
  )
    return "KEEP_VARIANT";
  return "NO_EDGE";
}

function enumerateVariants(): SectorLeaderVariant[] {
  const out: SectorLeaderVariant[] = [];
  for (const sr of SECTOR_RANK_PCT)
    for (const wr of STOCK_RANK_WITHIN_SECTOR_PCT)
      for (const mm of MIN_MEMBER)
        for (const allow of ALLOW_SYNTH)
          for (const st of SECTOR_TYPES)
            out.push({
              minSectorRankPercentile: sr,
              minStockRankWithinSectorPercentile: wr,
              minMemberCount: mm,
              allowSyntheticGroups: allow,
              sectorTypeAllowed: st,
            });
  return out;
}

export function tuneSectorLeader(
  input: SectorLeaderTuningInput,
): SectorLeaderTuningResult {
  const sectorLeaderSignals = input.signals.filter(
    (s) => s.strategyId === "sectorLeader",
  );
  if (sectorLeaderSignals.length === 0) {
    return {
      baseline: {
        variant: {
          minSectorRankPercentile: 100,
          minStockRankWithinSectorPercentile: 100,
          minMemberCount: 0,
          allowSyntheticGroups: true,
          sectorTypeAllowed: "ALL",
        },
        signalCount: 0,
        avgReturn1d: NaN,
        avgReturn3d: NaN,
        avgReturn5d: NaN,
        winRate1d: NaN,
        winRate3d: NaN,
        winRate5d: NaN,
        worstReturn5d: NaN,
        bestHorizon: "none",
        recommendedAction: "TOO_SPARSE",
      },
      variants: [],
      warning: "No sectorLeader signals found in store.",
    };
  }
  const enriched = enrichSignals(
    sectorLeaderSignals,
    input.sectorSnapshotsByDate,
    input.metas,
  );

  // Baseline = the current strategy (no extra filtering, all 18k+ signals).
  const baselineVariant: SectorLeaderVariant = {
    minSectorRankPercentile: 100,
    minStockRankWithinSectorPercentile: 100,
    minMemberCount: 0,
    allowSyntheticGroups: true,
    sectorTypeAllowed: "ALL",
  };
  const baseline = evaluateVariant(
    baselineVariant,
    enriched,
    sectorLeaderSignals,
    input.resolver,
  );

  const variants = enumerateVariants()
    .map((v) => evaluateVariant(v, enriched, sectorLeaderSignals, input.resolver))
    .sort((a, b) => b.avgReturn5d - a.avgReturn5d);

  const keepers = variants.filter(
    (v) => v.recommendedAction === "KEEP_VARIANT" && v.signalCount >= 100,
  );
  const bestVariant = keepers[0];

  const warning =
    enriched.length === 0
      ? "Could not enrich sectorLeader signals with sector metadata. Did getSectorSnapshots cover the historical date range?"
      : keepers.length === 0
      ? "No tightening variant produced a KEEP-quality edge. SectorLeader may need a structural redesign rather than a narrower threshold."
      : undefined;

  return { baseline, variants, bestVariant, warning };
}
