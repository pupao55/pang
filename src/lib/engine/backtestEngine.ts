// Point-in-time portfolio backtest engine.
//
// Design notes (see AUDIT.md):
//  - The outer loop walks the trading calendar day-by-day. On each day the
//    portfolio is marked-to-market at close, exit conditions are checked,
//    then strategies are re-evaluated using only bars up to that day
//    (truncateBars) — no look-ahead.
//  - Entries respect T+1: the first exit-eligible bar for any open position
//    is `entryIdx + 1` (A-share cannot sell what was bought today).
//  - A-share execution friction modelled via the cost model in `costs.ts`:
//    half-spread slippage per side, commission per side, stamp duty on sell.
//  - Price-limit gating: if the entry bar opens at limit-up (no offer to lift)
//    we skip the entry with `LIMIT_OPEN_BLOCKED`. Symmetric block on sell
//    when next bar opens at limit-down.
//  - Sector resolution is per-date via `sectorsByDate[date]`. Falls back to
//    the most recent prior snapshot. The mock dataset only ships a single
//    snapshot — see AUDIT H-2.

import { calculateMA } from "@/lib/indicators/movingAverage";
import { getLimitUpThreshold } from "@/lib/indicators/limitUp";
import { STRATEGIES } from "@/lib/strategies";
import type { Strategy, StrategyCandidate } from "@/lib/strategies/types";
import type {
  MarketSentimentSnapshot,
  SectorSnapshot,
} from "@/lib/types/market";
import type {
  BacktestParams,
  BacktestResult,
  BacktestTrade,
  EquityPoint,
  PortfolioConfig,
  SkipReason,
  SkippedSignal,
} from "@/lib/types/backtest";
import type { StockDailyBar, StockMeta } from "@/lib/types/stock";
import {
  A_SHARE_DEFAULT_COSTS,
  applySlippage,
  commission,
  stampDuty,
  type CostModel,
} from "@/lib/config/costs";
import { evaluateRisk } from "./riskFilter";
import { scoreCandidate } from "./scoreEngine";

export interface BacktestInput extends BacktestParams {
  metas: StockMeta[];
  barsBySymbol: Record<string, StockDailyBar[]>;
  /** Per-date sector snapshot map. */
  sectorsByDate?: Record<string, SectorSnapshot[]>;
  /** Per-date sentiment snapshot map. */
  sentimentByDate?: Record<string, MarketSentimentSnapshot>;
  /**
   * Trading calendar; if omitted we derive from the union of bar dates.
   */
  tradingCalendar?: string[];
}

interface OpenPosition {
  symbol: string;
  meta: StockMeta;
  bars: StockDailyBar[];
  ma10: number[];
  entryDate: string;
  entryPrice: number; // post-slippage
  entryIdx: number; // index in bars
  shares: number;
  notional: number; // post-slippage entry notional in CNY
  feesPaid: number; // CNY
  slippagePaid: number; // CNY (signed sum: positive cost)
  stopLoss: number;
  keySupport: number;
  signalType: string;
  signalScore: number;
  riskLevel: string;
  sector: string;
}

const DEFAULT_PORTFOLIO: Required<PortfolioConfig> = {
  startingCapital: 1_000_000,
  allowConcurrentPositions: true,
  maxConcurrentPositions: 5,
  maxPositionsPerSector: 2,
  allowSameSymbolOverlap: false,
  minScore: 0,
};

function resolveSector(
  meta: StockMeta,
  snapshots: SectorSnapshot[],
): SectorSnapshot | undefined {
  const byIndustry = snapshots.find((s) => s.sectorName === meta.industry);
  if (byIndustry) return byIndustry;
  for (const concept of meta.concepts) {
    const m = snapshots.find((s) => s.sectorName === concept);
    if (m) return m;
  }
  return undefined;
}

function buildCalendar(input: BacktestInput): string[] {
  if (input.tradingCalendar?.length) {
    return input.tradingCalendar
      .filter((d) => d >= input.startDate && d <= input.endDate)
      .sort();
  }
  const dates = new Set<string>();
  for (const sym of Object.keys(input.barsBySymbol)) {
    for (const b of input.barsBySymbol[sym]) {
      if (b.date >= input.startDate && b.date <= input.endDate) dates.add(b.date);
    }
  }
  return Array.from(dates).sort();
}

