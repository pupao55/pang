import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import type {
  BacktestDiagnostics,
  BucketStats,
} from "@/lib/engine/backtestDiagnostics";
import type { BacktestTrade } from "@/lib/types/backtest";

function BucketTable({ title, cn, buckets }: { title: string; cn: string; buckets: BucketStats[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {cn} <span className="text-subtle text-xs ml-1">{title}</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {buckets.length === 0 ? (
          <div className="text-xs text-subtle">—</div>
        ) : (
          <table className="w-full text-xs">
            <thead className="text-muted">
              <tr>
                <th className="text-left py-1">Bucket</th>
                <th className="text-right">N</th>
                <th className="text-right">胜率</th>
                <th className="text-right">均值%</th>
                <th className="text-right">中位%</th>
                <th className="text-right">合计%</th>
              </tr>
            </thead>
            <tbody>
              {buckets.map((b) => (
                <tr key={b.key} className="border-t border-border">
                  <td className="py-1">{b.key}</td>
                  <td className="text-right font-mono">{b.count}</td>
                  <td className="text-right font-mono">{(b.winRate * 100).toFixed(1)}%</td>
                  <td
                    className={`text-right font-mono ${
                      b.avgReturn >= 0 ? "text-bull" : "text-bear"
                    }`}
                  >
                    {b.avgReturn.toFixed(2)}
                  </td>
                  <td className="text-right font-mono">{b.medianReturn.toFixed(2)}</td>
                  <td
                    className={`text-right font-mono ${
                      b.totalReturnContribution >= 0 ? "text-bull" : "text-bear"
                    }`}
                  >
                    {b.totalReturnContribution.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}

function TradeList({ title, cn, trades }: { title: string; cn: string; trades: BacktestTrade[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {cn} <span className="text-subtle text-xs ml-1">{title}</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {trades.length === 0 ? (
          <div className="text-xs text-subtle">—</div>
        ) : (
          <table className="w-full text-xs">
            <thead className="text-muted">
              <tr>
                <th className="text-left py-1">代码</th>
                <th className="text-left">入场</th>
                <th className="text-left">出场</th>
                <th className="text-right">收益%</th>
                <th className="text-right">持有</th>
                <th className="text-left">原因</th>
              </tr>
            </thead>
            <tbody>
              {trades.map((t, i) => (
                <tr key={i} className="border-t border-border">
                  <td className="py-1 font-mono">{t.symbol}</td>
                  <td className="font-mono">{t.entryDate}</td>
                  <td className="font-mono">{t.exitDate}</td>
                  <td
                    className={`text-right font-mono ${
                      t.returnPct >= 0 ? "text-bull" : "text-bear"
                    }`}
                  >
                    {t.returnPct.toFixed(2)}
                  </td>
                  <td className="text-right font-mono">{t.holdingDays}</td>
                  <td className="text-muted">{t.exitReason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}

export function BacktestDiagnosticsCard({ d }: { d: BacktestDiagnostics }) {
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-ink">
        回测诊断 <span className="text-subtle text-sm ml-1">Diagnostics</span>
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <BucketTable title="By Sector" cn="按板块" buckets={d.bySector} />
        <BucketTable title="By Signal Type" cn="按信号类型" buckets={d.bySignalType} />
        <BucketTable title="By Score Bucket" cn="按分数段" buckets={d.byScoreBucket} />
        <BucketTable title="By Risk Level" cn="按风险等级" buckets={d.byRiskLevel} />
        <BucketTable title="By Holding Period" cn="按持有期" buckets={d.byHoldingPeriod} />
        <BucketTable title="By Market Regime" cn="按市场情绪" buckets={d.byMarketRegime} />
        <TradeList title="Worst 10" cn="最差 10 笔" trades={d.worstTrades} />
        <TradeList title="Best 10" cn="最好 10 笔" trades={d.bestTrades} />
        <Card>
          <CardHeader>
            <CardTitle>
              常见失败原因 <span className="text-subtle text-xs ml-1">Failure Reasons</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {d.commonFailureReasons.length === 0 ? (
              <div className="text-xs text-subtle">无亏损交易。</div>
            ) : (
              <table className="w-full text-xs">
                <thead className="text-muted">
                  <tr>
                    <th className="text-left py-1">Reason</th>
                    <th className="text-right">N</th>
                    <th className="text-right">均收益%</th>
                  </tr>
                </thead>
                <tbody>
                  {d.commonFailureReasons.map((r) => (
                    <tr key={r.reason} className="border-t border-border">
                      <td className="py-1">{r.reason}</td>
                      <td className="text-right font-mono">{r.count}</td>
                      <td className="text-right font-mono text-bear">
                        {r.avgReturn.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
