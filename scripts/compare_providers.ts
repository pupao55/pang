// compare_providers.ts — compare one symbol's daily bars between two
// providers. Writes reports/provider-comparison-{symbol}.md.
//
// Usage:
//   tsx scripts/compare_providers.ts --symbol 300750.SZ --providers akshareLocal,baostockLocal

import fs from "node:fs";
import path from "node:path";
import { PATHS } from "@/lib/store/paths";
import { createAkshareLocalAdapter } from "@/lib/data/adapters/akshareLocalAdapter";
import { createBaostockLocalAdapter } from "@/lib/data/adapters/baostockLocalAdapter";
import type { DataAdapter, DataSourceId } from "@/lib/data/adapters";
import { compareBars, renderCompareReport } from "@/lib/data/providers/compare";

interface CliArgs {
  symbol: string;
  providers: DataSourceId[];
}

function parseArgs(argv: string[]): CliArgs {
  let symbol = "";
  let providers: DataSourceId[] = ["akshareLocal", "baostockLocal"];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--symbol") symbol = argv[++i];
    else if (a === "--providers")
      providers = argv[++i].split(",").map((s) => s.trim() as DataSourceId);
    else if (a === "--help" || a === "-h") {
      console.log(
        "Usage: tsx scripts/compare_providers.ts --symbol <SYMBOL> [--providers akshareLocal,baostockLocal]",
      );
      process.exit(0);
    }
  }
  return { symbol, providers };
}

function adapterFor(source: DataSourceId): DataAdapter {
  if (source === "akshareLocal") return createAkshareLocalAdapter();
  if (source === "baostockLocal") return createBaostockLocalAdapter();
  throw new Error(`compare_providers does not support source ${source}`);
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.symbol) {
    console.error("--symbol is required");
    return 2;
  }
  if (args.providers.length !== 2) {
    console.error("--providers must list exactly two sources, comma-separated.");
    return 2;
  }
  const [a, b] = args.providers;
  const adapterA = adapterFor(a);
  const adapterB = adapterFor(b);
  const barsA = await adapterA.getDailyBars(args.symbol, "1900-01-01", "9999-12-31");
  const barsB = await adapterB.getDailyBars(args.symbol, "1900-01-01", "9999-12-31");
  if (barsA.length === 0 && barsB.length === 0) {
    console.error(`Neither ${a} nor ${b} has bars for ${args.symbol}.`);
    return 2;
  }
  const result = compareBars(args.symbol, a, barsA, b, barsB);

  if (!fs.existsSync(PATHS.reportsDir)) fs.mkdirSync(PATHS.reportsDir, { recursive: true });
  const outPath = path.join(PATHS.reportsDir, `provider-comparison-${args.symbol}.md`);
  fs.writeFileSync(outPath, renderCompareReport(result), "utf8");
  console.log(`Wrote ${outPath}`);

  console.log("");
  console.log(`Symbol: ${result.symbol}`);
  console.log(`  ${a} bars=${result.countA}  vs  ${b} bars=${result.countB}  overlap=${result.overlapCount}`);
  console.log(`  mean |close diff|: ${result.meanAbsCloseDiffPct.toFixed(3)}%  max: ${result.maxAbsCloseDiffPct.toFixed(3)}%`);
  console.log(`  mean |pctChange diff|: ${result.meanAbsPctChangeDiff.toFixed(3)}pp`);
  if (result.likelyAdjustmentMismatch) {
    console.log("  ⚠ Likely adjustment mismatch (mean close diff > 2%).");
  }
  return 0;
}

main()
  .then((c) => process.exit(c))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
