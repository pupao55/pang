// provider_fetch_campaign.ts — inspect each provider's local cache + status
// and produce reports/provider-fetch-campaign-report.md with the next
// recommended command. v1.7 covers akshareLocal + baostockLocal; tushare
// and live AkShare are documented but not actively probed.

import fs from "node:fs";
import path from "node:path";
import { PATHS } from "@/lib/store/paths";
import {
  getAkshareLocalCacheStatus,
  readAkshareFetchStatus,
  readAkshareImportReport,
} from "@/lib/data/adapters/akshareLocalAdapter";
import {
  getBaostockLocalCacheStatus,
  readBaostockFetchStatus,
  readBaostockImportReport,
} from "@/lib/data/adapters/baostockLocalAdapter";
import {
  recommendProvider,
  type ProviderSnapshot as BaseProviderSnapshot,
} from "@/lib/data/providers/recommend";

interface ProviderSnapshot extends BaseProviderSnapshot {
  notes: string[];
}

function snapshotAkshare(): ProviderSnapshot {
  const cache = getAkshareLocalCacheStatus();
  const fs_ = readAkshareFetchStatus();
  const ir = readAkshareImportReport();
  const notes: string[] = [];
  if (!cache.ok && cache.reason) notes.push(cache.reason);
  if (fs_ && fs_.failed > 0)
    notes.push(`${fs_.failed} symbols in FAILED — eastmoney upstream may be throttling.`);
  if (!fs_) notes.push("No fetch-status.json yet — try `npm run fetch:akshare:sample:slow`.");
  return {
    providerId: "akshareLocal",
    cacheOk: cache.ok,
    symbolCount: cache.symbolCount,
    succeeded: fs_?.succeeded ?? (ir?.totalSymbolsSucceeded ?? 0),
    failed: fs_?.failed ?? (ir?.totalSymbolsFailed ?? 0),
    empty: fs_?.empty ?? (ir?.totalSymbolsEmpty ?? 0),
    skipped: fs_?.skipped ?? 0,
    lastUpdatedAt: fs_?.updatedAt ?? ir?.lastUpdatedAt,
    notes,
  };
}

function snapshotBaostock(): ProviderSnapshot {
  const cache = getBaostockLocalCacheStatus();
  const fs_ = readBaostockFetchStatus();
  const ir = readBaostockImportReport();
  const notes: string[] = [];
  if (!cache.ok && cache.reason) notes.push(cache.reason);
  if (!fs_) notes.push("No BaoStock fetch-status.json yet — try `npm run fetch:baostock:sample`.");
  return {
    providerId: "baostockLocal",
    cacheOk: cache.ok,
    symbolCount: cache.symbolCount,
    succeeded: fs_?.succeeded ?? (ir?.totalSymbolsSucceeded ?? 0),
    failed: fs_?.failed ?? (ir?.totalSymbolsFailed ?? 0),
    empty: fs_?.empty ?? (ir?.totalSymbolsEmpty ?? 0),
    skipped: fs_?.skipped ?? 0,
    lastUpdatedAt: fs_?.updatedAt ?? ir?.lastUpdatedAt,
    notes,
  };
}

// Recommendation logic lives in src/lib/data/providers/recommend.ts so tests
// can drive it without spawning this script.

function render(akshare: ProviderSnapshot, baostock: ProviderSnapshot): string {
  const rec = recommendProvider(akshare, baostock);
  const lines: string[] = [];
  lines.push("# Pangzi provider fetch campaign report");
  lines.push("");
  lines.push(`Generated ${new Date().toISOString()}.`);
  lines.push("");
  lines.push("## Provider snapshots");
  lines.push("");
  lines.push("| Provider | Cache | Symbols | OK | Failed | Empty | Skipped | Updated |");
  lines.push("|---|:-:|---:|---:|---:|---:|---:|---|");
  for (const s of [akshare, baostock]) {
    lines.push(
      `| ${s.providerId} | ${s.cacheOk ? "✅" : "—"} | ${s.symbolCount} | ` +
        `${s.succeeded} | ${s.failed} | ${s.empty} | ${s.skipped} | ${s.lastUpdatedAt ?? "—"} |`,
    );
  }
  lines.push("");
  for (const s of [akshare, baostock]) {
    if (s.notes.length === 0) continue;
    lines.push(`### ${s.providerId} notes`);
    lines.push("");
    for (const n of s.notes) lines.push(`- ${n}`);
    lines.push("");
  }
  lines.push("## Recommendation");
  lines.push("");
  lines.push(`- **Use:** \`${rec.provider}\``);
  lines.push(`- **Why:** ${rec.rationale}`);
  lines.push(`- **Next command:**`);
  lines.push("");
  lines.push("```bash");
  lines.push(rec.command);
  lines.push("```");
  lines.push("");
  lines.push("## Notes");
  lines.push("");
  lines.push(
    "- BaoStock and AkShare/Eastmoney use independent upstreams, so an IP-level block on " +
      "Eastmoney does not prevent BaoStock fetches.",
  );
  lines.push(
    "- Always run `npm run compare:providers -- --symbol <symbol>` before mixing data " +
      "from both providers in the same calibration run; adjusted prices may differ.",
  );
  return lines.join("\n");
}

function main(): number {
  const akshare = snapshotAkshare();
  const baostock = snapshotBaostock();
  const md = render(akshare, baostock);
  if (!fs.existsSync(PATHS.reportsDir)) fs.mkdirSync(PATHS.reportsDir, { recursive: true });
  const outPath = path.join(PATHS.reportsDir, "provider-fetch-campaign-report.md");
  fs.writeFileSync(outPath, md, "utf8");
  console.log(`Wrote ${outPath}`);

  const rec = recommendProvider(akshare, baostock);
  console.log("");
  console.log("Provider snapshots:");
  console.log(
    `  akshareLocal  cache=${akshare.cacheOk}  symbols=${akshare.symbolCount}  failed=${akshare.failed}`,
  );
  console.log(
    `  baostockLocal cache=${baostock.cacheOk} symbols=${baostock.symbolCount} failed=${baostock.failed}`,
  );
  console.log("");
  console.log(`Recommendation: use ${rec.provider}`);
  console.log(`  ${rec.rationale}`);
  console.log(`  next: ${rec.command}`);
  return 0;
}

try {
  process.exit(main());
} catch (err) {
  console.error(err);
  process.exit(1);
}