function findBarIndex(bars: StockDailyBar[], date: string): number {
  // exact match; bars are sorted asc
  for (let i = 0; i < bars.length; i++) if (bars[i].date === date) return i;
  return -1;
}

function snapshotForDate(
  date: string,
  snapshots: Record<string, SectorSnapshot[]> | undefined,
): SectorSnapshot[] {
  if (!snapshots) return [];
  if (snapshots[date]) return snapshots[date];
  // most recent at or before
  const keys = Object.keys(snapshots).filter((k) => k <= date).sort();
  return snapshots[keys[keys.length - 1]] ?? [];
}

function sentimentForDate(
  date: string,
  snapshots: Record<string, MarketSentimentSnapshot> | undefined,
): MarketSentimentSnapshot | undefined {
  if (!snapshots) return undefined;
  if (snapshots[date]) return snapshots[date];
  const keys = Object.keys(snapshots).filter((k) => k <= date).sort();
  return snapshots[keys[keys.length - 1]];
}

function openAtLimitUp(
  bar: StockDailyBar,
  prevClose: number,
  meta: StockMeta,
): boolean {
  const thr = getLimitUpThreshold(meta.boardType);
  return (bar.open - prevClose) / prevClose >= thr * 0.99;
}

function openAtLimitDown(
  bar: StockDailyBar,
  prevClose: number,
  meta: StockMeta,
): boolean {
  const thr = getLimitUpThreshold(meta.boardType);
  return (prevClose - bar.open) / prevClose >= thr * 0.99;
}

