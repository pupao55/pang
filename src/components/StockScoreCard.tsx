import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import type { StockSignal } from "@/lib/types/signal";

const ROWS: { key: keyof StockSignal; cn: string; en: string; weight: string }[] = [
  { key: "technicalScore", cn: "技术面", en: "Technical", weight: "30%" },
  { key: "sectorScore", cn: "板块", en: "Sector", weight: "25%" },
  { key: "sentimentScore", cn: "情绪", en: "Sentiment", weight: "20%" },
  { key: "liquidityScore", cn: "流动性", en: "Liquidity", weight: "15%" },
  { key: "fundamentalSafetyScore", cn: "基本面安全", en: "Fundamentals", weight: "10%" },
];

function bar(v: number) {
  return (
    <div className="h-1.5 bg-gray-200 rounded">
      <div
        className="h-1.5 rounded bg-blue-600"
        style={{ width: `${Math.max(0, Math.min(100, v))}%` }}
      />
    </div>
  );
}

export function StockScoreCard({ signal }: { signal: StockSignal }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>评分明细 / Score Breakdown</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3 text-sm">
          {ROWS.map((r) => {
            const v = signal[r.key] as number;
            return (
              <div key={r.key}>
                <div className="flex justify-between text-xs text-muted">
                  <span>
                    {r.cn} <span className="opacity-60">{r.en}</span>
                  </span>
                  <span>
                    <span className="text-ink font-mono">{v.toFixed(1)}</span>
                    <span className="ml-2 opacity-50">{r.weight}</span>
                  </span>
                </div>
                {bar(v)}
              </div>
            );
          })}
          <div className="flex justify-between text-xs pt-3 border-t border-border">
            <span className="text-muted">风险扣减 / Risk Penalty</span>
            <span className="font-mono text-amber-700">-{signal.riskPenalty.toFixed(1)}</span>
          </div>
          <div className="flex justify-between text-sm pt-1">
            <span className="font-semibold">综合得分 / Total</span>
            <span className="font-mono font-semibold text-ink">
              {signal.score.toFixed(1)}
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
