// Markdown validation-report generator. Pure data-in, string-out.
// Consumed by scripts/validate_strategies.ts and exposed via /validation page.

import type { AkshareImportReport } from "@/lib/data/adapters";
import type { HistoricalSignalRecord } from "@/lib/engine/scoreCalibration";
import type { ScoreCalibrationResult } from "@/lib/engine/scoreCalibration";
import type { RiskFilterValidationResult } from "@/lib/engine/riskFilterValidation";
import type { StockDailyBar } from "@/lib/types/stock";

export interface DatasetSummary {
  source: string;
  symbolCount: number;
  barCount: number;
  dateRange: { start: string; end: string };
  signalCount: number;
}

export interface PerStrategyStat {
  strategyId: string;
  signalCount: number;
  avgR1: number;
  avgR3: number;
  avgR5: number;
  avgR10: number;
  winRate5d: number;
}

export interface PerMonthStat {
  month: string;
  signalCount: number;
  avgR5: number;
}

export interface PerSignalTypeStat {
  signalType: string;
  signalCount: number;
  avgR5: number;
  winRate5d: number;
}

export interface TopTradeRow {
  date: string;
  symbol: string;
  strategyId: string;
  score: number;
  r5: number;
}

export interface Recommendation {
  strategyId: string;
  verdict: "KEEP" | "MODIFY" | "DISABLE" | "NEEDS_MORE_DATA";
  reason: string;
}

export interface ReportPayload {
  dataset: DatasetSummary;
  importReport?: AkshareImportReport | null;
  importWarnings: string[];
  perStrategy: PerStrategyStat[];
  perMonth: PerMonthStat[];
  perSignalType: PerSignalTypeStat[];
  perRiskLevel: PerSignalTypeStat[]; // reuse shape: "signalType" field holds risk level
  calibration: ScoreCalibrationResult;
  riskValidation: RiskFilterValidationResult;
  best20: TopTradeRow[];
  worst20: TopTradeRow[];
  topFailureReasons: { reason: string; count: number; avgR5: number }[];
  recommendations: Recommendation[];
  generatedAt: string;
}

/* ------------------- helpers used by validate_strategies ------------------- */

export function makeBestWorst(
  signals: HistoricalSignalRecord[],
  resolveR5: (sym: string, date: string) => number,
  n = 20,
): { best: TopTradeRow[]; worst: TopTradeRow[] } {
  const rows: TopTradeRow[] = [];
  for (const s of signals) {
    const r = resolveR5(s.symbol, s.date);
    if (Number.isNaN(r)) continue;
    rows.push({
      date: s.date,
      symbol: s.symbol,
      strategyId: s.strategyId,
      score: s.score,
      r5: +r.toFixed(2),
    });
  }
  rows.sort((a, b) => a.r5 - b.r5);
  return {
    worst: rows.slice(0, n),
    best: rows.slice(-n).reverse(),
  };
}

export function summarizeByStrategy(
  signals: HistoricalSignalRecord[],
  resolver: { resolve(sym: string, date: string, n: number): number },
): PerStrategyStat[] {
  const map = new Map<string, HistoricalSignalRecord[]>();
  for (const s of signals) (map.get(s.strategyId) ?? map.set(s.strategyId, []).get(s.strategyId)!).push(s);
  const out: PerStrategyStat[] = [];
  for (const [id, list] of map) {
    const r1: number[] = [];
    const r3: number[] = [];
    const r5: number[] = [];
    const r10: number[] = [];
    let wins5 = 0;
    let r5Count = 0;
    for (const s of list) {
      const a = resolver.resolve(s.symbol, s.date, 1);
      const b = resolver.resolve(s.symbol, s.date, 3);
      const c = resolver.resolve(s.symbol, s.date, 5);
      const d = resolver.resolve(s.symbol, s.date, 10);
      if (!Number.isNaN(a)) r1.push(a);
      if (!Number.isNaN(b)) r3.push(b);
      if (!Number.isNaN(c)) {
        r5.push(c);
        r5Count += 1;
        if (c > 0) wins5 += 1;
      }
      if (!Number.isNaN(d)) r10.push(d);
    }
    const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
    out.push({
      strategyId: id,
      signalCount: list.length,
      avgR1: r1.length ? +avg(r1).toFixed(2) : NaN,
      avgR3: r3.length ? +avg(r3).toFixed(2) : NaN,
      avgR5: r5.length ? +avg(r5).toFixed(2) : NaN,
      avgR10: r10.length ? +avg(r10).toFixed(2) : NaN,
      winRate5d: r5Count ? +(wins5 / r5Count).toFixed(3) : NaN,
    });
  }
  out.sort((a, b) => (b.avgR5 || -Infinity) - (a.avgR5 || -Infinity));
  return out;
}

