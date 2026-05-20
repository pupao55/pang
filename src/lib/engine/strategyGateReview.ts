// First-breakout gate review (v1.9).
//
// firstBreakout fires very few signals on the live cache. This module re-runs
// the strategy's gates one at a time, counts how many (stock, date) candidates
// fall out at each gate, and reports the weakest link. The strategy itself is
// not modified — the diagnostic produces a recommendation only.

import {
  FIRST_BREAKOUT_MAX_60D_RISE_PCT,
  STRATEGY_LOOKBACKS,
} from "@/lib/config/constants";
import type { SectorSnapshot } from "@/lib/types/market";
import type { StockDailyBar, StockMeta } from "@/lib/types/stock";

export type GateKey =
  | "minHistory"
  | "sixtyDayRiseCap"
  | "platformBreakout"
  | "volumeExpansion"
  | "turnoverExpansion"
  | "sectorStrength"
  | "totalCandidates";

export interface GateCounts {
  /** How many (stock, date) candidates entered each gate. */
  entered: Record<GateKey, number>;
  /** How many were rejected at that gate. */
  rejected: Record<GateKey, number>;
  /** Final cohort that survived every gate. */
  passed: number;
}

export interface FirstBreakoutGateReview {
  counts: GateCounts;
  rejectionRate: Record<GateKey, number>;
  weakestGate: GateKey;
  likelyTooStrict: boolean;
  suggestedRelaxation: string;
}

export interface FirstBreakoutGateInput {
  metas: StockMeta[];
  barsBySymbol: Record<string, StockDailyBar[]>;
  sectorSnapshotsByDate: Map<string, SectorSnapshot[]>;
  /**
   * Limit how many dates to evaluate (most recent N). Bounds the cost on
   * large caches. Default: 250 (≈ one year of trading days).
   */
  maxDates?: number;
}

function resolveSector(
  meta: StockMeta,
  sectors: SectorSnapshot[],
): SectorSnapshot | undefined {
  const byIndustry = sectors.find((s) => s.sectorName === meta.industry);
  if (byIndustry) return byIndustry;
  for (const concept of meta.concepts ?? []) {
    const m = sectors.find((s) => s.sectorName === concept);
    if (m) return m;
  }
  return undefined;
}

