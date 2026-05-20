import { ACTION_THRESHOLDS, SCORE_WEIGHTS } from "@/lib/config/constants";
import type { MarketSentimentSnapshot, SectorSnapshot } from "@/lib/types/market";
import type { StockDailyBar, StockMeta } from "@/lib/types/stock";
import type { StrategyCandidate } from "@/lib/strategies/types";
import type { SuggestedAction } from "@/lib/types/signal";

export interface ScoreComponents {
  technicalScore: number;
  sectorScore: number;
  sentimentScore: number;
  liquidityScore: number;
  fundamentalSafetyScore: number;
}

export type SectorScoreMode = "REAL" | "GENERATED" | "FALLBACK" | "MISSING";

export interface ScoreInput {
  candidate: StrategyCandidate;
  meta: StockMeta;
  bars: StockDailyBar[];
  sector?: SectorSnapshot;
  sentiment?: MarketSentimentSnapshot;
  /** Risk penalty already computed by riskFilter. */
  riskPenalty: number;
  /**
   * Origin of the sector snapshot. v1.6 — when MISSING we keep sectorScore at
   * neutral 50, do NOT punish the stock for absent sector data, and emit an
   * explanation. FALLBACK behaves the same but signals "mock fallback in use".
   */
  sectorScoreMode?: SectorScoreMode;
}

export interface ScoreOutput extends ScoreComponents {
  score: number;
  positives: string[];
  negatives: string[];
  riskExplanations: string[];
  suggestedAction: SuggestedAction;
  /** Echoed from input so reports/UI can call out compressed scores. */
  sectorScoreMode: SectorScoreMode;
  /** Set when sectorScoreMode is MISSING or FALLBACK. */
  sectorScoreCaveat?: string;
}

const clamp = (v: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));

// AUDIT D-1: typed buckets instead of regex over strings.
interface SubScore {
  value: number;
  positives: string[];
  negatives: string[];
  /** Notes that belong specifically to the "risk explanations" pile. */
  riskNotes: string[];
}

function scoreSector(
  sector: SectorSnapshot | undefined,
  symbol: string | undefined,
  mode: SectorScoreMode,
): SubScore & { caveat?: string } {
  const out: SubScore & { caveat?: string } = {
    value: 50,
    positives: [],
    negatives: [],
    riskNotes: [],
  };

  // v1.6: when the sector dimension is unavailable, do not punish — return a
  // neutral 50 and surface a caveat so the UI/report can flag lower confidence.
  if (mode === "MISSING") {
    out.caveat =
      "Sector score unavailable; total score confidence is lower. Add real sector " +
      "data via `npm run fetch:sectors` to lift this caveat.";
    return out;
  }

  if (!sector) {
    out.caveat =
      mode === "FALLBACK"
        ? "Sector score using mock fallback; treat sector-dependent scores as compressed."
        : "Sector data missing for this stock; held at neutral 50.";
    return out;
  }

  out.value += Math.max(0, 12 - sector.strengthRank * 2);
  if (sector.strengthRank <= 5) out.positives.push(`Sector rank #${sector.strengthRank}`);
  else out.negatives.push(`Sector rank #${sector.strengthRank}`);

  out.value += (sector.momentumScore - 50) * 0.4;
  if (sector.momentumScore >= 70) out.positives.push(`Sector momentum ${sector.momentumScore}`);
  else if (sector.momentumScore < 40) out.negatives.push(`Sector momentum ${sector.momentumScore}`);

  if (symbol && sector.topStocks.includes(symbol)) {
    out.value += 12;
    out.positives.push("Listed as sector top stock");
  }
  out.value = clamp(out.value);
  if (mode === "FALLBACK") {
    out.caveat = "Sector score from mock fallback — interpret with caution.";
  }
  return out;
}

function scoreSentiment(s: MarketSentimentSnapshot | undefined): SubScore {
  const out: SubScore = { value: 50, positives: [], negatives: [], riskNotes: [] };
  if (!s) return out;
  switch (s.marketRegime) {
    case "STRONG":
      out.value += 25;
      out.positives.push("Market regime STRONG (赚钱效应)");
      break;
    case "NEUTRAL":
      break;
    case "WEAK":
      out.value -= 15;
      out.negatives.push("Market regime WEAK (退潮期)");
      break;
    case "PANIC":
      out.value -= 30;
      out.negatives.push("Market regime PANIC (情绪冰点)");
      break;
  }
  if (s.yesterdayLimitUpPerformance > 2) {
    out.value += 8;
    out.positives.push("Yesterday limit-up cohort followed through");
  }
  if (s.failedLimitUpRate > 0.4) {
    out.value -= 10;
    out.negatives.push(`Elevated failed-limit-up rate ${(s.failedLimitUpRate * 100).toFixed(1)}%`);
  }
  out.value = clamp(out.value);
  return out;
}

