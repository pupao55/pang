// Markdown renderer for the cache maturity diagnostic.

import type { CacheMaturityReport } from "@/lib/engine/cacheMaturity";

const READINESS_COPY: Record<CacheMaturityReport["readinessLevel"], string> = {
  NOT_READY:
    "Current results are workflow validation only, not strategy evidence. The pipeline executes but the dataset is too small to interpret outputs.",
  SMOKE_TEST_ONLY:
    "Current results are workflow validation only, not strategy evidence. Use the artifacts to confirm the engine runs, not to judge strategies.",
  EARLY_RESEARCH:
    "Current results can be used for preliminary strategy debugging, not final calibration. Treat verdicts as direction-of-travel signals, not investment evidence.",
  RESEARCH_READY:
    "Dataset is large enough for meaningful strategy comparison, though results are still not investment advice.",
};

const READINESS_BADGE: Record<CacheMaturityReport["readinessLevel"], string> = {
  NOT_READY: "🛑 NOT_READY",
  SMOKE_TEST_ONLY: "⚠️ SMOKE_TEST_ONLY",
  EARLY_RESEARCH: "🟡 EARLY_RESEARCH",
  RESEARCH_READY: "✅ RESEARCH_READY",
};

function pct(v: number): string {
  if (Number.isNaN(v) || !Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(1)}%`;
}

export function renderCacheMaturityReport(
  r: CacheMaturityReport,
  meta: { source: string; generatedAt: string },
): string {
  const lines: string[] = [];
  lines.push(`# Pangzi cache maturity report — ${meta.source}`);
  lines.push("");
  lines.push(`Generated ${meta.generatedAt}.`);
  lines.push("");
  lines.push(`## Verdict: ${READINESS_BADGE[r.readinessLevel]}`);
  lines.push("");
  lines.push(`> ${READINESS_COPY[r.readinessLevel]}`);
  lines.push("");
  if (r.readinessReasons.length > 0) {
    lines.push("**Why this verdict:**");
    for (const reason of r.readinessReasons) lines.push(`- ${reason}`);
    lines.push("");
  }

  lines.push("## Dataset size");
  lines.push("");
  lines.push(`- Symbols: **${r.symbolCount}**`);
  lines.push(`- Total bars: **${r.totalBars.toLocaleString()}**`);
  lines.push(`- Trading days in cache: ${r.tradingDayCount}`);
  lines.push(
    `- Bars per symbol — avg ${r.averageBarsPerSymbol}, min ${r.minBarsPerSymbol}, max ${r.maxBarsPerSymbol}`,
  );
  lines.push(`- Symbols with < 60 bars: ${r.symbolsWithShortHistory.length}`);
  lines.push("");

  lines.push("## Coverage");
  lines.push("");
  lines.push(
    `- Latest-date coverage: ${pct(r.latestDateCoverageRatio)} (${r.symbolsWithLatestDate}/${r.symbolCount})`,
  );
  lines.push(`- Sector coverage: ${pct(r.sectorCoverageRatio)}`);
  lines.push(`- Sentiment coverage: ${pct(r.sentimentCoverageRatio)}`);
  if (r.fetchStatusSummary) {
    const fs = r.fetchStatusSummary;
    lines.push(
      `- Fetch status: succeeded=${fs.succeeded} · failed=${fs.failed} · empty=${fs.empty} · skipped=${fs.skipped} · updated ${fs.updatedAt}`,
    );
  }
  lines.push("");

  lines.push("## Signals by strategy");
  lines.push("");
  const sortedStrategies = Object.entries(r.signalsByStrategy).sort(
    (a, b) => b[1] - a[1],
  );
  if (sortedStrategies.length === 0) {
    lines.push("_(no historical signals — run `npm run rebuild:signals`)_");
  } else {
    lines.push("| Strategy | Signals | ≥ 100 floor |");
    lines.push("|---|---:|:---:|");
    for (const [sid, n] of sortedStrategies) {
      const ok = n >= 100 ? "✅" : "—";
      lines.push(`| ${sid} | ${n} | ${ok} |`);
    }
  }
  lines.push("");

  lines.push("## Score-bucket distribution");
  lines.push("");
  lines.push("| Bucket | Signals |");
  lines.push("|---|---:|");
  for (const [b, n] of Object.entries(r.scoreBucketCoverage)) {
    lines.push(`| ${b} | ${n} |`);
  }
  if (r.hasScoreCompression) {
    lines.push("");
    lines.push(
      "> ⚠️ Score compression detected — no signals in 80-90 or 90-100. Most often caused by missing real sector/sentiment data deflating `sectorScore` / `sentimentScore`.",
    );
  }
  lines.push("");

  lines.push("## Risk-level distribution");
  lines.push("");
  lines.push("| Risk level | Signals |");
  lines.push("|---|---:|");
  for (const [k, n] of Object.entries(r.riskLevelCoverage)) {
    lines.push(`| ${k} | ${n} |`);
  }
  if (!r.hasRiskDiversity) {
    lines.push("");
    lines.push(
      "> ⚠️ No risk diversity — the risk filter cannot be evaluated meaningfully until at least one MEDIUM/HIGH/FORBIDDEN signal appears.",
    );
  }
  lines.push("");

  lines.push("## Next actions");
  lines.push("");
  if (r.nextActions.length === 0) {
    lines.push("_(no specific next action — dataset looks healthy on the dimensions checked)_");
  } else {
    for (const a of r.nextActions) lines.push(`- [ ] ${a}`);
  }
  lines.push("");

  lines.push("## Notes");
  lines.push("");
  lines.push(
    "- Readiness thresholds: NOT_READY (< 5 symbols or < 1000 bars), " +
      "SMOKE_TEST_ONLY (5-29 symbols), EARLY_RESEARCH (≥ 30 symbols / ≥ 200 avg bars / ≥ 1 strategy with 100 signals), " +
      "RESEARCH_READY (≥ 100 symbols / ≥ 250 avg bars / ≥ 3 strategies with 100 signals / score buckets 60-90+ populated / risk diversity / sector ≥ 50% / sentiment ≥ 80%).",
  );
  lines.push(
    "- Even RESEARCH_READY does **not** mean the strategies are profitable in production — it means the calibration framework has enough material to issue an informed verdict.",
  );

  return lines.join("\n");
}