export function reviewFirstBreakoutGates(
  input: FirstBreakoutGateInput,
): FirstBreakoutGateReview {
  const counts: GateCounts = {
    entered: {
      minHistory: 0,
      sixtyDayRiseCap: 0,
      platformBreakout: 0,
      volumeExpansion: 0,
      turnoverExpansion: 0,
      sectorStrength: 0,
      totalCandidates: 0,
    },
    rejected: {
      minHistory: 0,
      sixtyDayRiseCap: 0,
      platformBreakout: 0,
      volumeExpansion: 0,
      turnoverExpansion: 0,
      sectorStrength: 0,
      totalCandidates: 0,
    },
    passed: 0,
  };

  // Build trading date set from the universe.
  const dateSet = new Set<string>();
  for (const m of input.metas)
    for (const b of input.barsBySymbol[m.symbol] ?? []) dateSet.add(b.date);
  const sortedDates = [...dateSet].sort();
  const maxDates = input.maxDates ?? 250;
  const evalDates = sortedDates.slice(-maxDates);
  const evalSet = new Set(evalDates);

  for (const meta of input.metas) {
    const allBars = input.barsBySymbol[meta.symbol] ?? [];
    if (allBars.length === 0) continue;
    // For each eval date we use bars up to and including that date.
    for (let i = 0; i < allBars.length; i++) {
      const date = allBars[i].date;
      if (!evalSet.has(date)) continue;
      const bars = allBars.slice(0, i + 1);
      counts.entered.totalCandidates++;

      counts.entered.minHistory++;
      if (bars.length < STRATEGY_LOOKBACKS.trend + 1) {
        counts.rejected.minHistory++;
        continue;
      }

      const last = bars[bars.length - 1];

      counts.entered.sixtyDayRiseCap++;
      const window60 = bars.slice(-60);
      const startPrice = window60[0].close;
      const sixtyDayChange = (last.close - startPrice) / startPrice;
      if (sixtyDayChange * 100 > FIRST_BREAKOUT_MAX_60D_RISE_PCT) {
        counts.rejected.sixtyDayRiseCap++;
        continue;
      }

      counts.entered.platformBreakout++;
      const highWindow = bars.slice(
        -STRATEGY_LOOKBACKS.breakoutHigh - 1,
        -1,
      );
      if (highWindow.length === 0) {
        counts.rejected.platformBreakout++;
        continue;
      }
      const platformHigh = Math.max(...highWindow.map((b) => b.high));
      if (last.close <= platformHigh) {
        counts.rejected.platformBreakout++;
        continue;
      }

      const ref = bars.slice(-11, -1);
      if (ref.length === 0) {
        counts.entered.volumeExpansion++;
        counts.rejected.volumeExpansion++;
        continue;
      }
      const avgAmount = ref.reduce((s, b) => s + b.amount, 0) / ref.length;
      const avgTurnover =
        ref.reduce((s, b) => s + b.turnoverRate, 0) / ref.length;

      counts.entered.volumeExpansion++;
      const amountExpand = last.amount > avgAmount * 1.5;
      if (!amountExpand) {
        counts.rejected.volumeExpansion++;
        continue;
      }

      counts.entered.turnoverExpansion++;
      const turnoverExpand = last.turnoverRate > avgTurnover * 1.5;
      if (!turnoverExpand) {
        counts.rejected.turnoverExpansion++;
        continue;
      }

      counts.entered.sectorStrength++;
      const sectors = input.sectorSnapshotsByDate.get(date) ?? [];
      const sec = resolveSector(meta, sectors);
      const sectorOk =
        !sec || sec.momentumScore >= 50 || sec.strengthRank <= 8;
      if (!sectorOk) {
        counts.rejected.sectorStrength++;
        continue;
      }
      counts.passed++;
    }
  }

  const rejectionRate: Record<GateKey, number> = {
    minHistory: 0,
    sixtyDayRiseCap: 0,
    platformBreakout: 0,
    volumeExpansion: 0,
    turnoverExpansion: 0,
    sectorStrength: 0,
    totalCandidates: 0,
  };
  for (const k of Object.keys(rejectionRate) as GateKey[]) {
    const entered = counts.entered[k];
    rejectionRate[k] = entered > 0 ? counts.rejected[k] / entered : 0;
  }

  const gateKeys: GateKey[] = [
    "sixtyDayRiseCap",
    "platformBreakout",
    "volumeExpansion",
    "turnoverExpansion",
    "sectorStrength",
  ];
  const weakestGate = gateKeys.reduce(
    (best, k) => (rejectionRate[k] > rejectionRate[best] ? k : best),
    gateKeys[0],
  );

  const totalEnteredAfterHistory = counts.entered.sixtyDayRiseCap;
  // Strict if < 1% of candidates with sufficient history make it through.
  const passRate =
    totalEnteredAfterHistory > 0 ? counts.passed / totalEnteredAfterHistory : 0;
  const likelyTooStrict = passRate < 0.01;

  let suggestedRelaxation = "";
  switch (weakestGate) {
    case "platformBreakout":
      suggestedRelaxation =
        "Most candidates fail because today's close did not exceed the 40-day platform high. Consider: (a) widen the lookback to 30 days, or (b) accept a 'near breakout' (last.close >= platformHigh * 0.99).";
      break;
    case "volumeExpansion":
      suggestedRelaxation =
        "Volume expansion gate (>1.5× 10-day avg amount) blocks most candidates. Lower to 1.3× or evaluate amount + turnover OR (rather than AND).";
      break;
    case "turnoverExpansion":
      suggestedRelaxation =
        "Turnover expansion gate (>1.5× 10-day avg) blocks most candidates. Same relaxation options as volumeExpansion.";
      break;
    case "sixtyDayRiseCap":
      suggestedRelaxation =
        "60-day rise cap removes high-momentum names. Raise FIRST_BREAKOUT_MAX_60D_RISE_PCT from 60 to 80, or compute relative to sector momentum.";
      break;
    case "sectorStrength":
      suggestedRelaxation =
        "Sector strength gate rejects most candidates. Either lower the bar (momentumScore >= 45) or skip the gate when sectorMode === GENERATED.";
      break;
    default:
      suggestedRelaxation =
        "Multiple gates contribute roughly evenly to rejection; consider redesigning rather than relaxing one.";
  }

  return {
    counts,
    rejectionRate,
    weakestGate,
    likelyTooStrict,
    suggestedRelaxation,
  };
}
