// Cache maturity diagnostic.
//
// Answers the v1.6.1 question: "is this dataset mature enough for the
// calibration results to mean anything?" Combines hard signals (universe
// size, bar coverage, score-bucket population, risk diversity) into a
// readinessLevel and a concrete next-action checklist.
//
// Pure function — caller passes in already-loaded artifacts; the CLI
// wrapper handles filesystem IO.

import type { StockDailyBar, StockMeta } from "@/lib/types/stock";
import type { ContextSourceMode } from "@/lib/data/adapters/akshareLocalAdapter";
import type {
  AkshareFetchStatus,
  AkshareImportReport,
} from "@/lib/data/adapters";
import type { HistoricalSignalRecord } from "@/lib/engine/scoreCalibration";

export type ReadinessLevel =
  | "NOT_READY"
  | "SMOKE_TEST_ONLY"
  | "EARLY_RESEARCH"
  | "RESEARCH_READY";

export interface CacheMaturityInput {
  metas: StockMeta[];
  barsBySymbol: Record<string, StockDailyBar[]>;
  signals: HistoricalSignalRecord[];
  /** From fetch-status.json. */
  fetchStatus?: AkshareFetchStatus | null;
  /** From import-report.json. */
  importReport?: AkshareImportReport | null;
  /** Source modes echoed from the adapter. */
  metadataMode?: ContextSourceMode;
  sectorMode?: ContextSourceMode;
  sentimentMode?: ContextSourceMode;
  /** Optional: how many trading days are covered by the calendar; used to
   *  compute latest-date coverage. If absent, derives from union of bars. */
  tradingCalendarDates?: string[];
  /** Source id used to pick the right next-action commands. */
  source?: "mock" | "akshareLocal" | "baostockLocal";
}

export interface CacheMaturityReport {
  symbolCount: number;
  tradingDayCount: number;
  totalBars: number;
  averageBarsPerSymbol: number;
  minBarsPerSymbol: number;
  maxBarsPerSymbol: number;
  /** Fraction of symbols whose lastDate equals the calendar's last date. */
  latestDateCoverageRatio: number;
  symbolsWithLatestDate: number;
  symbolsWithShortHistory: string[];
  /** REAL → 1.0, FALLBACK/MISSING → 0; GENERATED maps to 0.5. */
  sectorCoverageRatio: number;
  sentimentCoverageRatio: number;
  signalsByStrategy: Record<string, number>;
  strategiesWithEnoughSamples: string[];
  strategiesNeedingMoreData: string[];
  scoreBucketCoverage: Record<string, number>;
  /** True when no signals fall above the 70-80 bucket (compression in 60-80). */
  hasScoreCompression: boolean;
  riskLevelCoverage: Record<string, number>;
  /** True when at least one MEDIUM/HIGH/FORBIDDEN sample exists in addition to LOW. */
  hasRiskDiversity: boolean;
  readinessLevel: ReadinessLevel;
  readinessReasons: string[];
  nextActions: string[];
  /** Echoed back for downstream renderers. */
  fetchStatusSummary?: {
    succeeded: number;
    failed: number;
    empty: number;
    skipped: number;
    updatedAt: string;
  };
}

export const SHORT_HISTORY_THRESHOLD = 60;
export const STRATEGY_SAMPLE_FLOOR = 100;
const SCORE_BUCKETS = ["90-100", "80-90", "70-80", "60-70", "<60"] as const;
const RISK_LEVELS = ["LOW", "MEDIUM", "HIGH", "FORBIDDEN"] as const;

function bucketFor(score: number): typeof SCORE_BUCKETS[number] {
  if (score >= 90) return "90-100";
  if (score >= 80) return "80-90";
  if (score >= 70) return "70-80";
  if (score >= 60) return "60-70";
  return "<60";
}

function tradingCalendarUnion(
  bars: Record<string, StockDailyBar[]>,
): string[] {
  const all = new Set<string>();
  for (const sym of Object.keys(bars)) for (const b of bars[sym]) all.add(b.date);
  return Array.from(all).sort();
}

function modeToCoverage(mode: ContextSourceMode | undefined): number {
  switch (mode) {
    case "REAL":
      return 1;
    case "GENERATED":
      return 0.5;
    case "FALLBACK":
      return 0.2;
    default:
      return 0;
  }
}

