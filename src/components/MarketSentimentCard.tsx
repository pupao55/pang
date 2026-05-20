import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import type { MarketSentimentSnapshot } from "@/lib/types/market";

const REGIME_TONE: Record<MarketSentimentSnapshot["marketRegime"], "bull" | "warn" | "danger" | "info"> = {
  STRONG: "bull",
  NEUTRAL: "info",
  WEAK: "warn",
  PANIC: "danger",
};

const REGIME_CN: Record<MarketSentimentSnapshot["marketRegime"], string> = {
  STRONG: "赚钱效应强",
  NEUTRAL: "震荡中性",
  WEAK: "退潮期",
  PANIC: "情绪冰点",
};

function Stat({ label, en, value, tone }: { label: string; en: string; value: string; tone?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="text-xs text-muted">
        {label} <span className="opacity-60">{en}</span>
      </div>
      <div className={`text-lg font-mono ${tone ?? "text-ink"}`}>{value}</div>
    </div>
  );
}

export function MarketSentimentCard({
  snapshot,
  description,
}: {
  snapshot: MarketSentimentSnapshot;
  description: string;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>市场情绪 / Market Sentiment</CardTitle>
          <Badge tone={REGIME_TONE[snapshot.marketRegime]}>
            {REGIME_CN[snapshot.marketRegime]} ·{" "}
            <span className="ml-1 opacity-70">{snapshot.marketRegime}</span>
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-3 md:grid-cols-6 gap-4">
          <Stat label="涨停" en="Limit-up" value={String(snapshot.limitUpCount)} tone="text-bull" />
          <Stat label="跌停" en="Limit-down" value={String(snapshot.limitDownCount)} tone="text-bear" />
          <Stat
            label="炸板率"
            en="Failed limit-up"
            value={`${(snapshot.failedLimitUpRate * 100).toFixed(1)}%`}
          />
          <Stat
            label="最高连板"
            en="Max consec."
            value={String(snapshot.maxConsecutiveLimitUp)}
          />
          <Stat
            label="昨涨停表现"
            en="Yest. LU perf"
            value={`${snapshot.yesterdayLimitUpPerformance.toFixed(2)}%`}
          />
          <Stat label="指数趋势" en="Index trend" value={snapshot.indexTrend} />
        </div>
        <p className="mt-4 text-sm text-ink leading-relaxed">{description}</p>
      </CardContent>
    </Card>
  );
}
