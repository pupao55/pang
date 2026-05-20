"use client";
import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input, Label, Select } from "@/components/ui/Select";
import { BacktestMetricsCard } from "@/components/BacktestMetricsCard";
import { BacktestResultChart } from "@/components/BacktestResultChart";
import { BacktestDiagnosticsCard } from "@/components/BacktestDiagnosticsCard";
import type { BacktestParams, BacktestResult } from "@/lib/types/backtest";
import type { DataSourceId } from "@/lib/data/adapters";
import { runBacktestAction, type RunBacktestResponse } from "./actions";

const STRATEGY_OPTIONS: { id: string; cn: string }[] = [
  { id: "limitUpSecondBuy", cn: "涨停后二买 / Limit-up Second Buy" },
  { id: "maxTurnoverBreakout", cn: "最大换手位突破 / Max Turnover Breakout" },
  { id: "sectorLeader", cn: "板块龙头 / Sector Leader" },
  { id: "trendPullback", cn: "趋势回踩 / Trend Pullback" },
  { id: "firstBreakout", cn: "低位首爆 / First Breakout" },
];

const DEFAULT: BacktestParams = {
  strategyId: "trendPullback",
  startDate: "2026-02-01",
  endDate: "2026-05-19",
  buyRule: "NEXT_OPEN",
  sellRule: "STOP_LOSS_TAKE_PROFIT",
  maxHoldingDays: 8,
  stopLossPct: 6,
  takeProfitPct: 12,
  portfolio: {
    startingCapital: 1_000_000,
    allowConcurrentPositions: true,
    maxConcurrentPositions: 5,
    maxPositionsPerSector: 2,
    allowSameSymbolOverlap: false,
    minScore: 0,
  },
};

