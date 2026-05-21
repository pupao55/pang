// firstBreakoutExperimentReport — markdown renderer for the strict-vs-relaxed
// firstBreakout experiment (T-006). Mirrors the calibration-report style.

import type {
  FirstBreakoutExperimentResult,
  FirstBreakoutVariantResult,
  SampleSizeBadge,
} from "@/lib/engine/firstBreakoutExperiment";

function pct(v: number): string {
  if (!Number.isFinite(v)) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
}
function rate(v: number): string {
  if (!Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(0)}%`;
}
function badge(b: SampleSizeBadge): string {
  return `\`${b}\``;
}

function variantHeaderRow(v: FirstBreakoutVariantResult): string {
  return `| ${v.variant} | ${v.candidateCount.toLocaleString()} | ${v.signalCount.toLocaleString()} | ${(v.passRate * 100).toFixed(3)}% | ${badge(v.sampleSizeBadge)} |`;
}

function gateRow(
  label: string,
  strict: number,
  relaxed: number,
  strictTotal: number,
  relaxedTotal: number,
): string {
  const sPct = strictTotal > 0 ? ((strict / strictTotal) * 100).toFixed(1) : "—";
  const rPct = relaxedTotal > 0 ? ((relaxed / relaxedTotal) * 100).toFixed(1) : "—";
  return `| ${label} | ${strict.toLocaleString()} (${sPct}%) | ${relaxed.toLocaleString()} (${rPct}%) |`;
}

function returnsRow(v: FirstBreakoutVariantResult): string {
  return `| ${v.variant} | ${pct(v.avgReturn1d)} | ${pct(v.avgReturn3d)} | ${pct(v.avgReturn5d)} | ${pct(v.avgReturn10d)} | ${rate(v.winRate1d)} | ${rate(v.winRate3d)} | ${rate(v.winRate5d)} | ${rate(v.winRate10d)} | ${pct(v.bestReturn5d)} | ${pct(v.worstReturn5d)} |`;
}

export function renderFirstBreakoutReport(
  result: FirstBreakoutExperimentResult,
  source: string,
): string {
  const { strict, relaxed, verdict, recommendation, note } = result;

  const sampleWarning =
    strict.signalCount < 30 || relaxed.signalCount < 30
      ? `\n> ⚠️ Sample size warning — strict n=${strict.signalCount}, relaxed n=${relaxed.signalCount}. At least one variant is below the 30-signal floor; treat all return figures as exploratory.\n`
      : "";

  return `# First-Breakout Experiment (T-006)

> Source: \`${source}\` · generated ${new Date().toISOString().slice(0, 10)}
>
> Strict vs relaxed firstBreakout A/B. **This experiment does not change
> production defaults.** The relaxed variant is research-only and is not
> registered in the default strategy list (run with
> \`ENABLE_EXPERIMENTAL_STRATEGIES=true\` to expose it elsewhere).

## Executive summary

- **Verdict**: \`${verdict}\`
- **Recommendation**: ${recommendation}
- Strict: ${strict.signalCount.toLocaleString()} raw fires (badge ${badge(strict.sampleSizeBadge)}) — +5d ${pct(strict.avgReturn5d)}, win5d ${rate(strict.winRate5d)}.
- Relaxed: ${relaxed.signalCount.toLocaleString()} raw fires (badge ${badge(relaxed.sampleSizeBadge)}) — +5d ${pct(relaxed.avgReturn5d)}, win5d ${rate(relaxed.winRate5d)}.${sampleWarning}

> **Note on counts.** "Raw fires" = the strategy returned a candidate AND
> the risk filter did not exclude it. The persistent signal store
> (\`data/signals/<source>/signals.jsonl\`) typically shows far fewer
> firstBreakout records because \`runSignalEngine\` keeps only the
> top-scoring strategy per (symbol, date) and lists others under
> \`corroboratingStrategies\`. Both views are useful — raw fires are the
> right denominator for an A/B; persisted records are the right view for
> daily UI ranking.

## 1. Strict vs relaxed comparison

| variant | candidates | signals | pass rate | sample size |
|---|---:|---:|---:|:---:|
${variantHeaderRow(strict)}
${variantHeaderRow(relaxed)}

## 2. Gate failure breakdown

Counts the candidate-rejections at each gate. Percentages are share of total candidates (not survivors), so columns do not need to sum to 100.

| Gate | Strict (rejected / %) | Relaxed (rejected / %) |
|---|---:|---:|
${gateRow("minHistory", strict.rejected.minHistory, relaxed.rejected.minHistory, strict.candidateCount, relaxed.candidateCount)}
${gateRow("priorRiseCap (60d ≤ 60%)", strict.rejected.priorRiseCap, relaxed.rejected.priorRiseCap, strict.candidateCount, relaxed.candidateCount)}
${gateRow("platformBreakout", strict.rejected.platformBreakout, relaxed.rejected.platformBreakout, strict.candidateCount, relaxed.candidateCount)}
${gateRow("amountExpansion (>1.5× 10d)", strict.rejected.amountExpansion, relaxed.rejected.amountExpansion, strict.candidateCount, relaxed.candidateCount)}
${gateRow("volumeExpansion (>1.5× 10d)", strict.rejected.volumeExpansion, relaxed.rejected.volumeExpansion, strict.candidateCount, relaxed.candidateCount)}
${gateRow("sectorStrength", strict.rejected.sectorStrength, relaxed.rejected.sectorStrength, strict.candidateCount, relaxed.candidateCount)}
${gateRow("riskFilter (post-gate)", strict.rejected.riskFilter, relaxed.rejected.riskFilter, strict.candidateCount, relaxed.candidateCount)}

## 3. Forward returns

| variant | +1d | +3d | +5d | +10d | win 1d | win 3d | win 5d | win 10d | best 5d | worst 5d |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
${returnsRow(strict)}
${returnsRow(relaxed)}

## 4. Sample-size note

- \`NEEDS_MORE_DATA\` — n < 30, treat as anecdote.
- \`LOW_CONFIDENCE\` — 30 ≤ n < 100, exploratory only.
- \`OK\` — n ≥ 100, enough to start trusting central tendency.

Strict: ${badge(strict.sampleSizeBadge)} · Relaxed: ${badge(relaxed.sampleSizeBadge)}

## 5. Verdict & recommendation

**${verdict}** — ${recommendation}

${note}

---

_Generated by_ \`scripts/first_breakout_experiment.ts\`.
`;
}
