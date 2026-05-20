// horizon_calibration.ts — generate reports/horizon-calibration-report.md.
//
// Reads the persistent signal store + the data adapter, runs:
//   - horizon calibration (per strategy + per score bucket, 1/2/3/5/10d)
//   - score weight sweep (advisory, no constants.ts changes)
//   - sectorLeader tightening sweep
//   - firstBreakout gate review
// then renders a single markdown document. Constants are not modified.
//
// Usage:
//   tsx scripts/horizon_calibration.ts --source baostockLocal

import fs from "node:fs";
import path from "node:path";
import { createMockAdapter } from "@/lib/data/adapters/mockAdapter";
import { createAkshareLocalAdapter } from "@/lib/data/adapters/akshareLocalAdapter";
import { createBaostockLocalAdapter } from "@/lib/data/adapters/baostockLocalAdapter";
import type { DataAdapter, DataSourceId } from "@/lib/data/adapters";
import { readSignalStore, signalStoreFile } from "@/lib/store/signalStore";
import { PATHS } from "@/lib/store/paths";
import { makeBarBasedResolver } from "@/lib/engine/scoreCalibration";
import { calibrateHorizons } from "@/lib/engine/horizonCalibration";
import { runScoreWeightSweep } from "@/lib/engine/scoreWeightSweep";
import { tuneSectorLeader } from "@/lib/engine/sectorLeaderTuning";
import { reviewFirstBreakoutGates } from "@/lib/engine/strategyGateReview";
import { renderHorizonReport } from "@/lib/reports/horizonCalibrationReport";

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
          "Usage: tsx scripts/horizon_calibration.ts --source <mock|akshareLocal|baostockLocal> [--max-dates 250]",
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
  console.log(`Pangzi horizon_calibration — source=${args.source}`);

  const adapter = createAdapter(args.source);
  const signals = readSignalStore(args.source);
  if (signals.length === 0) {
    console.error(
      `No signals found in ${signalStoreFile(args.source)}. Run npm run rebuild:signals --source ${args.source} --rebuild first.`,
    );
    return 1;
  }
  console.log(`Loaded ${signals.length} signals`);
  const signalsWithComponents = signals.filter(
    (s) => s.technicalScore !== undefined && s.riskPenalty !== undefined,
  );
  console.log(
    `  ${signalsWithComponents.length} carry component scores (rebuild required for weight sweep).`,
  );

  const metas = await adapter.getStockMetas();
  const allBars = await adapter.getDailyBarsForUniverse(
    metas.map((m) => m.symbol),
    "1900-01-01",
    "9999-12-31",
  );
  const resolver = makeBarBasedResolver(allBars);

  // Pre-load sector snapshots for every distinct date in the signal store —
  // sectorLeader tuning and firstBreakout gate review both need these.
  const signalDates = [...new Set(signals.map((s) => s.date))].sort();
  // First-breakout uses a 250-trading-day sliding window of dates; load those
  // too even if no signal date falls in them.
  const tradingDates = await adapter.getTradingCalendar(
    "1900-01-01",
    "9999-12-31",
  );
  const dateSet = new Set<string>(signalDates);
  for (const d of tradingDates.slice(-(args.maxDates ?? 250))) dateSet.add(d);
  const sortedDates = [...dateSet].sort();
  console.log(`Loading sector snapshots for ${sortedDates.length} dates ...`);
  const sectorSnapshotsByDate = new Map<string, Awaited<ReturnType<DataAdapter["getSectorSnapshots"]>>>();
  for (const d of sortedDates) {
    sectorSnapshotsByDate.set(d, await adapter.getSectorSnapshots(d));
  }

  console.log("Running horizon calibration ...");
  const horizon = calibrateHorizons(signals, resolver);
  console.log("Running score weight sweep ...");
  const sweep = runScoreWeightSweep(signals, resolver);
  console.log("Running sectorLeader tightening sweep ...");
  const sectorLeader = tuneSectorLeader({
    signals,
    resolver,
    sectorSnapshotsByDate,
    metas,
  });
  console.log("Running firstBreakout gate review ...");
  const firstBreakout = reviewFirstBreakoutGates({
    metas,
    barsBySymbol: allBars,
    sectorSnapshotsByDate,
    maxDates: args.maxDates ?? 250,
  });

  const md = renderHorizonReport({
    source: args.source,
    totalSignals: signals.length,
    signalsWithComponents: signalsWithComponents.length,
    horizon,
    sweep,
    sectorLeader,
    firstBreakout,
  });

  if (!fs.existsSync(PATHS.reportsDir))
    fs.mkdirSync(PATHS.reportsDir, { recursive: true });
  const outPath = path.join(PATHS.reportsDir, "horizon-calibration-report.md");
  fs.writeFileSync(outPath, md, "utf8");
  console.log(`\nDone. Report: ${outPath}`);
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
