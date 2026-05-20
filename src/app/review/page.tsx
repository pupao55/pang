import { Badge } from "@/components/ui/Badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { buildReview } from "@/lib/engine/reviewEngine";

const LABEL_TONE = {
  SUCCESS: "bull",
  FAILURE: "danger",
  MIXED: "warn",
  PENDING: "default",
} as const;

const LABEL_CN = {
  SUCCESS: "成功",
  FAILURE: "失败",
  MIXED: "中性",
  PENDING: "待定",
} as const;

function pct(v: number) {
  if (Number.isNaN(v)) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
}

export default function ReviewPage() {
  const rows = buildReview();
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-3xl font-semibold text-ink tracking-tight">复盘 / Daily Review</h1>
        <p className="text-sm text-muted mt-1">
          MVP 复盘基于最新一日生成的信号与可观察的近邻 bar 收益。v2 将改为按历史 close 重跑策略并使用真实后续 bar 计算成功/失败。
        </p>
      </div>

      {rows.length === 0 ? (
        <Card>
          <CardContent>
            <div className="text-sm text-muted py-6 text-center">
              今日无可复盘信号。
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <Card key={r.signal.symbol + r.signal.strategyId}>
              <CardHeader>
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <CardTitle>
                    <span className="font-mono mr-2">{r.signal.symbol}</span>
                    {r.signal.name}{" "}
                    <span className="text-subtle text-xs ml-2">
                      {r.signal.strategyName}
                    </span>
                  </CardTitle>
                  <Badge tone={LABEL_TONE[r.label]}>
                    {LABEL_CN[r.label]} ·{" "}
                    <span className="opacity-70">{r.label}</span>
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
                  <div>
                    <div className="text-xs text-muted">信号日期</div>
                    <div className="font-mono">{r.signal.date}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted">+1 日收益</div>
                    <div
                      className={`font-mono ${
                        r.nextDayReturn >= 0 ? "text-bull" : "text-bear"
                      }`}
                    >
                      {pct(r.nextDayReturn)}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-muted">+3 日收益</div>
                    <div
                      className={`font-mono ${
                        r.threeDayReturn >= 0 ? "text-bull" : "text-bear"
                      }`}
                    >
                      {pct(r.threeDayReturn)}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-muted">+5 日收益</div>
                    <div
                      className={`font-mono ${
                        r.fiveDayReturn >= 0 ? "text-bull" : "text-bear"
                      }`}
                    >
                      {pct(r.fiveDayReturn)}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-muted">失败原因</div>
                    <div className="text-amber-700">
                      {r.failureReason ?? "—"}
                    </div>
                  </div>
                </div>
                <div className="mt-3 text-xs text-muted">
                  <span className="font-semibold text-ink">策略笔记:</span>{" "}
                  {r.strategyNote}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
