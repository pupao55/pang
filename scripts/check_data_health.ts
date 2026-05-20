// check_data_health.ts — scan the AkShare local cache for data quality issues.
//
// Reads:  data/akshare/daily-bars/*.json
// Writes: reports/data-health-report.md
//
// Usage:
//   npm run check:data
//   tsx scripts/check_data_health.ts --cache-dir data/akshare/daily-bars

import fs from "node:fs";
import path from "node:path";
import { PATHS } from "@/lib/store/paths";
import {
  buildDataHealthReport,
  renderDataHealthReportMarkdown,
  type CachedSymbolFile,
  type TradingCalendar,
} from "@/lib/reports/dataHealthReport";

interface CliArgs {
  cacheDir: string;
  outFile: string;
  calendarFile: string;
  source: string;
}

function parseArgs(argv: string[]): CliArgs {
  let source = "akshareLocal";
  let cacheDir = PATHS.akshareBarsDir;
  let outFile = path.join(PATHS.reportsDir, "data-health-report.md");
  let calendarFile = path.join(PATHS.akshareDir, "trading-calendar.json");
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case "--source": {
        source = next();
        if (source === "baostockLocal") {
          cacheDir = PATHS.baostockBarsDir;
          outFile = path.join(PATHS.reportsDir, "baostockLocal-data-health-report.md");
          calendarFile = path.join(PATHS.akshareDir, "trading-calendar.json");
        } else if (source === "akshareLocal") {
          cacheDir = PATHS.akshareBarsDir;
          outFile = path.join(PATHS.reportsDir, "data-health-report.md");
          calendarFile = path.join(PATHS.akshareDir, "trading-calendar.json");
        }
        break;
      }
      case "--cache-dir":
        cacheDir = next();
        break;
      case "--out":
        outFile = next();
        break;
      case "--calendar":
        calendarFile = next();
        break;
      case "--help":
      case "-h":
        console.log(
          "Usage: tsx scripts/check_data_health.ts [--source <akshareLocal|baostockLocal>] [--cache-dir <dir>] [--calendar <file>] [--out <file>]",
        );
        process.exit(0);
    }
  }
  return { cacheDir, outFile, calendarFile, source };
}

function loadCalendar(filePath: string): TradingCalendar | undefined {
  if (!fs.existsSync(filePath)) return undefined;
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as TradingCalendar;
    if (!Array.isArray(parsed.dates)) return undefined;
    return parsed;
  } catch (err) {
    console.error(`Failed to read calendar at ${filePath}: ${(err as Error).message}`);
    return undefined;
  }
}

function readCache(cacheDir: string): CachedSymbolFile[] {
  if (!fs.existsSync(cacheDir)) return [];
  const files: CachedSymbolFile[] = [];
  for (const entry of fs.readdirSync(cacheDir)) {
    if (!entry.endsWith(".json")) continue;
    try {
      const raw = fs.readFileSync(path.join(cacheDir, entry), "utf8");
      const f = JSON.parse(raw) as CachedSymbolFile;
      if (!f.symbol) f.symbol = entry.replace(/\.json$/, "");
      f.bars = Array.isArray(f.bars) ? f.bars : [];
      files.push(f);
    } catch (err) {
      console.error(`Failed to parse ${entry}: ${(err as Error).message}`);
    }
  }
  return files;
}

function main(): number {
  const args = parseArgs(process.argv.slice(2));
  console.log(`Scanning ${args.cacheDir}`);
  const files = readCache(args.cacheDir);
  if (files.length === 0) {
    console.error(
      "No cached JSON files found. Run npm run fetch:akshare:sample first.",
    );
    return 2;
  }
  console.log(`Loaded ${files.length} symbol files`);

  const calendar = loadCalendar(args.calendarFile);
  if (calendar) {
    console.log(`Loaded trading calendar (${calendar.dates.length} dates, source ${calendar.source})`);
  } else {
    console.log("No trading calendar found — using weekday heuristic fallback.");
  }

  const report = buildDataHealthReport(files, { calendar });
  const md = renderDataHealthReportMarkdown(report, {
    source: args.source,
    generatedAt: new Date().toISOString(),
    cachePath: args.cacheDir,
  });

  if (!fs.existsSync(PATHS.reportsDir)) fs.mkdirSync(PATHS.reportsDir, { recursive: true });
  fs.writeFileSync(args.outFile, md, "utf8");
  console.log(`Wrote report: ${args.outFile}`);

  // Console headline.
  console.log("");
  console.log(
    `Symbols: ${report.symbolCount} · bars: ${report.totalBars} · range: ${report.dateRange.start} → ${report.dateRange.end}`,
  );
  if (Object.keys(report.warningCounts).length === 0) {
    console.log("No data-health warnings — cache looks clean.");
  } else {
    console.log("Warning counts:");
    for (const [k, v] of Object.entries(report.warningCounts).sort(
      (a, b) => (b[1] ?? 0) - (a[1] ?? 0),
    )) {
      console.log(`  ${k.padEnd(22)} ${v}`);
    }
  }
  return 0;
}

try {
  process.exit(main());
} catch (err) {
  console.error(err);
  process.exit(1);
}