export function summarizeByMonth(
  signals: HistoricalSignalRecord[],
  resolver: { resolve(sym: string, date: string, n: number): number },
): PerMonthStat[] {
  const map = new Map<string, number[]>();
  const counts = new Map<string, number>();
  for (const s of signals) {
    const month = s.date.slice(0, 7);
    counts.set(month, (counts.get(month) ?? 0) + 1);
    const r = resolver.resolve(s.symbol, s.date, 5);
    if (!Number.isNaN(r)) {
      (map.get(month) ?? map.set(month, []).get(month)!).push(r);
    }
  }
  const months = Array.from(counts.keys()).sort();
  return months.map((m) => {
    const rs = map.get(m) ?? [];
    const avg = rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : NaN;
    return { month: m, signalCount: counts.get(m) ?? 0, avgR5: rs.length ? +avg.toFixed(2) : NaN };
  });
}

export function summarizeByKey<K extends string>(
  signals: HistoricalSignalRecord[],
  keyFn: (s: HistoricalSignalRecord) => K,
  resolver: { resolve(sym: string, date: string, n: number): number },
): PerSignalTypeStat[] {
  const map = new Map<string, HistoricalSignalRecord[]>();
  for (const s of signals) {
    const k = keyFn(s);
    (map.get(k) ?? map.set(k, []).get(k)!).push(s);
  }
  const out: PerSignalTypeStat[] = [];
  for (const [k, list] of map) {
    const r5: number[] = [];
    let wins = 0;
    for (const s of list) {
      const r = resolver.resolve(s.symbol, s.date, 5);
      if (!Number.isNaN(r)) {
        r5.push(r);
        if (r > 0) wins += 1;
      }
    }
    const avg = r5.length ? r5.reduce((a, b) => a + b, 0) / r5.length : NaN;
    out.push({
      signalType: k,
      signalCount: list.length,
      avgR5: r5.length ? +avg.toFixed(2) : NaN,
      winRate5d: r5.length ? +(wins / r5.length).toFixed(3) : NaN,
    });
  }
  out.sort((a, b) => (b.avgR5 || -Infinity) - (a.avgR5 || -Infinity));
  return out;
}

export function buildRecommendations(perStrategy: PerStrategyStat[]): Recommendation[] {
  const out: Recommendation[] = [];
  for (const s of perStrategy) {
    if (s.signalCount < 20) {
      out.push({
        strategyId: s.strategyId,
        verdict: "NEEDS_MORE_DATA",
        reason: `Only ${s.signalCount} signals — too few to draw conclusions.`,
      });
      continue;
    }
    if (s.avgR5 >= 2 && s.winRate5d >= 0.5) {
      out.push({
        strategyId: s.strategyId,
        verdict: "KEEP",
        reason: `avgR5 ${s.avgR5}% with ${(s.winRate5d * 100).toFixed(1)}% 5d win rate.`,
      });
    } else if (s.avgR5 <= -1) {
      out.push({
        strategyId: s.strategyId,
        verdict: "DISABLE",
        reason: `Negative avgR5 ${s.avgR5}% with ${(s.winRate5d * 100).toFixed(1)}% 5d win rate.`,
      });
    } else {
      out.push({
        strategyId: s.strategyId,
        verdict: "MODIFY",
        reason: `Marginal performance avgR5 ${s.avgR5}%; consider tuning thresholds.`,
      });
    }
  }
  return out;
}

/* ------------------------- markdown rendering ------------------------- */

function pct(v: number): string {
  return Number.isNaN(v) ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
}
function pctRate(v: number): string {
  return Number.isNaN(v) ? "—" : `${(v * 100).toFixed(1)}%`;
}

