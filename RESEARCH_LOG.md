# RESEARCH_LOG.md — market, user, and technical research notes

Append findings here as they emerge. Distinguish **evidence** (a dated link,
a screenshot, a measurement) from **opinion**. Researchers do not make final
product decisions — they record what is known and flag what is not. Product
decisions land in `DECISIONS.md`.

## Research Questions

Open questions that drive what to investigate next:

- **Q1**: Are there mainstream A-share research tools that publish their
  score calibration verdict openly the way Pangzi does, or is "honest
  calibration" actually a differentiator?
- **Q2**: For A-share retail users, is the 1d-vs-5d horizon distinction
  intuitive, or does it need explainer copy on `/validation`?
- **Q3**: How large does the universe need to be (in symbols × years) for
  the v1.9 score weight sweep to produce a top-bucket sample ≥ 100?
- **Q4**: Is BaoStock's free historical depth (~10 years for most A-share
  symbols) enough to validate the horizon profile across multiple market
  regimes (2018 bear, 2020 bull, 2022 sideways, 2024 bear)?
- **Q5**: Are there alternative free providers besides BaoStock + AkShare
  for A-share daily bars, especially for the post-2020 period?

## Findings

Date-stamped factual claims. Format: `YYYY-MM-DD — finding (source)`.

- 2026-05-20 — BaoStock free tier exposes ~10 years of daily OHLC + turnover
  + adjusted prices for ~5,400 active A-share symbols. Concept boards / 龙虎榜
  are **not** exposed (validated by reading `baostock_fetcher.py` outputs and
  the BaoStock docs as of v1.7).
- 2026-05-20 — On the current dev machine, AkShare requests to Eastmoney
  endpoints time out or get HTTP 412 after ~5 sequential calls — IP-level
  rate limit. Documented in README v1.5 retry-with-jitter section.
- 2026-05-20 — In the BaoStock 169-symbol cache, signals with score ≥ 80
  show +8.26% mean 1-day return and 88% win, but -1.07% / 32% win at 5d
  (n=66). Source: `reports/horizon-calibration-report.md` §3.
- 2026-05-20 — **T-006 firstBreakout relaxed-variant experiment.** Strict
  (40d lookback, close > platformHigh) fires 1,652 times in raw A/B over
  the 169-symbol cache (94,918 candidates, 1.74% pass rate); relaxed
  (30d lookback, close ≥ platformHigh × 0.99) fires 2,476 times (2.61%
  pass, +50% raw fire count). Forward returns: strict +5d +0.58% / win
  42%; relaxed +5d +0.89% / win 45%. **Verdict: `KEEP_STRICT`** — relaxed
  improves both 5d return and win rate marginally, but win rate (45%) is
  still below the 52% bar for `PROMISING_RELAXED` and the sample bump
  (×1.499) lands one signal short of the 1.5× threshold for
  `TEST_RELAXED`. No production default was changed.
  - Source: `reports/first-breakout-experiment.md`.
  - Caveat: the v1.9 horizon report listed firstBreakout at 33 signals;
    that number comes from the persisted signal store, which keeps only
    the top-scoring strategy per (symbol, date). The raw-fire count
    (1,652 here) is the correct denominator for an A/B comparison.
  - Next: T-013 (history rewrite) or T-007 (audit walk) — *not* a
    production strategy change, per D-006.

## Competitors / adjacent tools

- **同花顺 (THS)** — pro tool. Has concept boards, real-time 龙虎榜, fundamental
  data. Black-box scoring. Subscription.
- **东方财富 (Eastmoney)** — free for retail. Concept boards yes, calibrated
  scoring no.
- **米筐 (Ricequant)** — quant platform with Python sandbox. Closest in
  spirit but is a backtesting platform, not a daily research dashboard.
- **聚宽 (JoinQuant)** — similar to Ricequant.

Pangzi's distinctive position: **transparent, locally-run, calibration-honest,
research-not-trading**. Not aiming to replace any of the above for execution.

## User Interview Notes

> No formal user interviews yet. Add entries as they happen.

Template:

```
### YYYY-MM-DD — <name or pseudonym>
Background: <retail / quant / etc.>
Workflow:
Pain points:
Reaction to /validation page:
Quotes:
```

## Evidence

Place screenshots, links, or measurement notes in `docs/research-evidence/`
(create on demand) and reference them here. Today the directory does not yet
exist.

## Open Questions

Questions raised by findings but not yet investigated:

- Is there a published academic study on Tongdaxin-style breakout strategies
  on A-share? If yes, does it report 1d vs 5d profiles?
- Has the score-calibration `Spearman rank correlation` flipped sign on
  other A-share studies, or is the v1.9 finding unique to Pangzi's universe?
- Do BaoStock historical bars include the post-2020 STAR Market correctly?
  (The cache shows STAR symbols but coverage start-date wasn't audited.)
