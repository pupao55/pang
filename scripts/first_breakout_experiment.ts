// first_breakout_experiment.ts — generate reports/first-breakout-experiment.md.
//
// Strict vs relaxed firstBreakout A/B over the local cache. Does not change
// any production default. See DECISIONS.md D-006 + TASKS.md T-006.
//
// Usage:
//   tsx scripts/first_breakout_experiment.ts --source baostockLocal [--max-dates 250]

import fs from "node:fs";
import path from "node:path";
import { createAkshareLocalAdapter } from "@/lib/data/adapters/akshareLocalAdapter";
import { createBaostockLocalAdapter } from "@/lib/data/adapters/baostockLocalAdapter";
import { createMockAdapter } from "@/lib/data/adapters/mockAdapter";
import type { DataAdapter, DataSourceId } from "@/lib/data/adapters";
import { PATHS } from "@/lib/store/paths";
import { makeBarBasedResolver } from "@/lib/engine/scoreCalibration";
import { runFirstBreakoutExperiment } from "@/lib/engine/firstBreakoutExperiment";
import { renderFirstBreakoutReport } from "@/lib/reports/firstBreakoutExperimentReport";
import type { MarketSentimentSnapshot } from "@/lib/types/market";

interface CliArgs {
  source: DataSourceId;
  maxDates?: number;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { source: "baostockLocal" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case "--source":
        args.source = next() as DataSourceId;
        break;
      case "--max-dates":
        args.maxDates = Number(next());
        break;
      case "--help":
      case "-h":
        console.log(
          "Usage: tsx scripts/first_breakout_experiment.ts --source <mock|akshareLocal|baostockLocal> [--max-dates 250]",
        );
        process.exit(0);
    }
  }
  return args;
}

function createAdapter(source: DataSourceId): DataAdapter {
  switch (source) {
    case "mock":
      return createMockAdapter();
    case "akshareLocal":
      return createAkshareLocalAdapter();
    case "baostockLocal":
      return createBaostockLocalAdapter();
    default:
      throw new Error(`Unknown source: ${source}`);
  }
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  console.log(`Pangzi first_breakout_experiment — source=${args.source}`);

  const adapter = createAdapter(args.source);
  const metas = await adapter.getStockMetas();
  if (metas.length === 0) {
    console.error("No metas — nothing to do.");
    return 1;
  }
  console.log(`Loaded ${metas.length} symbols`);

  const allBars = await adapter.getDailyBarsForUniverse(
    metas.map((m) => m.symbol),
    "1900-01-01",
    "9999-12-31",
  );
  const resolver = makeBarBasedResolver(allBars);

  // Build per-date sector + sentiment maps from the dates present in bars.
  const dateSet = new Set<string>();
  for (const sym of Object.keys(allBars))
    for (const b of allBars[sym]) dateSet.add(b.date);
  const dates = [...dateSet].sort();
  const maxDates = args.maxDates ?? Infinity;
  const evalDates =
    Number.isFinite(maxDates) ? dates.slice(-(maxDates as number)) : dates;
  console.log(`Loading sector + sentiment for ${evalDates.length} dates ...`);
  const sectorSnapshotsByDate = new Map<string, Awaited<ReturnType<DataAdapter["getSectorSnapshots"]>>>();
  const sentimentByDate = new Map<string, MarketSentimentSnapshot | undefined>();
  for (const d of evalDates) {
    sectorSnapshotsByDate.set(d, await adapter.getSectorSnapshots(d));
    sentimentByDate.set(d, await adapter.getMarketSentiment(d));
  }

  console.log("Running strict vs relaxed firstBreakout ...");
  const result = runFirstBreakoutExperiment({
    metas,
    barsBySymbol: allBars,
    sectorSnapshotsByDate,
    sentimentByDate,
    resolver,
    maxDatesPerSymbol: args.maxDates,
  });

  const md = renderFirstBreakoutReport(result, args.source);
  if (!fs.existsSync(PATHS.reportsDir))
    fs.mkdirSync(PATHS.reportsDir, { recursive: true });
  const outPath = path.join(PATHS.reportsDir, "first-breakout-experiment.md");
  fs.writeFileSync(outPath, md, "utf8");

  console.log("\nResults:");
  console.log(
    `  strict:  signals=${result.strict.signalCount}  pass=${(result.strict.passRate * 100).toFixed(3)}%  +5d=${result.strict.avgReturn5d}%  win5d=${(result.strict.winRate5d * 100).toFixed(0)}%  badge=${result.strict.sampleSizeBadge}`,
  );
  console.log(
    `  relaxed: signals=${result.relaxed.signalCount}  pass=${(result.relaxed.passRate * 100).toFixed(3)}%  +5d=${result.relaxed.avgReturn5d}%  win5d=${(result.relaxed.winRate5d * 100).toFixed(0)}%  badge=${result.relaxed.sampleSizeBadge}`,
  );
  console.log(`  verdict: ${result.verdict}`);
  console.log(`\nReport written to ${outPath}`);
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
