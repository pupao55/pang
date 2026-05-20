"use client";
import * as React from "react";
import Link from "next/link";
import { ActionBadge, SignalTypeBadge } from "@/components/StrategyBadge";
import { RiskBadge } from "@/components/RiskBadge";
import { Card, CardContent } from "@/components/ui/Card";
import { Select, Input } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { cn } from "@/lib/utils/cn";
import type {
  StockSignal,
  RiskLevel,
  SignalType,
} from "@/lib/types/signal";

const STRATEGY_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "全部策略" },
  { value: "breakout", label: "突破策略 / Breakout" },
  { value: "pullback", label: "回踩策略 / Pullback" },
  { value: "reversal", label: "反包策略 / Reversal" },
  { value: "second_buy", label: "二买策略 / Second-buy" },
  { value: "trend_follow", label: "趋势跟随 / Trend-follow" },
];

const RISK_OPTIONS: { value: RiskLevel | ""; label: string }[] = [
  { value: "", label: "全部风险" },
  { value: "LOW", label: "低风险 LOW" },
  { value: "MEDIUM", label: "中风险 MEDIUM" },
  { value: "HIGH", label: "高风险 HIGH" },
];

const SIGNAL_OPTIONS: { value: SignalType | ""; label: string }[] = [
  { value: "", label: "全部类型" },
  { value: "BREAKOUT", label: "突破 BREAKOUT" },
  { value: "PULLBACK", label: "回踩 PULLBACK" },
  { value: "REVERSAL", label: "反包 REVERSAL" },
  { value: "SECOND_BUY", label: "二买 SECOND_BUY" },
  { value: "WATCH_ONLY", label: "观察 WATCH_ONLY" },
];

const SCORE_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "全部得分" },
  { value: "80", label: "≥ 80 (高分)" },
  { value: "70", label: "≥ 70" },
  { value: "60", label: "≥ 60" },
];

