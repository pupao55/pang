// Cross-provider bar comparison (pure functions, no IO).
//
// Inputs are two arrays of normalized StockDailyBar for the same symbol from
// two different providers. Output describes overlap, divergence, and
// adjustment-mismatch hints suitable for the markdown report.

import type { StockDailyBar } from "@/lib/types/stock";

export interface BarDiff {
  date: string;
  closeA?: number;
  closeB?: number;
  closeDiffPct?: number;
  pctChangeA?: number;
  pctChangeB?: number;
  pctChangeDiff?: number;
  volumeA?: number;
  volumeB?: number;
  volumeRatio?: number;
  amountA?: number;
  amountB?: number;
  amountRatio?: number;
}

export interface CompareResult {
  symbol: string;
  providerA: string;
  providerB: string;
  countA: number;
  countB: number;
  /** Dates present in both providers. */
  overlapCount: number;
  /** Dates in A but not B (limited list). */
  onlyInA: string[];
  /** Dates in B but not A (limited list). */
  onlyInB: string[];
  meanAbsCloseDiffPct: number;
  maxAbsCloseDiffPct: number;
  meanAbsPctChangeDiff: number;
  maxAbsPctChangeDiff: number;
  meanVolumeRatio: number;
  /** True when overlap exists and mean close diff > 2% — strong hint of
   *  adjustment mismatch (qfq vs hfq vs raw). */
  likelyAdjustmentMismatch: boolean;
  /** Largest absolute close-diff rows, capped for the report. */
  topDiffs: BarDiff[];
}

function abs(x: number) {
  return Math.abs(x);
}

export function compareBars(
  symbol: string,
  providerA: string,
  barsA: StockDailyBar[],
  providerB: string,
  barsB: StockDailyBar[],
  options: { maxOnlyIn?: number; topDiffsCount?: number } = {},
): CompareResult {
  const maxOnlyIn = options.maxOnlyIn ?? 20;
  const topN = options.topDiffsCount ?? 20;

  const mapA = new Map<string, StockDailyBar>();
  for (const b of barsA) mapA.set(b.date, b);
  const mapB = new Map<string, StockDailyBar>();
  for (const b of barsB) mapB.set(b.date, b);

  const onlyA: string[] = [];
  const onlyB: string[] = [];
  for (const d of mapA.keys()) if (!mapB.has(d)) onlyA.push(d);
  for (const d of mapB.keys()) if (!mapA.has(d)) onlyB.push(d);
  onlyA.sort();
  onlyB.sort();

  const diffs: BarDiff[] = [];
  for (const [d, a] of mapA) {
    const b = mapB.get(d);
    if (!b) continue;
    const closeDiff =
      a.close > 0 && b.close > 0
        ? ((a.close - b.close) / ((a.close + b.close) / 2)) * 100
        : NaN;
    const pctDiff = a.pctChange - b.pctChange;
    const volRatio = b.volume > 0 ? a.volume / b.volume : NaN;
    const amtRatio = b.amount > 0 ? a.amount / b.amount : NaN;
    diffs.push({
      date: d,
      closeA: a.close,
      closeB: b.close,
      closeDiffPct: Number.isNaN(closeDiff) ? NaN : +closeDiff.toFixed(3),
      pctChangeA: a.pctChange,
      pctChangeB: b.pctChange,
      pctChangeDiff: +pctDiff.toFixed(3),
      volumeA: a.volume,
      volumeB: b.volume,
      volumeRatio: Number.isNaN(volRatio) ? NaN : +volRatio.toFixed(3),
      amountA: a.amount,
      amountB: b.amount,
      amountRatio: Number.isNaN(amtRatio) ? NaN : +amtRatio.toFixed(3),
    });
  }

  const overlap = diffs.length;
  const closeDiffs = diffs
    .map((d) => d.closeDiffPct)
    .filter((v): v is number => typeof v === "number" && !Number.isNaN(v));
  const pctDiffs = diffs
    .map((d) => d.pctChangeDiff)
    .filter((v): v is number => typeof v === "number" && !Number.isNaN(v));
  const volRatios = diffs
    .map((d) => d.volumeRatio)
    .filter((v): v is number => typeof v === "number" && !Number.isNaN(v));

  const meanAbsClose =
    closeDiffs.length > 0
      ? closeDiffs.reduce((s, v) => s + abs(v), 0) / closeDiffs.length
      : NaN;
  const maxAbsClose = closeDiffs.length > 0 ? Math.max(...closeDiffs.map(abs)) : NaN;
  const meanAbsPct =
    pctDiffs.length > 0
      ? pctDiffs.reduce((s, v) => s + abs(v), 0) / pctDiffs.length
      : NaN;
  const maxAbsPct = pctDiffs.length > 0 ? Math.max(...pctDiffs.map(abs)) : NaN;
  const meanVol =
    volRatios.length > 0
      ? volRatios.reduce((s, v) => s + v, 0) / volRatios.length
      : NaN;

  const topDiffs = [...diffs]
    .sort((x, y) =>
      abs(y.closeDiffPct ?? 0) - abs(x.closeDiffPct ?? 0),
    )
    .slice(0, topN);

  return {
    symbol,
    providerA,
    providerB,
    countA: barsA.length,
    countB: barsB.length,
    overlapCount: overlap,
    onlyInA: onlyA.slice(0, maxOnlyIn),
    onlyInB: onlyB.slice(0, maxOnlyIn),
    meanAbsCloseDiffPct: Number.isNaN(meanAbsClose) ? NaN : +meanAbsClose.toFixed(3),
    maxAbsCloseDiffPct: Number.isNaN(maxAbsClose) ? NaN : +maxAbsClose.toFixed(3),
    meanAbsPctChangeDiff: Number.isNaN(meanAbsPct) ? NaN : +meanAbsPct.toFixed(3),
    maxAbsPctChangeDiff: Number.isNaN(maxAbsPct) ? NaN : +maxAbsPct.toFixed(3),
    meanVolumeRatio: Number.isNaN(meanVol) ? NaN : +meanVol.toFixed(3),
    likelyAdjustmentMismatch: !Number.isNaN(meanAbsClose) && meanAbsClose > 2,
    topDiffs,
  };
}

