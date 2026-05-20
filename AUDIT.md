# Pangzi v1.1 Audit

Scope: a rigorous re-read of the v1 MVP, before adding any new product
features. Each finding is classified as **CRITICAL / HIGH / MEDIUM / LOW** and
records whether v1.1 fixes it or defers it.

Severity rubric:

- **CRITICAL** — incorrect output, look-ahead, or fundamentally wrong P&L.
- **HIGH** — significantly misleading results or material A-share gaps.
- **MEDIUM** — design fragility, hidden coupling, fragile heuristics.
- **LOW** — cosmetic, dead code, minor docs.

---

## A. Backtest engine

### A-1 (CRITICAL) Sequential-compounding portfolio model overstates returns
- **File:** `src/lib/engine/backtestEngine.ts:189-254`
- **Problem:** v1 sorts the trade list by `entryDate` then folds with
  `equity *= 1 + r/100`. This pretends the same dollar of capital sequentially
  rolls across every winning trade — even when those trades overlap in time
  (different symbols). Real portfolio compounding cannot reuse capital still
  tied up in another position.
- **Why it matters:** Returns can be wildly overstated, especially when many
  stocks signal on the same day; max drawdown is calculated only on trade
  exits and misses intra-trade drawdowns.
- **Fix:** Day-by-day portfolio replay with explicit cash, open positions,
  daily mark-to-market, and equal-weight allocation.
- **Fixed in v1.1:** **YES** — `backtestEngine.ts` is rewritten end-to-end.

### A-2 (CRITICAL) `findIndex` end-date semantics use `>= endDate`
- **File:** `src/lib/engine/backtestEngine.ts:45-48`
- **Problem:** `findIndex(bars, endDate)` returns the first bar **at or after**
  `endDate`. For an `endDate` that is a non-trading day (weekend/holiday) or
  beyond the data, this still resolves to a bar after the cutoff, extending the
  backtest window.
- **Why it matters:** Off-by-many-days at the right boundary; subtle when
  endDate happens to be a trading day, catastrophic for the typical case of
  "from 2024-01-01 to 2024-12-31".
- **Fix:** Add explicit `findIndexAtOrBefore(bars, date)` for end alignment and
  `findIndexAtOrAfter(bars, date)` for start.
- **Fixed in v1.1:** **YES** in new engine.

### A-3 (CRITICAL) No transaction costs, no slippage, no stamp duty
- **File:** `src/lib/engine/backtestEngine.ts` (entire file)
- **Problem:** Trades returned at raw `(exit - entry) / entry`. A-share retail
  cost (round-trip ≈ 0.11% commission + stamp duty + slippage) is omitted.
- **Why it matters:** Win/loss ratio overstated; short-holding-period strategies
  look profitable when they shouldn't be.
- **Fix:** Cost model with `commissionRateBuy/Sell`, `stampDutyRate` (sell
  only), `slippageBps`. A-share defaults set as specified.
- **Fixed in v1.1:** **YES** — `src/lib/config/costs.ts` + integrated.

### A-4 (HIGH) Backtest ignores `riskFilter` and `scoreEngine` thresholds
- **File:** `src/lib/engine/backtestEngine.ts:130-138`
- **Problem:** Backtest entries fire on *any* non-null candidate from the
  strategy. FORBIDDEN risk would never be entered in `runSignalEngine`, but
  here a forbidden stock (e.g. ST) could be backtested freely if a strategy
  technically returns a candidate.
- **Why it matters:** Backtest performance is divorced from what the live
  signal system would actually trade.
- **Fix:** Apply `evaluateRisk` per-bar, drop entries whose `excluded === true`,
  optionally enforce a `minScore` action gate.
- **Fixed in v1.1:** **YES** — risk + optional min-score check both added.

