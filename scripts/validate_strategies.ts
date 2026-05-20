// validate_strategies.ts — produce reports/{source}-validation-report.md
//
// Reads the persistent signal store + the data adapter, computes forward
// returns over 1/3/5/10-day windows, summarizes per strategy / month / score
// bucket / risk level, runs score-calibration and risk-filter checks, then
// emits a markdown report.
//
// Usage:
//   tsx scripts/validate_strategies.ts --source akshareLocal
//     [--start-date YYYY-MM-DD] [--end-date YYYY-MM-DD]

import fs from "node:fs";
import { createMockAdapter } from "@/lib/data/adapters/mockAdapter";
import {
  createAkshareLocalAdapter,
  type AkshareLocalAdapter,
} from "@/lib/data/adapters/akshareLocalAdapter";
import { createBaostockLocalAdapter } from "@/lib/data/adapters/baostockLocalAdapter";
import type { DataAdapter, DataSourceId } from "@/lib/data/adapters";
import { readSignalStore, signalStoreFile } from "@/lib/store/signalStore";
import { PATHS } from "@/lib/store/paths";
import {
  calibrateScores,
  makeBarBasedResolver,
} from "@/lib/engine/scoreCalibration";
import { validateRiskFilter } from "@/lib/engine/riskFilterValidation";
import {
  buildRecommendations,
  makeBestWorst,
  renderReportMarkdown,
  summarizeByMonth,
  summarizeByKey,
  summarizeByStrategy,
  summarizeFailureReasons,
} from "@/lib/reports/validationReport";

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
          "Usage: tsx scripts/validate_strategies.ts --source <mock|akshareLocal|baostockLocal> [--start-date ...] [--end-date ...]",
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
  console.log(`Pangzi validate_strategies — source=${args.source}`);

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
  const resolveR5 = (sym: string, date: string) => resolver.resolve(sym, date, 5);

  const allDates = signals.map((s) => s.date).sort();
  const firstDate = allDates[0] ?? "—";
  const lastDate = allDates[allDates.length - 1] ?? "—";
  const barCount = Object.values(allBars).reduce((a, b) => a + b.length, 0);

  const perStrategy = summarizeByStrategy(signals, resolver);
  const perMonth = summarizeByMonth(signals, resolver);
  const perSignalType = summarizeByKey(signals, (s) => s.signalType, resolver);
  const perRiskLevel = summarizeByKey(signals, (s) => s.riskLevel, resolver);
  const calibration = calibrateScores(signals, resolver);
  const riskValidation = validateRiskFilter(signals, resolver);
  const { best, worst } = makeBestWorst(signals, resolveR5, 20);
  const topFailureReasons = summarizeFailureReasons(signals, resolver);
  const recommendations = buildRecommendations(perStrategy);

  const importReport =
    args.source === "akshareLocal"
      ? (adapter as AkshareLocalAdapter).importReport()
      : null;
  const importWarnings =
    args.source === "akshareLocal"
      ? (adapter as AkshareLocalAdapter).warnings
      : [];

  const md = renderReportMarkdown({
    dataset: {
      source: args.source,
      symbolCount: metas.length,
      barCount,
      dateRange: { start: firstDate, end: lastDate },
      signalCount: signals.length,
    },
    importReport,
    importWarnings,
    perStrategy,
    perMonth,
    perSignalType,
    perRiskLevel,
    calibration,
    riskValidation,
    best20: best,
    worst20: worst,
    topFailureReasons,
    recommendations,
    generatedAt: new Date().toISOString(),
  });

  if (!fs.existsSync(PATHS.reportsDir)) fs.mkdirSync(PATHS.reportsDir, { recursive: true });
  const outPath = PATHS.reportFor(args.source);
  fs.writeFileSync(outPath, md, "utf8");
  console.log(`\nWrote report: ${outPath}`);

  // Pretty headline summary on stdout.
  console.log("");
  console.log("Per-strategy headline:");
  for (const s of perStrategy) {
    console.log(
      `  ${s.strategyId.padEnd(24)}  n=${String(s.signalCount).padStart(5)}  avgR5=${s.avgR5}%  win5d=${(s.winRate5d * 100).toFixed(1)}%`,
    );
  }
  if (calibration.warning) console.log(`\n⚠️  ${calibration.warning}`);
  if (riskValidation.warning) console.log(`\n⚠️  ${riskValidation.warning}`);

  return 0;
}

main()
  .then((c) => process.exit(c))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
