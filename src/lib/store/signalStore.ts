// Append-only historical signal store, one JSONL file per data source.
//
// Layout (relative to baseDir, which defaults to PATHS.signalsDir):
//   {baseDir}/{source}/signals.jsonl
//
// JSONL is chosen over a single JSON array because:
//   - tolerates appends without re-reading/re-serializing the full file
//   - resilient to a partial write (truncated lines can be detected)

import fs from "node:fs";
import path from "node:path";
import { PATHS } from "./paths";
import type { HistoricalSignalRecord } from "@/lib/engine/scoreCalibration";

function resolveDir(source: string, baseDir?: string): string {
  return baseDir ? path.join(baseDir, source) : PATHS.signalsFor(source).dir;
}

export function signalStoreFile(source: string, baseDir?: string): string {
  return path.join(resolveDir(source, baseDir), "signals.jsonl");
}

export function signalStoreExists(source: string, baseDir?: string): boolean {
  return fs.existsSync(signalStoreFile(source, baseDir));
}

export function deleteSignalStore(source: string, baseDir?: string): void {
  const file = signalStoreFile(source, baseDir);
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

export function ensureSignalStoreDir(source: string, baseDir?: string): void {
  const dir = resolveDir(source, baseDir);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export function appendSignals(
  source: string,
  records: HistoricalSignalRecord[],
  baseDir?: string,
): void {
  if (records.length === 0) return;
  ensureSignalStoreDir(source, baseDir);
  const file = signalStoreFile(source, baseDir);
  const lines = records.map((r) => JSON.stringify(r)).join("\n");
  fs.appendFileSync(file, lines + "\n");
}

export function readSignalStore(
  source: string,
  baseDir?: string,
): HistoricalSignalRecord[] {
  const file = signalStoreFile(source, baseDir);
  if (!fs.existsSync(file)) return [];
  const text = fs.readFileSync(file, "utf8");
  const out: HistoricalSignalRecord[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    try {
      out.push(JSON.parse(line) as HistoricalSignalRecord);
    } catch {
      // Skip malformed line (likely a partial write). The next rebuild fixes it.
    }
  }
  return out;
}

export function signalStoreStats(
  source: string,
  baseDir?: string,
): {
  exists: boolean;
  filePath: string;
  recordCount: number;
  firstDate?: string;
  lastDate?: string;
  bySymbol?: Record<string, number>;
} {
  const file = signalStoreFile(source, baseDir);
  if (!fs.existsSync(file)) return { exists: false, filePath: file, recordCount: 0 };
  const recs = readSignalStore(source, baseDir);
  if (recs.length === 0) {
    return { exists: true, filePath: file, recordCount: 0 };
  }
  let first = recs[0].date;
  let last = recs[0].date;
  const bySymbol: Record<string, number> = {};
  for (const r of recs) {
    if (r.date < first) first = r.date;
    if (r.date > last) last = r.date;
    bySymbol[r.symbol] = (bySymbol[r.symbol] ?? 0) + 1;
  }
  return {
    exists: true,
    filePath: file,
    recordCount: recs.length,
    firstDate: first,
    lastDate: last,
    bySymbol,
  };
}
