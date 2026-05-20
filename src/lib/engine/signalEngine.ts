import { STRATEGIES } from "@/lib/strategies";
import type { Strategy, StrategyContext } from "@/lib/strategies/types";
import type { MarketSentimentSnapshot, SectorSnapshot } from "@/lib/types/market";
import type { StockDailyBar, StockMeta } from "@/lib/types/stock";
import type { StockSignal } from "@/lib/types/signal";
import { evaluateRisk } from "./riskFilter";
import { scoreCandidate, type SectorScoreMode } from "./scoreEngine";

export interface SignalEngineInput {
  metas: StockMeta[];
  /** Map symbol -> chronological bars. */
  barsBySymbol: Record<string, StockDailyBar[]>;
  sectors: SectorSnapshot[];
  sentiment?: MarketSentimentSnapshot;
  /** Optional filter — only run these strategy ids. */
  strategyIds?: string[];
  /**
   * Optional point-in-time cutoff. When set, bars are truncated to
   * bars[i].date ≤ asOfDate before any indicator/strategy sees them.
   * AUDIT K-1: prevents look-ahead when called inside historical loops.
   */
  asOfDate?: string;
  /** v1.6 — passed through to score engine so reports/UI can mark caveats. */
  sectorScoreMode?: SectorScoreMode;
}

function resolveSector(
  meta: StockMeta,
  sectors: SectorSnapshot[],
): SectorSnapshot | undefined {
  const byIndustry = sectors.find((s) => s.sectorName === meta.industry);
  if (byIndustry) return byIndustry;
  for (const concept of meta.concepts) {
    const m = sectors.find((s) => s.sectorName === concept);
    if (m) return m;
  }
  return undefined;
}

function truncateBars(bars: StockDailyBar[], asOfDate?: string): StockDailyBar[] {
  if (!asOfDate) return bars;
  // bars are chronological; find last index with date <= asOfDate
  let last = -1;
  for (let i = 0; i < bars.length; i++) {
    if (bars[i].date <= asOfDate) last = i;
    else break;
  }
  return last === -1 ? [] : bars.slice(0, last + 1);
}

export function runSignalEngine(input: SignalEngineInput): StockSignal[] {
  const strategies = Object.values(STRATEGIES).filter(
    (d) => !input.strategyIds || input.strategyIds.includes(d.id),
  );

  const signals: StockSignal[] = [];

  for (const meta of input.metas) {
    const fullBars = input.barsBySymbol[meta.symbol] ?? [];
    const bars = truncateBars(fullBars, input.asOfDate);
    if (bars.length === 0) continue;
    const sector = resolveSector(meta, input.sectors);

    const risk = evaluateRisk({
      meta,
      bars,
      sector,
      sentiment: input.sentiment,
    });
    if (risk.excluded) continue;

    const ctx: StrategyContext = {
      meta,
      bars,
      sector,
      sentiment: input.sentiment,
    };

    const candidates = strategies
      .map((s) => ({ id: s.id, candidate: s.fn(ctx) }))
      .filter((x): x is { id: string; candidate: NonNullable<typeof x["candidate"]> } => x.candidate !== null);
    if (candidates.length === 0) continue;

    const scored = candidates.map(({ candidate }) => {
      const sc = scoreCandidate({
        candidate,
        meta,
        bars,
        sector,
        sentiment: input.sentiment,
        riskPenalty: risk.riskPenalty,
        sectorScoreMode: input.sectorScoreMode,
      });
      const last = bars[bars.length - 1];
      const signal: StockSignal = {
        symbol: meta.symbol,
        name: meta.name,
        date: last.date,
        strategyId: candidate.strategyId,
        strategyName: candidate.strategyName,
        score: sc.score,
        technicalScore: sc.technicalScore,
        sectorScore: sc.sectorScore,
        sentimentScore: sc.sentimentScore,
        liquidityScore: sc.liquidityScore,
        fundamentalSafetyScore: sc.fundamentalSafetyScore,
        riskPenalty: risk.riskPenalty,
        riskLevel: risk.riskLevel,
        signalType: candidate.signalType,
        suggestedAction: sc.suggestedAction,
        keySupport: candidate.keySupport,
        keyResistance: candidate.keyResistance,
        stopLoss: candidate.stopLoss,
        target1: candidate.target1,
        target2: candidate.target2,
        explanation: candidate.explanation,
        bullishFactors: [...candidate.bullishFactors, ...sc.positives].slice(0, 12),
        bearishFactors: [...candidate.bearishFactors, ...sc.negatives].slice(0, 12),
        risks: risk.reasons,
      };
      return signal;
    });

    // AUDIT F-1: keep the highest-scoring signal but record other strategy ids
    // that also fired as `corroboratingStrategies`.
    scored.sort((a, b) => b.score - a.score);
    const top = scored[0];
    const others = scored.slice(1).map((s) => s.strategyId);
    if (others.length > 0) top.corroboratingStrategies = others;
    signals.push(top);
  }

  signals.sort((a, b) => b.score - a.score);
  return signals;
}
