// Backtest diagnostics — slice a BacktestResult by various dimensions so the
// reviewer can tell whether the headline number is robust or driven by a
// narrow regime / sector / score bucket.

import type {
  BacktestResult,
  BacktestTrade,
} from "@/lib/types/backtest";

export interface BucketStats {
  key: string;
  count: number;
  /** Average net return percent. */
  avgReturn: number;
  /** Median net return percent. */
  medianReturn: number;
  winRate: number;
  totalReturnContribution: number;
}

export interface BacktestDiagnostics {
  /** Single-strategy result wrapped for completeness; aggregation across
   *  strategies should be done in a future multi-strategy backtest runner. */
  byStrategy: BucketStats[];
  byMarketRegime: BucketStats[];
  bySector: BucketStats[];
  bySignalType: BucketStats[];
  byScoreBucket: BucketStats[];
  byRiskLevel: BucketStats[];
  byHoldingPeriod: BucketStats[];
  worstTrades: BacktestTrade[];
  bestTrades: BacktestTrade[];
  commonFailureReasons: { reason: string; count: number; avgReturn: number }[];
}

function group(
  trades: BacktestTrade[],
  keyFn: (t: BacktestTrade) => string | undefined,
): BucketStats[] {
  const map = new Map<string, BacktestTrade[]>();
  for (const t of trades) {
    const k = keyFn(t);
    if (k === undefined) continue;
    (map.get(k) ?? map.set(k, []).get(k)!).push(t);
  }
  const out: BucketStats[] = [];
  for (const [k, list] of map.entries()) {
    const returns = list.map((t) => t.returnPct);
    const avg = returns.reduce((s, r) => s + r, 0) / returns.length;
    const sorted = [...returns].sort((a, b) => a - b);
    const median =
      sorted.length % 2 === 0
        ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
        : sorted[Math.floor(sorted.length / 2)];
    const wins = list.filter((t) => t.returnPct > 0).length;
    out.push({
      key: k,
      count: list.length,
      avgReturn: +avg.toFixed(2),
      medianReturn: +median.toFixed(2),
      winRate: +(wins / list.length).toFixed(3),
      // Treat each trade's pct return as additive contribution (approximation;
      // a true contribution requires weighting by capital deployed).
      totalReturnContribution: +returns.reduce((s, r) => s + r, 0).toFixed(2),
    });
  }
  out.sort((a, b) => b.totalReturnContribution - a.totalReturnContribution);
  return out;
}

function bucketScore(score: number | undefined): string {
  if (score === undefined) return "unknown";
  if (score >= 90) return "90-100";
  if (score >= 80) return "80-90";
  if (score >= 70) return "70-80";
  return "<70";
}

function bucketHoldingDays(d: number): string {
  if (d <= 1) return "1d";
  if (d <= 3) return "2-3d";
  if (d <= 5) return "4-5d";
  if (d <= 10) return "6-10d";
  return ">10d";
}

export function buildDiagnostics(
  result: BacktestResult,
  /** Optional date->market regime map; gives "byMarketRegime" buckets when
   *  the underlying backtest input had per-date sentiment. */
  regimeByDate?: Record<string, string>,
): BacktestDiagnostics {
  const trades = result.trades;

  const byStrategy = group(trades, (t) => t.strategyId);
  const bySector = group(trades, (t) => t.sector ?? "unknown");
  const bySignalType = group(trades, (t) => t.signalType ?? "unknown");
  const byScoreBucket = group(trades, (t) => bucketScore(t.signalScore));
  const byRiskLevel = group(trades, (t) => t.riskLevel ?? "unknown");
  const byHoldingPeriod = group(trades, (t) => bucketHoldingDays(t.holdingDays));
  const byMarketRegime = regimeByDate
    ? group(trades, (t) => regimeByDate[t.entryDate] ?? "unknown")
    : group(trades, () => "unknown");

  const sortedByReturn = [...trades].sort((a, b) => a.returnPct - b.returnPct);
  const worstTrades = sortedByReturn.slice(0, 10);
  const bestTrades = sortedByReturn.slice(-10).reverse();

  const reasonMap = new Map<string, number[]>();
  for (const t of trades) {
    if (t.returnPct >= 0) continue;
    (reasonMap.get(t.exitReason) ?? reasonMap.set(t.exitReason, []).get(t.exitReason)!).push(
      t.returnPct,
    );
  }
  const commonFailureReasons = Array.from(reasonMap.entries())
    .map(([reason, returns]) => ({
      reason,
      count: returns.length,
      avgReturn: +(returns.reduce((s, r) => s + r, 0) / returns.length).toFixed(2),
    }))
    .sort((a, b) => b.count - a.count);

  return {
    byStrategy,
    byMarketRegime,
    bySector,
    bySignalType,
    byScoreBucket,
    byRiskLevel,
    byHoldingPeriod,
    worstTrades,
    bestTrades,
    commonFailureReasons,
  };
}
