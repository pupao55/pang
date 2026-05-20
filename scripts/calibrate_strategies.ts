// calibrate_strategies.ts — produce reports/calibration-report.md.
//
// Reads the persistent signal store + the data adapter, runs:
//   - score calibration
//   - risk filter validation
//   - per-strategy quality + recommendation
//   - failure-mode breakdowns
//   - threshold sweep
//
// Usage:
//   tsx scripts/calibrate_strategies.ts --source akshareLocal
//     [--start-date YYYY-MM-DD] [--end-date YYYY-MM-DD]

import fs from "node:fs";
import path from "node:path";
import { createMockAdapter } from "@/lib/data/adapters/mockAdapter";
import { createAkshareLocalAdapter } from "@/lib/data/adapters/akshareLocalAdapter";
import { createBaostockLocalAdapter } from "@/lib/data/adapters/baostockLocalAdapter";
import type { DataAdapter, DataSourceId } from "@/lib/data/adapters";
import { readSignalStore, signalStoreFile } from "@/lib/store/signalStore";
import { PATHS } from "@/lib/store/paths";
import {
  calibrateScores,
  makeBarBasedResolver,
} from "@/lib/engine/scoreCalibration";
import { validateRiskFilter } from "@/lib/engine/riskFilterValidation";
import { evaluateStrategyQuality } from "@/lib/engine/strategyQuality";
import { buildFailureModes } from "@/lib/engine/failureModes";
import { runThresholdSweep } from "@/lib/engine/thresholdSweep";
import { buildPerStrategyCalibration } from "@/lib/engine/perStrategyCalibration";
import { buildScoreDistributionHealth } from "@/lib/engine/scoreDistributionHealth";
import { renderCalibrationReport } from "@/lib/reports/calibrationReport";

// Tiny side-channel for the previous-run bucket counts so the report can
// render a before/after column without snapshotting the whole report.
function bucketSnapshotPath(source: string): string {
  return path.join(PATHS.reportsDir, `${source}-score-buckets.json`);
}
function readPreviousBucketCounts(source: string): Record<string, number> | undefined {
  const p = bucketSnapshotPath(source);
  if (!fs.existsSync(p)) return undefined;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8")) as Record<string, number>;
  } catch {
    return undefined;
  }
}
function writeBucketCountsSnapshot(source: string, counts: Record<string, number>): void {
  if (!fs.existsSync(PATHS.reportsDir)) fs.mkdirSync(PATHS.reportsDir, { recursive: true });
  fs.writeFileSync(bucketSnapshotPath(source), JSON.stringify(counts, null, 2), "utf8");
}

interface CliArgs {
  source: DataSourceId;
  startDate?: string;
  endDate?: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { source: "akshareLocal" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case "--source":
        args.source = next() as DataSourceId;
        break;
      case "--start-date":
        args.startDate = next();
        break;
      case "--end-date":
        args.endDate = next();
        break;
      case "--help":
      case "-h":
        console.log(
          "Usage: tsx scripts/calibrate_strategies.ts --source <mock|akshareLocal|baostockLocal> [--start-date ...] [--end-date ...]",
        );
        process.exit(0);
    }
  }
  return args;
}

