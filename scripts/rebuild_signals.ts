// rebuild_signals.ts — generate historical signals from a data source and
// append them to the persistent signal store.
//
// Usage:
//   tsx scripts/rebuild_signals.ts --source akshareLocal \
//     [--start-date YYYY-MM-DD] [--end-date YYYY-MM-DD] \
//     [--min-score 60] [--rebuild]
//
// No-overwrite semantics: the script aborts if a signal store already exists
// for the chosen source unless --rebuild is passed. The point is to make
// hindsight rewriting an explicit choice.

import { createMockAdapter } from "@/lib/data/adapters/mockAdapter";
import { createAkshareLocalAdapter } from "@/lib/data/adapters/akshareLocalAdapter";
import { createBaostockLocalAdapter } from "@/lib/data/adapters/baostockLocalAdapter";
import type { DataAdapter, DataSourceId } from "@/lib/data/adapters";
import { runSignalEngine } from "@/lib/engine/signalEngine";
import type { HistoricalSignalRecord } from "@/lib/engine/scoreCalibration";
import {
  appendSignals,
  deleteSignalStore,
  signalStoreExists,
  signalStoreFile,
} from "@/lib/store/signalStore";

interface CliArgs {
  source: DataSourceId;
  startDate?: string;
  endDate?: string;
  minScore: number;
  rebuild: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    source: "akshareLocal",
    minScore: 0,
    rebuild: false,
  };
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
      case "--min-score":
        args.minScore = Number(next());
        break;
      case "--rebuild":
        args.rebuild = true;
        break;
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
      default:
        // ignore unknown flags so npm pass-through `--` works cleanly
        break;
    }
  }
  return args;
}

function printHelp(): void {
  console.log(`Usage: tsx scripts/rebuild_signals.ts [options]

Options:
  --source <mock|akshareLocal|baostockLocal>   Data source (default: akshareLocal)
  --start-date YYYY-MM-DD        Override start date (default: earliest bar)
  --end-date YYYY-MM-DD          Override end date (default: latest bar)
  --min-score <0-100>            Skip signals below this score (default: 0)
  --rebuild                      Wipe existing signal store before rebuilding
  --help                         Show this help`);
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
  console.log(`Pangzi rebuild_signals — source=${args.source}`);

  if (signalStoreExists(args.source) && !args.rebuild) {
    console.error(
      `\nSignal store already exists at ${signalStoreFile(args.source)}.\n` +
        "Refusing to overwrite (this protects against hindsight rewriting).\n" +
        "Pass --rebuild to wipe and regenerate.",
    );
    return 2;
  }
  if (args.rebuild && signalStoreExists(args.source)) {
    deleteSignalStore(args.source);
    console.log(`Wiped existing store at ${signalStoreFile(args.source)}`);
  }

  let adapter: DataAdapter;
  try {
    adapter = createAdapter(args.source);
  } catch (err) {
    console.error(String((err as Error).message));
    return 2;
  }

  const metas = await adapter.getStockMetas();
  if (metas.length === 0) {
    console.error("No stock metas available from adapter — nothing to do.");
    return 1;
  }
  console.log(`Loaded ${metas.length} symbols`);

  // Compute the union date range to walk.
  const earliestPerSymbol: string[] = [];
  const latestPerSymbol: string[] = [];
  for (const m of metas) {
    const bars = await adapter.getDailyBars(m.symbol, "1900-01-01", "9999-12-31");
    if (bars.length === 0) continue;
    earliestPerSymbol.push(bars[0].date);
    latestPerSymbol.push(bars[bars.length - 1].date);
  }
  if (earliestPerSymbol.length === 0) {
    console.error("No bars available; aborting.");
    return 1;
  }
  const dataStart = earliestPerSymbol.sort()[0];
  const dataEnd = latestPerSymbol.sort().reverse()[0];
  const startDate = args.startDate ?? dataStart;
  const endDate = args.endDate ?? dataEnd;
  console.log(`Date range: ${startDate} → ${endDate}`);

  const calendar = await adapter.getTradingCalendar(startDate, endDate);
  console.log(`Walking ${calendar.length} trading days`);

  // Pre-load all bars once (cheaper than re-slicing per day inside the engine).
  const barsBySymbol: Record<string, ReturnType<typeof Object> & object> =
    {} as never;
  const allBars = await adapter.getDailyBarsForUniverse(
    metas.map((m) => m.symbol),
    "1900-01-01",
    "9999-12-31",
  );
  void barsBySymbol;

  let totalSignals = 0;
  // v1.8: probe the adapter for its sectorMode + sentimentMode so the score
  // engine knows whether sector data is REAL / GENERATED / FALLBACK / MISSING.
  const sectorScoreMode =
    "sectorMode" in adapter
      ? ((adapter as unknown as { sectorMode: "REAL" | "GENERATED" | "FALLBACK" | "MISSING" }).sectorMode)
      : "MISSING";

  // Walk every trading day; need at least ~30 bars of history for warm-up.
  // Sectors + sentiment are now resolved PER asOfDate (v1.8) so per-date
  // local sector snapshots actually flow into scoring.
  for (let i = 0; i < calendar.length; i++) {
    const asOfDate = calendar[i];
    const [sectors, sentimentSnap] = await Promise.all([
      adapter.getSectorSnapshots(asOfDate),
      adapter.getMarketSentiment(asOfDate),
    ]);
    const signals = runSignalEngine({
      metas,
      barsBySymbol: allBars,
      sectors,
      sentiment: sentimentSnap,
      asOfDate,
      sectorScoreMode,
    });
    const filtered = signals.filter((s) => s.score >= args.minScore);
    if (filtered.length === 0) continue;
    const records: HistoricalSignalRecord[] = filtered.map((s) => ({
      date: s.date,
      symbol: s.symbol,
      name: s.name,
      strategyId: s.strategyId,
      score: s.score,
      riskLevel: s.riskLevel,
      signalType: s.signalType,
      suggestedAction: s.suggestedAction,
      keySupport: s.keySupport,
      keyResistance: s.keyResistance,
      stopLoss: s.stopLoss,
      target1: s.target1,
      target2: s.target2,
      explanation: s.explanation,
      risks: s.risks,
      // v1.9 — persist component scores so weight sweep can recompute.
      technicalScore: s.technicalScore,
      sectorScore: s.sectorScore,
      sentimentScore: s.sentimentScore,
      liquidityScore: s.liquidityScore,
      fundamentalSafetyScore: s.fundamentalSafetyScore,
      riskPenalty: s.riskPenalty,
    }));
    appendSignals(args.source, records);
    totalSignals += records.length;
    if (i % 10 === 0 || i === calendar.length - 1) {
      console.log(`  ${asOfDate}  +${records.length}  total=${totalSignals}`);
    }
  }

  console.log(
    `\nDone. Wrote ${totalSignals} signal records to ${signalStoreFile(args.source)}`,
  );
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
