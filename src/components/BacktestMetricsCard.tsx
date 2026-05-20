import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import type { BacktestResult } from "@/lib/types/backtest";

function Stat({ label, en, value, tone }: { label: string; en: string; value: string; tone?: string }) {
  return (
    <div>
      <div className="text-xs text-muted">
        {label} <span className="opacity-60">{en}</span>
      </div>
      <div className={`text-lg font-mono ${tone ?? "text-ink"}`}>{value}</div>
    </div>
  );
}

export function BacktestMetricsCard({ result }: { result: BacktestResult }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>回测指标 / Metrics</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-3 md:grid-cols-5 gap-4">
          <Stat
            label="总收益"
            en="Total return"
            value={`${result.totalReturn.toFixed(2)}%`}
            tone={result.totalReturn >= 0 ? "text-bull" : "text-bear"}
          />
          <Stat
            label="年化"
            en="Annualized"
            value={`${result.annualizedReturn.toFixed(2)}%`}
            tone={result.annualizedReturn >= 0 ? "text-bull" : "text-bear"}
          />
          <Stat label="胜率" en="Win rate" value={`${(result.winRate * 100).toFixed(1)}%`} />
          <Stat label="平均收益" en="Avg return" value={`${result.averageReturn.toFixed(2)}%`} />
          <Stat label="盈亏比" en="P/L ratio" value={result.profitLossRatio.toFixed(2)} />
          <Stat label="最大回撤" en="Max DD" value={`${result.maxDrawdown.toFixed(2)}%`} tone="text-amber-700" />
          <Stat label="最大连亏" en="Max consec." value={String(result.maxConsecutiveLosses)} />
          <Stat label="持仓占比" en="Exposure" value={`${(result.exposureRatio * 100).toFixed(1)}%`} />
          <Stat label="均持有日" en="Avg holding" value={result.averageHoldingDays.toFixed(2)} />
          <Stat label="换手率" en="Turnover" value={`${result.turnover.toFixed(2)}x`} />
          <Stat
            label="总费用"
            en="Total fees"
            value={`${(result.totalFeesCny / 1000).toFixed(1)}k`}
          />
          <Stat
            label="总滑点"
            en="Total slippage"
            value={`${(result.totalSlippageCny / 1000).toFixed(1)}k`}
          />
          <Stat label="信号数" en="Signal count" value={String(result.signalCount)} />
          <Stat
            label="成交笔数"
            en="Executed"
            value={String(result.executedTradeCount)}
          />
          <Stat
            label="跳过数"
            en="Skipped"
            value={String(result.skippedSignalCount)}
          />
        </div>
        {Object.keys(result.skipReasonCounts).length > 0 && (
          <div className="mt-3 text-xs text-muted">
            跳过原因 Skipped reasons:{" "}
            {Object.entries(result.skipReasonCounts)
              .map(([k, v]) => `${k}=${v}`)
              .join(" · ")}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