export function runBacktest(input: BacktestInput): BacktestResult {
  const strategyDef = STRATEGIES[input.strategyId];
  if (!strategyDef) throw new Error(`Unknown strategy: ${input.strategyId}`);
  const strategy: Strategy = strategyDef.fn;

  const port = { ...DEFAULT_PORTFOLIO, ...(input.portfolio ?? {}) };
  const costs: CostModel = input.costs ?? A_SHARE_DEFAULT_COSTS;
  const startingCapital = port.startingCapital;

  // Pre-compute per-symbol MA10 series (used by BREAK_MA10).
  const ma10BySymbol: Record<string, number[]> = {};
  for (const meta of input.metas) {
    const bars = input.barsBySymbol[meta.symbol] ?? [];
    ma10BySymbol[meta.symbol] = calculateMA(bars.map((b) => b.close), 10);
  }

  const calendar = buildCalendar(input);
  if (calendar.length === 0) {
    return emptyResult(input, costs);
  }

  let cash = startingCapital;
  const open: Map<string, OpenPosition> = new Map();
  const trades: BacktestTrade[] = [];
  const equityCurve: EquityPoint[] = [];
  const skipped: SkippedSignal[] = [];
  let signalCount = 0;

  let peakEquity = startingCapital;
  let maxDD = 0;
  let exposureDays = 0;
  let totalFees = 0;
  let totalSlippage = 0;
  let turnoverNotional = 0;

  // Position-size in CNY for each new entry. Equal-weight across the cap.
  const positionAllocCny = startingCapital / Math.max(1, port.maxConcurrentPositions);

  for (let dayIdx = 0; dayIdx < calendar.length; dayIdx++) {
    const date = calendar[dayIdx];

    // ------------- 1. Process exits for all open positions -------------
    for (const [sym, pos] of Array.from(open.entries())) {
      const idx = findBarIndex(pos.bars, date);
      if (idx < 0) continue; // stock missing this date — leave position untouched
      // AUDIT A-6: T+1 — entry bar itself is not exit-eligible.
      if (idx <= pos.entryIdx) continue;

      const bar = pos.bars[idx];
      const heldDays = idx - pos.entryIdx;
      let exitReason: string | null = null;
      const ret = (bar.close - pos.entryPrice) / pos.entryPrice;

      if (input.sellRule === "FIXED_DAYS") {
        if (heldDays >= input.maxHoldingDays) exitReason = `FIXED_DAYS_${input.maxHoldingDays}`;
      } else if (input.sellRule === "STOP_LOSS_TAKE_PROFIT") {
        if (ret * 100 <= -input.stopLossPct) exitReason = "STOP_LOSS";
        else if (ret * 100 >= input.takeProfitPct) exitReason = "TAKE_PROFIT";
        else if (heldDays >= input.maxHoldingDays) exitReason = "MAX_HOLDING";
      } else if (input.sellRule === "BREAK_MA10") {
        const ma10 = pos.ma10[idx];
        if (!isNaN(ma10) && bar.close < ma10) exitReason = "BREAK_MA10";
        else if (heldDays >= input.maxHoldingDays) exitReason = "MAX_HOLDING";
      } else if (input.sellRule === "BREAK_SUPPORT") {
        if (bar.close < pos.keySupport) exitReason = "BREAK_SUPPORT";
        else if (heldDays >= input.maxHoldingDays) exitReason = "MAX_HOLDING";
      }

      if (!exitReason) continue;

      // A-share execution: if the bar opened at limit-down we cannot exit
      // at open today. Use close as a defensive proxy; flag the skip if
      // even close is at the lower limit. We exit at close (lower bound).
      const prev = pos.bars[idx - 1];
      const lockedDownAll = bar.high === bar.low && openAtLimitDown(bar, prev.close, pos.meta);
      if (lockedDownAll) {
        // can't exit today, try tomorrow
        continue;
      }
      const exitPriceRaw = bar.close;
      const exitPrice = applySlippage(exitPriceRaw, "SELL", costs.slippageBps);
      const exitNotional = exitPrice * pos.shares;
      const sellCommission = commission(exitNotional, "SELL", costs);
      const sellStamp = stampDuty(exitNotional, "SELL", costs);
      const sellSlippageCost = (exitPriceRaw - exitPrice) * pos.shares;
      const proceeds = exitNotional - sellCommission - sellStamp;
      cash += proceeds;

      const grossRet = ((exitPriceRaw - pos.entryPrice) / pos.entryPrice) * 100;
      const totalFeesForTrade = pos.feesPaid + sellCommission + sellStamp;
      const totalSlipForTrade = pos.slippagePaid + sellSlippageCost;
      // Net return on the original entry notional, including all costs.
      const netPnl = proceeds - pos.notional - pos.feesPaid; // entry notional already excludes entry fees; pos.notional is post-slippage cash outlay before fees? we recorded pos.notional as entryPrice * shares (post-slip). Entry fees were already debited from cash separately.
      // Recompute precisely: cash impact is sale proceeds - (entry cash outlay).
      // entry cash outlay = pos.notional + pos.feesPaid
      const cashInflow = proceeds;
      const cashOutflow = pos.notional + pos.feesPaid;
      const netRet = ((cashInflow - cashOutflow) / cashOutflow) * 100;

      totalFees += sellCommission + sellStamp;
      totalSlippage += sellSlippageCost;

      trades.push({
        symbol: pos.symbol,
        strategyId: input.strategyId,
        entryDate: pos.entryDate,
        exitDate: bar.date,
        entryPrice: +pos.entryPrice.toFixed(2),
        exitPrice: +exitPrice.toFixed(2),
        returnPct: +netRet.toFixed(2),
        grossReturnPct: +grossRet.toFixed(2),
        holdingDays: heldDays,
        exitReason,
        pnlCny: +(cashInflow - cashOutflow).toFixed(2),
        feesCny: +totalFeesForTrade.toFixed(2),
        slippageCny: +totalSlipForTrade.toFixed(2),
        signalType: pos.signalType,
        signalScore: pos.signalScore,
        riskLevel: pos.riskLevel,
        sector: pos.sector,
      });
      void netPnl; // (alias kept for clarity / future use)
      open.delete(sym);
    }

    // ------------- 2. Generate signals as of `date` -------------
    const sectorSnaps = snapshotForDate(date, input.sectorsByDate);
    const sentimentSnap = sentimentForDate(date, input.sentimentByDate);
    const todaysCandidates: {
      meta: StockMeta;
      bars: StockDailyBar[];
      todayIdx: number;
      candidate: StrategyCandidate;
      score: number;
      riskLevel: string;
      sectorName: string;
    }[] = [];

    for (const meta of input.metas) {
      const bars = input.barsBySymbol[meta.symbol] ?? [];
      const todayIdx = findBarIndex(bars, date);
      if (todayIdx < 30) continue; // need warm-up
      const sliced = bars.slice(0, todayIdx + 1);
      const sector = resolveSector(meta, sectorSnaps);

      const risk = evaluateRisk({ meta, bars: sliced, sector, sentiment: sentimentSnap });
      if (risk.excluded) {
        skipped.push({ date, symbol: meta.symbol, reason: "RISK_FORBIDDEN" });
        continue;
      }

      const cand = strategy({ meta, bars: sliced, sector, sentiment: sentimentSnap });
      if (!cand) continue;
      signalCount += 1;

      const sc = scoreCandidate({
        candidate: cand,
        meta,
        bars: sliced,
        sector,
        sentiment: sentimentSnap,
        riskPenalty: risk.riskPenalty,
      });

      if (sc.score < port.minScore) {
        skipped.push({ date, symbol: meta.symbol, reason: "MIN_SCORE" });
        continue;
      }

      todaysCandidates.push({
        meta,
        bars,
        todayIdx,
        candidate: cand,
        score: sc.score,
        riskLevel: risk.riskLevel,
        sectorName: sector?.sectorName ?? meta.industry,
      });
    }

    // Highest scores first when allocating limited capacity.
    todaysCandidates.sort((a, b) => b.score - a.score);

    // ------------- 3. Apply capacity and execute entries -------------
    const sectorCount = new Map<string, number>();
    for (const p of open.values()) {
      sectorCount.set(p.sector, (sectorCount.get(p.sector) ?? 0) + 1);
    }

    for (const c of todaysCandidates) {
      const skip = (reason: SkipReason) => {
        skipped.push({ date, symbol: c.meta.symbol, reason });
      };

      if (!port.allowConcurrentPositions && open.size >= 1) {
        skip("POSITION_CAP");
        continue;
      }
      if (open.size >= port.maxConcurrentPositions) {
        skip("POSITION_CAP");
        continue;
      }
      const sc = sectorCount.get(c.sectorName) ?? 0;
      if (sc >= port.maxPositionsPerSector) {
        skip("SECTOR_CAP");
        continue;
      }
      if (!port.allowSameSymbolOverlap && open.has(c.meta.symbol)) {
        skip("SYMBOL_OVERLAP");
        continue;
      }

      // Determine entry bar and reference price.
      let entryIdx: number;
      let referencePrice: number;
      const todayBar = c.bars[c.todayIdx];
      if (input.buyRule === "CLOSE") {
        entryIdx = c.todayIdx;
        referencePrice = todayBar.close;
      } else {
        // NEXT_OPEN
        if (c.todayIdx + 1 >= c.bars.length) {
          skip("NO_NEXT_BAR");
          continue;
        }
        entryIdx = c.todayIdx + 1;
        referencePrice = c.bars[entryIdx].open;
      }

      // AUDIT A-7: skip if entry bar opens at limit-up (no fillable liquidity).
      if (input.buyRule === "NEXT_OPEN") {
        const entryBar = c.bars[entryIdx];
        const prev = c.bars[entryIdx - 1];
        if (openAtLimitUp(entryBar, prev.close, c.meta)) {
          skip("LIMIT_OPEN_BLOCKED");
          continue;
        }
      }

      const fillPrice = applySlippage(referencePrice, "BUY", costs.slippageBps);
      // Equal-weight allocation; shares rounded down to whole.
      const targetCny = Math.min(positionAllocCny, cash);
      const shares = Math.floor(targetCny / fillPrice);
      if (shares <= 0) {
        skip("INSUFFICIENT_CASH");
        continue;
      }
      const notional = fillPrice * shares;
      const buyCommission = commission(notional, "BUY", costs);
      const buySlippageCost = (fillPrice - referencePrice) * shares;
      if (cash < notional + buyCommission) {
        skip("INSUFFICIENT_CASH");
        continue;
      }
      cash -= notional + buyCommission;
      totalFees += buyCommission;
      totalSlippage += buySlippageCost;
      turnoverNotional += notional;

      const pos: OpenPosition = {
        symbol: c.meta.symbol,
        meta: c.meta,
        bars: c.bars,
        ma10: ma10BySymbol[c.meta.symbol],
        entryDate: c.bars[entryIdx].date,
        entryPrice: fillPrice,
        entryIdx,
        shares,
        notional,
        feesPaid: buyCommission,
        slippagePaid: buySlippageCost,
        stopLoss: c.candidate.stopLoss,
        keySupport: c.candidate.keySupport,
        signalType: c.candidate.signalType,
        signalScore: c.score,
        riskLevel: c.riskLevel,
        sector: c.sectorName,
      };
      open.set(c.meta.symbol, pos);
      sectorCount.set(c.sectorName, (sectorCount.get(c.sectorName) ?? 0) + 1);
    }

    // ------------- 4. Mark to market & track equity -------------
    let positionsValue = 0;
    for (const p of open.values()) {
      const idx = findBarIndex(p.bars, date);
      const price = idx >= 0 ? p.bars[idx].close : p.entryPrice;
      positionsValue += price * p.shares;
    }
    const equity = cash + positionsValue;
    equityCurve.push({
      date,
      equity: +equity.toFixed(2),
      cash: +cash.toFixed(2),
      positionsValue: +positionsValue.toFixed(2),
      positionCount: open.size,
    });
    peakEquity = Math.max(peakEquity, equity);
    const dd = (peakEquity - equity) / peakEquity;
    if (dd > maxDD) maxDD = dd;
    if (open.size > 0) exposureDays += 1;
  }

  // ------------- 5. Force-close any remaining positions on the last day -------------
  const lastDate = calendar[calendar.length - 1];
  for (const [sym, pos] of Array.from(open.entries())) {
    const idx = findBarIndex(pos.bars, lastDate);
    if (idx < 0 || idx <= pos.entryIdx) {
      open.delete(sym);
      continue;
    }
    const bar = pos.bars[idx];
    const exitPriceRaw = bar.close;
    const exitPrice = applySlippage(exitPriceRaw, "SELL", costs.slippageBps);
    const exitNotional = exitPrice * pos.shares;
    const sellCommission = commission(exitNotional, "SELL", costs);
    const sellStamp = stampDuty(exitNotional, "SELL", costs);
    const sellSlippageCost = (exitPriceRaw - exitPrice) * pos.shares;
    const proceeds = exitNotional - sellCommission - sellStamp;
    cash += proceeds;
    totalFees += sellCommission + sellStamp;
    totalSlippage += sellSlippageCost;
    const grossRet = ((exitPriceRaw - pos.entryPrice) / pos.entryPrice) * 100;
    const cashInflow = proceeds;
    const cashOutflow = pos.notional + pos.feesPaid;
    const netRet = ((cashInflow - cashOutflow) / cashOutflow) * 100;
    trades.push({
      symbol: pos.symbol,
      strategyId: input.strategyId,
      entryDate: pos.entryDate,
      exitDate: bar.date,
      entryPrice: +pos.entryPrice.toFixed(2),
      exitPrice: +exitPrice.toFixed(2),
      returnPct: +netRet.toFixed(2),
      grossReturnPct: +grossRet.toFixed(2),
      holdingDays: idx - pos.entryIdx,
      exitReason: "PERIOD_END",
      pnlCny: +(cashInflow - cashOutflow).toFixed(2),
      feesCny: +(pos.feesPaid + sellCommission + sellStamp).toFixed(2),
      slippageCny: +(pos.slippagePaid + sellSlippageCost).toFixed(2),
      signalType: pos.signalType,
      signalScore: pos.signalScore,
      riskLevel: pos.riskLevel,
      sector: pos.sector,
    });
    open.delete(sym);
  }

  return summarize({
    input,
    costs,
    startingCapital,
    calendar,
    trades,
    equityCurve,
    skipped,
    signalCount,
    totalFees,
    totalSlippage,
    turnoverNotional,
    maxDD,
    exposureDays,
  });
}