function scoreLiquidity(bars: StockDailyBar[]): SubScore {
  const out: SubScore = { value: 50, positives: [], negatives: [], riskNotes: [] };
  if (bars.length < 5) return out;
  const ref = bars.slice(-10);
  const avgAmount = ref.reduce((s, b) => s + b.amount, 0) / ref.length;
  const avgTurnover = ref.reduce((s, b) => s + b.turnoverRate, 0) / ref.length;

  if (avgAmount > 500_000_000) {
    out.value += 25;
    out.positives.push("Strong amount (>5e8)");
  } else if (avgAmount > 200_000_000) {
    out.value += 15;
    out.positives.push("Healthy amount (>2e8)");
  } else if (avgAmount < 80_000_000) {
    out.value -= 15;
    out.negatives.push("Thin liquidity (<8e7)");
  }
  if (avgTurnover >= 3 && avgTurnover <= 15) {
    out.value += 8;
    out.positives.push(`Healthy turnover ${avgTurnover.toFixed(2)}%`);
  } else if (avgTurnover > 20) {
    out.value -= 5;
    out.negatives.push(`Hot turnover ${avgTurnover.toFixed(2)}%`);
  }
  out.value = clamp(out.value);
  return out;
}

function scoreFundamentalSafety(meta: StockMeta): SubScore {
  const out: SubScore = { value: 70, positives: [], negatives: [], riskNotes: [] };
  if (meta.isST) {
    out.value = 0;
    out.negatives.push("ST — fundamentals unsafe");
    out.riskNotes.push("ST — fundamentals unsafe");
  }
  if (meta.hasDelistingRisk) {
    out.value = 0;
    out.negatives.push("Delisting risk");
    out.riskNotes.push("Delisting risk");
  }
  if (meta.hasRegulatoryWarning) {
    out.value -= 25;
    out.negatives.push("Recent regulatory warning");
    out.riskNotes.push("Recent regulatory warning");
  }
  if (meta.hasRecentReduction) {
    out.value -= 10;
    out.riskNotes.push("Recent shareholder reduction");
  }
  if (meta.hasRecentUnlock) {
    out.value -= 8;
    out.riskNotes.push("Recent unlock pressure");
  }
  // AUDIT D-4: kept as a small bonus for now; flagged for calibration.
  if (meta.marketCap > 50_000_000_000) {
    out.value += 5;
    out.positives.push("Large cap");
  }
  out.value = clamp(out.value);
  return out;
}

export function scoreCandidate(input: ScoreInput): ScoreOutput {
  const { candidate, meta, bars, sector, sentiment, riskPenalty } = input;
  const sectorScoreMode: SectorScoreMode = input.sectorScoreMode ?? (sector ? "REAL" : "MISSING");

  const technicalScore = clamp(candidate.technicalScore);
  const sectorR = scoreSector(sector, meta.symbol, sectorScoreMode);
  const sentimentR = scoreSentiment(sentiment);
  const liquidityR = scoreLiquidity(bars);
  const fundR = scoreFundamentalSafety(meta);

  const weighted =
    technicalScore * SCORE_WEIGHTS.technical +
    sectorR.value * SCORE_WEIGHTS.sector +
    sentimentR.value * SCORE_WEIGHTS.sentiment +
    liquidityR.value * SCORE_WEIGHTS.liquidity +
    fundR.value * SCORE_WEIGHTS.fundamentalSafety;

  const finalScore = clamp(weighted - riskPenalty);

  const positives = [
    ...candidate.bullishFactors,
    ...sectorR.positives,
    ...sentimentR.positives,
    ...liquidityR.positives,
    ...fundR.positives,
  ];
  const negatives = [
    ...candidate.bearishFactors,
    ...sectorR.negatives,
    ...sentimentR.negatives,
    ...liquidityR.negatives,
    ...fundR.negatives,
  ];

  let suggestedAction: SuggestedAction;
  if (riskPenalty >= 40 || fundR.value === 0) suggestedAction = "AVOID";
  else if (finalScore >= ACTION_THRESHOLDS.standard) suggestedAction = "STANDARD_POSITION";
  else if (finalScore >= ACTION_THRESHOLDS.light) suggestedAction = "LIGHT_POSITION";
  else if (finalScore >= ACTION_THRESHOLDS.watch) suggestedAction = "WATCH";
  else suggestedAction = "AVOID";

  return {
    technicalScore: +technicalScore.toFixed(1),
    sectorScore: +sectorR.value.toFixed(1),
    sentimentScore: +sentimentR.value.toFixed(1),
    liquidityScore: +liquidityR.value.toFixed(1),
    fundamentalSafetyScore: +fundR.value.toFixed(1),
    score: +finalScore.toFixed(1),
    positives,
    negatives,
    riskExplanations: fundR.riskNotes,
    suggestedAction,
    sectorScoreMode,
    sectorScoreCaveat: sectorR.caveat,
  };
}
