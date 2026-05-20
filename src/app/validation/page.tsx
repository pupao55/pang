import fs from "node:fs";
import path from "node:path";
import Link from "next/link";
import { Badge, type BadgeProps } from "@/components/ui/Badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import {
  createAkshareLocalAdapter,
  getAkshareLocalCacheStatus,
  readAkshareFetchStatus,
  readAkshareImportReport,
} from "@/lib/data/adapters/akshareLocalAdapter";
import {
  createBaostockLocalAdapter,
  getBaostockLocalCacheStatus,
  readBaostockFetchStatus,
  readBaostockImportReport,
} from "@/lib/data/adapters/baostockLocalAdapter";
import { recommendProvider } from "@/lib/data/providers/recommend";
import type { DataSourceId } from "@/lib/data/adapters";
import { PATHS } from "@/lib/store/paths";
import { readSignalStore } from "@/lib/store/signalStore";
import {
  calibrateScores,
  makeBarBasedResolver,
} from "@/lib/engine/scoreCalibration";
import { validateRiskFilter } from "@/lib/engine/riskFilterValidation";
import {
  evaluateStrategyQuality,
  type StrategyQualityRow,
} from "@/lib/engine/strategyQuality";
import { buildFailureModes, type FailureModeGroup } from "@/lib/engine/failureModes";
import {
  buildCacheMaturityReport,
  type CacheMaturityReport,
} from "@/lib/engine/cacheMaturity";
import {
  calibrateHorizons,
  type HorizonCalibrationResult,
} from "@/lib/engine/horizonCalibration";

// Server component — reads the local cache and signal store at request time.
export const dynamic = "force-dynamic";

