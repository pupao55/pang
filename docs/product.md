# Product

This is the human-readable view of "what Pangzi is" and "why we build it
this way." The machine-readable equivalent is `SPEC.md` — if they ever
disagree, SPEC wins for behavior and this doc gets updated.

## What it is

A local-first A-share research dashboard that:

- Surfaces 5 strategy-based daily candidate lists.
- Scores each candidate with a 5-component transparent model.
- Tells you, on its own, whether the score model is **calibrated** on the
  current dataset.
- Tells you (v1.9+) whether the calibration holds at **1-day, 3-day, or
  5-day horizons** — because a +8% 1d edge that mean-reverts by day 5 is a
  real edge at the wrong horizon, not a broken model.

## What it is not

- A trading platform. There is no broker integration and never will be.
- A predictor. Scores are decision-support, not forecasts.
- A black-box. Every score component, every gate, every risk penalty is
  inspectable in source.

## Why these strategies

The 5 shipped strategies were chosen because they map to common
Tongdaxin-style formula categories used in Chinese retail trading:

| Strategy | Setup |
|---|---|
| `breakout` / `firstBreakout` | Low-base breakout above a 40-day platform |
| `pullback` / `trendPullback` | Pullback to MA10/MA20 after trend |
| `secondBuy` / `limitUpSecondBuy` | Second-buy after a prior 涨停 |
| `sectorLeader` | Top stocks of the day's strongest sectors |
| `maxTurnoverBreakout` | Breakout coinciding with max-turnover day |

The point is not to "beat the market" — it's to put these formulas in a
form where the user can see whether they actually work on their data.

## Why honest calibration is the differentiator

Every mature A-share tool gives you signals. None gives you a verdict on
whether *its own scoring* has held up on real data. Pangzi does, openly,
on `/validation`.

That openness sometimes embarrassingly says "your score is `NOT_CALIBRATED`
at 5d" — and the v1.9 work showed why: the score IS calibrated, but at 1d.
This is the kind of finding the product is designed to surface.

## Roadmap (advisory — not committed)

- **v2 candidate**: per-strategy holding horizons (some strategies are 1d
  scalps, some are 5d swings; report and backtest them differently).
- **v2 candidate**: out-of-sample validation (split the historical store
  into in-sample / out-of-sample cohorts).
- **Permanently out-of-scope**: live trading, paid data feeds, mobile-first
  UI, US / HK / crypto markets.