### A-5 (HIGH) Sector/sentiment context is global, not time-indexed
- **File:** `src/lib/engine/backtestEngine.ts:62, 131-136`
- **Problem:** `sectors` is a single array (typically today's snapshot) and
  `sentimentByDate` is optional; the v1 mock only ships `MOCK_SECTORS` for
  `EVAL_DATE`. During historical replay the strategy sees today's sector
  strength on every historical bar — pure look-ahead for sector scoring.
- **Why it matters:** A strategy that depends on "sector ranked #1 today"
  retroactively sees ranks that did not exist back then.
- **Fix:** Add `sectorsByDate` to backtest input; resolver picks the latest
  snapshot at or before the current trading day. Mock adapter still ships one
  snapshot but the indirection is in place.
- **Fixed in v1.1:** **YES** in backtest engine; mock adapter has a stub
  `getSectorSnapshots(date)` that returns the EVAL_DATE snapshot for any date
  (documented limitation).

### A-6 (MEDIUM) No T+1 enforcement
- **File:** `src/lib/engine/backtestEngine.ts:140-165`
- **Problem:** A-share T+1 forbids selling shares bought the same day. v1 uses
  close-vs-close exit checks; with `buyRule=CLOSE` no same-day exit can occur,
  but `buyRule=NEXT_OPEN` + a same-bar exit check (`BREAK_MA10` evaluated on
  the entry bar's close) can produce a same-day round-trip.
- **Fix:** Skip exit evaluation on the entry bar itself; first eligible exit
  bar is `entryIdx + 1`.
- **Fixed in v1.1:** **YES** — explicit `if (i === pos.entryIdx) continue;`.

### A-7 (MEDIUM) No price-limit (涨停 / 跌停) execution simulation
- **File:** `src/lib/engine/backtestEngine.ts` (entire)
- **Problem:** Backtest fills at any next-open price even if that bar opens at
  the daily limit (one-way move with no liquidity). Real-life fills would
  fail.
- **Why it matters:** Strategies that "buy at next open after a big breakout"
  may be filled at a price that no real trader could obtain (limit-up open
  with no offer).
- **Fix:** Add a check: if entry bar open vs prev-close ≥ `limitUpThreshold *
  0.99`, skip with reason `SKIP_LIMIT_OPEN`. Add the symmetric check for
  sells (limit-down open).
- **Fixed in v1.1:** **YES** — implemented with skipped-signal reason logged.

### A-8 (MEDIUM) Drawdown calculated trade-to-trade, not daily
- **File:** `src/lib/engine/backtestEngine.ts:200-213`
- **Problem:** Peak/drawdown updated only at trade exit. A 30% mid-trade
  drawdown that recovers before exit is invisible.
- **Fix:** Mark-to-market daily and update peak/DD per trading day.
- **Fixed in v1.1:** **YES** — daily equity series in the new engine.

### A-9 (MEDIUM) Annualized return uses calendar days, not trading days
- **File:** `src/lib/engine/backtestEngine.ts:226-229`
- **Problem:** `years = days / 365` blends weekends/holidays. Acceptable but
  imprecise for short windows.
- **Fix:** Document and continue with calendar; switch to a trading calendar
  when a real adapter ships one.
- **Fixed in v1.1:** Documented — formula kept.

### A-10 (MEDIUM) Missing duplicate-overlap protection per symbol
- **File:** `src/lib/engine/backtestEngine.ts`
- **Problem:** Within a single symbol the v1 loop holds at most one position
  at a time, but across the same symbol it can immediately re-enter on the
  exit bar (next iteration), inflating trade count.
- **Fix:** Add `allowSameSymbolOverlap` flag and an explicit cooldown of 1 bar.
- **Fixed in v1.1:** **YES** — `allowSameSymbolOverlap` config flag.

### A-11 (LOW) Dead constant
- **File:** `src/lib/engine/backtestEngine.ts:33`
- **Problem:** `TRADE_RISK_FRACTION` declared, unused.
- **Fixed in v1.1:** **YES** — removed.

---

## B. Strategies

### B-1 (HIGH) `limitUpSecondBuy`: max-turnover bar includes today
- **File:** `src/lib/strategies/limitUpSecondBuyStrategy.ts:69-73`
- **Problem:** `findMaxTurnoverBar(bars.slice(0, lastIdx + 1), …)` includes
  today. If today is itself a high-turnover breakout bar, `reclaimedMaxTurn`
  becomes trivially true (today's close vs today's bodyHigh — equal by
  definition when close = bodyHigh).
- **Why it matters:** Inflates technical score on the very bar that should be
  evaluating reclaim of *prior* battle zones.
- **Fix:** Use `bars.slice(0, lastIdx)` (exclude today), matching the pattern
  in `maxTurnoverBreakoutStrategy`.
- **Fixed in v1.1:** **YES**.

### B-2 (MEDIUM) Strategy state machine biases toward older real limit-ups
- **File:** `src/lib/strategies/limitUpSecondBuyStrategy.ts:39-50`
- **Problem:** Search iterates from `searchEnd` (most recent) backward; a
  near-limit-up assigns `limitUpIdx` but doesn't break, so a real limit-up
  further back overrides it. Net effect: an older real LU is preferred over a
  newer near LU — usually fine, but the choice is implicit.
- **Fix:** Make the preference explicit; document or refactor to two passes.
- **Fixed in v1.1:** Documented; refactor deferred (no behavior change needed).

### B-3 (MEDIUM) `isLimitUpBar` close-based proxy can over-flag
- **File:** `src/lib/indicators/limitUp.ts:21-26`
- **Problem:** Uses `(close - prev) / prev >= thr - 0.0005`. A clean +9.95% UP
  day that didn't actually seal at the limit will be marked as 涨停. Real-time
  limit detection requires intraday seal data.
- **Why it matters:** Inflates `LimitUpEvent` counts; affects strategies and
  sentiment that key off "yesterday's 涨停 cohort".
- **Fix:** Tighten by requiring `bar.close === bar.high` AND `change ≥ thr`,
  for synthetic precision; in real data require provider's `limitState`.
- **Fixed in v1.1:** **YES** — added `closeEqualsHighEpsilon` guard.

### B-4 (MEDIUM) `isNearLimitUpBar` is loose enough to be near-meaningless
- **File:** `src/lib/indicators/limitUp.ts:31-44`
- **Problem:** Threshold = 85% of limit (8.46% for MAIN, 17% for ChiNext).
  Triggers for many non-special days.
- **Fix:** Raise default to 95% AND require intraday `high` to reach the
  actual limit price for true 炸板 detection.
- **Fixed in v1.1:** Threshold raised + added `wasFailedLimitUpBar` which
  requires intraday high at limit AND close below.

### B-5 (LOW) Pure functions confirmed
- **Files:** all strategy modules
- **Problem:** Strategies have no external side-effects; they read
  `StrategyContext` and return a `StrategyCandidate`. Good.
- **Fixed in v1.1:** N/A.

---

## C. Indicators

### C-1 (MEDIUM) RSI seed uses simple avg over first `period` diffs
- **File:** `src/lib/indicators/rsi.ts`
- **Problem:** Wilder's RSI traditionally seeds with the simple average then
  smooths. Implementation matches. Edge case: when `avgLoss === 0` returns
  `100` — correct.
- **Fixed in v1.1:** OK.

### C-2 (LOW) `calculateMA` returns NaN for warm-up
- **File:** `src/lib/indicators/movingAverage.ts`
- **Problem:** Callers must check `isNaN`. Documented in JSDoc. Acceptable.
- **Fixed in v1.1:** N/A.

### C-3 (MEDIUM) `findMaxTurnoverBar` semantics: "counting the most recent N
  bars" but takes a slice of the array
- **File:** `src/lib/indicators/turnover.ts:7-16`
- **Problem:** Caller controls slicing; doc says "lookback" but logic just
  looks at the last `lookback` bars of whatever was passed in. Easy to
  misuse — caller in `limitUpSecondBuyStrategy` (see B-1) passes the full
  series.
- **Fix:** Either accept the full series and require an `endIdx` parameter, or
  enforce slicing internally with a clearer signature `findMaxTurnoverBar(bars,
  windowEnd, lookback)`.
- **Fixed in v1.1:** Behavior unchanged; documented in JSDoc and audit; the
  one buggy caller (B-1) was fixed at the call site.

---

## D. Score engine

### D-1 (HIGH) `positives`/`negatives` derived via regex over note strings
- **File:** `src/lib/engine/scoreEngine.ts:157-167`
- **Problem:** Edit a note string and the regex silently drops it. Fragile.
- **Fix:** Have each scoring sub-function return `{ value, positives[],
  negatives[] }` typed buckets.
- **Fixed in v1.1:** **YES** — refactored to typed buckets.

### D-2 (MEDIUM) `SCORE_WEIGHTS` not asserted to sum to 1
- **File:** `src/lib/config/constants.ts:36-44`
- **Problem:** Silent miscalibration if someone edits one weight without
  rebalancing.
- **Fix:** Add a top-level invariant assertion + a Vitest unit test.
- **Fixed in v1.1:** **YES** — added runtime assertion + test.

### D-3 (MEDIUM) `ACTION_THRESHOLDS` are arbitrary
- **File:** `src/lib/config/constants.ts:46-51`
- **Problem:** 75 / 60 / 45 chosen by eye, no empirical calibration.
- **Fix:** Mark explicitly as defaults pending calibration; expose as a
  config that backtest diagnostics can sweep.
- **Fixed in v1.1:** Comment added; calibration deferred.

### D-4 (MEDIUM) `scoreFundamentalSafety` market-cap rule rewards size
- **File:** `src/lib/engine/scoreEngine.ts:132-135`
- **Problem:** +5 for marketCap > 50B is a "size premium" that may not match
  short-term-trading reality (large caps have less momentum). Likely
  miscalibrated.
- **Fix:** Document and re-weight when real data lands.
- **Fixed in v1.1:** Deferred (calibration task).

---

## E. Risk filter

### E-1 (HIGH) "失败涨停" detection conflates close-change with intraday seal
- **File:** `src/lib/engine/riskFilter.ts:74-77`
- **Problem:** `isNearLimitUpBar && !isLimitUpBar` does not actually mean
  炸板; it means "close ≥ 85% of limit but not limit". Real 炸板 needs
  intraday high *at* the limit price and close lower.
- **Fix:** Replace with `wasFailedLimitUpBar(bar, prev, board)` checking
  `high reached limit ∧ close below limit`.
- **Fixed in v1.1:** **YES** — new util + risk filter switched.

### E-2 (MEDIUM) `riskPenalty` cap at 60
- **File:** `src/lib/engine/riskFilter.ts:99-101`
- **Problem:** Many compounding risks cap at 60 — but with a 100-cap weighted
  score, even max penalty leaves 40 ("AVOID" triggered explicitly anyway).
  Functionally OK, semantically muddy.
- **Fix:** Document.
- **Fixed in v1.1:** Documented.

### E-3 (MEDIUM) No suspension / 停牌 / 除权 awareness
- **File:** `src/lib/engine/riskFilter.ts` (and adapters)
- **Problem:** Real A-share data has 停牌 (no bars for days), 除权除息 (price
  jumps from corporate actions). Strategies will treat the gap or jump as
  signal.
- **Fix:** Adapter must adjust prices and flag suspension dates; risk filter
  should exclude stocks suspended within last N days.
- **Fixed in v1.1:** Adapter interface includes `getTradingCalendar`;
  adjustment handling deferred to real-adapter implementation, documented in
  README "known limitations".

---

## F. Signal merge

### F-1 (MEDIUM) Merge silently discards alternate-strategy info
- **File:** `src/lib/engine/signalEngine.ts:106-108`
- **Problem:** Per-stock dedup keeps only the highest-scoring candidate. The
  fact that two strategies fired on the same stock (corroborating signal) is
  lost.
- **Fix:** Keep the primary signal but attach a `corroboratingStrategies:
  string[]` list of other strategy ids that also fired.
- **Fixed in v1.1:** **YES** — new field on `StockSignal` is optional, set by
  merge step.

### F-2 (LOW) `runSignalEngine` re-evaluates risk before strategies
- **File:** `src/lib/engine/signalEngine.ts:47-53`
- **Problem:** Early-exits FORBIDDEN stocks before strategies run — efficient
  and correct. Just worth noting that explanations for "why no signal" never
  surface for excluded stocks.
- **Fix:** None required; backtest reports skipped reason.
- **Fixed in v1.1:** Note added.

---

## G. Review

### G-1 (HIGH) Forward returns are fabricated when no future bars exist
- **File:** `src/lib/engine/reviewEngine.ts:42-46`
- **Problem:** When `fwd(N)` is NaN, the code falls back to *backward* returns
  `(entry - past_bar.close) / past_bar.close`, presented as if it were forward
  performance. Misleading even though commented.
- **Fix:** Return NaN/"PENDING" and mark "未来数据不足"; remove the proxy.
- **Fixed in v1.1:** **YES** — proxy removed; PENDING label used.

### G-2 (MEDIUM) Review runs the engine on EVAL_DATE only
- **File:** `src/lib/engine/reviewEngine.ts`
- **Problem:** v1 only produces a one-shot review for "today". A true review
  needs point-in-time replay over a window.
- **Fix:** v1.1 review accepts a `windowDays` argument and walks back N
  historical close days, generating one row per (date, signal). Forward
  returns then exist.
- **Fixed in v1.1:** **YES** (in `reviewEngine.ts`).

---

## H. Mock data

### H-1 (HIGH) Mock data is engineered to fire on EVAL_DATE
- **Files:** `src/lib/data/mockDailyBars.ts`
- **Problem:** Every "positive" stock has explicit event overlays on the
  last bars (`t: 78, 79`) that deterministically produce signals on the
  evaluation date. This is helpful for showcasing the UI but creates a
  false sense of strategy efficacy in `/signals` and `/review`.
- **Why it matters:** Easy to mistake the staged demo for evidence the system
  works.
- **Fix:** Add explicit `SCENARIO` labels on each mock stock + a disclaimer
  banner on `/signals`. Backtest diagnostics over a wider window are the real
  measure of strategy quality.
- **Fixed in v1.1:** **YES** — disclaimer added in README + UI banner;
  long-window backtest now possible via point-in-time replay.

### H-2 (MEDIUM) Single sector & sentiment snapshot
- **File:** `src/lib/data/mockSectors.ts`, `src/lib/data/mockSentiment.ts`
- **Problem:** Static; sector ranks and market regime never change across the
  backtest window.
- **Fix:** Adapter contract supports per-date snapshots; mock adapter returns
  the same snapshot for any date (documented limitation).
- **Fixed in v1.1:** Adapter API added; richer mock series deferred.

### H-3 (LOW) Module-level bar cache
- **File:** `src/lib/data/mockDailyBars.ts:139-148`
- **Problem:** Lazy cache survives between requests in dev; harmless for
  read-only deterministic data.
- **Fixed in v1.1:** Kept.

---

## I. UI / strategy coupling

### I-1 (MEDIUM) `StockSignalTable` splits `strategyName` on `" / "`
- **File:** `src/components/StockSignalTable.tsx` (cells using `.split(" / ")`)
- **Problem:** Display layer parses domain strings. A localized strategy
  without "/" breaks the UI.
- **Fix:** Strategy registry should expose `{ id, nameCN, nameEN }`.
- **Fixed in v1.1:** **YES** — `STRATEGIES` enriched; UI consumes structured
  names; old `name` retained for back-compat.

### I-2 (LOW) Recharts horizontal reference uses `dataKey={() => support}`
- **File:** `src/components/KLineChart.tsx`
- **Problem:** Works but `<ReferenceLine>` is idiomatic.
- **Fixed in v1.1:** Deferred (cosmetic).

---

## J. Thresholds & A-share specifics

### J-1 (MEDIUM) `PULLBACK_TOLERANCE_PCT` is global
- **File:** `src/lib/config/constants.ts:34`
- **Problem:** One 1.5% value applied to unrelated checks (limit-body
  pullback in `limitUpSecondBuyStrategy`, MA touch in `trendPullbackStrategy`,
  body-low defence in `maxTurnoverBreakoutStrategy`). These setups merit
  different tolerances.
- **Fix:** Split into `LIMIT_BODY_TOLERANCE_PCT`, `MA_TOUCH_TOLERANCE_PCT`,
  `MAX_TURN_DEFENCE_TOLERANCE_PCT`.
- **Fixed in v1.1:** **YES** (split into three named constants).

### J-2 (HIGH) No 涨跌停 execution model in backtest
- See A-7. Fixed.

### J-3 (HIGH) No T+1 in backtest
- See A-6. Fixed.

### J-4 (HIGH) No transaction-cost modelling
- See A-3. Fixed.

### J-5 (MEDIUM) No suspension or corporate-action handling
- See E-3. Deferred to real-adapter implementation.

### J-6 (MEDIUM) BJ exchange (北交所) board type not modeled
- **File:** `src/lib/types/stock.ts`
- **Problem:** Only MAIN / CHINEXT / STAR. 北交所 stocks have a 30% daily
  limit and different rules.
- **Fix:** Add `BSE` board type with its own threshold; defer rest.
- **Fixed in v1.1:** Documented; types unchanged to avoid touching strategy
  internals — added a TODO.

### J-7 (MEDIUM) No 风险警示 differentiation (ST vs *ST vs 退市整理)
- **File:** `src/lib/types/stock.ts`
- **Problem:** Single `isST` boolean; reality has tiers.
- **Fixed in v1.1:** Documented; deferred.

---

## K. Hidden look-ahead

### K-1 (HIGH) `runSignalEngine` always uses the latest bar
- **File:** `src/lib/engine/signalEngine.ts:43-60`
- **Problem:** Intended for live "today" evaluation. If anyone ever calls it
  inside a historical loop while passing full-history bars, every strategy
  sees the future. Acceptable for v1's single use site, but easy to misuse.
- **Fix:** Accept an explicit `asOfDate` argument; truncate bars to that
  date. The new backtest engine uses its own per-bar slicing and never calls
  `runSignalEngine` in a loop.
- **Fixed in v1.1:** **YES** — `runSignalEngine` now accepts an optional
  `asOfDate` and slices each symbol's bars accordingly.

### K-2 (HIGH) Sector snapshot is "today's" during historical replay
- See A-5. Fixed via adapter API + per-date resolution.

### K-3 (HIGH) Sentiment snapshot global
- See A-5. Same fix.

---

## L. Duplicate signal inflation

### L-1 (MEDIUM) Same symbol can re-signal next bar after exit
- See A-10. Cooldown added.

### L-2 (LOW) Same strategy + same stock + multiple consecutive bars
- **Problem:** A trend strategy can flag the same setup for 3 days in a row.
  v1 backtest converts these into one trade because a position is already
  open; live `/signals` shows just today's snapshot. No real duplication.
- **Fixed in v1.1:** No change needed.

---

## M. Overfitting to mock scenarios

### M-1 (HIGH) Strategy thresholds tuned to make the staged events fire
- See H-1. The events in `mockDailyBars.ts` use percentages picked to match the
  strategy thresholds (e.g. `breakout` event at +8% on a stock so it crosses
  the 40-day high). This is not real evidence of strategy quality.
- **Fix:** v1.1 backtest diagnostics over a window are the real benchmark.
  README adds a warning about not over-interpreting `/signals`.
- **Fixed in v1.1:** Documented; nothing technical to "fix" in code beyond
  flagging.

### M-2 (MEDIUM) `firstBreakoutStrategy` 60-day rise cap of 60%
- **File:** `src/lib/strategies/firstBreakoutStrategy.ts:18`
- **Problem:** Single magic threshold; in a bull market many stocks rise
  > 60% and would be excluded.
- **Fixed in v1.1:** Moved to a named config constant for tunability.

---

## N. New gaps surfaced by the upgrade (now fixed)

| ID | Topic | Fix |
|----|-------|-----|
| N-1 | No data adapter abstraction | New `src/lib/data/adapters/` with `types.ts`, `mockAdapter.ts`, `csvAdapter.ts`, stubs for `akshareAdapter.ts` and `tushareAdapter.ts`. |
| N-2 | No CSV import path | `src/lib/data/csvImporter.ts` + tests. |
| N-3 | No backtest diagnostics | `src/lib/engine/backtestDiagnostics.ts` + UI panel. |
| N-4 | No structured strategy registry | `STRATEGIES` enriched with `{ id, nameCN, nameEN }`. |

---

## Issues deferred to v2 (explicit)

- Adjustment for 除权除息 (corporate actions / dividends).
- Real suspension (停牌) handling.
- 北交所 board type and its 30% limit.
- *ST / ST / 退市整理 differentiation.
- True candlestick chart.
- Persistent historical signal store (SQLite).
- Real `getMarketSentiment` derivation from rolling stats.
- Sentiment / sector adapters that vary by date in the mock dataset.
- Calibration of `ACTION_THRESHOLDS`, strategy `tech +=` bonuses, and the
  market-cap size premium against real backtests.