export function renderReportMarkdown(p: ReportPayload): string {
  const lines: string[] = [];
  lines.push(`# Pangzi validation report — ${p.dataset.source}`);
  lines.push("");
  lines.push(`Generated ${p.generatedAt}.`);
  lines.push("");
  lines.push("> ⚠️ Research output. Not investment advice. Past returns do not predict future returns. Verify before trading.");
  lines.push("");

  lines.push("## Dataset summary");
  lines.push("");
  lines.push(`- Source: \`${p.dataset.source}\``);
  lines.push(`- Symbols: ${p.dataset.symbolCount}`);
  lines.push(`- Bars: ${p.dataset.barCount.toLocaleString()}`);
  lines.push(`- Date range: ${p.dataset.dateRange.start} → ${p.dataset.dateRange.end}`);
  lines.push(`- Historical signals: ${p.dataset.signalCount.toLocaleString()}`);
  lines.push("");

  if (p.importReport) {
    const r = p.importReport;
    lines.push("## AkShare import report");
    lines.push("");
    lines.push(`- Adjust: \`${r.adjust}\``);
    lines.push(`- Requested ${r.totalSymbolsRequested}, succeeded ${r.totalSymbolsSucceeded}, failed ${r.totalSymbolsFailed}`);
    lines.push(`- Total bars: ${r.totalRows.toLocaleString()}`);
    lines.push(`- Started: ${r.startedAt} · completed: ${r.completedAt}`);
    if (r.failedSymbols.length) {
      lines.push("");
      lines.push("**Failed symbols (first 20):**");
      for (const f of r.failedSymbols.slice(0, 20)) lines.push(`  - ${f.symbol}: ${f.error}`);
    }
    if (r.warnings.length) {
      lines.push("");
      lines.push("**Warnings (first 20):**");
      for (const w of r.warnings.slice(0, 20)) lines.push(`  - ${w}`);
    }
    lines.push("");
  }

  if (p.importWarnings.length) {
    lines.push("## Adapter warnings");
    lines.push("");
    for (const w of p.importWarnings) lines.push(`- ${w}`);
    lines.push("");
  }

  lines.push("## Performance by strategy (forward returns)");
  lines.push("");
  lines.push("| Strategy | N | +1d | +3d | +5d | +10d | 5d win |");
  lines.push("|---|---:|---:|---:|---:|---:|---:|");
  for (const r of p.perStrategy) {
    lines.push(
      `| ${r.strategyId} | ${r.signalCount} | ${pct(r.avgR1)} | ${pct(r.avgR3)} | ${pct(r.avgR5)} | ${pct(r.avgR10)} | ${pctRate(r.winRate5d)} |`,
    );
  }
  lines.push("");

  lines.push("## Performance by month");
  lines.push("");
  lines.push("| Month | N | avg +5d |");
  lines.push("|---|---:|---:|");
  for (const m of p.perMonth) lines.push(`| ${m.month} | ${m.signalCount} | ${pct(m.avgR5)} |`);
  lines.push("");

  lines.push("## Performance by signal type");
  lines.push("");
  lines.push("| Signal type | N | avg +5d | 5d win |");
  lines.push("|---|---:|---:|---:|");
  for (const s of p.perSignalType)
    lines.push(`| ${s.signalType} | ${s.signalCount} | ${pct(s.avgR5)} | ${pctRate(s.winRate5d)} |`);
  lines.push("");

  lines.push("## Performance by risk level");
  lines.push("");
  lines.push("| Risk level | N | avg +5d | 5d win |");
  lines.push("|---|---:|---:|---:|");
  for (const s of p.perRiskLevel)
    lines.push(`| ${s.signalType} | ${s.signalCount} | ${pct(s.avgR5)} | ${pctRate(s.winRate5d)} |`);
  lines.push("");

  lines.push("## Score calibration");
  lines.push("");
  lines.push(`Monotonicity (5d): **${p.calibration.monotonic5d ? "OK" : "FAILED"}** · rank correlation: **${p.calibration.rankCorrelation5d.toFixed(3)}**`);
  if (p.calibration.warning) {
    lines.push("");
    lines.push(`> ⚠️ ${p.calibration.warning}`);
  }
  lines.push("");
  lines.push("| Bucket | N | +1d | +3d | +5d | +10d | 5d win | worst 5d | avg risk |");
  lines.push("|---|---:|---:|---:|---:|---:|---:|---:|---:|");
  for (const b of p.calibration.buckets) {
    lines.push(
      `| ${b.bucket} | ${b.signalCount} | ${pct(b.avgR1)} | ${pct(b.avgR3)} | ${pct(b.avgR5)} | ${pct(b.avgR10)} | ${pctRate(b.winRate5d)} | ${pct(b.worstR5)} | ${b.avgRiskLevelEncoded.toFixed(2)} |`,
    );
  }
  lines.push("");

  lines.push("## Risk filter comparison");
  lines.push("");
  if (p.riskValidation.warning) {
    lines.push(`> ⚠️ ${p.riskValidation.warning}`);
    lines.push("");
  }
  lines.push("| Cohort | N | Skipped | avg +5d | 5d win | worst 5d | cum proxy |");
  lines.push("|---|---:|---:|---:|---:|---:|---:|");
  for (const c of p.riskValidation.cohorts) {
    lines.push(
      `| ${c.cohort} | ${c.signalCount} | ${c.skippedCount} | ${pct(c.avgR5)} | ${pctRate(c.winRate5d)} | ${pct(c.worstR5)} | ${(c.cumulativeReturnProxy * 100).toFixed(2)}% |`,
    );
  }
  lines.push("");

  lines.push("## Top 20 best trades (by 5-day forward return)");
  lines.push("");
  lines.push("| Date | Symbol | Strategy | Score | +5d |");
  lines.push("|---|---|---|---:|---:|");
  for (const t of p.best20)
    lines.push(`| ${t.date} | ${t.symbol} | ${t.strategyId} | ${t.score.toFixed(1)} | ${pct(t.r5)} |`);
  lines.push("");

  lines.push("## Top 20 worst trades (by 5-day forward return)");
  lines.push("");
  lines.push("| Date | Symbol | Strategy | Score | +5d |");
  lines.push("|---|---|---|---:|---:|");
  for (const t of p.worst20)
    lines.push(`| ${t.date} | ${t.symbol} | ${t.strategyId} | ${t.score.toFixed(1)} | ${pct(t.r5)} |`);
  lines.push("");

  lines.push("## Most common failure modes (signals with negative 5d return)");
  lines.push("");
  lines.push("| Reason | Count | avg +5d |");
  lines.push("|---|---:|---:|");
  for (const r of p.topFailureReasons)
    lines.push(`| ${r.reason} | ${r.count} | ${pct(r.avgR5)} |`);
  lines.push("");

  lines.push("## Recommendations");
  lines.push("");
  lines.push("| Strategy | Verdict | Reason |");
  lines.push("|---|---|---|");
  for (const r of p.recommendations)
    lines.push(`| ${r.strategyId} | **${r.verdict}** | ${r.reason} |`);
  lines.push("");

  return lines.join("\n");
}

/** Convenience: aggregate negative-return signals by primary risk reason. */
export function summarizeFailureReasons(
  signals: HistoricalSignalRecord[],
  resolver: { resolve(sym: string, date: string, n: number): number },
): { reason: string; count: number; avgR5: number }[] {
  const map = new Map<string, number[]>();
  for (const s of signals) {
    const r = resolver.resolve(s.symbol, s.date, 5);
    if (Number.isNaN(r) || r >= 0) continue;
    const reason = s.risks?.[0] ?? "未标注风险 (no recorded risk)";
    (map.get(reason) ?? map.set(reason, []).get(reason)!).push(r);
  }
  const out: { reason: string; count: number; avgR5: number }[] = [];
  for (const [reason, rs] of map) {
    const avg = rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : NaN;
    out.push({ reason, count: rs.length, avgR5: +avg.toFixed(2) });
  }
  out.sort((a, b) => b.count - a.count);
  return out.slice(0, 10);
}

// Avoid unused-import warning when this module is consumed without a resolver.
export type { StockDailyBar };