function pctStr(v: number): string {
  if (Number.isNaN(v)) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(3)}%`;
}

export function renderCompareReport(r: CompareResult): string {
  const lines: string[] = [];
  lines.push(`# Pangzi provider comparison — ${r.symbol}`);
  lines.push("");
  lines.push(`Generated ${new Date().toISOString()}.`);
  lines.push(`Comparing **${r.providerA}** vs **${r.providerB}**.`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- Bars in ${r.providerA}: **${r.countA}**`);
  lines.push(`- Bars in ${r.providerB}: **${r.countB}**`);
  lines.push(`- Overlap (same date in both): **${r.overlapCount}**`);
  lines.push(`- Only in ${r.providerA}: ${r.onlyInA.length} dates`);
  lines.push(`- Only in ${r.providerB}: ${r.onlyInB.length} dates`);
  lines.push(`- mean |close diff|: ${pctStr(r.meanAbsCloseDiffPct)}`);
  lines.push(`- max |close diff|: ${pctStr(r.maxAbsCloseDiffPct)}`);
  lines.push(`- mean |pctChange diff|: ${pctStr(r.meanAbsPctChangeDiff)} (absolute, percentage-points)`);
  lines.push(`- max |pctChange diff|: ${pctStr(r.maxAbsPctChangeDiff)}`);
  lines.push(`- mean volume ratio (A/B): ${Number.isNaN(r.meanVolumeRatio) ? "—" : r.meanVolumeRatio.toFixed(3)}`);
  if (r.likelyAdjustmentMismatch) {
    lines.push("");
    lines.push(
      "> ⚠️ Mean absolute close diff > 2% — likely adjustment mismatch " +
        "(qfq vs hfq vs raw). Refetch one side with the matching adjustment.",
    );
  }
  lines.push("");

  if (r.onlyInA.length > 0) {
    lines.push(`### Dates only in ${r.providerA}`);
    lines.push("");
    lines.push(r.onlyInA.map((d) => `\`${d}\``).join(" "));
    lines.push("");
  }
  if (r.onlyInB.length > 0) {
    lines.push(`### Dates only in ${r.providerB}`);
    lines.push("");
    lines.push(r.onlyInB.map((d) => `\`${d}\``).join(" "));
    lines.push("");
  }

  if (r.topDiffs.length > 0) {
    lines.push("## Top divergences by |close diff|");
    lines.push("");
    lines.push("| Date | A close | B close | close diff % | A pctChg | B pctChg | pctChg diff | volume ratio |");
    lines.push("|---|---:|---:|---:|---:|---:|---:|---:|");
    for (const d of r.topDiffs) {
      lines.push(
        `| ${d.date} | ${d.closeA?.toFixed(2) ?? "—"} | ${d.closeB?.toFixed(2) ?? "—"} | ${pctStr(d.closeDiffPct ?? NaN)} | ` +
          `${(d.pctChangeA ?? 0).toFixed(2)} | ${(d.pctChangeB ?? 0).toFixed(2)} | ${pctStr(d.pctChangeDiff ?? NaN)} | ` +
          `${Number.isNaN(d.volumeRatio ?? NaN) ? "—" : (d.volumeRatio as number).toFixed(3)} |`,
      );
    }
    lines.push("");
  }

  lines.push("## Notes");
  lines.push("");
  lines.push(
    "- AkShare and BaoStock can use different adjustment methods even when both are " +
      "configured for `qfq`. Always re-verify the adjustment column on a few rows " +
      "before treating the providers as interchangeable.",
  );
  lines.push(
    "- Volume / amount come in different units depending on the upstream (lots vs " +
      "shares, CNY vs 万元). Treat large volume-ratio deviations as a unit " +
      "difference until you've inspected the raw API response.",
  );
  return lines.join("\n");
}
