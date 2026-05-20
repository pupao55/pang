// build_sentiment.ts — generate data/{provider}/sentiment/sentiment.jsonl from
// cached daily bars. Pure TypeScript; no network calls.

import fs from "node:fs";
import path from "node:path";
import { PATHS } from "@/lib/store/paths";
import { createAkshareLocalAdapter } from "@/lib/data/adapters/akshareLocalAdapter";
import { createBaostockLocalAdapter } from "@/lib/data/adapters/baostockLocalAdapter";
import type { DataAdapter, DataSourceId } from "@/lib/data/adapters";
import { buildMarketSentiment } from "@/lib/engine/marketSentimentBuilder";

function parseSource(argv: string[]): DataSourceId {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--source") return argv[i + 1] as DataSourceId;
  }
  return "akshareLocal";
}

function adapterFor(source: DataSourceId): DataAdapter {
  if (source === "akshareLocal") return createAkshareLocalAdapter();
  if (source === "baostockLocal") return createBaostockLocalAdapter();
  throw new Error(`build_sentiment requires --source akshareLocal | baostockLocal (got ${source})`);
}

function outDirFor(source: DataSourceId): string {
  if (source === "akshareLocal") return path.join(PATHS.akshareDir, "sentiment");
  if (source === "baostockLocal") return path.join(PATHS.baostockDir, "sentiment");
  throw new Error(`No sentiment directory for source ${source}`);
}

async function main(): Promise<number> {
  const source = parseSource(process.argv.slice(2));
  const adapter = adapterFor(source);
  const metas = await adapter.getStockMetas();
  if (metas.length === 0) {
    console.error(`No symbols in ${source} cache.`);
    return 2;
  }
  const all = await adapter.getDailyBarsForUniverse(
    metas.map((m) => m.symbol),
    "1900-01-01",
    "9999-12-31",
  );
  console.log(`Building sentiment from ${metas.length} symbols (source=${source})`);

  const snapshots = buildMarketSentiment({ metas, barsBySymbol: all });
  console.log(`Generated ${snapshots.length} per-date sentiment snapshots`);

  const dir = outDirFor(source);
  fs.mkdirSync(dir, { recursive: true });
  const outFile = path.join(dir, "sentiment.jsonl");
  const tmp = outFile + ".tmp";
  fs.writeFileSync(tmp, snapshots.map((s) => JSON.stringify(s)).join("\n") + "\n", "utf8");
  fs.renameSync(tmp, outFile);
  console.log(`Wrote ${snapshots.length} records → ${outFile}`);

  const counts: Record<string, number> = {};
  for (const s of snapshots) counts[s.marketRegime] = (counts[s.marketRegime] ?? 0) + 1;
  console.log("Regime distribution:");
  for (const [k, v] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(8)}  ${v}`);
  }
  return 0;
}

main()
  .then((c) => process.exit(c))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
