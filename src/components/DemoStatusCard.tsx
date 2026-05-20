// Top-of-page status card for the demo dashboard.
//
// Reads existing cache + signal + maturity artifacts. No new logic — every
// number comes from a previously-shipped reader.

import fs from "node:fs";
import Link from "next/link";
import { Badge, type BadgeProps } from "@/components/ui/Badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import {
  createAkshareLocalAdapter,
  getAkshareLocalCacheStatus,
  readAkshareFetchStatus,
} from "@/lib/data/adapters/akshareLocalAdapter";
import {
  createBaostockLocalAdapter,
  getBaostockLocalCacheStatus,
  readBaostockFetchStatus,
} from "@/lib/data/adapters/baostockLocalAdapter";
import { PATHS } from "@/lib/store/paths";
import { readSignalStore } from "@/lib/store/signalStore";
import {
  buildCacheMaturityReport,
  type CacheMaturityReport,
} from "@/lib/engine/cacheMaturity";
import { recommendProvider } from "@/lib/data/providers/recommend";
import type { DataSourceId } from "@/lib/data/adapters";

const READINESS_TONE: Record<CacheMaturityReport["readinessLevel"], BadgeProps["tone"]> = {
  NOT_READY: "danger",
  SMOKE_TEST_ONLY: "warn",
  EARLY_RESEARCH: "info",
  RESEARCH_READY: "bull",
};

