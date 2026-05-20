// build_local_sectors.ts — generate per-date sector snapshots from the
// cached BaoStock universe (or any compatible local adapter cache).
//
// Output: data/{provider}/sectors/{date}.json  (one file per trading day)
//
// Usage:
//   tsx scripts/build_local_sectors.ts --source baostockLocal

import fs from "node:fs";
import path from "node:path";
import { PATHS } from "@/lib/store/paths";
import { createAkshareLocalAdapter } from "@/lib/data/adapters/akshareLocalAdapter";
import { createBaostockLocalAdapter } from "@/lib/data/adapters/baostockLocalAdapter";
import type { DataAdapter, DataSourceId } from "@/lib/data/adapters";
import { buildLocalSectors, type SectorMetaInput } from "@/lib/engine/localSectorBuilder";

interface CliArgs {
  source: DataSourceId;
  minMembers: number;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { source: "baostockLocal", minMembers: 3 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--source") args.source = argv[++i] as DataSourceId;
    else if (a === "--min-members") args.minMembers = Number(argv[++i]);
    else if (a === "--help" || a === "-h") {
      console.log(
        "Usage: tsx scripts/build_local_sectors.ts --source <baostockLocal|akshareLocal> [--min-members 3]",
      );
      process.exit(0);
    }
  }
  return args;
}

function providerBaseDir(source: DataSourceId): string {
  if (source === "akshareLocal") return PATHS.akshareDir;
  if (source === "baostockLocal") return PATHS.baostockDir;
  throw new Error(`Unsupported source for build_local_sectors: ${source}`);
}

function adapterFor(source: DataSourceId): DataAdapter {
  if (source === "akshareLocal") return createAkshareLocalAdapter();
  if (source === "baostockLocal") return createBaostockLocalAdapter();
  throw new Error(`Unsupported source: ${source}`);
}

interface MetadataStock extends SectorMetaInput {
  name?: string;
}

interface MetadataFile {
  stocks?: MetadataStock[];
}

function loadMetadata(baseDir: string): MetadataStock[] {
  const p = path.join(baseDir, "metadata", "stocks.json");
  if (!fs.existsSync(p)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(p, "utf8")) as MetadataFile;
    return Array.isArray(parsed.stocks) ? parsed.stocks : [];
  } catch (err) {
    console.error(`Failed to parse ${p}: ${(err as Error).message}`);
    return [];
  }
}

function atomicWriteJson(path_: string, data: unknown): void {
  fs.mkdirSync(path.dirname(path_), { recursive: true });
  const tmp = path_ + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(tmp, path_);
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  console.log(`Building local sectors for source=${args.source}`);

  const baseDir = providerBaseDir(args.source);
  const adapter = adapterFor(args.source);
  const cacheMetas = await adapter.getStockMetas();
  if (cacheMetas.length === 0) {
    console.error(`No symbols in ${args.source} cache.`);
    return 2;
  }
  const all = await adapter.getDailyBarsForUniverse(
    cacheMetas.map((m) => m.symbol),
    "1900-01-01",
    "9999-12-31",
  );

  const md = loadMetadata(baseDir);
  const metaBySymbol = new Map<string, MetadataStock>();
  for (const m of md) metaBySymbol.set(m.symbol, m);

  const metas: SectorMetaInput[] = cacheMetas.map((m) => {
    const mm = metaBySymbol.get(m.symbol);
    return {
      symbol: m.symbol,
      industry: mm?.industry ?? "",
      syntheticBoardGroup: mm?.syntheticBoardGroup ?? `BOARD_${m.boardType}`,
      syntheticPrefixGroup:
        mm?.syntheticPrefixGroup ?? `PREFIX_${m.symbol.slice(0, 3)}`,
      boardType: m.boardType,
    };
  });

  console.log(
    `Universe: ${cacheMetas.length} symbols; metadata entries: ${md.length}; min members per group: ${args.minMembers}`,
  );

  const result = buildLocalSectors({
    metas,
    barsBySymbol: all,
    config: { minMembers: args.minMembers },
  });

  const outDir = path.join(baseDir, "sectors");
  fs.mkdirSync(outDir, { recursive: true });

  // Clean only files this run will overwrite to avoid stale snapshots from
  // a smaller cache run. We only wipe local-builder files (suffix matches).
  const written: string[] = [];
  for (const [date, snapshots] of result.byDate) {
    const filePath = path.join(outDir, `${date}.json`);
    atomicWriteJson(filePath, {
      source: "localSectorBuilder",
      date,
      fetchedAt: new Date().toISOString(),
      industryCount: snapshots.filter((s) => s.sectorType === "INDUSTRY").length,
      boardCount: snapshots.filter((s) => s.sectorType === "BOARD").length,
      prefixCount: snapshots.filter((s) => s.sectorType === "PREFIX").length,
      warnings: [],
      snapshots,
    });
    written.push(filePath);
  }

  console.log(
    `Wrote ${written.length} sector files (${result.totalGroups} group rows total) → ${outDir}`,
  );
  if (result.warnings.length > 0) {
    const head = result.warnings.slice(0, 5);
    console.log(`Warnings (${result.warnings.length} total, showing ${head.length}):`);
    for (const w of head) console.log(`  - ${w}`);
  }

  // Pretty per-type sample on the last date.
  if (result.datesCovered.length > 0) {
    const latest = result.datesCovered[result.datesCovered.length - 1];
    const snaps = result.byDate.get(latest) ?? [];
    const sample = snaps.slice(0, 8);
    console.log(`\nTop sectors on ${latest}:`);
    for (const s of sample) {
      console.log(
        `  #${s.strengthRank} ${s.sectorType.padEnd(8)} ${s.sectorName.padEnd(28)} ` +
          `members=${s.memberCount} pct=${s.pctChange.toFixed(2)}% momentum=${s.momentumScore}`,
      );
    }
  }
  return 0;
}

main()
  .then((c) => process.exit(c))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
