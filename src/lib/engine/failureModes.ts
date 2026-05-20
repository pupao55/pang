// Failure-mode breakdowns for losing signals.
//
// A signal is "losing" when its 5-day forward return is negative. For each
// of several grouping dimensions (strategy / risk level / signalType / score
// bucket / boardType / month), produce: count, average loss, worst loss, and
// the top-N most common risk reasons taken from `signal.risks`.

import { inferBoardType } from "@/lib/data/adapters/akshareLocalAdapter";
import type {
  ForwardReturnResolver,
  HistoricalSignalRecord,
} from "./scoreCalibration";

export interface FailureModeGroup {
  key: string;
  count: number;
  avgLossPct: number;
  worstLossPct: number;
  topReasons: { reason: string; count: number }[];
}

export interface FailureModeBreakdowns {
  byStrategy: FailureModeGroup[];
  byRiskLevel: FailureModeGroup[];
  bySignalType: FailureModeGroup[];
  byScoreBucket: FailureModeGroup[];
  byBoardType: FailureModeGroup[];
  byMonth: FailureModeGroup[];
}

function scoreBucket(score: number): string {
  if (score >= 90) return "90-100";
  if (score >= 80) return "80-90";
  if (score >= 70) return "70-80";
  if (score >= 60) return "60-70";
  return "<60";
}

function topReasons(
  signals: HistoricalSignalRecord[],
  n = 3,
): { reason: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const s of signals) {
    for (const r of s.risks ?? []) {
      counts.set(r, (counts.get(r) ?? 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, n);
}

function summarize(group: Map<string, HistoricalSignalRecord[]>, returns: Map<string, number[]>): FailureModeGroup[] {
  const out: FailureModeGroup[] = [];
  for (const [key, list] of group) {
    const rs = returns.get(key) ?? [];
    const avg = rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : NaN;
    const worst = rs.length ? Math.min(...rs) : NaN;
    out.push({
      key,
      count: list.length,
      avgLossPct: rs.length ? +avg.toFixed(2) : NaN,
      worstLossPct: rs.length ? +worst.toFixed(2) : NaN,
      topReasons: topReasons(list),
    });
  }
  // Most-frequent losers first; most-painful loss is in the worst column.
  out.sort((a, b) => b.count - a.count);
  return out;
}

export function buildFailureModes(
  signals: HistoricalSignalRecord[],
  resolver: ForwardReturnResolver,
): FailureModeBreakdowns {
  // Filter to losing-on-5d signals first.
  const losers: { rec: HistoricalSignalRecord; r5: number }[] = [];
  for (const s of signals) {
    const r5 = resolver.resolve(s.symbol, s.date, 5);
    if (!Number.isNaN(r5) && r5 < 0) losers.push({ rec: s, r5 });
  }
  const groupBy = (
    keyFn: (s: HistoricalSignalRecord) => string,
  ): FailureModeGroup[] => {
    const grp = new Map<string, HistoricalSignalRecord[]>();
    const ret = new Map<string, number[]>();
    for (const { rec, r5 } of losers) {
      const k = keyFn(rec);
      (grp.get(k) ?? grp.set(k, []).get(k)!).push(rec);
      (ret.get(k) ?? ret.set(k, []).get(k)!).push(r5);
    }
    return summarize(grp, ret);
  };

  const safeBoard = (sym: string): string => {
    try {
      return inferBoardType(sym).board;
    } catch {
      return "UNKNOWN";
    }
  };

  return {
    byStrategy: groupBy((s) => s.strategyId),
    byRiskLevel: groupBy((s) => s.riskLevel),
    bySignalType: groupBy((s) => s.signalType),
    byScoreBucket: groupBy((s) => scoreBucket(s.score)),
    byBoardType: groupBy((s) => safeBoard(s.symbol)),
    byMonth: groupBy((s) => s.date.slice(0, 7)),
  };
}
