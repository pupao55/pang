// check_cache_maturity.ts — assess research-readiness of the AkShare cache.
//
// Usage:
//   tsx scripts/check_cache_maturity.ts --source akshareLocal
//
// Writes reports/cache-maturity-report.md and prints a one-line verdict.

import fs from "node:fs";
import path from "node:path";
import { createMockAdapter } from "@/lib/data/adapters/mockAdapter";
import {
  createAkshareLocalAdapter,
  readAkshareFetchStatus,
  readAkshareImportReport,
} from "@/lib/data/adapters/akshareLocalAdapter";
import {
  createBaostockLocalAdapter,
  readBaostockFetchStatus,
  readBaostockImportReport,
} from "@/lib/data/adapters/baostockLocalAdapter";
import type { DataAdapter, DataSourceId } from "@/lib/data/adapters";
import { PATHS } from "@/lib/store/paths";
import { readSignalStore } from "@/lib/store/signalStore";
import { buildCacheMaturityReport } from "@/lib/engine/cacheMaturity";
import { renderCacheMaturityReport } from "@/lib/reports/cacheMaturityReport";

interface CliArgs {
  source: DataSourceId;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { source: "akshareLocal" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--source") args.source = argv[++i] as DataSourceId;
    if (a === "--help" || a === "-h") {
      console.log(
        "Usage: tsx scripts/check_cache_maturity.ts [--source <mock|akshareLocal>]",
      );
      process.exit(0);
    }
  }
  return args;
}

function loadTradingCalendar(): string[] | undefined {
  const p = path.join(PATHS.akshareDir, "trading-calendar.json");
  if (!fs.existsSync(p)) return undefined;
  try {
    const parsed = JSON.parse(fs.readFileSync(p, "utf8")) as { dates: string[] };
    return Array.isArray(parsed.dates) ? parsed.dates : undefined;
  } catch {
    return undefined;
  }
}

function createAdapter(source: DataSourceId): DataAdapter {
  if (source === "mock") return createMockAdapter();
  if (source === "akshareLocal") return createAkshareLocalAdapter();
  if (source === "baostockLocal") return createBaostockLocalAdapter();
  throw new Error(`Unknown source: ${source}`);
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  console.log(`Pangzi check_cache_maturity — source=${args.source}`);

  let adapter: DataAdapter;
  try {
    adapter = createAdapter(args.source);
  } catch (err) {
    console.error((err as Error).message);
    return 2;
  }

  const metas = await adapter.getStockMetas();
  const barsBySymbol = await adapter.getDailyBarsForUniverse(
    metas.map((m) => m.symbol),
    "1900-01-01",
    "9999-12-31",
  );
  const signals = readSignalStore(args.source);
  const fetchStatus =
    args.source === "akshareLocal"
      ? readAkshareFetchStatus()
      : args.source === "baostockLocal"
      ? readBaostockFetchStatus()
      : null;
  const importReport =
    args.source === "akshareLocal"
      ? readAkshareImportReport()
      : args.source === "baostockLocal"
      ? readBaostockImportReport()
      : null;
  // Trading calendar is shared (AkShare's calendar fetcher writes it once).
  const calendar = args.source !== "mock" ? loadTradingCalendar() : undefined;

  // Pull context modes from the adapter when available.
  const akAdapter = "metadataMode" in adapter
    ? (adapter as ReturnType<typeof createAkshareLocalAdapter>)
    : undefined;

  const report = buildCacheMaturityReport({
    metas,
    barsBySymbol,
    signals,
    fetchStatus: fetchStatus ?? undefined,
    importReport: importReport ?? undefined,
    metadataMode: akAdapter?.metadataMode,
    sectorMode: akAdapter?.sectorMode,
    sentimentMode: akAdapter?.sentimentMode,
    tradingCalendarDates: calendar,
    source: args.source,
  });

  if (!fs.existsSync(PATHS.reportsDir)) fs.mkdirSync(PATHS.reportsDir, { recursive: true });
  const outPath = path.join(PATHS.reportsDir, "cache-maturity-report.md");
  const md = renderCacheMaturityReport(report, {
    source: args.source,
    generatedAt: new Date().toISOString(),
  });
  fs.writeFileSync(outPath, md, "utf8");
  console.log(`\nWrote report: ${outPath}`);

  console.log("");
  console.log(`Readiness: ${report.readinessLevel}`);
  console.log(
    `  symbols=${report.symbolCount} totalBars=${report.totalBars} ` +
      `avgBars=${report.averageBarsPerSymbol.toFixed(0)} signals=${signals.length}`,
  );
  if (report.readinessReasons.length > 0) {
    console.log("Reasons:");
    for (const r of report.readinessReasons.slice(0, 5)) console.log(`  - ${r}`);
  }
  if (report.nextActions.length > 0) {
    console.log("Next actions:");
    for (const a of report.nextActions) console.log(`  • ${a}`);
  }
  return 0;
}

main()
  .then((c) => process.exit(c))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