export function StockSignalTable({ signals }: { signals: StockSignal[] }) {
  const [expanded, setExpanded] = React.useState<string | null>(null);
  const [strategy, setStrategy] = React.useState("");
  const [risk, setRisk] = React.useState<RiskLevel | "">("");
  const [signalType, setSignalType] = React.useState<SignalType | "">("");
  const [scoreMin, setScoreMin] = React.useState("");
  const [query, setQuery] = React.useState("");

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return signals.filter((s) => {
      if (strategy && s.strategyId !== strategy) return false;
      if (risk && s.riskLevel !== risk) return false;
      if (signalType && s.signalType !== signalType) return false;
      if (scoreMin && s.score < Number(scoreMin)) return false;
      if (q) {
        const hay = `${s.symbol} ${s.name} ${s.strategyName}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [signals, strategy, risk, signalType, scoreMin, query]);

  const reset = () => {
    setStrategy("");
    setRisk("");
    setSignalType("");
    setScoreMin("");
    setQuery("");
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="py-4">
          <div className="flex flex-wrap items-end gap-3">
            <FilterField label="搜索">
              <Input
                placeholder="代码 / 名称 / 策略"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="w-52"
              />
            </FilterField>
            <FilterField label="策略">
              <Select
                value={strategy}
                onChange={(e) => setStrategy(e.target.value)}
                className="w-48"
              >
                {STRATEGY_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </FilterField>
            <FilterField label="信号类型">
              <Select
                value={signalType}
                onChange={(e) =>
                  setSignalType(e.target.value as SignalType | "")
                }
                className="w-44"
              >
                {SIGNAL_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </FilterField>
            <FilterField label="风险">
              <Select
                value={risk}
                onChange={(e) => setRisk(e.target.value as RiskLevel | "")}
                className="w-36"
              >
                {RISK_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </FilterField>
            <FilterField label="最低分">
              <Select
                value={scoreMin}
                onChange={(e) => setScoreMin(e.target.value)}
                className="w-32"
              >
                {SCORE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </FilterField>
            <Button variant="outline" size="sm" onClick={reset}>
              重置
            </Button>
            <div className="ml-auto text-xs text-muted whitespace-nowrap">
              显示 <span className="font-semibold text-ink tabular-nums">{filtered.length}</span> /{" "}
              <span className="tabular-nums">{signals.length}</span> 条
            </div>
          </div>
        </CardContent>
      </Card>

      {filtered.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted">
            <div className="text-base text-ink">无符合条件的信号</div>
            <div className="text-xs mt-2">
              当前筛选条件下没有候选股。尝试放宽筛选器或扩展数据集。
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-panel shadow-card">
          <table className="w-full text-[13px]">
            <thead className="bg-surface-2 text-xs text-muted">
              <tr>
                <Th className="min-w-[180px]">股票</Th>
                <Th className="min-w-[160px]">策略</Th>
                <Th className="min-w-[110px]">信号</Th>
                <Th align="right" className="min-w-[80px]">综合评分</Th>
                <Th className="min-w-[110px]">风险</Th>
                <Th align="right" className="min-w-[150px]">关键价位</Th>
                <Th align="right" className="min-w-[150px]">目标</Th>
                <Th className="min-w-[120px]">建议</Th>
                <Th className="w-[60px]"></Th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => {
                const id = s.symbol + s.strategyId;
                const isOpen = expanded === id;
                return (
                  <React.Fragment key={id}>
                    <tr
                      className={cn(
                        "border-t border-border row-hover",
                        isOpen && "bg-surface-2",
                      )}
                    >
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <Link
                            href={`/stocks/${s.symbol}`}
                            className="font-mono text-blue-600 hover:underline tabular-nums"
                          >
                            {s.symbol}
                          </Link>
                          <span className="text-ink">{s.name}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <div className="text-ink">{s.strategyName.split(" / ")[0]}</div>
                        <div className="text-[11px] text-subtle">
                          {s.strategyName.split(" / ")[1] ?? ""}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <SignalTypeBadge type={s.signalType} />
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono font-semibold tabular-nums">
                        <ScoreCell score={s.score} />
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <RiskBadge level={s.riskLevel} />
                      </td>
                      <td className="px-3 py-2.5 text-right whitespace-nowrap font-mono tabular-nums text-[12px]">
                        <div className="text-bear">支 {s.keySupport.toFixed(2)}</div>
                        <div className="text-bull">压 {s.keyResistance.toFixed(2)}</div>
                      </td>
                      <td className="px-3 py-2.5 text-right whitespace-nowrap font-mono tabular-nums text-[12px]">
                        <div className="text-bull">
                          T1 {s.target1.toFixed(2)} · T2 {s.target2.toFixed(2)}
                        </div>
                        <div className="text-amber-700">
                          止损 {s.stopLoss.toFixed(2)}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <ActionBadge action={s.suggestedAction} />
                      </td>
                      <td className="px-2 py-2.5 text-right whitespace-nowrap">
                        <button
                          className="text-xs text-blue-600 hover:underline"
                          onClick={() => setExpanded(isOpen ? null : id)}
                        >
                          {isOpen ? "收起" : "详情"}
                        </button>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="bg-surface-2">
                        <td colSpan={9} className="px-6 py-5 border-t border-border">
                          <ExpandedDetail signal={s} />
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Th({
  children,
  align = "left",
  className,
}: {
  children?: React.ReactNode;
  align?: "left" | "right";
  className?: string;
}) {
  return (
    <th
      className={cn(
        "px-3 py-2.5 font-medium whitespace-nowrap",
        align === "right" ? "text-right" : "text-left",
        className,
      )}
    >
      {children}
    </th>
  );
}

function ScoreCell({ score }: { score: number }) {
  const tone =
    score >= 80
      ? "text-bull"
      : score >= 70
      ? "text-amber-700"
      : score >= 60
      ? "text-ink"
      : "text-muted";
  return <span className={tone}>{score.toFixed(1)}</span>;
}

function FilterField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col">
      <span className="text-[11px] text-muted mb-1">{label}</span>
      {children}
    </div>
  );
}

function ExpandedDetail({ signal: s }: { signal: StockSignal }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        <ScoreChip label="技术" value={s.technicalScore} />
        <ScoreChip label="板块" value={s.sectorScore} />
        <ScoreChip label="情绪" value={s.sentimentScore} />
        <ScoreChip label="流动性" value={s.liquidityScore} />
        <ScoreChip label="基本面" value={s.fundamentalSafetyScore} />
        <ScoreChip
          label="风险扣减"
          value={s.riskPenalty}
          negative
        />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 text-[13px]">
        <Section title="入选原因 · Why selected" items={s.explanation} />
        <Section title="多头因素 · Bullish" items={s.bullishFactors} tone="bull" />
        <Section title="风险信号 · Bearish" items={s.bearishFactors} tone="bear" />
        <Section title="风险提示 · Warnings" items={s.risks} tone="warn" />
      </div>
      {s.corroboratingStrategies && s.corroboratingStrategies.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
          <span>同时入选:</span>
          {s.corroboratingStrategies.map((c) => (
            <Badge key={c} tone="info">
              {c}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

function ScoreChip({
  label,
  value,
  negative = false,
}: {
  label: string;
  value: number;
  negative?: boolean;
}) {
  return (
    <div className="rounded-md border border-border bg-white px-3 py-2">
      <div className="text-[11px] text-muted">{label}</div>
      <div
        className={cn(
          "text-base font-semibold tabular-nums",
          negative ? "text-amber-700" : "text-ink",
        )}
      >
        {negative ? "-" : ""}
        {value.toFixed(0)}
      </div>
    </div>
  );
}

function Section({
  title,
  items,
  tone = "default",
}: {
  title: string;
  items: string[];
  tone?: "default" | "bull" | "bear" | "warn";
}) {
  const itemColor =
    tone === "bull"
      ? "text-bull"
      : tone === "bear"
      ? "text-bear"
      : tone === "warn"
      ? "text-amber-800"
      : "text-ink";
  return (
    <div>
      <div className="text-xs font-semibold text-muted uppercase tracking-wide mb-1.5">
        {title}
      </div>
      {items.length === 0 ? (
        <div className="text-subtle text-sm">—</div>
      ) : (
        <ul className={cn("space-y-1 text-sm", itemColor)}>
          {items.map((it, i) => (
            <li key={i} className="leading-snug flex gap-1.5">
              <span className="text-subtle">•</span>
              <span>{it}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
