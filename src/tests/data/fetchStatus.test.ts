import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readAkshareFetchStatus } from "@/lib/data/adapters/akshareLocalAdapter";

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pangzi-fs-"));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("readAkshareFetchStatus", () => {
  it("returns null when fetch-status.json is missing", () => {
    expect(readAkshareFetchStatus(tmp)).toBeNull();
  });

  it("parses a valid status file", () => {
    const payload = {
      source: "akshare",
      adjust: "qfq",
      startDate: "20240101",
      endDate: "20260519",
      updatedAt: "2026-05-20T00:00:00",
      totalSymbols: 3,
      succeeded: 1,
      failed: 1,
      empty: 1,
      skipped: 0,
      symbols: {
        "300750.SZ": {
          symbol: "300750.SZ",
          name: "宁德时代",
          status: "SUCCESS",
          rows: 572,
          firstDate: "2024-01-02",
          lastDate: "2026-05-19",
          attemptCount: 1,
        },
      },
    };
    fs.writeFileSync(path.join(tmp, "fetch-status.json"), JSON.stringify(payload), "utf8");
    const s = readAkshareFetchStatus(tmp);
    expect(s?.succeeded).toBe(1);
    expect(s?.symbols["300750.SZ"].status).toBe("SUCCESS");
  });
});