function createAdapter(source: DataSourceId): DataAdapter {
  if (source === "mock") return createMockAdapter();
  if (source === "akshareLocal") return createAkshareLocalAdapter();
  if (source === "baostockLocal") return createBaostockLocalAdapter();
  throw new Error(`Unknown source: ${source}`);
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  console.log(`Pangzi calibrate_strategies — source=${args.source}`);

  const file = signalStoreFile(args.source);
  if (!fs.existsSync(file)) {
    console.error(
      `Signal store not found at ${file}. Run:\n` +
        `  npm run rebuild:signals -- --source ${args.source} --rebuild`,
    );
    return 2;
  }
  let signals = readSignalStore(args.source);
  if (args.startDate) signals = signals.filter((s) => s.date >= args.startDate!);
  if (args.endDate) signals = signals.filter((s) => s.date <= args.endDate!);
  console.log(`Loaded ${signals.length} signal records`);

  let adapter: DataAdapter;
  try {
    adapter = createAdapter(args.source);
  } catch (err) {
    console.error(String((err as Error).message));
    return 2;
  }

  const metas = await adapter.getStockMetas();
  const allBars = await adapter.getDailyBarsForUniverse(
    metas.map((m) => m.symbol),
    "1900-01-01",
    "9999-12-31",
  );
  const resolver = makeBarBasedResolver(allBars);

  const calibration = calibrateScores(signals, resolver);
  const riskValidation = validateRiskFilter(signals, resolver);
  const perStrategy = evaluateStrategyQuality({
    signals,
    resolver,
    scoreCalibrationOk: calibration.verdict !== "NOT_CALIBRATED",
  });
  const failureModes = buildFailureModes(signals, resolver);
  const sweep = runThresholdSweep(signals, resolver);
  const perStrategyCalibration = buildPerStrategyCalibration(signals, resolver);

  // v1.8 — score distribution health, with mode probe + optional previous-run baseline.
  const akAdapter = "sectorMode" in adapter
    ? (adapter as unknown as { sectorMode: "REAL" | "GENERATED" | "FALLBACK" | "MISSING"; sentimentMode: "REAL" | "GENERATED" | "FALLBACK" | "MISSING"; metadataMode: "REAL" | "GENERATED" | "FALLBACK" | "MISSING" })
    : undefined;
  const previousBucketCounts = readPreviousBucketCounts(args.source);
  const scoreDistribution = buildScoreDistributionHealth({
    signals,
    sectorMode: akAdapter?.sectorMode,
    sentimentMode: akAdapter?.sentimentMode,
    metadataMode: akAdapter?.metadataMode,
    previousBucketCounts,
  });

  const allDates = signals.map((s) => s.date).sort();
  const md = renderCalibrationReport({
    source: args.source,
    generatedAt: new Date().toISOString(),
    signalCount: signals.length,
    dateRange: {
      start: allDates[0] ?? "—",
      end: allDates[allDates.length - 1] ?? "—",
    },
    perStrategy,
    perStrategyCalibration,
    calibration,
    riskValidation,
    failureModes,
    sweep,
    scoreDistribution,
  });

  // Persist current bucket counts so the next run can render a "previous"
  // column without storing the whole prior report. Tiny JSON, no PII.
  writeBucketCountsSnapshot(args.source, scoreDistribution.bucketCounts);

  if (!fs.existsSync(PATHS.reportsDir)) fs.mkdirSync(PATHS.reportsDir, { recursive: true });
  const outPath = path.join(PATHS.reportsDir, "calibration-report.md");
  fs.writeFileSync(outPath, md, "utf8");
  console.log(`\nWrote report: ${outPath}`);

  // Console headline.
  console.log("");
  console.log("Calibration verdicts:");
  console.log(`  scoreCalibration : ${calibration.verdict}`);
  console.log(`  riskFilter       : ${riskValidation.verdict}`);
  console.log("");
  console.log("Per-strategy recommendation:");
  for (const r of perStrategy) {
    console.log(
      `  ${r.strategyId.padEnd(24)}  n=${String(r.signalCount).padStart(5)}  ` +
        `avg5d=${String(r.avg5dReturn).padStart(7)}%  ` +
        `win5d=${(Number.isNaN(r.winRate5d) ? "—" : (r.winRate5d * 100).toFixed(1) + "%").padStart(6)}  ` +
        `→ ${r.recommendation}  [${r.sampleSizeBadge}]`,
    );
  }
  if (sweep.bestOverall) {
    const c = sweep.bestOverall;
    console.log("");
    console.log(
      `Sweep best overall: minScore=${c.minScore} risk≤${c.maxRiskLevel} hold=${c.holdingWindow}d ` +
        `n=${c.signalCount} avg=${c.avgReturn}% win=${(c.winRate * 100).toFixed(1)}% ` +
        `risk-adj=${c.riskAdjusted.toFixed(2)}`,
    );
  }
  return 0;
}

main()
  .then((c) => process.exit(c))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