export default async function ValidationPage() {
  // v1.8: pick whichever provider has a usable cache. Prefer the one the
  // campaign recommends; fall back to whichever cache is actually present.
  const akshareCache = getAkshareLocalCacheStatus();
  const baostockCache = getBaostockLocalCacheStatus();
  const akshareFetchStatus = readAkshareFetchStatus();
  const baostockFetchStatus = readBaostockFetchStatus();
  const rec = recommendProvider(
    {
      providerId: "akshareLocal",
      cacheOk: akshareCache.ok,
      symbolCount: akshareCache.symbolCount,
      succeeded: akshareFetchStatus?.succeeded ?? 0,
      failed: akshareFetchStatus?.failed ?? 0,
      empty: akshareFetchStatus?.empty ?? 0,
      skipped: akshareFetchStatus?.skipped ?? 0,
    },
    {
      providerId: "baostockLocal",
      cacheOk: baostockCache.ok,
      symbolCount: baostockCache.symbolCount,
      succeeded: baostockFetchStatus?.succeeded ?? 0,
      failed: baostockFetchStatus?.failed ?? 0,
      empty: baostockFetchStatus?.empty ?? 0,
      skipped: baostockFetchStatus?.skipped ?? 0,
    },
  );
  const SOURCE: DataSourceId =
    rec.provider === "baostockLocal" && baostockCache.ok
      ? "baostockLocal"
      : akshareCache.ok
      ? "akshareLocal"
      : baostockCache.ok
      ? "baostockLocal"
      : "akshareLocal"; // SetupCard will render below
  const cache = SOURCE === "baostockLocal" ? baostockCache : akshareCache;
  const reportPath = PATHS.reportFor(SOURCE);
  const reportExists = fs.existsSync(reportPath);
  const calibrationReportPath = `${PATHS.reportsDir}/calibration-report.md`;
  const calibrationReportExists = fs.existsSync(calibrationReportPath);
  const horizonReportPath = `${PATHS.reportsDir}/horizon-calibration-report.md`;
  const horizonReportExists = fs.existsSync(horizonReportPath);

  if (!cache.ok) {
    return <SetupCard reason={cache.reason ?? "No provider cache available."} />;
  }

  const importReport =
    SOURCE === "baostockLocal"
      ? readBaostockImportReport()
      : readAkshareImportReport();
  const fetchStatus =
    SOURCE === "baostockLocal" ? baostockFetchStatus : akshareFetchStatus;
  const signals = readSignalStore(SOURCE);
  const calendarPath = path.join(PATHS.akshareDir, "trading-calendar.json");
  const calendarPresent = fs.existsSync(calendarPath);

  let calibration: ReturnType<typeof calibrateScores> | null = null;
  let riskValidation: ReturnType<typeof validateRiskFilter> | null = null;
  let perStrategy: StrategyQualityRow[] = [];
  let failureModes: ReturnType<typeof buildFailureModes> | null = null;
  let maturity: CacheMaturityReport | null = null;
  let horizon: HorizonCalibrationResult | null = null;
  let adapterWarnings: string[] = [];
  let universeCount = 0;
  let calendarStart = "—";
  let calendarEnd = "—";

  try {
    const adapter =
      SOURCE === "baostockLocal"
        ? createBaostockLocalAdapter()
        : createAkshareLocalAdapter();
    adapterWarnings = adapter.warnings;
    const metas = await adapter.getStockMetas();
    universeCount = metas.length;
    const allBars = await adapter.getDailyBarsForUniverse(
      metas.map((m) => m.symbol),
      "1900-01-01",
      "9999-12-31",
    );

    // Maturity uses whatever data exists, even with zero signals.
    maturity = buildCacheMaturityReport({
      metas,
      barsBySymbol: allBars,
      signals,
      fetchStatus: fetchStatus ?? undefined,
      importReport: importReport ?? undefined,
      metadataMode: adapter.metadataMode,
      sectorMode: adapter.sectorMode,
      sentimentMode: adapter.sentimentMode,
      source: SOURCE,
    });

    if (signals.length > 0) {
      const resolver = makeBarBasedResolver(allBars);
      calibration = calibrateScores(signals, resolver);
      riskValidation = validateRiskFilter(signals, resolver);
      perStrategy = evaluateStrategyQuality({
        signals,
        resolver,
        scoreCalibrationOk: calibration.verdict !== "NOT_CALIBRATED",
      });
      failureModes = buildFailureModes(signals, resolver);
      horizon = calibrateHorizons(signals, resolver);
      const dates = signals.map((s) => s.date).sort();
      calendarStart = dates[0];
      calendarEnd = dates[dates.length - 1];
    }
  } catch (err) {
    return <SetupCard reason={String((err as Error).message)} />;
  }

  const showHonestyAlert =
    maturity?.readinessLevel === "SMOKE_TEST_ONLY" ||
    maturity?.readinessLevel === "EARLY_RESEARCH" ||
    maturity?.readinessLevel === "NOT_READY";

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold text-ink tracking-tight">历史验证</h1>
        <p className="text-sm text-muted">
          Historical Validation · 当前数据源{" "}
          <code className="text-blue-600">{SOURCE}</code> (本地缓存, no live calls).
          Campaign recommends <code className="text-amber-700">{rec.provider}</code>.
        </p>
        <div className="flex items-center gap-2 flex-wrap pt-1">
          <Badge tone="info">cache OK · {cache.symbolCount} symbols</Badge>
          {adapterWarnings.length > 0 && (
            <Badge tone="warn">{adapterWarnings.length} adapter warnings</Badge>
          )}
          <Badge tone="warn">sector/sentiment FALLBACK (mock)</Badge>
          {!calendarPresent && (
            <Badge tone="warn">trading calendar missing</Badge>
          )}
        </div>
      </header>

      {showHonestyAlert && maturity && (
        <Card className="border-amber-300 bg-amber-50">
          <CardContent className="py-4">
            <div className="flex items-start gap-3">
              <div className="text-xl leading-none">⚠️</div>
              <div className="flex-1">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <span className="text-sm font-semibold text-amber-900">
                    研究可信度提醒 · Research credibility
                  </span>
                  <Badge tone={READINESS_TONE[maturity.readinessLevel]}>
                    {maturity.readinessLevel}
                  </Badge>
                </div>
                <p className="text-sm text-amber-900">
                  当前数据集尚不足以证明策略有效。请继续扩展 BaoStock 样本至 100+
                  只股票，并将日期范围扩展至 ≥ 2 年。
                </p>
                <p className="text-xs text-amber-800 mt-1">
                  {READINESS_COPY[maturity.readinessLevel]}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {maturity && <ResearchReadinessCard m={maturity} />}

      {horizon && <HorizonVerdictCard horizon={horizon} />}

      <Card>
        <CardContent>
          <div className="text-amber-700 text-sm py-2">
            ⚠️ Sector / sentiment data is currently the mock fallback. Scores that rely
            on these dimensions (sectorLeader, regime-based scoring) are compressed and
            should NOT be used for final ranking until real sector/sentiment adapters
            ship.
          </div>
        </CardContent>
      </Card>

      {fetchStatus && (
        <Card>
          <CardHeader>
            <CardTitle>抓取状态 / Fetch Status</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-y-2 text-sm">
              <div>
                <div className="text-xs text-muted">Succeeded</div>
                <div className="font-mono text-bull">{fetchStatus.succeeded}</div>
              </div>
              <div>
                <div className="text-xs text-muted">Failed</div>
                <div className="font-mono text-bear">{fetchStatus.failed}</div>
              </div>
              <div>
                <div className="text-xs text-muted">Empty</div>
                <div className="font-mono">{fetchStatus.empty}</div>
              </div>
              <div>
                <div className="text-xs text-muted">Skipped</div>
                <div className="font-mono">{fetchStatus.skipped}</div>
              </div>
              <div>
                <div className="text-xs text-muted">Last updated</div>
                <div className="font-mono text-xs">{fetchStatus.updatedAt}</div>
              </div>
            </div>
            <div className="text-[11px] text-subtle mt-3">
              Scope: {fetchStatus.startDate} → {fetchStatus.endDate} · adjust={" "}
              <code>{fetchStatus.adjust}</code> · status file{" "}
              <code className="text-xs">{path.join(PATHS.akshareDir, "fetch-status.json")}</code>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>导入摘要 / Import Summary</CardTitle>
        </CardHeader>
        <CardContent>
          {importReport ? (
            <dl className="grid grid-cols-2 md:grid-cols-4 gap-y-2 text-sm">
              <dt className="text-muted">Source · adjust</dt>
              <dd className="font-mono">
                {importReport.source} · {importReport.adjust}
              </dd>
              <dt className="text-muted">Known / OK / failed / empty</dt>
              <dd className="font-mono">
                {importReport.totalSymbolsKnown ?? "—"} /{" "}
                {importReport.totalSymbolsSucceeded} /{" "}
                {importReport.totalSymbolsFailed} /{" "}
                {importReport.totalSymbolsEmpty ?? 0}
              </dd>
              <dt className="text-muted">Total bars</dt>
              <dd className="font-mono">{importReport.totalRows.toLocaleString()}</dd>
              <dt className="text-muted">Last updated</dt>
              <dd className="font-mono text-xs">
                {importReport.lastUpdatedAt ?? "—"}
              </dd>
              <dt className="text-muted">Cache date range</dt>
              <dd className="font-mono text-xs">
                {importReport.dateRange
                  ? `${importReport.dateRange.start} → ${importReport.dateRange.end}`
                  : `${importReport.startDate} → ${importReport.endDate}`}
              </dd>
              <dt className="text-muted">Universe in adapter</dt>
              <dd className="font-mono">{universeCount}</dd>
              <dt className="text-muted">Signals · date range</dt>
              <dd className="font-mono">
                {signals.length.toLocaleString()} · {calendarStart} → {calendarEnd}
              </dd>
            </dl>
          ) : (
            <div className="text-sm text-muted">
              No import-report.json found yet.
            </div>
          )}
        </CardContent>
      </Card>

      {signals.length === 0 ? (
        <Card>
          <CardContent>
            <div className="text-sm text-amber-700 py-4">
              No historical signals yet. Run:
              <pre className="mt-2 text-xs bg-surface-2 border border-border p-2 rounded">
                npm run rebuild:signals -- --source {SOURCE} --rebuild
              </pre>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Section A — strategy quality */}
          <Card>
            <CardHeader>
              <CardTitle>
                A. 策略质量 <span className="text-subtle text-xs ml-1">Strategy Quality</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-muted">
                    <tr>
                      <th className="text-left py-1">Strategy</th>
                      <th className="text-right">N</th>
                      <th className="text-left">Sample</th>
                      <th className="text-right">+1d</th>
                      <th className="text-right">+3d</th>
                      <th className="text-right">+5d</th>
                      <th className="text-right">+10d</th>
                      <th className="text-right">win 1/3/5/10d</th>
                      <th className="text-right">best</th>
                      <th className="text-right">worst</th>
                      <th className="text-right">avg score</th>
                      <th className="text-left">Recommendation</th>
                    </tr>
                  </thead>
                  <tbody>
                    {perStrategy.map((r) => (
                      <tr key={r.strategyId} className="border-t border-border">
                        <td className="py-1 font-mono">{r.strategyId}</td>
                        <td className="text-right font-mono">{r.signalCount}</td>
                        <td>
                          <SampleBadge badge={r.sampleSizeBadge} />
                        </td>
                        <td className="text-right font-mono">{fmt(r.avg1dReturn)}</td>
                        <td className="text-right font-mono">{fmt(r.avg3dReturn)}</td>
                        <td className="text-right font-mono">{fmt(r.avg5dReturn)}</td>
                        <td className="text-right font-mono">{fmt(r.avg10dReturn)}</td>
                        <td className="text-right font-mono text-muted text-[10px]">
                          {rate(r.winRate1d)} · {rate(r.winRate3d)} · {rate(r.winRate5d)} · {rate(r.winRate10d)}
                        </td>
                        <td className="text-right font-mono">{fmt(r.bestReturn)}</td>
                        <td className="text-right font-mono">{fmt(r.worstReturn)}</td>
                        <td className="text-right font-mono">{r.averageScore.toFixed(1)}</td>
                        <td>
                          <RecommendationBadge rec={r.recommendation} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-3 text-[10px] text-subtle leading-snug">
                Sample badges: NEEDS_MORE_DATA &lt; 30 · LOW_CONFIDENCE 30-99 · OK ≥ 100. Strong
                KEEP/DISABLE verdicts only fire at N ≥ 100.
              </div>
            </CardContent>
          </Card>

          {/* Section B — score calibration */}
          {calibration && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <CardTitle>
                    B. 分数校准 <span className="text-subtle text-xs ml-1">Score Calibration</span>
                  </CardTitle>
                  <CalibrationBadge verdict={calibration.verdict} />
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-xs text-muted mb-2">
                  monotonic5d: {calibration.monotonic5d ? "OK" : "FAILED"} · rank correlation:{" "}
                  {calibration.rankCorrelation5d.toFixed(3)}
                </div>
                {calibration.warning && (
                  <div className="text-amber-700 text-sm mb-3">⚠️ {calibration.warning}</div>
                )}
                <table className="w-full text-sm">
                  <thead className="text-xs text-muted">
                    <tr>
                      <th className="text-left py-1">Bucket</th>
                      <th className="text-right">N</th>
                      <th className="text-right">+1d</th>
                      <th className="text-right">+3d</th>
                      <th className="text-right">+5d</th>
                      <th className="text-right">+10d</th>
                      <th className="text-right">win 5d</th>
                      <th className="text-right">worst 5d</th>
                      <th className="text-right">avg risk</th>
                    </tr>
                  </thead>
                  <tbody>
                    {calibration.buckets.map((b) => (
                      <tr key={b.bucket} className="border-t border-border">
                        <td className="py-1">{b.bucket}</td>
                        <td className="text-right font-mono">{b.signalCount}</td>
                        <td className="text-right font-mono">{fmt(b.avgR1)}</td>
                        <td className="text-right font-mono">{fmt(b.avgR3)}</td>
                        <td className="text-right font-mono">{fmt(b.avgR5)}</td>
                        <td className="text-right font-mono">{fmt(b.avgR10)}</td>
                        <td className="text-right font-mono">{rate(b.winRate5d)}</td>
                        <td className="text-right font-mono">{fmt(b.worstR5)}</td>
                        <td className="text-right font-mono">
                          {Number.isNaN(b.avgRiskLevelEncoded) ? "—" : b.avgRiskLevelEncoded.toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}

          {/* Section C — risk filter effectiveness */}
          {riskValidation && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <CardTitle>
                    C. 风险过滤有效性 <span className="text-subtle text-xs ml-1">Risk Filter Effectiveness</span>
                  </CardTitle>
                  <RiskFilterBadge verdict={riskValidation.verdict} />
                </div>
              </CardHeader>
              <CardContent>
                {riskValidation.warning && (
                  <div className="text-amber-700 text-sm mb-3">⚠️ {riskValidation.warning}</div>
                )}
                <table className="w-full text-sm">
                  <thead className="text-xs text-muted">
                    <tr>
                      <th className="text-left py-1">Cohort</th>
                      <th className="text-right">N</th>
                      <th className="text-right">Skipped</th>
                      <th className="text-right">avg +5d</th>
                      <th className="text-right">win 5d</th>
                      <th className="text-right">worst 5d</th>
                      <th className="text-right">cum proxy</th>
                    </tr>
                  </thead>
                  <tbody>
                    {riskValidation.cohorts.map((c) => (
                      <tr key={c.cohort} className="border-t border-border">
                        <td className="py-1">{c.cohort}</td>
                        <td className="text-right font-mono">{c.signalCount}</td>
                        <td className="text-right font-mono">{c.skippedCount}</td>
                        <td className="text-right font-mono">{fmt(c.avgR5)}</td>
                        <td className="text-right font-mono">{rate(c.winRate5d)}</td>
                        <td className="text-right font-mono">{fmt(c.worstR5)}</td>
                        <td className="text-right font-mono">
                          {(c.cumulativeReturnProxy * 100).toFixed(2)}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}

          {/* Section D — failure modes */}
          {failureModes && (
            <Card>
              <CardHeader>
                <CardTitle>
                  D. 失败模式 <span className="text-subtle text-xs ml-1">Failure Modes (5d &lt; 0)</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  <FailureGroupTable title="By strategy" rows={failureModes.byStrategy} />
                  <FailureGroupTable title="By risk level" rows={failureModes.byRiskLevel} />
                  <FailureGroupTable title="By signal type" rows={failureModes.bySignalType} />
                  <FailureGroupTable title="By score bucket" rows={failureModes.byScoreBucket} />
                  <FailureGroupTable title="By board type" rows={failureModes.byBoardType} />
                  <FailureGroupTable title="By month" rows={failureModes.byMonth} />
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}

      <Card>
        <CardHeader>
          <CardTitle>报告 / Reports</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="text-sm space-y-2">
            <li>
              Validation report:{" "}
              {reportExists ? (
                <code className="text-blue-600 text-xs">{reportPath}</code>
              ) : (
                <>
                  尚未生成 ·{" "}
                  <code className="text-xs">
                    npm run validate:strategies -- --source {SOURCE}
                  </code>
                </>
              )}
            </li>
            <li>
              Calibration report:{" "}
              {calibrationReportExists ? (
                <code className="text-blue-600 text-xs">{calibrationReportPath}</code>
              ) : (
                <>
                  尚未生成 · <code className="text-xs">npm run calibrate:strategies</code>
                </>
              )}
            </li>
            <li>
              Horizon calibration report (v1.9):{" "}
              {horizonReportExists ? (
                <code className="text-blue-600 text-xs">{horizonReportPath}</code>
              ) : (
                <>
                  尚未生成 ·{" "}
                  <code className="text-xs">npm run calibrate:horizons</code>
                </>
              )}
            </li>
          </ul>
        </CardContent>
      </Card>

      <p className="text-xs text-subtle">
        ⚠️ AkShare 数据来自公开上游源，可能限流或变更。本工具仅用于研究，不构成投资建议。Sector/sentiment
        currently fall back to mock snapshots — strategies that depend on them are not yet
        validated on real data.
      </p>
    </div>
  );
}

function SetupCard({ reason }: { reason: string }) {
  return (
    <div className="space-y-4">
      <header className="space-y-1.5">
        <h1 className="text-3xl font-semibold text-ink tracking-tight">历史验证</h1>
        <p className="text-sm text-muted">
          Historical Validation · No provider cache (AkShare or BaoStock) is ready yet.
        </p>
      </header>
      <Card>
        <CardHeader>
          <CardTitle>Setup steps (BaoStock — recommended)</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-amber-700 text-sm mb-3">⚠️ {reason}</div>
          <p className="text-xs text-muted mb-3">
            BaoStock is the recommended primary provider — AkShare/Eastmoney
            currently blocks new fetches from many IPs.
          </p>
          <ol className="list-decimal pl-5 text-sm space-y-2">
            <li>
              <pre className="text-xs bg-surface-2 border border-border p-2 mt-1 rounded">npm run setup:baostock</pre>
            </li>
            <li>
              <pre className="text-xs bg-surface-2 border border-border p-2 mt-1 rounded">npm run fetch:baostock:sample</pre>
            </li>
            <li>
              <pre className="text-xs bg-surface-2 border border-border p-2 mt-1 rounded">
                npm run build:sentiment -- --source baostockLocal
              </pre>
            </li>
            <li>
              <pre className="text-xs bg-surface-2 border border-border p-2 mt-1 rounded">
                npm run rebuild:signals -- --source baostockLocal --rebuild
              </pre>
            </li>
            <li>
              <pre className="text-xs bg-surface-2 border border-border p-2 mt-1 rounded">
                npm run validate:strategies -- --source baostockLocal
              </pre>
            </li>
            <li>
              <pre className="text-xs bg-surface-2 border border-border p-2 mt-1 rounded">
                npm run calibrate:strategies -- --source baostockLocal
              </pre>
            </li>
          </ol>
          <div className="text-xs text-subtle mt-4">
            Or skip cache entirely and open{" "}
            <Link href="/signals" className="text-blue-600 hover:underline">
              /signals
            </Link>{" "}
            for the mock-data demo.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function FailureGroupTable({
  title,
  rows,
}: {
  title: string;
  rows: FailureModeGroup[];
}) {
  return (
    <div>
      <div className="text-xs text-muted mb-1 font-semibold">{title}</div>
      {rows.length === 0 ? (
        <div className="text-[11px] text-subtle">—</div>
      ) : (
        <table className="w-full text-[11px]">
          <thead className="text-subtle">
            <tr>
              <th className="text-left py-0.5">Key</th>
              <th className="text-right">N</th>
              <th className="text-right">avg</th>
              <th className="text-right">worst</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 8).map((r) => (
              <tr key={r.key} className="border-t border-border">
                <td className="py-0.5">{r.key}</td>
                <td className="text-right font-mono">{r.count}</td>
                <td className="text-right font-mono">{fmt(r.avgLossPct)}</td>
                <td className="text-right font-mono">{fmt(r.worstLossPct)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function fmt(v: number): string {
  return Number.isNaN(v) ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
}
function rate(v: number): string {
  return Number.isNaN(v) ? "—" : `${(v * 100).toFixed(0)}%`;
}

function SampleBadge({
  badge,
}: {
  badge: "OK" | "LOW_CONFIDENCE" | "NEEDS_MORE_DATA";
}) {
  const tone: Record<typeof badge, BadgeProps["tone"]> = {
    OK: "info",
    LOW_CONFIDENCE: "warn",
    NEEDS_MORE_DATA: "danger",
  };
  return <Badge tone={tone[badge]}>{badge}</Badge>;
}

function RecommendationBadge({
  rec,
}: {
  rec: "KEEP_CANDIDATE" | "MODIFY_CANDIDATE" | "DISABLE_CANDIDATE" | "NEEDS_MORE_DATA";
}) {
  const tone: Record<typeof rec, BadgeProps["tone"]> = {
    KEEP_CANDIDATE: "bull",
    MODIFY_CANDIDATE: "warn",
    DISABLE_CANDIDATE: "danger",
    NEEDS_MORE_DATA: "default",
  };
  return <Badge tone={tone[rec]}>{rec}</Badge>;
}

function CalibrationBadge({
  verdict,
}: {
  verdict: "CALIBRATED" | "NOT_CALIBRATED" | "INCONCLUSIVE";
}) {
  const tone: Record<typeof verdict, BadgeProps["tone"]> = {
    CALIBRATED: "bull",
    NOT_CALIBRATED: "danger",
    INCONCLUSIVE: "warn",
  };
  return <Badge tone={tone[verdict]}>{verdict}</Badge>;
}

function RiskFilterBadge({
  verdict,
}: {
  verdict: "IMPROVES" | "NO_IMPROVEMENT" | "INCONCLUSIVE";
}) {
  const tone: Record<typeof verdict, BadgeProps["tone"]> = {
    IMPROVES: "bull",
    NO_IMPROVEMENT: "danger",
    INCONCLUSIVE: "warn",
  };
  return <Badge tone={tone[verdict]}>{verdict}</Badge>;
}

const HORIZON_PROFILE_COPY: Record<string, { en: string; cn: string }> = {
  MOMENTUM_1D: {
    en: "1-day momentum (decays after that)",
    cn: "1日动能（之后衰减）",
  },
  MEAN_REVERTS_AFTER_1D: {
    en: "Mean-reverts after 1 day",
    cn: "1日后均值回归",
  },
  SHORT_SWING_3D: { en: "Short swing (~3d)", cn: "短线 3 日左右" },
  SWING_5D: { en: "5-day swing", cn: "5 日波段" },
  NO_EDGE: { en: "No edge at any horizon", cn: "任一周期均无优势" },
  INCONCLUSIVE: { en: "Sample too small", cn: "样本不足" },
};

function HorizonVerdictCard({
  horizon,
}: {
  horizon: HorizonCalibrationResult;
}) {
  const highBucket = horizon.perScoreBucket.find(
    (b) => b.key === "90-100" || b.key === "80-90",
  );
  const stat = highBucket?.stat ?? horizon.overall;
  const profile = stat.horizonProfile;
  const copy = HORIZON_PROFILE_COPY[profile] ?? {
    en: profile,
    cn: profile,
  };
  let nextAction = "";
  if (profile === "MOMENTUM_1D" || profile === "MEAN_REVERTS_AFTER_1D") {
    nextAction =
      "用 1d 持有期重跑回测；当前 5d 回测对此类信号会低估业绩。";
  } else if (profile === "NO_EDGE") {
    nextAction = "评分模型本身需要重设计，先不要调权重。";
  } else if (profile === "INCONCLUSIVE") {
    nextAction = "继续扩样本至高分桶 ≥ 30 才会有可信结论。";
  } else {
    nextAction = "保留当前 5d 回测视角，可以开始权重微调。";
  }
  const tone: BadgeProps["tone"] =
    profile === "NO_EDGE"
      ? "danger"
      : profile === "INCONCLUSIVE"
      ? "warn"
      : profile === "SWING_5D"
      ? "bull"
      : "info";
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <CardTitle>
            高分桶最佳持有周期{" "}
            <span className="text-subtle text-xs ml-1">
              Horizon verdict (v1.9)
            </span>
          </CardTitle>
          <Badge tone={tone}>{profile}</Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <div className="text-xs text-muted">高分桶 (80+) 样本</div>
            <div className="font-mono text-lg text-ink">
              {highBucket?.stat.signalCount.toLocaleString() ?? "—"}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted">Best / Worst horizon</div>
            <div className="font-mono text-lg text-ink">
              <span className="text-bull">{stat.bestHorizon}</span>{" "}
              <span className="text-subtle">/</span>{" "}
              <span className="text-bear">{stat.worstHorizon}</span>
            </div>
          </div>
          <div>
            <div className="text-xs text-muted">含义</div>
            <div className="text-sm text-ink">
              {copy.cn} <span className="text-subtle">· {copy.en}</span>
            </div>
          </div>
        </div>
        <div className="mt-3 text-sm text-ink">
          <span className="font-semibold">下一步: </span>
          {nextAction}
        </div>
        <div className="mt-2 text-[11px] text-subtle">
          详细见{" "}
          <code className="text-blue-600">
            reports/horizon-calibration-report.md
          </code>{" "}
          · 生成命令{" "}
          <code className="text-blue-600">npm run calibrate:horizons</code>。
        </div>
      </CardContent>
    </Card>
  );
}

const READINESS_TONE: Record<CacheMaturityReport["readinessLevel"], BadgeProps["tone"]> = {
  NOT_READY: "danger",
  SMOKE_TEST_ONLY: "warn",
  EARLY_RESEARCH: "info",
  RESEARCH_READY: "bull",
};

const READINESS_COPY: Record<CacheMaturityReport["readinessLevel"], string> = {
  NOT_READY:
    "Current results are workflow validation only, not strategy evidence.",
  SMOKE_TEST_ONLY:
    "Current results are workflow validation only, not strategy evidence.",
  EARLY_RESEARCH:
    "Current results can be used for preliminary strategy debugging, not final calibration.",
  RESEARCH_READY:
    "Dataset is large enough for meaningful strategy comparison, though results are still not investment advice.",
};

function ResearchReadinessCard({ m }: { m: CacheMaturityReport }) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <CardTitle>
            研究就绪度 <span className="text-subtle text-xs ml-1">Research Readiness</span>
          </CardTitle>
          <Badge tone={READINESS_TONE[m.readinessLevel]}>{m.readinessLevel}</Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="text-sm text-ink mb-3">{READINESS_COPY[m.readinessLevel]}</div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-y-2 text-sm">
          <div>
            <div className="text-xs text-muted">Symbols</div>
            <div className="font-mono text-lg">{m.symbolCount}</div>
          </div>
          <div>
            <div className="text-xs text-muted">Avg bars / symbol</div>
            <div className="font-mono text-lg">{m.averageBarsPerSymbol.toFixed(0)}</div>
          </div>
          <div>
            <div className="text-xs text-muted">Latest-date coverage</div>
            <div className="font-mono text-lg">
              {(m.latestDateCoverageRatio * 100).toFixed(1)}%
            </div>
          </div>
          <div>
            <div className="text-xs text-muted">Strategies w/ ≥ 100 signals</div>
            <div className="font-mono text-lg">{m.strategiesWithEnoughSamples.length}</div>
          </div>
          <div>
            <div className="text-xs text-muted">Score buckets ≥ 80</div>
            <div className="font-mono text-lg">
              {m.scoreBucketCoverage["80-90"] + m.scoreBucketCoverage["90-100"]}
              {m.hasScoreCompression && (
                <span className="ml-2 text-xs text-amber-700">compression</span>
              )}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted">Risk diversity</div>
            <div className="font-mono text-lg">
              {m.hasRiskDiversity ? "OK" : <span className="text-amber-700">LOW only</span>}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted">Sector coverage</div>
            <div className="font-mono text-lg">{(m.sectorCoverageRatio * 100).toFixed(0)}%</div>
          </div>
          <div>
            <div className="text-xs text-muted">Sentiment coverage</div>
            <div className="font-mono text-lg">
              {(m.sentimentCoverageRatio * 100).toFixed(0)}%
            </div>
          </div>
        </div>

        {m.readinessReasons.length > 0 && (
          <div className="mt-4 text-xs text-muted">
            <div className="font-semibold text-ink mb-1">Why this verdict</div>
            <ul className="space-y-0.5">
              {m.readinessReasons.map((r, i) => (
                <li key={i}>• {r}</li>
              ))}
            </ul>
          </div>
        )}

        {m.nextActions.length > 0 && (
          <div className="mt-4">
            <div className="text-xs text-ink font-semibold mb-1">Next actions</div>
            <ul className="space-y-1 text-sm">
              {m.nextActions.map((a, i) => (
                <li key={i} className="text-ink">
                  ☐ {a}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
