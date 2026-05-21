# SPEC.md — Pangzi product spec

This is the canonical product spec. The README is user-facing prose; this file
is what agents read to act. If they disagree, this file wins for behavioral
decisions, and the README is updated to match.

## Product Summary

Pangzi is a **research and decision-support dashboard for Chinese A-share
short-term / swing setups**. It does not place orders, does not predict
prices, and does not constitute investment advice.

Given a universe of stocks and recent daily bars, Pangzi:

1. Runs five strategies that generate trading-style candidates.
2. Scores each candidate with a transparent 5-component model
   (`technical 0.30 / sector 0.25 / sentiment 0.20 / liquidity 0.15 / fundamental 0.10`).
3. Subtracts a `riskPenalty` for ST flags, low liquidity, regulatory warnings,
   recent insider reductions, etc.
4. Stores every signal to a persistent JSONL store for forward-return analysis.
5. Surfaces calibration verdicts (`CALIBRATED` / `NOT_CALIBRATED` / `INCONCLUSIVE`),
   risk-filter effectiveness verdicts (`IMPROVES` / `NO_IMPROVEMENT` / `INCONCLUSIVE`),
   and v1.9 horizon-aware verdicts (`MOMENTUM_1D` / `MEAN_REVERTS_AFTER_1D` /
   `SHORT_SWING_3D` / `SWING_5D` / `NO_EDGE` / `INCONCLUSIVE`).

## Target Users

- Individual A-share traders who want a transparent scoring system rather
  than a black-box "AI pick."
- Quants / researchers evaluating Tongdaxin-style formulas at scale.
- The repo owner, who uses it to learn whether their gut strategies have
  measurable edge.

Pangzi is **not** for: institutional execution, options, futures, US equities,
or any audience that needs broker integration.

## Core User Workflows

1. **Daily screen** — Open `/dashboard`, then `/signals`. See today's
   ranked candidates with explanation, key levels, and risk caveats.
2. **Drill-down** — Click a symbol to land on `/stocks/[symbol]` for KLine
   chart + score breakdown.
3. **Research credibility** — Open `/validation` to see whether the score
   model is calibrated on the current dataset, whether the risk filter
   improves results, and (v1.9) which horizon the score model actually works at.
4. **Backtest** — Open `/backtest`, parameterize a strategy + horizon,
   review trade-level diagnostics and equity curve.
5. **Day-after review** — Open `/review` to see yesterday's signals against
   today's bars.

## Current Functionality

- 5 strategies registered in `src/lib/strategies/index.ts`.
- Score engine in `src/lib/engine/scoreEngine.ts`, weights in
  `src/lib/config/constants.ts` (sum-to-1 invariant enforced).
- Risk filter in `src/lib/engine/riskFilter.ts` with risk levels
  `LOW / MEDIUM / HIGH / FORBIDDEN`.
- Signal store: `data/signals/<source>/signals.jsonl`, append-only, can be
  rebuilt via `npm run rebuild:signals -- --source <id> --rebuild`.
- Two data adapters: `akshareLocalAdapter` and `baostockLocalAdapter`. The
  local sector builder synthesizes per-date sector strength when concept
  boards are unavailable.
- Validation pass produces `reports/<source>-validation-report.md`.
- Calibration pass produces `reports/calibration-report.md` and
  `reports/horizon-calibration-report.md`.
- /validation page surfaces readiness, calibration verdict, and v1.9 horizon
  verdict cards.

## Non-Goals

- Live order placement (now and forever, by design).
- Price prediction or "AI alpha."
- Auto-tuning of `SCORE_WEIGHTS` or strategy thresholds from diagnostic
  scripts. Recommendations only — the human approves.
- US / HK / crypto markets.
- Mobile-first UI (desktop research workflow only).

## Data Model / Key Entities

| Entity | Where | Notes |
|---|---|---|
| `StockMeta` | `src/lib/types/stock.ts` | symbol, board, industry, concepts, flags |
| `StockDailyBar` | `src/lib/types/stock.ts` | OHLCV + turnoverRate + pctChange |
| `SectorSnapshot` | `src/lib/types/market.ts` | sector strength + topStocks for a date |
| `MarketSentimentSnapshot` | `src/lib/types/market.ts` | regime + limit-up/down stats |
| `StockSignal` | `src/lib/types/signal.ts` | full in-memory signal incl. component scores |
| `HistoricalSignalRecord` | `src/lib/engine/scoreCalibration.ts` | persisted JSONL record (v1.9 added component scores) |
| `LocalSectorSnapshot` | `src/lib/engine/localSectorBuilder.ts` | synthesized sector with sectorType + memberCount |

## Main Screens or Interfaces

- `/dashboard` (default landing) — market sentiment + quick links + mock-data label.
- `/signals` — filterable signal table with expandable detail rows.
- `/validation` — research-readiness + calibration + risk-filter + horizon verdicts.
- `/backtest` — parameterized strategy backtest with diagnostics.
- `/review` — day-after performance review.
- `/stocks/[symbol]` — per-stock KLine + score breakdown.

## API / Backend Surface

Server components only — there is no public HTTP API. All work happens at
request time in the Next.js server runtime, reading from:

- `data/baostock/daily-bars/*.json` — per-symbol cached bars.
- `data/baostock/sectors/*.json` — generated sector snapshots per date.
- `data/baostock/sentiment/sentiment.jsonl` — per-date sentiment.
- `data/signals/<source>/signals.jsonl` — historical signal store.

Adapters in `src/lib/data/adapters/*Adapter.ts` are the abstraction boundary.

## Success Metrics

Because the product is research, "success" is measured by **honest calibration**,
not by predicted returns:

1. ≥ 1 strategy reaches `RESEARCH_READY` cache-maturity status with N ≥ 100
   signals in the top score bucket.
2. Score calibration verdict on real BaoStock data flips from
   `NOT_CALIBRATED` → `CALIBRATED` at *some* horizon (1d / 3d / 5d).
3. Risk filter verdict reaches `IMPROVES` on the same dataset.
4. /validation page makes the current limitations legible to a new user in
   under 30 seconds.

## Open Questions

- Should `SCORE_WEIGHTS` move to per-strategy weights given that v1.9 shows
  some strategies are `MEAN_REVERTS_AFTER_1D` while others are `NO_EDGE`?
- Is the 169-symbol BaoStock cache enough to test sectorLeader tightening,
  or do we need a 300+ universe first?
- Should `firstBreakout` be disabled (only 33 signals historically) or
  relaxed (weakest gate is `platformBreakout` at 96.3% rejection)?
- Mobile / tablet support — out of scope for v2 or never?
- Is there value in a public read-only deploy, or is this a private tool?

## TODO markers

- TODO: write a v2 SPEC update once the per-strategy horizon decision is made.
- TODO: nail down what "RESEARCH_READY" should mean for the dataset
  (currently still `EARLY_RESEARCH`).
- TODO: document the price-limit (涨停 / 跌停) execution model the backtest
  engine should use (AUDIT A-7 is still open).