function emptyResult(input: BacktestInput, costs: CostModel): BacktestResult {
  return {
    strategyId: input.strategyId,
    startDate: input.startDate,
    endDate: input.endDate,
    totalReturn: 0,
    annualizedReturn: 0,
    winRate: 0,
    averageReturn: 0,
    profitLossRatio: 0,
    maxDrawdown: 0,
    maxConsecutiveLosses: 0,
    exposureRatio: 0,
    averageHoldingDays: 0,
    turnover: 0,
    totalFeesCny: 0,
    totalSlippageCny: 0,
    signalCount: 0,
    executedTradeCount: 0,
    skippedSignalCount: 0,
    skipReasonCounts: {},
    trades: [],
    equityCurve: [],
    costs,
  };
}

interface SummarizeArgs {
  input: BacktestInput;
  costs: CostModel;
  startingCapital: number;
  calendar: string[];
  trades: BacktestTrade[];
  equityCurve: EquityPoint[];
  skipped: SkippedSignal[];
  signalCount: number;
  totalFees: number;
  totalSlippage: number;
  turnoverNotional: number;
  maxDD: number;
  exposureDays: number;
}

function summarize(a: SummarizeArgs): BacktestResult {
  const { input, costs, startingCapital, calendar, trades, equityCurve, skipped } = a;
  const finalEquity =
    equityCurve.length > 0 ? equityCurve[equityCurve.length - 1].equity : startingCapital;
  const totalReturn = ((finalEquity - startingCapital) / startingCapital) * 100;

  const days =
    (new Date(input.endDate).getTime() - new Date(input.startDate).getTime()) /
    (1000 * 60 * 60 * 24);
  const years = Math.max(days / 365, 1 / 365);
  const annualizedReturn =
    ((finalEquity / startingCapital) ** (1 / years) - 1) * 100;

  let wins = 0;
  let winSum = 0;
  let lossSum = 0;
  let maxConsec = 0;
  let consec = 0;
  for (const t of trades) {
    if (t.returnPct > 0) {
      wins += 1;
      winSum += t.returnPct;
      consec = 0;
    } else {
      lossSum += t.returnPct;
      consec += 1;
      if (consec > maxConsec) maxConsec = consec;
    }
  }
  const winRate = trades.length ? wins / trades.length : 0;
  const averageReturn = trades.length
    ? trades.reduce((s, t) => s + t.returnPct, 0) / trades.length
    : 0;
  const avgWin = wins ? winSum / wins : 0;
  const losses = trades.length - wins;
  const avgLoss = losses ? lossSum / losses : 0;
  const profitLossRatio =
    avgLoss === 0 ? (avgWin > 0 ? 99 : 0) : +(Math.abs(avgWin / avgLoss).toFixed(2));

  const skipReasonCounts: Partial<Record<SkipReason, number>> = {};
  for (const s of skipped) {
    skipReasonCounts[s.reason] = (skipReasonCounts[s.reason] ?? 0) + 1;
  }

  const averageHoldingDays = trades.length
    ? trades.reduce((s, t) => s + t.holdingDays, 0) / trades.length
    : 0;

  return {
    strategyId: input.strategyId,
    startDate: input.startDate,
    endDate: input.endDate,
    totalReturn: +totalReturn.toFixed(2),
    annualizedReturn: +annualizedReturn.toFixed(2),
    winRate: +winRate.toFixed(3),
    averageReturn: +averageReturn.toFixed(2),
    profitLossRatio,
    maxDrawdown: +(a.maxDD * 100).toFixed(2),
    maxConsecutiveLosses: maxConsec,
    exposureRatio: calendar.length ? +(a.exposureDays / calendar.length).toFixed(3) : 0,
    averageHoldingDays: +averageHoldingDays.toFixed(2),
    turnover: +(a.turnoverNotional / startingCapital).toFixed(3),
    totalFeesCny: +a.totalFees.toFixed(2),
    totalSlippageCny: +a.totalSlippage.toFixed(2),
    signalCount: a.signalCount,
    executedTradeCount: trades.length,
    skippedSignalCount: skipped.length,
    skipReasonCounts,
    trades,
    equityCurve,
    costs,
  };
}
