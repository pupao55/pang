// A-share retail trading cost defaults used by the backtest engine.
//
// All rates are decimals applied to the trade notional.
//   commissionRateBuy / Sell: brokerage commission per side.
//   stampDutyRate: 印花税 — sell-side only on A-share equities.
//   slippageBps: half-spread approximation, applied to both buy and sell.
//
// Realistic defaults (post-2023 retail tier):
//   commission ≈ 0.025% per side (broker minimum 5 CNY ignored in v1)
//   stamp duty = 0.05% on sell
//   slippage ≈ 10 bps round-trip (5 bps per side)
//
// These are tunable per backtest via `BacktestParams.costs`.

export interface CostModel {
  commissionRateBuy: number;
  commissionRateSell: number;
  stampDutyRate: number;
  /** Per-side slippage in basis points (1 bp = 0.01%). */
  slippageBps: number;
  /** Minimum commission per side in CNY (ignored if 0). */
  minCommissionCny: number;
}

export const A_SHARE_DEFAULT_COSTS: CostModel = {
  commissionRateBuy: 0.0003, // 0.03%
  commissionRateSell: 0.0003,
  stampDutyRate: 0.0005, // 0.05% sell-only
  slippageBps: 10, // half-spread proxy, 5 bps per side -> 10 bps round-trip total
  minCommissionCny: 0, // disabled in v1; per-share allocation usually > min
};

export const ZERO_COSTS: CostModel = {
  commissionRateBuy: 0,
  commissionRateSell: 0,
  stampDutyRate: 0,
  slippageBps: 0,
  minCommissionCny: 0,
};

/**
 * Apply per-side slippage to a fill price.
 * Buys fill higher than reference; sells fill lower.
 */
export function applySlippage(
  price: number,
  side: "BUY" | "SELL",
  bps: number,
): number {
  const slip = price * (bps / 2 / 10_000); // half-spread per side
  return side === "BUY" ? price + slip : price - slip;
}

/** Commission CNY paid for a trade leg. Min-commission floor optional. */
export function commission(
  notional: number,
  side: "BUY" | "SELL",
  costs: CostModel,
): number {
  const rate = side === "BUY" ? costs.commissionRateBuy : costs.commissionRateSell;
  const c = notional * rate;
  return costs.minCommissionCny > 0 ? Math.max(c, costs.minCommissionCny) : c;
}

/** Stamp duty CNY (sell-side only). */
export function stampDuty(notional: number, side: "BUY" | "SELL", costs: CostModel): number {
  return side === "SELL" ? notional * costs.stampDutyRate : 0;
}
