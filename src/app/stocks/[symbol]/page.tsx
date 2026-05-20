import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { KLineChart } from "@/components/KLineChart";
import { StockScoreCard } from "@/components/StockScoreCard";
import { RiskBadge } from "@/components/RiskBadge";
import { ActionBadge, SignalTypeBadge } from "@/components/StrategyBadge";
import { isLimitUpBar, isNearLimitUpBar } from "@/lib/indicators/limitUp";
import { findMaxTurnoverBar } from "@/lib/indicators/turnover";
import { STRATEGY_LOOKBACKS } from "@/lib/config/constants";
import { runSignalEngine } from "@/lib/engine/signalEngine";
import { MOCK_STOCKS } from "@/lib/data/mockStocks";
import { getMockBars, getMockBarsBySymbol } from "@/lib/data/mockDailyBars";
import { MOCK_SECTORS } from "@/lib/data/mockSectors";
import { MOCK_SENTIMENT } from "@/lib/data/mockSentiment";

interface Props {
  params: { symbol: string };
}

export default function StockDetailPage({ params }: Props) {
  const meta = MOCK_STOCKS.find((s) => s.symbol === params.symbol);
  if (!meta) notFound();

  const bars = getMockBars(meta.symbol);
  if (bars.length === 0) notFound();

  const last = bars[bars.length - 1];
  const maxTurn = findMaxTurnoverBar(bars, STRATEGY_LOOKBACKS.maxTurnover);

  // Recent limit-up events (lookback 60 bars).
  const limitUps: { date: string; near: boolean; close: number }[] = [];
  for (let i = Math.max(1, bars.length - 60); i < bars.length; i++) {
    if (isLimitUpBar(bars[i], bars[i - 1], meta.boardType)) {
      limitUps.push({ date: bars[i].date, near: false, close: bars[i].close });
    } else if (isNearLimitUpBar(bars[i], bars[i - 1], meta.boardType)) {
      limitUps.push({ date: bars[i].date, near: true, close: bars[i].close });
    }
  }

  const allSignals = runSignalEngine({
    metas: MOCK_STOCKS,
    barsBySymbol: getMockBarsBySymbol(),
    sectors: MOCK_SECTORS,
    sentiment: MOCK_SENTIMENT,
  });
  const signal = allSignals.find((s) => s.symbol === meta.symbol);

  return (
    <div className="space-y-6">
      <div className="flex items-baseline gap-3">
        <Link href="/signals" className="text-xs text-blue-600 hover:underline">
          ← 返回信号列表
        </Link>
        <h1 className="text-3xl font-semibold text-ink tracking-tight">
          {meta.name} <span className="font-mono text-muted text-base">{meta.symbol}</span>
        </h1>
        <span className="text-xs text-muted">
          {meta.exchange} · {meta.boardType} · {meta.industry}
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>K 线 / Chart (close + MAs + turnover)</CardTitle>
          </CardHeader>
          <CardContent>
            <KLineChart
              bars={bars}
              support={signal?.keySupport}
              resistance={signal?.keyResistance}
            />
          </CardContent>
        </Card>

        {signal ? (
          <StockScoreCard signal={signal} />
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>暂无信号 / No Active Signal</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted">
              当前评估周期内未命中任一策略，或被风险过滤器排除。
            </CardContent>
          </Card>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>基础信息 / Basic Info</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-y-2 text-sm">
              <dt className="text-muted">最新价 Close</dt>
              <dd className="font-mono">{last.close.toFixed(2)}</dd>
              <dt className="text-muted">涨跌幅 pctChg</dt>
              <dd className={`font-mono ${last.pctChange >= 0 ? "text-bull" : "text-bear"}`}>
                {last.pctChange.toFixed(2)}%
              </dd>
              <dt className="text-muted">换手率</dt>
              <dd className="font-mono">{last.turnoverRate.toFixed(2)}%</dd>
              <dt className="text-muted">成交额 amount</dt>
              <dd className="font-mono">
                {(last.amount / 1e8).toFixed(2)} 亿
              </dd>
              <dt className="text-muted">流通市值</dt>
              <dd className="font-mono">
                {(meta.floatMarketCap / 1e8).toFixed(1)} 亿
              </dd>
              <dt className="text-muted">概念</dt>
              <dd className="text-xs text-ink">
                {meta.concepts.length === 0 ? "—" : meta.concepts.join("、")}
              </dd>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>关键位 / Key Levels</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-y-2 text-sm">
              {maxTurn ? (
                <>
                  <dt className="text-muted">最大换手位 date</dt>
                  <dd className="font-mono">
                    {maxTurn.date} ({maxTurn.turnoverRate.toFixed(2)}%)
                  </dd>
                  <dt className="text-muted">最大换手位 high/low</dt>
                  <dd className="font-mono">
                    {maxTurn.high.toFixed(2)} / {maxTurn.low.toFixed(2)}
                  </dd>
                </>
              ) : (
                <dd className="col-span-2 text-subtle">—</dd>
              )}
              {signal && (
                <>
                  <dt className="text-muted">支撑 keySupport</dt>
                  <dd className="font-mono text-emerald-700">
                    {signal.keySupport.toFixed(2)}
                  </dd>
                  <dt className="text-muted">压力 keyResistance</dt>
                  <dd className="font-mono text-rose-300">
                    {signal.keyResistance.toFixed(2)}
                  </dd>
                  <dt className="text-muted">止损 stopLoss</dt>
                  <dd className="font-mono text-amber-700">{signal.stopLoss.toFixed(2)}</dd>
                  <dt className="text-muted">目标 1 / 2</dt>
                  <dd className="font-mono text-emerald-700">
                    {signal.target1.toFixed(2)} / {signal.target2.toFixed(2)}
                  </dd>
                </>
              )}
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>近期涨停 / Recent Limit-up Events</CardTitle>
          </CardHeader>
          <CardContent>
            {limitUps.length === 0 ? (
              <div className="text-sm text-subtle">近 60 日无涨停或近涨停记录。</div>
            ) : (
              <ul className="text-sm space-y-1">
                {limitUps.slice(-8).map((e) => (
                  <li key={e.date} className="flex justify-between">
                    <span className="text-ink font-mono">{e.date}</span>
                    <span className={e.near ? "text-amber-700" : "text-bull"}>
                      {e.near ? "近涨停 near limit-up" : "涨停 limit-up"} · {e.close.toFixed(2)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>历史信号 / Historical Signals</CardTitle>
          </CardHeader>
          <CardContent>
            {signal ? (
              <div className="space-y-2 text-sm">
                <div className="flex gap-2 flex-wrap">
                  <SignalTypeBadge type={signal.signalType} />
                  <ActionBadge action={signal.suggestedAction} />
                  <RiskBadge level={signal.riskLevel} />
                </div>
                <div className="text-xs text-muted mt-2">
                  策略: {signal.strategyName}
                </div>
                <ul className="text-xs text-ink space-y-1">
                  {signal.explanation.map((e, i) => (
                    <li key={i}>• {e}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <div className="text-sm text-subtle">
                MVP 版本仅展示当日最新信号。v2 将持久化历史信号。
              </div>
            )}
          </CardContent>
        </Card>

        {signal && (
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>风险解释 / Risk Notes</CardTitle>
            </CardHeader>
            <CardContent>
              {signal.risks.length === 0 ? (
                <div className="text-sm text-subtle">无重大风险提示。</div>
              ) : (
                <ul className="text-sm text-amber-700 space-y-1">
                  {signal.risks.map((r, i) => (
                    <li key={i}>• {r}</li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