export async function DemoStatusCard() {
  const akshare = getAkshareLocalCacheStatus();
  const baostock = getBaostockLocalCacheStatus();
  const akshareFetch = readAkshareFetchStatus();
  const baostockFetch = readBaostockFetchStatus();

  const rec = recommendProvider(
    {
      providerId: "akshareLocal",
      cacheOk: akshare.ok,
      symbolCount: akshare.symbolCount,
      succeeded: akshareFetch?.succeeded ?? 0,
      failed: akshareFetch?.failed ?? 0,
      empty: akshareFetch?.empty ?? 0,
      skipped: akshareFetch?.skipped ?? 0,
      lastUpdatedAt: akshareFetch?.updatedAt,
    },
    {
      providerId: "baostockLocal",
      cacheOk: baostock.ok,
      symbolCount: baostock.symbolCount,
      succeeded: baostockFetch?.succeeded ?? 0,
      failed: baostockFetch?.failed ?? 0,
      empty: baostockFetch?.empty ?? 0,
      skipped: baostockFetch?.skipped ?? 0,
      lastUpdatedAt: baostockFetch?.updatedAt,
    },
  );

  // Pick the source used by maturity: the recommended one if its cache is OK,
  // else any cache that does exist, else mock-fallback.
  const primarySource: DataSourceId =
    rec.provider === "baostockLocal" && baostock.ok
      ? "baostockLocal"
      : akshare.ok
      ? "akshareLocal"
      : baostock.ok
      ? "baostockLocal"
      : "mock";

  let maturity: CacheMaturityReport | null = null;
  let signalCount = 0;
  let dataHealthStatus: "CLEAN" | "WARNINGS" | "UNKNOWN" = "UNKNOWN";

  if (primarySource !== "mock") {
    try {
      const adapter =
        primarySource === "baostockLocal"
          ? createBaostockLocalAdapter()
          : createAkshareLocalAdapter();
      const metas = await adapter.getStockMetas();
      const all = await adapter.getDailyBarsForUniverse(
        metas.map((m) => m.symbol),
        "1900-01-01",
        "9999-12-31",
      );
      const signals = readSignalStore(primarySource);
      signalCount = signals.length;
      maturity = buildCacheMaturityReport({
        metas,
        barsBySymbol: all,
        signals,
        fetchStatus: primarySource === "akshareLocal" ? akshareFetch : baostockFetch,
        metadataMode: adapter.metadataMode,
        sectorMode: adapter.sectorMode,
        sentimentMode: adapter.sentimentMode,
        source: primarySource,
      });

      // Tiny data-health proxy: count zero-volume / impossible-OHLC bars.
      let bad = 0;
      for (const m of metas) {
        for (const b of all[m.symbol] ?? []) {
          if (b.volume === 0 || b.high < b.low || b.close <= 0) bad += 1;
        }
      }
      dataHealthStatus = bad === 0 ? "CLEAN" : "WARNINGS";
    } catch {
      // Adapter throws when cache directory is empty; fall through and we
      // render setup hints below.
    }
  }

  const maturityReportExists = fs.existsSync(`${PATHS.reportsDir}/cache-maturity-report.md`);
  const calibrationReportExists = fs.existsSync(`${PATHS.reportsDir}/calibration-report.md`);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle>演示状态 / Demo Status</CardTitle>
          {maturity && (
            <Badge tone={READINESS_TONE[maturity.readinessLevel]}>
              {maturity.readinessLevel}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-y-3 text-sm">
          <div>
            <div className="text-xs text-muted">Primary provider</div>
            <div className="font-mono">
              {rec.provider}
              {primarySource !== rec.provider && (
                <span className="ml-1 text-xs text-amber-700">
                  (using {primarySource})
                </span>
              )}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted">AkShare cache</div>
            <div className="font-mono">
              {akshare.ok ? `${akshare.symbolCount} symbols` : "missing"}
              {akshareFetch && akshareFetch.failed > 0 && (
                <span className="ml-1 text-xs text-bear">⚠ {akshareFetch.failed} failed</span>
              )}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted">BaoStock cache</div>
            <div className="font-mono">
              {baostock.ok ? `${baostock.symbolCount} symbols` : "missing"}
              {baostockFetch && baostockFetch.failed > 0 && (
                <span className="ml-1 text-xs text-bear">⚠ {baostockFetch.failed} failed</span>
              )}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted">Signals (current source)</div>
            <div className="font-mono">{signalCount.toLocaleString()}</div>
          </div>
          {maturity && (
            <>
              <div>
                <div className="text-xs text-muted">Symbols</div>
                <div className="font-mono">{maturity.symbolCount}</div>
              </div>
              <div>
                <div className="text-xs text-muted">Total bars</div>
                <div className="font-mono">{maturity.totalBars.toLocaleString()}</div>
              </div>
              <div>
                <div className="text-xs text-muted">Sector / Sentiment</div>
                <div className="font-mono text-xs">
                  {maturity.sectorCoverageRatio === 1 ? "REAL" : maturity.sectorCoverageRatio === 0.5 ? "GENERATED" : maturity.sectorCoverageRatio === 0.2 ? "FALLBACK" : "MISSING"}{" "}/{" "}
                  {maturity.sentimentCoverageRatio === 1 ? "REAL" : maturity.sentimentCoverageRatio === 0.5 ? "GENERATED" : maturity.sentimentCoverageRatio === 0.2 ? "FALLBACK" : "MISSING"}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted">Data health</div>
                <div
                  className={
                    dataHealthStatus === "CLEAN"
                      ? "font-mono text-bull"
                      : dataHealthStatus === "WARNINGS"
                      ? "font-mono text-bear"
                      : "font-mono text-muted"
                  }
                >
                  {dataHealthStatus}
                </div>
              </div>
            </>
          )}
        </div>

        <div className="mt-4 text-sm text-amber-700">
          ⚠️ {rec.rationale}
        </div>
        <div className="mt-2 text-xs text-muted">
          Next recommended command:{" "}
          <code className="text-blue-600 text-xs">{rec.command}</code>
        </div>

        <div className="mt-4 flex flex-wrap gap-3 text-xs text-muted">
          {maturityReportExists && (
            <span>
              📄 maturity report: <code className="text-ink">reports/cache-maturity-report.md</code>
            </span>
          )}
          {calibrationReportExists && (
            <span>
              📄 calibration report: <code className="text-ink">reports/calibration-report.md</code>
            </span>
          )}
        </div>

        <div className="mt-5">
          <Link
            href="/validation"
            className="inline-block px-4 py-2 rounded-md bg-blue-600 text-white text-sm font-semibold hover:bg-blue-500"
          >
            Open Research Readiness Dashboard →
          </Link>
        </div>

        <div className="mt-4 text-[11px] text-subtle leading-snug">
          Pangzi is research software, not investment advice. All on-screen
          numbers describe what the engine sees, not whether the strategies are
          profitable. Treat verdicts at SMOKE_TEST_ONLY / EARLY_RESEARCH as
          workflow validation only.
        </div>
      </CardContent>
    </Card>
  );
}
