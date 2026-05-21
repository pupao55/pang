#!/usr/bin/env node
// check-data-policy.mjs — enforce D-007 (no large provider caches in repo).
//
// Run with: `npm run check:data-policy`.
//
// The script scans:
//   - every file currently tracked by git (via `git ls-files`)
//   - every file added in the index (via `git diff --cached --name-only --diff-filter=A`)
// and flags any path that:
//   1. matches a "not allowed" pattern (provider caches, generated reports,
//      persistent signal store), OR
//   2. exceeds the 1 MB size cap, unless it lives under data/fixtures/.
//
// Exit codes:
//   0 — clean
//   1 — at least one violation
//
// IMPORTANT: violations are reported but never auto-deleted. The script's
// job is to make the issue loud; the human runs the suggested `git rm
// --cached` follow-up after reading reports/data-cache-audit.md.

import { execFileSync } from "node:child_process";
import { statSync, existsSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MAX_BYTES = 1024 * 1024; // 1 MB

// Patterns that should never be tracked. Order matters only for nicer error
// messages — the predicate is "any pattern matches".
const FORBIDDEN_PATTERNS = [
  {
    re: /^data\/baostock\/daily-bars\/.+\.json$/,
    why: "BaoStock daily-bar cache — regenerable via npm run fetch:baostock:*",
  },
  {
    re: /^data\/baostock\/sectors\/.+\.json$/,
    why: "Generated sector snapshot — regenerable via npm run build:sectors:baostock",
  },
  {
    re: /^data\/baostock\/sentiment\/sentiment\.jsonl$/,
    why: "Sentiment snapshot — regenerable via npm run build:sentiment",
  },
  {
    re: /^data\/baostock\/metadata\/stocks\.json$/,
    why: "Universe metadata — regenerable via npm run fetch:baostock:metadata",
  },
  {
    re: /^data\/baostock\/(import-report|fetch-status)\.json$/,
    why: "Run snapshot — regenerable by the fetcher",
  },
  {
    re: /^data\/baostock\/fetch-runs\/.+\.json$/,
    why: "Per-run audit log — regenerable by the fetcher",
  },
  {
    re: /^data\/akshare\/daily-bars\/.+\.json$/,
    why: "AkShare daily-bar cache — regenerable via npm run fetch:akshare:*",
  },
  {
    re: /^data\/akshare\/sectors\/.+\.json$/,
    why: "AkShare sector snapshot — regenerable via npm run fetch:sectors",
  },
  {
    re: /^data\/akshare\/sentiment\/sentiment\.jsonl$/,
    why: "AkShare sentiment — regenerable via npm run build:sentiment",
  },
  {
    re: /^data\/akshare\/trading-calendar\.json$/,
    why: "Trading calendar — regenerable via npm run fetch:calendar",
  },
  {
    re: /^data\/akshare\/(import-report|fetch-status)\.json$/,
    why: "Run snapshot — regenerable by the fetcher",
  },
  {
    re: /^data\/akshare\/fetch-runs\/.+\.json$/,
    why: "Per-run audit log — regenerable by the fetcher",
  },
  {
    re: /^data\/signals\/.+\/.+\.(jsonl|json)$/,
    why: "Persistent signal store — regenerable via npm run rebuild:signals",
  },
  {
    re: /^reports\/(?!\.gitkeep$).+\.(md|json|jsonl)$/,
    why: "Generated report — regenerable via npm run validate:* / calibrate:*",
  },
];

const FIXTURE_EXEMPT = /^data\/fixtures\//;

function lsFiles(args) {
  try {
    return execFileSync("git", ["ls-files", ...args], {
      cwd: ROOT,
      encoding: "utf8",
    })
      .split("\n")
      .filter(Boolean);
  } catch {
    return [];
  }
}

function stagedAdditions() {
  try {
    return execFileSync(
      "git",
      ["diff", "--cached", "--name-only", "--diff-filter=A"],
      { cwd: ROOT, encoding: "utf8" },
    )
      .split("\n")
      .filter(Boolean);
  } catch {
    return [];
  }
}

function fileSize(rel) {
  const abs = join(ROOT, rel);
  if (!existsSync(abs)) return null;
  try {
    return statSync(abs).size;
  } catch {
    return null;
  }
}

function classify(rel) {
  const violations = [];

  // Pattern check (provider caches, reports, signal store)
  for (const p of FORBIDDEN_PATTERNS) {
    if (p.re.test(rel)) {
      violations.push({ kind: "forbidden-pattern", why: p.why });
      break;
    }
  }

  // Size check (anywhere under data/ or reports/, except fixtures)
  if (!FIXTURE_EXEMPT.test(rel)) {
    if (rel.startsWith("data/") || rel.startsWith("reports/")) {
      const size = fileSize(rel);
      if (size !== null && size > MAX_BYTES) {
        violations.push({
          kind: "size-cap",
          why: `${(size / 1024 / 1024).toFixed(2)} MB > 1 MB cap`,
        });
      }
    }
  }

  return violations;
}

function suggested(rel) {
  // Tracked → suggest git rm --cached. Staged-but-untracked-prior → suggest unstage.
  // We don't always know which state a path is in, so suggest both.
  return [
    `  git rm --cached "${rel}"`,
    `  # if staged but not yet committed:`,
    `  git reset HEAD "${rel}"`,
  ].join("\n");
}

function main() {
  const tracked = new Set(lsFiles(["data", "reports"]));
  for (const f of stagedAdditions()) tracked.add(f);

  const offenders = [];
  for (const rel of tracked) {
    const v = classify(rel);
    if (v.length > 0) {
      offenders.push({ rel, violations: v, size: fileSize(rel) });
    }
  }

  console.log(`Pangzi data-policy check — root=${relative(process.cwd(), ROOT) || "."}`);
  console.log(`  scanned: ${tracked.size} tracked files under data/ + reports/`);

  if (offenders.length === 0) {
    console.log(`\nOK — no data-policy violations.`);
    process.exit(0);
  }

  // Group offenders by violation pattern for compact output.
  const byWhy = new Map();
  for (const o of offenders) {
    for (const v of o.violations) {
      const k = `[${v.kind}] ${v.why}`;
      let arr = byWhy.get(k);
      if (!arr) {
        arr = [];
        byWhy.set(k, arr);
      }
      arr.push(o);
    }
  }

  console.log(`\nFAIL — ${offenders.length} file(s) violate the data policy.\n`);
  for (const [why, files] of byWhy.entries()) {
    console.log(why);
    // Show up to 5 examples per category, then a summary count.
    const head = files.slice(0, 5);
    for (const f of head) {
      const sz = f.size !== null ? ` (${(f.size / 1024).toFixed(1)} KB)` : "";
      console.log(`  ${f.rel}${sz}`);
    }
    if (files.length > head.length) {
      console.log(`  …and ${files.length - head.length} more`);
    }
    console.log("");
  }

  console.log(`See reports/data-cache-audit.md for the full inventory.`);
  console.log(`Suggested non-destructive cleanup (run only with user approval):`);
  console.log(`  git rm --cached -r data/baostock/daily-bars/`);
  console.log(`  git rm --cached -r data/baostock/sectors/`);
  console.log(`  git rm --cached data/baostock/sentiment/sentiment.jsonl`);
  console.log(`  git rm --cached data/baostock/metadata/stocks.json`);
  console.log(`  git rm --cached data/baostock/import-report.json`);
  console.log(`  git rm --cached data/baostock/fetch-status.json`);
  console.log(`  git rm --cached -r data/baostock/fetch-runs/`);
  console.log(`  git rm --cached -r data/akshare/sectors/`);
  console.log(`  git rm --cached data/akshare/sentiment/sentiment.jsonl`);
  console.log(`  git rm --cached data/akshare/trading-calendar.json`);
  console.log(`  git rm --cached data/akshare/fetch-status.json`);
  console.log(`  git rm --cached -r data/akshare/fetch-runs/`);
  console.log(`  git rm --cached reports/baostockLocal-score-buckets.json`);
  console.log(`  git commit -m "untrack bulk provider caches per D-007"`);
  process.exit(1);
}

main();