export function BacktestForm() {
  const [params, setParams] = React.useState<BacktestParams>(DEFAULT);
  const [source, setSource] = React.useState<DataSourceId>("mock");
  const [response, setResponse] = React.useState<RunBacktestResponse | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  function update<K extends keyof BacktestParams>(k: K, v: BacktestParams[K]) {
    setParams((p) => ({ ...p, [k]: v }));
  }
  function updatePortfolio<K extends keyof NonNullable<BacktestParams["portfolio"]>>(
    k: K,
    v: NonNullable<BacktestParams["portfolio"]>[K],
  ) {
    setParams((p) => ({
      ...p,
      portfolio: { ...(p.portfolio ?? {}), [k]: v },
    }));
  }

  async function onRun() {
    setLoading(true);
    setError(null);
    try {
      const r = await runBacktestAction(params, source);
      setResponse(r);
    } catch (err) {
      setError(String((err as Error).message));
      setResponse(null);
    } finally {
      setLoading(false);
    }
  }

  const result: BacktestResult | null = response?.result ?? null;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>回测参数 / Parameters</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <Label>数据源 Source</Label>
              <Select
                value={source}
                onChange={(e) => setSource(e.target.value as DataSourceId)}
                className="w-full"
              >
                <option value="mock">MOCK · 内置示例</option>
                <option value="akshareLocal">AKSHARE_LOCAL · 本地缓存</option>
                <option value="baostockLocal">BAOSTOCK_LOCAL · 本地缓存</option>
              </Select>
            </div>
            <div>
              <Label>策略 Strategy</Label>
              <Select
                value={params.strategyId}
                onChange={(e) => update("strategyId", e.target.value)}
                className="w-full"
              >
                {STRATEGY_OPTIONS.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.cn}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label>开始日期 Start</Label>
              <Input
                type="date"
                value={params.startDate}
                onChange={(e) => update("startDate", e.target.value)}
                className="w-full"
              />
            </div>
            <div>
              <Label>结束日期 End</Label>
              <Input
                type="date"
                value={params.endDate}
                onChange={(e) => update("endDate", e.target.value)}
                className="w-full"
              />
            </div>
            <div>
              <Label>买入规则 Buy Rule</Label>
              <Select
                value={params.buyRule}
                onChange={(e) => update("buyRule", e.target.value as BacktestParams["buyRule"])}
                className="w-full"
              >
                <option value="CLOSE">当日收盘 CLOSE</option>
                <option value="NEXT_OPEN">次日开盘 NEXT_OPEN</option>
              </Select>
            </div>
            <div>
              <Label>卖出规则 Sell Rule</Label>
              <Select
                value={params.sellRule}
                onChange={(e) => update("sellRule", e.target.value as BacktestParams["sellRule"])}
                className="w-full"
              >
                <option value="FIXED_DAYS">固定持有 FIXED_DAYS</option>
                <option value="STOP_LOSS_TAKE_PROFIT">止盈止损 STOP/TP</option>
                <option value="BREAK_MA10">跌破 MA10 BREAK_MA10</option>
                <option value="BREAK_SUPPORT">跌破支撑 BREAK_SUPPORT</option>
              </Select>
            </div>
            <div>
              <Label>最大持有 Days</Label>
              <Input
                type="number"
                min={1}
                value={params.maxHoldingDays}
                onChange={(e) => update("maxHoldingDays", Number(e.target.value))}
                className="w-full"
              />
            </div>
            <div>
              <Label>止损 % StopLoss</Label>
              <Input
                type="number"
                value={params.stopLossPct}
                onChange={(e) => update("stopLossPct", Number(e.target.value))}
                className="w-full"
              />
            </div>
            <div>
              <Label>止盈 % TakeProfit</Label>
              <Input
                type="number"
                value={params.takeProfitPct}
                onChange={(e) => update("takeProfitPct", Number(e.target.value))}
                className="w-full"
              />
            </div>

            <div>
              <Label>起始资金 Capital</Label>
              <Input
                type="number"
                value={params.portfolio?.startingCapital ?? 1_000_000}
                onChange={(e) =>
                  updatePortfolio("startingCapital", Number(e.target.value))
                }
                className="w-full"
              />
            </div>
            <div>
              <Label>同时持仓上限 Max Concurrent</Label>
              <Input
                type="number"
                value={params.portfolio?.maxConcurrentPositions ?? 5}
                onChange={(e) =>
                  updatePortfolio("maxConcurrentPositions", Number(e.target.value))
                }
                className="w-full"
              />
            </div>
            <div>
              <Label>单板块上限 Max per Sector</Label>
              <Input
                type="number"
                value={params.portfolio?.maxPositionsPerSector ?? 2}
                onChange={(e) =>
                  updatePortfolio("maxPositionsPerSector", Number(e.target.value))
                }
                className="w-full"
              />
            </div>
            <div>
              <Label>最低进场分 Min Score</Label>
              <Input
                type="number"
                value={params.portfolio?.minScore ?? 0}
                onChange={(e) => updatePortfolio("minScore", Number(e.target.value))}
                className="w-full"
              />
            </div>
          </div>
          <div className="mt-4 flex items-center gap-3">
            <Button onClick={onRun} disabled={loading}>
              {loading ? "回测中…" : "运行回测 Run"}
            </Button>
            <span className="text-xs text-subtle">
              成本模型默认: 买/卖手续费 0.03%，印花税 0.05%(卖出)，滑点 10 bps。
            </span>
          </div>
        </CardContent>
      </Card>

      {error && (
        <Card>
          <CardContent>
            <div className="text-sm text-amber-700 whitespace-pre-wrap">⚠️ {error}</div>
          </CardContent>
        </Card>
      )}

      {response?.dataInfo && (
        <Card>
          <CardContent>
            <div className="text-sm text-ink">
              数据源 <code className="text-blue-600">{response.dataInfo.source}</code> ·{" "}
              {response.dataInfo.symbolCount} 只股票
              {response.dataInfo.sectorIsFallback && (
                <span className="ml-2 text-amber-700">
                  ⚠ sector = fallback (mock)
                </span>
              )}
              {response.dataInfo.sentimentIsFallback && (
                <span className="ml-2 text-amber-700">
                  ⚠ sentiment = fallback (mock)
                </span>
              )}
            </div>
            {response.dataInfo.adapterWarnings.length > 0 && (
              <ul className="mt-2 text-xs text-amber-700">
                {response.dataInfo.adapterWarnings.slice(0, 5).map((w, i) => (
                  <li key={i}>• {w}</li>
                ))}
                {response.dataInfo.adapterWarnings.length > 5 && (
                  <li>
                    • … and {response.dataInfo.adapterWarnings.length - 5} more
                  </li>
                )}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      {result && (
        <>
          <BacktestMetricsCard result={result} />
          <Card>
            <CardHeader>
              <CardTitle>资金曲线 / Equity Curve</CardTitle>
            </CardHeader>
            <CardContent>
              <BacktestResultChart equityCurve={result.equityCurve} />
            </CardContent>
          </Card>
          {response?.diagnostics && <BacktestDiagnosticsCard d={response.diagnostics} />}
          <Card>
            <CardHeader>
              <CardTitle>交易列表 / Trades ({result.trades.length})</CardTitle>
            </CardHeader>
            <CardContent>
              {result.trades.length === 0 ? (
                <div className="text-sm text-subtle">
                  No trades. Check signalCount (
                  <span className="font-mono">{result.signalCount}</span>) and skipped reasons (
                  <span className="font-mono">{result.skippedSignalCount}</span>).
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-xs text-muted">
                      <tr>
                        <th className="text-left py-1">代码</th>
                        <th className="text-left">入场</th>
                        <th className="text-right">入场价</th>
                        <th className="text-left">出场</th>
                        <th className="text-right">出场价</th>
                        <th className="text-right">净收益%</th>
                        <th className="text-right">毛收益%</th>
                        <th className="text-right">持有</th>
                        <th className="text-right">费用</th>
                        <th className="text-left">原因</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.trades.map((t, i) => (
                        <tr key={i} className="border-t border-border">
                          <td className="py-1 font-mono">{t.symbol}</td>
                          <td className="font-mono text-xs">{t.entryDate}</td>
                          <td className="text-right font-mono">{t.entryPrice.toFixed(2)}</td>
                          <td className="font-mono text-xs">{t.exitDate}</td>
                          <td className="text-right font-mono">{t.exitPrice.toFixed(2)}</td>
                          <td
                            className={`text-right font-mono ${
                              t.returnPct >= 0 ? "text-bull" : "text-bear"
                            }`}
                          >
                            {t.returnPct.toFixed(2)}
                          </td>
                          <td className="text-right font-mono text-muted">
                            {t.grossReturnPct.toFixed(2)}
                          </td>
                          <td className="text-right font-mono">{t.holdingDays}</td>
                          <td className="text-right font-mono text-muted">
                            {t.feesCny.toFixed(0)}
                          </td>
                          <td className="text-xs text-muted">{t.exitReason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
