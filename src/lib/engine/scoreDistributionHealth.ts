// Score distribution health diagnostic (v1.8).
//
// Surfaces score-bucket population, whether the 80+ buckets are populated,
// whether score compression persists, and (if context is available) the
// distribution of `sectorScoreMode` across signals.
//
// Used by the calibration report and the /validation page to answer the
// v1.8 question: "did real / generated sector context actually decompress
// the score distribution?"

import type { HistoricalSignalRecord } from "@/lib/engine/scoreCalibration";

export interface ScoreDistributionHealthInput {
  signals: HistoricalSignalRecord[];
  /** Optional adapter-level mode echoed alongside the distribution. */
  sectorMode?: "REAL" | "GENERATED" | "FALLBACK" | "MISSING";
  sentimentMode?: "REAL" | "GENERATED" | "FALLBACK" | "MISSING";
  metadataMode?: "REAL" | "GENERATED" | "FALLBACK" | "MISSING";
  /** v1.7 baseline distribution; rendered alongside the current one. */
  previousBucketCounts?: Record<string, number>;
}

export interface ScoreDistributionHealth {
  bucketCounts: Record<string, number>;
  bucket90to100Populated: boolean;
  bucket80to90Populated: boolean;
  bucket70to80Populated: boolean;
  /** Compression = entire 80-100 range is empty AND signal count ≥ 50. */
  compressionDetected: boolean;
  /** Compression = entire 70+ range is empty AND signal count ≥ 50. */
  severeCompressionDetected: boolean;
  averageScore: number;
  medianScore: number;
  /** Echoed from input for the report. */
  sectorMode?: "REAL" | "GENERATED" | "FALLBACK" | "MISSING";
  sentimentMode?: "REAL" | "GENERATED" | "FALLBACK" | "MISSING";
  metadataMode?: "REAL" | "GENERATED" | "FALLBACK" | "MISSING";
  previousBucketCounts?: Record<string, number>;
  /** Set when bucket-coverage improves between previous and current. */
  improvementNote?: string;
}

const BUCKETS = ["90-100", "80-90", "70-80", "60-70", "<60"] as const;

function bucketFor(score: number): typeof BUCKETS[number] {
  if (score >= 90) return "90-100";
  if (score >= 80) return "80-90";
  if (score >= 70) return "70-80";
  if (score >= 60) return "60-70";
  return "<60";
}

function median(xs: number[]): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
}

export function buildScoreDistributionHealth(
  input: ScoreDistributionHealthInput,
): ScoreDistributionHealth {
  const counts: Record<string, number> = Object.fromEntries(BUCKETS.map((b) => [b, 0]));
  const scores: number[] = [];
  for (const s of input.signals) {
    counts[bucketFor(s.score)] += 1;
    scores.push(s.score);
  }
  const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : NaN;
  const med = median(scores);
  const has90 = counts["90-100"] > 0;
  const has80 = counts["80-90"] > 0;
  const has70 = counts["70-80"] > 0;
  const totalSignals = scores.length;

  const compressionDetected = totalSignals >= 50 && !has90 && !has80;
  const severeCompression = totalSignals >= 50 && !has90 && !has80 && !has70;

  let improvementNote: string | undefined;
  const prev = input.previousBucketCounts;
  if (prev) {
    const prev80 = (prev["80-90"] ?? 0) + (prev["90-100"] ?? 0);
    const cur80 = counts["80-90"] + counts["90-100"];
    const prev70 = prev80 + (prev["70-80"] ?? 0);
    const cur70 = cur80 + counts["70-80"];
    if (prev80 === 0 && cur80 > 0) {
      improvementNote = `80+ buckets now populated (${cur80} signals); they were empty before.`;
    } else if (cur80 > prev80) {
      improvementNote = `80+ bucket grew from ${prev80} → ${cur80}.`;
    } else if (cur70 > prev70 && prev70 < 100) {
      improvementNote = `70+ bucket grew from ${prev70} → ${cur70}.`;
    } else if (cur80 < prev80) {
      improvementNote = `⚠ 80+ bucket shrank from ${prev80} → ${cur80}.`;
    }
  }

  return {
    bucketCounts: counts,
    bucket90to100Populated: has90,
    bucket80to90Populated: has80,
    bucket70to80Populated: has70,
    compressionDetected,
    severeCompressionDetected: severeCompression,
    averageScore: scores.length ? +avg.toFixed(2) : NaN,
    medianScore: scores.length ? +med.toFixed(2) : NaN,
    sectorMode: input.sectorMode,
    sentimentMode: input.sentimentMode,
    metadataMode: input.metadataMode,
    previousBucketCounts: prev,
    improvementNote,
  };
}

export function renderScoreDistributionHealthMarkdown(
  d: ScoreDistributionHealth,
): string {
  const lines: string[] = [];
  lines.push("");
  lines.push("Distribution stats: " +
    `avg=${Number.isNaN(d.averageScore) ? "—" : d.averageScore} · ` +
    `median=${Number.isNaN(d.medianScore) ? "—" : d.medianScore}`);
  lines.push("");
  lines.push("| Bucket | Current | Previous |");
  lines.push("|---|---:|---:|");
  for (const b of BUCKETS) {
    const cur = d.bucketCounts[b] ?? 0;
    const prev = d.previousBucketCounts?.[b];
    lines.push(`| ${b} | ${cur} | ${prev ?? "—"} |`);
  }
  lines.push("");
  lines.push(`- 70-80 populated: **${d.bucket70to80Populated ? "yes" : "no"}**`);
  lines.push(`- 80-90 populated: **${d.bucket80to90Populated ? "yes" : "no"}**`);
  lines.push(`- 90-100 populated: **${d.bucket90to100Populated ? "yes" : "no"}**`);
  lines.push(`- Compression (80+ empty, n≥50): **${d.compressionDetected ? "DETECTED" : "no"}**`);
  if (d.severeCompressionDetected) {
    lines.push(`- Severe compression (70+ empty, n≥50): **DETECTED**`);
  }
  if (d.sectorMode || d.sentimentMode || d.metadataMode) {
    lines.push("");
    lines.push(
      `Context modes — sector=**${d.sectorMode ?? "—"}**, ` +
        `sentiment=**${d.sentimentMode ?? "—"}**, ` +
        `metadata=**${d.metadataMode ?? "—"}**`,
    );
  }
  if (d.improvementNote) {
    lines.push("");
    lines.push(`> ${d.improvementNote}`);
  }
  return lines.join("\n");
}
