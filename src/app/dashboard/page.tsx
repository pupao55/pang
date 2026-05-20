import Link from "next/link";
import { DemoStatusCard } from "@/components/DemoStatusCard";
import { MarketSentimentCard } from "@/components/MarketSentimentCard";
import { SectorStrengthTable } from "@/components/SectorStrengthTable";
import { Badge } from "@/components/ui/Badge";
import { Card, CardContent } from "@/components/ui/Card";
import { MOCK_SECTORS } from "@/lib/data/mockSectors";
import { MOCK_SENTIMENT, describeMarketRegime } from "@/lib/data/mockSentiment";

// Reads cache + signal store at request time, so don't pre-render statically.
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  return (
    <div className="space-y-6">
      <header className="space-y-1.5">
        <h1 className="text-3xl font-semibold text-ink tracking-tight">市场情绪</h1>
        <p className="text-sm text-muted">
          Pangzi · A-share Research Dashboard ·
          每日收盘后基于涨停结构、板块强弱、连板分布给出市场情绪研判，仅供研究使用。
        </p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <DemoStatusCard />
        </div>
        <Card>
          <CardContent className="py-5 space-y-3">
            <div className="text-sm font-semibold text-ink">快速入口 · Quick links</div>
            <div className="flex flex-col gap-2">
              <Link
                href="/validation"
                className="inline-flex items-center justify-between rounded-md border border-border bg-white px-4 py-2.5 text-sm text-ink hover:bg-gray-50 transition-colors"
              >
                <span>打开研究可信度面板</span>
                <span className="text-blue-600">→</span>
              </Link>
              <Link
                href="/signals"
                className="inline-flex items-center justify-between rounded-md border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm font-medium text-blue-700 hover:bg-blue-100 transition-colors"
              >
                <span>查看选股信号</span>
                <span>→</span>
              </Link>
              <Link
                href="/backtest"
                className="inline-flex items-center justify-between rounded-md border border-border bg-white px-4 py-2.5 text-sm text-ink hover:bg-gray-50 transition-colors"
              >
                <span>运行策略回测</span>
                <span className="text-blue-600">→</span>
              </Link>
            </div>
            <p className="text-[11px] text-subtle pt-1">
              建议:先打开研究可信度面板确认数据成熟度，再查看选股信号。
            </p>
          </CardContent>
        </Card>
      </div>

      <Card className="border-amber-200 bg-amber-50">
        <CardContent className="py-4">
          <div className="flex items-start gap-2 flex-wrap">
            <Badge tone="warn">mock data</Badge>
            <div className="flex-1 text-sm text-amber-900 min-w-[260px]">
              <strong>下面的板块/情绪卡片来自合成 mock 数据。</strong>{" "}
              真实板块与情绪需要 AkShare context 抓取成功才能填入 (当前 IP 受限,
              建议改用 BaoStock 完成历史回放;实时市场情绪暂不支持)。
              本节仅用于 UI 演示。
            </div>
          </div>
        </CardContent>
      </Card>

      <MarketSentimentCard
        snapshot={MOCK_SENTIMENT}
        description={describeMarketRegime(MOCK_SENTIMENT)}
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SectorStrengthTable
          sectors={MOCK_SECTORS}
          title="Strongest Sectors"
          cnTitle="强势板块"
        />
        <SectorStrengthTable
          sectors={MOCK_SECTORS}
          title="Weakest Sectors"
          cnTitle="弱势板块"
          ascending
        />
      </div>

      <p className="text-xs text-subtle">
        免责声明: 本工具为决策辅助与研究用途，不构成投资建议，不预测未来股价。
      </p>
    </div>
  );
}
