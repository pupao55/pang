// Centralized filesystem paths for the local data cache and signal store.
// Keep all path knowledge in one place so adapters/scripts/UI agree.

import path from "node:path";

const ROOT = process.cwd();

export const PATHS = {
  root: ROOT,
  dataDir: path.join(ROOT, "data"),
  reportsDir: path.join(ROOT, "reports"),

  akshareDir: path.join(ROOT, "data", "akshare"),
  akshareBarsDir: path.join(ROOT, "data", "akshare", "daily-bars"),
  akshareReport: path.join(ROOT, "data", "akshare", "import-report.json"),

  baostockDir: path.join(ROOT, "data", "baostock"),
  baostockBarsDir: path.join(ROOT, "data", "baostock", "daily-bars"),
  baostockReport: path.join(ROOT, "data", "baostock", "import-report.json"),

  /** Per-provider local-cache base directory (v1.7). */
  providerDir(providerId: string) {
    return path.join(ROOT, "data", providerId.replace(/Local$/, ""));
  },

  signalsDir: path.join(ROOT, "data", "signals"),

  /** Per-source signal-store directory and JSONL file. */
  signalsFor(source: string) {
    const dir = path.join(ROOT, "data", "signals", source);
    return { dir, file: path.join(dir, "signals.jsonl") };
  },

  /** Per-source generated validation report file. */
  reportFor(source: string) {
    return path.join(ROOT, "reports", `${source}-validation-report.md`);
  },
};
