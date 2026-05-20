import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  appendSignals,
  deleteSignalStore,
  readSignalStore,
  signalStoreExists,
  signalStoreFile,
} from "@/lib/store/signalStore";

let baseDir: string;

beforeEach(() => {
  baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "pangzi-store-"));
});

afterEach(() => {
  fs.rmSync(baseDir, { recursive: true, force: true });
});

const baseRecord = {
  date: "2024-01-02",
  symbol: "600000.SH",
  name: "Test",
  strategyId: "trendPullback",
  score: 80,
  riskLevel: "LOW" as const,
  signalType: "BREAKOUT",
  suggestedAction: "LIGHT_POSITION",
  keySupport: 9,
  keyResistance: 12,
  stopLoss: 9,
  target1: 12,
  target2: 13,
  explanation: ["test"],
  risks: [],
};

describe("signal store", () => {
  it("returns empty array when file does not exist", () => {
    expect(readSignalStore("ut-source", baseDir)).toEqual([]);
    expect(signalStoreExists("ut-source", baseDir)).toBe(false);
  });

  it("appends and reads JSONL records", () => {
    appendSignals(
      "ut-source",
      [baseRecord, { ...baseRecord, date: "2024-01-03" }],
      baseDir,
    );
    const back = readSignalStore("ut-source", baseDir);
    expect(back).toHaveLength(2);
    expect(back[0].date).toBe("2024-01-02");
    expect(back[1].date).toBe("2024-01-03");
  });

  it("appendSignals is additive and does not overwrite", () => {
    appendSignals("ut-source", [baseRecord], baseDir);
    appendSignals("ut-source", [{ ...baseRecord, symbol: "000001.SZ" }], baseDir);
    expect(readSignalStore("ut-source", baseDir)).toHaveLength(2);
  });

  it("deleteSignalStore removes the JSONL file", () => {
    appendSignals("ut-source", [baseRecord], baseDir);
    expect(signalStoreExists("ut-source", baseDir)).toBe(true);
    deleteSignalStore("ut-source", baseDir);
    expect(signalStoreExists("ut-source", baseDir)).toBe(false);
    expect(readSignalStore("ut-source", baseDir)).toEqual([]);
  });

  it("tolerates a malformed trailing line by skipping it", () => {
    appendSignals("ut-source", [baseRecord], baseDir);
    fs.appendFileSync(signalStoreFile("ut-source", baseDir), "{not-json\n");
    const back = readSignalStore("ut-source", baseDir);
    expect(back).toHaveLength(1);
  });
});