export function buildCacheMaturityReport(
  input: CacheMaturityInput,
): CacheMaturityReport {
  const symbols = input.metas.map((m) => m.symbol);
  const symbolCount = symbols.length;

  let totalBars = 0;
  let minBars = Infinity;
  let maxBars = 0;
  const lastDateBySymbol = new Map<string, string>();
  for (const sym of symbols) {
    const bars = input.barsBySymbol[sym] ?? [];
    totalBars += bars.length;
    if (bars.length < minBars) minBars = bars.length;
    if (bars.length > maxBars) maxBars = bars.length;
    if (bars.length > 0) lastDateBySymbol.set(sym, bars[bars.length - 1].date);
  }
  if (!Number.isFinite(minBars)) minBars = 0;
  const avgBars = symbolCount > 0 ? totalBars / symbolCount : 0;

  const calendar =
    input.tradingCalendarDates && input.tradingCalendarDates.length > 0
      ? [...input.tradingCalendarDates].sort()
      : tradingCalendarUnion(input.barsBySymbol);
  const tradingDayCount = calendar.length;
  const latestDate = calendar[calendar.length - 1];

  let symbolsWithLatestDate = 0;
  if (latestDate) {
    for (const sym of symbols) {
      const lastDate = lastDateBySymbol.get(sym);
      if (lastDate && lastDate >= latestDate) symbolsWithLatestDate += 1;
    }
  }
  const latestDateCoverageRatio =
    symbolCount > 0 ? +(symbolsWithLatestDate / symbolCount).toFixed(3) : 0;

  const symbolsWithShortHistory: string[] = [];
  for (const sym of symbols) {
    const n = (input.barsBySymbol[sym] ?? []).length;
    if (n < SHORT_HISTORY_THRESHOLD) symbolsWithShortHistory.push(sym);
  }

  const sectorCoverageRatio = +modeToCoverage(input.sectorMode).toFixed(2);
  const sentimentCoverageRatio = +modeToCoverage(input.sentimentMode).toFixed(2);

  const signalsByStrategy: Record<string, number> = {};
  const scoreBucketCoverage: Record<string, number> = Object.fromEntries(
    SCORE_BUCKETS.map((b) => [b, 0]),
  );
  const riskLevelCoverage: Record<string, number> = Object.fromEntries(
    RISK_LEVELS.map((r) => [r, 0]),
  );

  for (const s of input.signals) {
    signalsByStrategy[s.strategyId] = (signalsByStrategy[s.strategyId] ?? 0) + 1;
    scoreBucketCoverage[bucketFor(s.score)] += 1;
    riskLevelCoverage[s.riskLevel] = (riskLevelCoverage[s.riskLevel] ?? 0) + 1;
  }

  const strategiesWithEnoughSamples: string[] = [];
  const strategiesNeedingMoreData: string[] = [];
  for (const [sid, n] of Object.entries(signalsByStrategy)) {
    if (n >= STRATEGY_SAMPLE_FLOOR) strategiesWithEnoughSamples.push(sid);
    else strategiesNeedingMoreData.push(sid);
  }

  const hasScoreCompression =
    scoreBucketCoverage["90-100"] === 0 && scoreBucketCoverage["80-90"] === 0;
  const hasRiskDiversity =
    (riskLevelCoverage["LOW"] ?? 0) > 0 &&
    (riskLevelCoverage["MEDIUM"] ?? 0) +
      (riskLevelCoverage["HIGH"] ?? 0) +
      (riskLevelCoverage["FORBIDDEN"] ?? 0) >
      0;

  // ---- readiness logic ----
  const reasons: string[] = [];
  let level: ReadinessLevel;

  if (symbolCount < 5 || totalBars < 1000) {
    level = "NOT_READY";
    if (symbolCount < 5) reasons.push(`Only ${symbolCount} symbols (< 5).`);
    if (totalBars < 1000) reasons.push(`Only ${totalBars} bars total (< 1000).`);
  } else if (symbolCount < 30) {
    level = "SMOKE_TEST_ONLY";
    reasons.push(`Symbol count ${symbolCount} ∈ [5, 30) — pipeline works but not enough breadth for evidence.`);
  } else {
    const enoughStrategies = strategiesWithEnoughSamples.length;
    const bucketsBelow80Empty =
      scoreBucketCoverage["80-90"] === 0 && scoreBucketCoverage["90-100"] === 0;

    if (
      symbolCount >= 100 &&
      avgBars >= 250 &&
      enoughStrategies >= 3 &&
      scoreBucketCoverage["60-70"] > 0 &&
      scoreBucketCoverage["70-80"] > 0 &&
      scoreBucketCoverage["80-90"] > 0 &&
      hasRiskDiversity &&
      sectorCoverageRatio >= 0.5 &&
      sentimentCoverageRatio >= 0.8
    ) {
      level = "RESEARCH_READY";
      reasons.push(
        `${symbolCount} symbols × avg ${avgBars.toFixed(0)} bars; ${enoughStrategies} strategies ≥ 100; ` +
          `score buckets populated 60-90+; risk diversity; sector ${sectorCoverageRatio}; sentiment ${sentimentCoverageRatio}.`,
      );
    } else if (
      symbolCount >= 30 &&
      avgBars >= 200 &&
      enoughStrategies >= 1
    ) {
      level = "EARLY_RESEARCH";
      reasons.push(
        `${symbolCount} symbols × avg ${avgBars.toFixed(0)} bars; ${enoughStrategies} strategy(ies) ≥ 100 signals.`,
      );
      if (symbolCount < 100) reasons.push(`Symbol count ${symbolCount} < 100 (RESEARCH_READY floor).`);
      if (bucketsBelow80Empty) reasons.push("80-100 score buckets are empty — sector/sentiment likely compressing scores.");
      if (!hasRiskDiversity) reasons.push("Risk levels not diverse — risk filter cannot be evaluated.");
      if (sectorCoverageRatio < 0.5) reasons.push(`Sector coverage ${sectorCoverageRatio} < 0.5.`);
      if (sentimentCoverageRatio < 0.8) reasons.push(`Sentiment coverage ${sentimentCoverageRatio} < 0.8.`);
    } else {
      // Has the size but fails other gates.
      level = "SMOKE_TEST_ONLY";
      if (avgBars < 200) reasons.push(`Average bars per symbol ${avgBars.toFixed(0)} < 200.`);
      if (enoughStrategies < 1)
        reasons.push("No strategy has ≥ 100 signals yet.");
    }
  }

  // ---- next actions ----
  const next: string[] = [];
  const isBao = input.source === "baostockLocal";
  const resumeCmd = isBao ? "npm run fetch:baostock:resume" : "npm run fetch:akshare:resume";
  const failedCmd = isBao ? "npm run fetch:baostock:failed" : "npm run fetch:akshare:failed";
  const sourceForSignals = input.source ?? "akshareLocal";

  if (symbolCount < 30) {
    next.push(
      `Grow the universe: \`${resumeCmd}\` (slow / polite); aim for ≥ 30 symbols for early research.`,
    );
  } else if (symbolCount < 100) {
    next.push(
      `Push universe past 100 symbols: rerun \`${resumeCmd}\` until cache is healthy.`,
    );
  }
  if (input.fetchStatus && input.fetchStatus.failed > 0) {
    next.push(
      `${input.fetchStatus.failed} symbols are in FAILED state — retry with \`${failedCmd}\`.`,
    );
  }
  if (
    input.fetchStatus &&
    latestDate &&
    typeof input.fetchStatus.updatedAt === "string" &&
    input.fetchStatus.updatedAt < latestDate
  ) {
    next.push(
      `fetch-status is older than the latest cached bar; refresh with \`${resumeCmd}\`.`,
    );
  }
  if (avgBars < 200 && symbolCount > 0) {
    next.push(
      `Average history is ${avgBars.toFixed(0)} bars (< 200). Extend the fetch window or refetch short-history symbols.`,
    );
  }
  if (symbolsWithShortHistory.length > 0) {
    next.push(
      `${symbolsWithShortHistory.length} symbols have < ${SHORT_HISTORY_THRESHOLD} bars (e.g. ${symbolsWithShortHistory.slice(0, 3).join(", ")}). Consider excluding or extending date range.`,
    );
  }
  // Only recommend fetching when the underlying source is missing/mock —
  // GENERATED sentiment is OK; coverage ratio is informational.
  if (input.sectorMode === "MISSING" || input.sectorMode === "FALLBACK") {
    next.push(
      "Add real sector context: `npm run fetch:metadata:full && npm run fetch:sectors`.",
    );
  }
  if (input.sentimentMode === "MISSING" || input.sentimentMode === "FALLBACK") {
    next.push(
      "Generate sentiment from cached bars: `npm run build:sentiment`.",
    );
  } else if (
    input.sentimentMode === "GENERATED" &&
    symbolCount > 0 &&
    symbolCount < 30
  ) {
    next.push(
      "Sentiment is GENERATED but the universe is small; accuracy will improve once symbolCount ≥ 30.",
    );
  }
  if (input.signals.length === 0) {
    next.push(
      `No historical signals yet: \`npm run rebuild:signals -- --source ${sourceForSignals} --rebuild\`.`,
    );
  } else if (level === "EARLY_RESEARCH" || level === "RESEARCH_READY") {
    next.push("Run `npm run calibrate:strategies` to refresh the calibration report.");
  }

  return {
    symbolCount,
    tradingDayCount,
    totalBars,
    averageBarsPerSymbol: +avgBars.toFixed(2),
    minBarsPerSymbol: minBars,
    maxBarsPerSymbol: maxBars,
    latestDateCoverageRatio,
    symbolsWithLatestDate,
    symbolsWithShortHistory,
    sectorCoverageRatio,
    sentimentCoverageRatio,
    signalsByStrategy,
    strategiesWithEnoughSamples,
    strategiesNeedingMoreData,
    scoreBucketCoverage,
    hasScoreCompression,
    riskLevelCoverage,
    hasRiskDiversity,
    readinessLevel: level,
    readinessReasons: reasons,
    nextActions: next,
    fetchStatusSummary: input.fetchStatus
      ? {
          succeeded: input.fetchStatus.succeeded,
          failed: input.fetchStatus.failed,
          empty: input.fetchStatus.empty,
          skipped: input.fetchStatus.skipped,
          updatedAt: input.fetchStatus.updatedAt,
        }
      : undefined,
  };
}
