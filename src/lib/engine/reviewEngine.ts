import { runSignalEngine } from "@/lib/engine/signalEngine";
import { getMockBarsBySymbol } from "@/lib/data/mockDailyBars";
import { MOCK_SECTORS } from "@/lib/data/mockSectors";
import { MOCK_SENTIMENT } from "@/lib/data/mockSentiment";
import { MOCK_STOCKS } from "@/lib/data/mockStocks";
import type { StockSignal } from "@/lib/types/signal";

export interface ReviewRow {
  signal: StockSignal;
  /** Forward return %, NaN if not enough future bars available. */
  nextDayReturn: number;
  threeDayReturn: number;
  fiveDayReturn: number;
  label: "SUCCESS" | "FAILURE" | "MIXED" | "PENDING";
  failureReason?: string;
  strategyNote: string;
}

const STRATEGY_NOTES: Record<string, string> = {
  limitUpSecondBuy:
    "二买依赖前期涨停结构与回踩支撑；若市场退潮，应主动降低仓位。",
  maxTurnoverBreakout:
    "突破后需观察 3 日是否回踩不破；跌破最大换手位实体下沿则信号失效。",
  sectorLeader: "板块情绪是龙头股最大变量，板块退潮后应优先减仓。",
  trendPullback: "趋势回踩注重缩量等待与放量反弹的配合。",
  firstBreakout: "低位首爆若量能跟不上易回吐，第二日量能是关键确认。",
};

export interface ReviewOptions {
  /**
   * Point-in-time replay window. When provided, the engine is re-run at each
   * historical close for the last `windowDays` trading days, and forward
   * returns are computed from real future bars when they exist.
   * AUDIT G-2: replaces the v1 "today only" review.
   */
  windowDays?: number;
}

export function buildReview(options: ReviewOptions = {}): ReviewRow[] {
  const bySymbol = getMockBarsBySymbol();

  // Determine evaluation dates from the first stock's calendar.
  const calendar = (() => {
    const first = MOCK_STOCKS[0]?.symbol;
    return first ? bySymbol[first].map((b) => b.date) : [];
  })();
  const evalDates: string[] = options.windowDays
    ? calendar.slice(-options.windowDays)
    : [calendar[calendar.length - 1] ?? ""];

  const rows: ReviewRow[] = [];
  for (const asOfDate of evalDates) {
    if (!asOfDate) continue;
    const signals = runSignalEngine({
      metas: MOCK_STOCKS,
      barsBySymbol: bySymbol,
      sectors: MOCK_SECTORS,
      sentiment: MOCK_SENTIMENT,
      asOfDate,
    });
    for (const sig of signals) {
      const bars = bySymbol[sig.symbol];
      if (!bars || bars.length < 2) continue;
      const idx = bars.findIndex((b) => b.date === sig.date);
      if (idx === -1) continue;
      const entry = bars[idx].close;
      const fwd = (offset: number): number => {
        const target = bars[idx + offset];
        if (!target) return NaN;
        return ((target.close - entry) / entry) * 100;
      };
      const r1 = fwd(1);
      const r3 = fwd(3);
      const r5 = fwd(5);

      let label: ReviewRow["label"] = "PENDING";
      let failureReason: string | undefined;
      if (!Number.isNaN(r5)) {
        if (r5 >= 4) label = "SUCCESS";
        else if (r5 <= -4) {
          label = "FAILURE";
          failureReason = !Number.isNaN(r1) && r1 < 0
            ? "次日即破位"
            : "持有期内跌破止损";
        } else label = "MIXED";
      }

      rows.push({
        signal: sig,
        nextDayReturn: Number.isNaN(r1) ? NaN : +r1.toFixed(2),
        threeDayReturn: Number.isNaN(r3) ? NaN : +r3.toFixed(2),
        fiveDayReturn: Number.isNaN(r5) ? NaN : +r5.toFixed(2),
        label,
        failureReason,
        strategyNote: STRATEGY_NOTES[sig.strategyId] ?? "—",
      });
    }
  }
  return rows;
}
