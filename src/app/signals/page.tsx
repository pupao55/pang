import { StockSignalTable } from "@/components/StockSignalTable";
import { runSignalEngine } from "@/lib/engine/signalEngine";
import { Card, CardContent } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { createMockAdapter } from "@/lib/data/adapters/mockAdapter";
import {
  createAkshareLocalAdapter,
  getAkshareLocalCacheStatus,
} from "@/lib/data/adapters/akshareLocalAdapter";
import {
  createBaostockLocalAdapter,
  getBaostockLocalCacheStatus,
} from "@/lib/data/adapters/baostockLocalAdapter";
import { MOCK_SECTORS } from "@/lib/data/mockSectors";
import { MOCK_SENTIMENT } from "@/lib/data/mockSentiment";
import type { DataAdapter } from "@/lib/data/adapters";
import type { StockSignal } from "@/lib/types/signal";

export const dynamic = "force-dynamic";

interface PickedSource {
  source: "mock" | "akshareLocal" | "baostockLocal";
  adapter: DataAdapter;
  asOfDate?: string;
}

async function pickSource(): Promise<PickedSource> {
  const baostock = getBaostockLocalCacheStatus();
  if (baostock.ok) {
    const a = createBaostockLocalAdapter();
    return { source: "baostockLocal", adapter: a };
  }
  const akshare = getAkshareLocalCacheStatus();
  if (akshare.ok) {
    const a = createAkshareLocalAdapter();
    return { source: "akshareLocal", adapter: a };
  }
  return { source: "mock", adapter: createMockAdapter() };
}

export default async function SignalsPage() {
  const picked = await pickSource();
  const metas = await picked.adapter.getStockMetas();
  const bars = await picked.adapter.getDailyBarsForUniverse(
    metas.map((m) => m.symbol),
    "1900-01-01",
    "9999-12-31",
  );

  // Pick the latest date present in the cache as "today" so signal generation
  // sees a fully realised bar. Mock data has its own EVAL_DATE.
  const allDates = new Set<string>();
  for (const sym of Object.keys(bars))
    for (const b of bars[sym]) allDates.add(b.date);
  const asOfDate = [...allDates].sort().pop();

  const sectors = await picked.adapter.getSectorSnapshots(asOfDate ?? "9999-12-31");
  const sentiment = await picked.adapter.getMarketSentiment(asOfDate ?? "9999-12-31");

  const signals: StockSignal[] = runSignalEngine({
    metas,
    barsBySymbol: bars,
    sectors: sectors.length > 0 ? sectors : MOCK_SECTORS,
    sentiment: sentiment ?? MOCK_SENTIMENT,
    asOfDate,
    sectorScoreMode:
      "sectorMode" in picked.adapter
        ? ((picked.adapter as unknown as { sectorMode: "REAL" | "GENERATED" | "FALLBACK" | "MISSING" }).sectorMode)
        : "MISSING",
  });

  // Quick summary card aggregates
  const breakdown = {
    BREAKOUT: 0,
    PULLBACK: 0,
    REVERSAL: 0,
    SECOND_BUY: 0,
    WATCH_ONLY: 0,
  } as Record<string, number>;
  for (const s of signals) breakdown[s.signalType] = (breakdown[s.signalType] ?? 0) + 1;
  const highScore = signals.filter((s) => s.score >= 80).length;
  const standardAction = signals.filter((s) => s.suggestedAction === "STANDARD_POSITION").length;

  return (
    <div className="space-y-6">
      <header className="space-y-1.5">
        <h1 className="text-3xl font-semibold text-ink tracking-tight">选股信号</h1>
        <p className="text-sm text-muted">
          Stock Signals · 五大策略合并去重，按综合得分降序排列。点击「详情」展开理由与风险。
        </p>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <SummaryCard label="候选数" en="Total signals" value={signals.length.toLocaleString()} />
        <SummaryCard
          label="数据源"
          en="Provider"
          value={
            picked.source === "baostockLocal"
              ? "BaoStock"
              : picked.source === "akshareLocal"
              ? "AkShare"
              : "Mock"
          }
          chip={picked.source === "mock" ? "mock data" : undefined}
        />
        <SummaryCard
          label="高分信号 (≥80)"
          en="High-score (≥80)"
          value={String(highScore)}
        />
        <SummaryCard
          label="标准仓位建议"
          en="Standard position"
          value={String(standardAction)}
        />
      </div>

      {picked.source === "mock" && (
        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="text-sm text-amber-800">
            <strong>⚠️ Demo mode.</strong> No local AkShare/BaoStock cache found —
            showing engineered mock signals. Run{" "}
            <code className="bg-white px-1 py-0.5 rounded border border-amber-200">
              npm run fetch:baostock:sample
            </code>{" "}
            for real data.
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
        <span>信号类型分布</span>
        {Object.entries(breakdown)
          .filter(([, n]) => n > 0)
          .map(([k, n]) => (
            <Badge key={k} tone="default">
              {k}: {n}
            </Badge>
          ))}
        <span className="ml-auto text-subtle">
          被风险过滤排除的 ST / 退市风险股不会出现在此表
        </span>
      </div>

      <StockSignalTable signals={signals} />
    </div>
  );
}

function SummaryCard({
  label,
  en,
  value,
  chip,
}: {
  label: string;
  en: string;
  value: string;
  chip?: string;
}) {
  return (
    <Card>
      <CardContent className="py-4">
        <div className="text-xs text-muted">
          {label} <span className="opacity-60 ml-1">{en}</span>
        </div>
        <div className="flex items-baseline gap-2 mt-1">
          <div className="text-3xl font-semibold text-ink tracking-tight tabular-nums">{value}</div>
          {chip && <Badge tone="warn">{chip}</Badge>}
        </div>
      </CardContent>
    </Card>
  );
}
