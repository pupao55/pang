# Pangzi · A-share Research

> Decision-support and research tool for Chinese A-share short-term / swing
> trading. Screens, scores, explains and backtests stock setups derived from
> Tongdaxin-style formulas, restructured into a modular, testable engine.
>
> **⚠️ Research software — not investment advice.** This tool does not place
> orders, does not connect to any broker, and does not predict prices. All
> outputs (signals, scores, backtests) are for research and education. Always
> verify against primary sources before risking capital.

---

## Quick start

```bash
npm install
npm run dev            # local Next.js dev server (http://localhost:3000)

npm run typecheck      # TypeScript strict
npm test               # Vitest unit + integration tests
npm run build          # production build
```

`npm start` serves the production build.

The app boots in **MOCK** mode by default — no Python, no external data, no
network. To switch to real historical A-share data, see
[Using AkShare real data](#using-akshare-real-data) below.

---

## Running the demo dashboard

The fastest path to a working demo, against real BaoStock data:

```bash
npm run setup:baostock                                  # pip install baostock pandas
npm run fetch:baostock:sample                           # 5 well-known symbols
npm run build:sentiment -- --source baostockLocal
npm run check:maturity:baostock                         # honest readiness verdict
npm run validate:baostock                               # rebuild + validate + calibrate
npm run dev
```

Then open **http://localhost:3000/validation**.

The `/validation` page auto-picks the recommended provider, surfaces the
readiness level, and points to the latest report files. `/dashboard` carries
a top-of-page **Demo Status** card with a one-click button into
`/validation`. The full runbook lives at
[`reports/dashboard-runbook.md`](./reports/dashboard-runbook.md).

> The dashboard does **not** imply strategy profitability. Verdicts at
> `SMOKE_TEST_ONLY` and `EARLY_RESEARCH` are workflow validation only —
> calibration claims require a `RESEARCH_READY` cache (≥ 100 symbols).

---

## Horizon-aware calibration (v1.9)

After v1.8 finished generating local sector strength the score calibration
verdict moved from `INCONCLUSIVE` to `NOT_CALIBRATED` — the 5-day forward
return showed a *negative* rank correlation with the score, even though the
80-90 bucket carried a +8% / 88% win one-day blowout. The issue isn't the
score; it's the horizon we evaluated it on.

v1.9 adds **horizon-aware calibration**: it reports forward returns and win
rates at 1d / 2d / 3d / 5d / 10d for every strategy and every score bucket,
classifies the result into one of:

- `MOMENTUM_1D` — works for 1 day, fades after.
- `MEAN_REVERTS_AFTER_1D` — 1d edge that flips negative by 5d.
- `SHORT_SWING_3D` / `SWING_5D` — multi-day edge.
- `NO_EDGE` — no horizon profitable.
- `INCONCLUSIVE` — sample below 30.

### Why 1d edge and 5d edge are different

A breakout that pops 4% on day 1 and then drifts back to flat by day 5 is a
**real edge** — just not for a 5-day hold. Strategies should be backtested at
the horizon they were designed for. Mixing horizons across strategies makes
the calibration verdict look worse than the model actually is.

### Why high-score momentum may mean-revert

In the BaoStock 169-symbol cache the 80+ bucket is dominated by
`limitUpSecondBuy` signals firing after a 涨停 + 缩量回踩 setup. These tend to
gap-up and fade — classic 1d momentum, not a swing. Holding through 5 days
gives back most of the move and incurs additional risk.

### Why score weights should not be changed until validated

`scripts/horizon_calibration.ts` sweeps a constrained weight grid and prints
the best 1d / 3d / 5d / 10d picks plus a "robust" choice with the lowest
median rank across horizons. It deliberately does **not** edit
`src/lib/config/constants.ts`. The output is a recommendation only — picking
the best single-horizon weight set risks overfitting to the dataset we used
for tuning.

### How to run

```bash
npm run rebuild:signals -- --source baostockLocal --rebuild
npm run calibrate:horizons
```

The first command repopulates the signal store with component scores
(v1.9 added `technicalScore` / `sectorScore` / `sentimentScore` /
`liquidityScore` / `fundamentalSafetyScore` / `riskPenalty` to
`HistoricalSignalRecord`). The second command runs:

1. Horizon calibration per strategy + per score bucket.
2. Score weight sweep (advisory, no constants edited).
3. SectorLeader tightening sweep (sweeps `minSectorRankPercentile`,
   `minStockRankWithinSectorPercentile`, `minMemberCount`, sector types).
4. FirstBreakout gate review (counts rejections at each gate, names the
   weakest, suggests relaxation).

Output: `reports/horizon-calibration-report.md`. The /validation page shows a
one-card summary (best horizon for high-score signals + recommended next
action) and a link to the markdown.

### Honest limitations

- The sweep tightens but cannot loosen — only existing historical signals
  are reweighted. Loosening sectorLeader requires re-running
  `rebuild:signals` with a modified strategy.
- The conservative pick requires top-bucket sample ≥ 50; with the current
  169-symbol cache the 90-100 bucket is still in the low double-digits.
  Treat all "best weights" output as exploratory until top-bucket n ≥ 100.

## Local sector strength (v1.8)

BaoStock's free tier does **not** provide full historical concept / industry
boards. v1.8 closes that gap by computing **local sector strength** from the
cached universe instead of pretending the data is missing.

For every trading day in the cache, `build_local_sectors` groups stocks by
three layers — industry (from BaoStock's `query_stock_industry`), synthetic
**BOARD** group (`BOARD_MAIN` / `BOARD_CHINEXT` / `BOARD_STAR`), and
synthetic **PREFIX** group (`PREFIX_600` / `PREFIX_000` / `PREFIX_300` / …) —
then computes per-group:

- median + equal-weighted 1-day pct change
- cumulative 3-day and 5-day return
- breadth-up ratio (members closing positive)
- limit-up count
- top 5 stocks by daily pct change
- a 0-100 momentumScore combining all of the above
- strengthRank (1 = strongest of the day)

Only groups with **≥ 3 members** become snapshots; smaller groups are
dropped with a warning. Output goes to `data/baostock/sectors/{date}.json`
with a `source: "localSectorBuilder"` tag so the adapter knows to mark
`sectorMode = GENERATED` (not REAL).

### Why this matters

Before v1.8, every BaoStock signal had `sectorScore ≈ 50` (neutral) because
the adapter had no sector context. After weight integration, weighted
totals were locked into the 60-80 band — the **80-100 buckets were entirely
empty**, which made score calibration trivially `INCONCLUSIVE`. Local
sector strength fills the 80+ buckets back in so calibration can finally
exercise its main hypothesis: "do higher scores predict higher forward
returns?"

### Recommended workflow

```bash
npm run fetch:baostock:resume         # grow the universe (≥ 30 for early research, ≥ 100 ideal)
npm run refresh:baostock-context      # metadata + local sectors + sentiment
npm run check:data:baostock
npm run check:maturity:baostock
npm run rebuild:signals -- --source baostockLocal --rebuild
npm run validate:baostock
```

### Honest limitations

- **Synthetic groups are not concepts.** `PREFIX_600` does not mean "all
  Shanghai main-board stocks share a theme". It groups together stocks that
  often move together for structural reasons (board liquidity, regulatory
  regime, retail attention) without claiming a thematic narrative.
- **Larger universe = better.** With < 30 symbols most industry groups fall
  below the 3-member floor and the only viable groups are BOARD_* and
  PREFIX_* (synthetic). Industry coverage scales linearly with universe
  size.
- **`sectorMode = GENERATED` is honest, not equivalent to upstream concept
  boards.** Reports and `/validation` tag generated sectors explicitly so
  calibration verdicts can be read in context.

---

## Multi-provider data ingestion (v1.7)

AkShare is not the only A-share daily-bar source. v1.7 adds **BaoStock** as
a fully wired alternative provider so an IP-block on Eastmoney does not
leave you stuck.

```
+-------------+      +-------------+      +-----------+
|  AkShare    |      |  BaoStock   |      |  CSV /    |
| (Eastmoney) |      | (xtquant)   |      |  Tushare  |
+------+------+      +------+------+      +-----+-----+
       |                    |                   |
       v                    v                   v
+----------------------------------------------------+
|   local JSON cache: data/{provider}/daily-bars/    |
+--------------------------+-------------------------+
                           |
                           v
              +------------+-------------+
              |  TS DataAdapter (read)   |
              |  akshareLocal /          |
              |  baostockLocal           |
              +------------+-------------+
                           |
                           v
            signal / backtest / calibration engines
```

### Why two providers

AkShare scrapes Eastmoney / Sina. v1.4–v1.6 demonstrated that Eastmoney can
IP-block a machine across **every** AkShare endpoint (universe, per-symbol,
sector, metadata). BaoStock uses an independent upstream and a normal
`login()` / `logout()` flow, so the block does not transfer.

In our v1.7 smoke test with the **same four symbols that AkShare had been
blocking** (`601138.SH`, `000001.SZ`, `002415.SZ`, `300308.SZ`), BaoStock
fetched all of them on the first attempt — 5/5 successful, 0 failed.

### Recommended workflow

```bash
# Install BaoStock (one-time)
npm run setup:baostock

# Sample fetch (5 well-known symbols)
npm run fetch:baostock:sample

# Health + maturity
npm run check:data:baostock
npm run check:maturity:baostock

# Generate sentiment from BaoStock bars (pure TS, no network)
npm run build:sentiment -- --source baostockLocal

# Build signals + validate + calibrate
npm run rebuild:signals -- --source baostockLocal --rebuild
npm run validate:strategies -- --source baostockLocal
npm run calibrate:strategies -- --source baostockLocal

# Larger universe (100 symbols, resumable)
npm run fetch:baostock:resume
npm run fetch:baostock:failed     # retry losers later
```

### When to use which provider

Run **`npm run fetch:provider:campaign`**. It inspects both providers'
local caches + status files and recommends the next command. Typical
verdicts:

| Situation | Recommendation |
|---|---|
| AkShare blocked, BaoStock missing | `setup:baostock && fetch:baostock:sample` |
| AkShare blocked, BaoStock < 30 symbols | `fetch:baostock:resume` |
| AkShare blocked, BaoStock ≥ 30 symbols | `build:sentiment && validate:baostock` |
| AkShare growing, < 30 symbols | `fetch:akshare:resume` |
| AkShare healthy at 30+ symbols | `refresh:akshare-context && calibrate:strategies` |

### Always compare before mixing providers

Adjusted close prices from BaoStock and AkShare can differ. Before treating
two providers as interchangeable, run:

```bash
npm run compare:providers -- --symbol 300750.SZ
```

This writes `reports/provider-comparison-300750.SZ.md` with:

- date overlap + dates only in one provider
- mean / max absolute close-diff percent
- mean / max absolute pctChange diff (percentage points)
- top divergent rows (close-diff sorted)
- a `likelyAdjustmentMismatch` flag when mean |close diff| > 2% (suggests
  qfq-vs-hfq-vs-raw mismatch — refetch one side with the matching mode)

In our smoke test, AkShare's qfq for `300750.SZ` and BaoStock's qfq differed
by mean **1.76%** absolute on close — close enough that the comparison tool
does NOT flag a mismatch, but large enough to refuse blindly mixing the two
in a single calibration run. **Pick one provider per calibration.**

### Limitations of v1.7 BaoStock support

- BaoStock free tier does **not** expose concept tags or per-stock industry
  classification reliably. `baostockLocalAdapter` carries `metadataMode =
  FALLBACK` until a dedicated BaoStock metadata pass is added.
- BaoStock has no sector-board endpoints — `sectorMode` will be `MISSING`
  unless you copy `data/akshare/sectors/` over manually (and accept the date
  mismatch).
- BaoStock returns volume in 100-share lots, not shares. The comparison tool
  may report large volume-ratio deviations vs AkShare; treat as a unit
  difference until you've inspected the raw response.
- BaoStock does not cover 北交所 (BJ) symbols on the free tier; those will
  return `EMPTY_DATA` / `INVALID_SYMBOL`.

---

## Research readiness (v1.6.1)

After every cache refresh, ask the question that matters most:

```bash
npm run check:maturity
```

This writes `reports/cache-maturity-report.md` and prints a one-line verdict.
It looks at universe size, average history per symbol, latest-date coverage,
sector/sentiment availability, per-strategy signal counts, score-bucket
distribution, and risk-level diversity, then issues one of four readiness
levels:

| Level | Trigger | What it means |
|---|---|---|
| 🛑 **NOT_READY** | < 5 symbols or < 1000 bars | Workflow validation only — no strategy evidence. |
| ⚠️ **SMOKE_TEST_ONLY** | 5–29 symbols | Pipeline works; do not interpret strategy outputs. |
| 🟡 **EARLY_RESEARCH** | ≥ 30 symbols, ≥ 200 avg bars, ≥ 1 strategy with 100 signals | Preliminary strategy debugging; not final calibration. |
| ✅ **RESEARCH_READY** | ≥ 100 symbols, ≥ 250 avg bars, ≥ 3 strategies with 100 signals, score buckets 60-90+ populated, risk diversity, sector ≥ 50%, sentiment ≥ 80% | Meaningful strategy comparison; results are still not investment advice. |

### Why the floors are where they are

- **1 symbol is not enough.** Every single-symbol cohort is correlated 1.0
  with itself — no calibration claim survives. The `300750.SZ`-only cache
  from v1.4 deliberately produced INCONCLUSIVE verdicts.
- **30 symbols is only "early research".** Score buckets above 80 only
  populate when sector/sentiment scoring fires across a wider universe — a
  prerequisite for any calibration claim, not a guarantee of one.
- **100+ symbols is a better minimum** for KEEP_CANDIDATE / DISABLE_CANDIDATE
  verdicts. v1.3 strong recommendations require n ≥ 100 signals per strategy,
  which in practice means 100+ distinct symbols × 250+ trading days.
- **Sector coverage matters.** `sectorScore` is 25% of the total. With mock
  sectors, every real-data score is dragged into the 60-80 band — the 80-100
  bucket stays empty and calibration goes INCONCLUSIVE regardless of strategy.
- **Score-bucket distribution matters.** Calibration compares high-score
  signals against low-score signals. If the 80-100 bucket is empty, the
  verdict logic can't fire (treated as INCONCLUSIVE in v1.3).
- **HIGH / FORBIDDEN samples matter.** The risk filter is a no-op when every
  signal is LOW. v1.5 risk-filter rules surface this as INCONCLUSIVE, and
  v1.6.1's readiness check warns explicitly when only LOW signals exist.

### The recommended loop after a fresh fetch

```bash
npm run fetch:akshare:resume         # grow the cache (slow / polite)
npm run refresh:akshare-context      # metadata + sectors + sentiment
npm run check:data                   # structural health
npm run check:maturity               # ← v1.6.1: are we research-ready?
npm run rebuild:signals -- --source akshareLocal --rebuild
npm run validate:strategies -- --source akshareLocal
npm run calibrate:strategies
```

When `check:maturity` says SMOKE_TEST_ONLY, **do not interpret the calibration
report's verdicts as strategy evidence** — they describe what the engine sees,
not whether the strategies work.

---

## Real AkShare context: metadata, sectors, sentiment (v1.6)

v1.4 / v1.5 had a real-data weakness: sector and sentiment data were always
the mock fallback, which compressed every real signal's score into a narrow
band and made sector-dependent strategies impossible to validate. v1.6 adds:

| Cache file | Purpose | Generated by |
|---|---|---|
| `data/akshare/metadata/stocks.json` | universe + name + industry + market cap | `npm run fetch:metadata` (use `:full` for industry backfill) |
| `data/akshare/sectors/{date}.json` | current-day industry + concept board snapshots | `npm run fetch:sectors` |
| `data/akshare/sentiment/sentiment.jsonl` | per-date market sentiment derived from cached bars | `npm run build:sentiment` |
| `data/akshare/trading-calendar.json` | real A-share trading days | `npm run fetch:calendar` |

Refresh all context in one go (after a fresh bar fetch):

```bash
npm run refresh:akshare-context
# = fetch:metadata && fetch:sectors && build:sentiment
```

### Why sector / sentiment matter

- `sectorScore` is 25% of the total score. With mock sector data, every real
  symbol that isn't in `MOCK_SECTORS.topStocks` is dragged toward 50, so the
  weighted score never breaks 80 and **the entire 80-100 score bucket stays
  empty** — calibration verdicts go to `INCONCLUSIVE` regardless of strategy
  quality.
- `sentimentScore` is 20% of the total and gates the `marketRegime`-based
  bonuses/penalties. Mock sentiment is always `STRONG`, so the regime-based
  filtering never fires on real data.
- Without real context, `IMPROVES` from the risk-filter validator can be
  vacuous (v1.4 saw this — all 211 signals were LOW, so every cohort was
  identical). v1.5 INCONCLUSIVE rules + v1.6 generated sentiment make the
  verdict honest.

### Fallback priority

`akshareLocalAdapter` resolves context in this order:

1. **REAL** — `metadata/stocks.json` for stock meta; `sectors/{date}.json`
   for sector snapshots (with nearest-prior-date fallback within the cache).
2. **GENERATED** — `sentiment/sentiment.jsonl` produced by
   `marketSentimentBuilder` from the cached bars themselves.
3. **FALLBACK** — mock snapshot. Surfaced via `sectorIsFallback` /
   `sentimentIsFallback` so the UI can warn explicitly.
4. **MISSING** — when no data is available at all. v1.6 specifically refuses
   to penalize the score: `sectorScore` stays at neutral 50 and a
   `sectorScoreCaveat` is attached to the output instead of dragging the
   stock down.

### Limitations of historical sector data

AkShare's free-tier sector endpoints (`stock_board_industry_name_em`,
`stock_board_concept_name_em`) reliably return **current-day** snapshots
only. Historical per-board data is available via `*_hist_em` but requires
one call per board (≈ 80 industry + 200+ concept boards), so historical
sector validation is gated behind a future opt-in. Treat v1.6 sector
validation as "recent calendar coverage" rather than full-history.

### Per-strategy calibration (v1.6)

Global calibration verdicts mix all strategies; a well-tuned strategy can be
masked by noise from another. v1.6 adds `buildPerStrategyCalibration` which
runs score calibration, risk-filter validation, threshold sweep, and quality
assessment **separately for each strategy** and surfaces the results in
`reports/calibration-report.md` under "Per-strategy calibration (v1.6)" and
on the `/validation` page.

---

## Building the AkShare cache safely (v1.5)

AkShare scrapes public upstream sources (Eastmoney, Sina). Hitting them with
fast back-to-back requests results in `RemoteDisconnected` blocks that
persist for the rest of your session — v1.4 demonstrated this empirically.

**Use the slow / resumable workflow** unless you specifically know you can
tolerate the throttling.

### Recommended workflow

```bash
# One-time setup
pip install akshare --upgrade
npm run fetch:calendar             # real A-share trading calendar (one-shot)

# Sample (5 well-known symbols), polite pacing
npm run fetch:akshare:sample:slow  # 45–90 s between symbols, --resume, --skip-existing

# Larger universe (first 100 spot symbols), resumable
npm run fetch:akshare:resume       # 45–120 s pacing, stops after 10 consecutive failures

# Pick up where you left off — retry only previously failed/empty symbols
npm run fetch:akshare:failed       # 60–150 s pacing, --failed-only

# Sanity check + validation
npm run check:data
npm run rebuild:signals -- --source akshareLocal --rebuild
npm run validate:strategies -- --source akshareLocal
npm run calibrate:strategies
```

### How resume works

- `data/akshare/fetch-status.json` — cumulative per-symbol status (SUCCESS /
  FAILED / EMPTY_DATA / SCHEMA_ERROR / INVALID_SYMBOL / SKIPPED). Persisted
  after every symbol so an interrupted run never loses ground.
- `data/akshare/import-report.json` — cumulative aggregate report. Reflects
  what's actually on disk, not just the most recent run.
- `data/akshare/fetch-runs/{timestamp}.json` — immutable per-run audit log.
- `--resume`: skip symbols already marked `SUCCESS` for the same
  (startDate, endDate, adjust) scope.
- `--skip-existing`: skip symbols whose cached JSON file is present and
  valid. The status entry is promoted to SUCCESS so downstream views agree.
- `--failed-only`: iterate only the symbols whose last status was
  FAILED / EMPTY_DATA / SCHEMA_ERROR. Does NOT call `stock_zh_a_spot_em()`.
- `--force`: ignore status + cache entirely; refetch.
- `--stop-after-consecutive-failures N`: abort early when N consecutive
  upstream failures suggest your IP has been throttled.
- `--user-agent-rotate`: cycle UAs across attempts (mild anti-throttle).

### Real validation needs ≥ 30 symbols

The /validation page surfaces a sample-size warning when the cache has
fewer than 30 symbols. v1.3 strong KEEP/DISABLE verdicts require ≥ 100
signals per strategy — practically that means ≥ 30 distinct symbols over
≥ 200 trading days. **300+ symbols is the realistic minimum for any
calibration-driven decision.**

### Why the fast scripts still exist

`npm run fetch:akshare` and `fetch:akshare:sample` use shorter sleeps and
are kept for **development only** (e.g. CI smoke). For any real research
session, use the `:slow` / `:resume` / `:failed` variants.

---

## Using AkShare real data

Pangzi's real-data pipeline is **offline AkShare → local JSON cache → TS
adapter → engines**. The web app never calls Python or scrapes the network at
request time; it only reads the local cache. This keeps the runtime
reproducible and avoids surprise rate-limiting.

### 0 · Prerequisites

- Python 3.8+ (`python3 --version`)
- AkShare: `pip install akshare --upgrade`
- Node 18+ (for `tsx` CLI runner — already a devDependency)

### 1 · Fetch sample data (5 well-known symbols)

```bash
npm run fetch:akshare:sample
```

This calls `scripts/akshare_fetcher.py`, which uses
`ak.stock_zh_a_hist(symbol, period="daily", adjust="qfq", ...)` and writes one
file per symbol to `data/akshare/daily-bars/{symbol}.json`, plus a roll-up
`data/akshare/import-report.json`.

### 2 · Fetch first 100 symbols of the live universe

```bash
npm run fetch:akshare
```

Resolves the universe via `ak.stock_zh_a_spot_em()`, then caps to the first
`--limit 100` symbols. Tunable via flags:

```bash
python3 scripts/akshare_fetcher.py \
  --start-date 20220101 --end-date 20260519 \
  --symbols 300750,601138,000001 \
  --adjust qfq \
  --output data/akshare \
  --sleep-seconds 0.5 \
  --retry 3
```

### 3 · Rebuild the historical signal store from the cache

```bash
npm run rebuild:signals -- --source akshareLocal --rebuild
```

Walks the trading calendar day-by-day with no look-ahead, runs the signal
engine point-in-time at each close, and appends to
`data/signals/akshareLocal/signals.jsonl`.

**No-overwrite default:** without `--rebuild`, the script aborts if a store
already exists. This is intentional — historical signals must not be silently
rewritten with hindsight.

Optional flags: `--start-date`, `--end-date`, `--min-score 60`.

### 4 · Generate the validation report

```bash
npm run validate:strategies -- --source akshareLocal
```

Writes `reports/akshareLocal-validation-report.md` containing:

- dataset summary + AkShare import report
- per-strategy / per-month / per-signal-type / per-risk-level forward returns
- score calibration table + monotonicity verdict + warning if not calibrated
- risk filter cohort comparison (ALL / NO_FORBIDDEN / NO_HIGH / LOW_MED_ONLY)
- top 20 best + top 20 worst trades
- top failure modes
- per-strategy recommendation (KEEP / MODIFY / DISABLE / NEEDS_MORE_DATA)

The convenience alias `npm run validate:akshare` runs steps 3 + 4 together.

### 3b · Sanity-check the cache (v1.4)

```bash
npm run check:data
```

Scans `data/akshare/daily-bars/*.json` and writes
`reports/data-health-report.md` with universe-wide summary + per-symbol
warnings (duplicates, missing weekdays, impossible OHLC, zero-volume rows,
abnormal pct changes, short histories, missing `adjust` field, BJ
board-fallbacks). Run this before `validate:strategies` whenever you refresh
the cache — it catches the upstream issues that would otherwise poison the
calibration report.

### 4b · Generate the calibration report (v1.3)

```bash
npm run calibrate:strategies
```

Writes `reports/calibration-report.md` containing:

- executive summary with overall `scoreCalibration` and `riskFilter` verdicts
  (`CALIBRATED` / `NOT_CALIBRATED` / `INCONCLUSIVE` and `IMPROVES` /
  `NO_IMPROVEMENT` / `INCONCLUSIVE`)
- per-strategy quality table with recommendation
  (`KEEP_CANDIDATE` / `MODIFY_CANDIDATE` / `DISABLE_CANDIDATE` /
  `NEEDS_MORE_DATA`) and sample-size badge
  (`OK` / `LOW_CONFIDENCE` / `NEEDS_MORE_DATA`)
- failure-mode breakdowns by strategy / risk level / signal type / score
  bucket / board type / month
- threshold sweep (best overall / best conservative / best high-signal-count)
- recommended threshold changes

### 5 · View the live dashboard

```bash
npm run dev
# open http://localhost:3000/validation
```

The `/validation` page surfaces the import report, signal store stats, the
calibration table, and the risk-filter comparison. The `/backtest` page now
has a **MOCK | AKSHARE_LOCAL** data-source selector.

### How to evaluate whether a strategy works

A repeatable evaluation loop:

```bash
# 1. Pull real bars (one-time per refresh)
pip install akshare --upgrade
npm run fetch:akshare           # or fetch:akshare:sample

# 2. Generate point-in-time historical signals
npm run rebuild:signals -- --source akshareLocal --rebuild

# 3. Surface what the strategies actually did
npm run validate:strategies -- --source akshareLocal
#    → reports/akshareLocal-validation-report.md

# 4. Decide whether to believe the result
npm run calibrate:strategies
#    → reports/calibration-report.md

# 5. (optional) Inspect the same data interactively
npm run dev
open http://localhost:3000/validation
```

#### Interpreting the verdicts

| Verdict / badge | What it means | What to do |
|---|---|---|
| **`NEEDS_MORE_DATA`** (n < 30) | Not enough signals to draw any conclusion. | Fetch more symbols or extend the date range. |
| **`LOW_CONFIDENCE`** (30 ≤ n < 100) | Headline numbers exist but `KEEP_CANDIDATE` / `DISABLE_CANDIDATE` won't fire. | Use with extreme caution; keep collecting data. |
| **`OK`** (n ≥ 100) | Sample large enough for the full verdict. | Treat as evidence; still re-evaluate quarterly. |
| **`KEEP_CANDIDATE`** | `avg5d > 0`, `win5d > 52%`, `worst5d ≥ -10`, calibration positive. | Strategy may be promoted; verify before live use. |
| **`DISABLE_CANDIDATE`** | `avg5d < 0`, `win5d < 45%`, `worst5d < -12`. | Disable and investigate failure modes. |
| **`MODIFY_CANDIDATE`** | Marginal: at least one gate fails but not all. | Tune thresholds; do not promote. |
| **`CALIBRATED`** | Higher score buckets outperform lower buckets (Spearman ≥ 0.4, monotonic on +5d) on n ≥ 30 buckets. | `ACTION_THRESHOLDS` are reasonable. |
| **`NOT_CALIBRATED`** | Enough data, but score is not predictive. | Re-weight `SCORE_WEIGHTS` before raising `minScore`. |
| **`IMPROVES`** | Stricter risk cohorts have higher avg5d. | Risk filter is doing its job. |
| **`NO_IMPROVEMENT`** | Stricter cohorts don't help. | Drill into byRiskLevel failure modes — some risk reasons may be too aggressive. |
| **`INCONCLUSIVE`** | Insufficient samples for the verdict path. | Always means more data, never "OK to use anyway". |

#### Why sample size matters

A strategy that wins 8 out of 10 small-window bets looks great until you run
it 200 times. The v1.3 verdict floor (n ≥ 100 for strong verdicts) is there
precisely to keep you from reading meaning into noise. Mock data (`source=mock`)
**always** trips the calibration warning because the demo bars are
engineered — that is not evidence of strategy quality.

#### Why mock performance is not evidence

`/signals` and `/review` on the mock universe produce engineered results
designed to exercise UI paths. The relevant question is whether the same
strategy code produces returns on **real AkShare bars** over a multi-month
window. Always treat the AkShare `reports/calibration-report.md` as the
source of truth, never the mock pages.

### Reading the validation report

Focus on these signals before changing any strategy:

1. **`signalCount` per strategy.** Below ~20 → `NEEDS_MORE_DATA`. Recommendation
   text already labels this.
2. **Score calibration warning.** If higher score buckets don't outperform
   lower buckets, the score formula or thresholds need re-weighting. Don't
   raise `ACTION_THRESHOLDS` until calibration is OK on a real dataset.
3. **Risk filter cohort table.** If `LOW_MED_ONLY` doesn't outperform `ALL`,
   the risk reasons firing on profitable signals need inspection (drill into
   the "Top failure modes" table).
4. **Per-month performance.** A strategy that worked in 2024-01 but blew up in
   2024-03 is regime-sensitive — investigate before keeping.

### Limitations (real data)

- **AkShare upstream may change or rate-limit.** Always cache locally;
  re-fetch only when you need fresh bars.
- **Sector / sentiment / market regime** are still mock fallbacks in v1.2 — the
  UI labels them as such. Strategies that depend heavily on these dimensions
  (sectorLeader, regime-based scoring) are NOT validated on real data yet.
- **No corporate action handling.** `--adjust qfq` is used so historical
  prices are forward-adjusted at fetch time, but suspension (停牌) gaps are
  not flagged — strategies see a continuous series with missing dates.
- **No 北交所 native board type.** BJ symbols default to MAIN with a warning;
  the 30% daily limit is not modelled.
- **Past performance does not predict future returns.** The validation report
  is a research tool, not a trading recommendation. Always verify upstream
  data from multiple sources before risking capital.

---

## System architecture

```
                +------------------------------+
                |   AkShare Python fetcher     |  (offline, scripts/akshare_fetcher.py)
                |   stock_zh_a_spot_em()        |
                |   stock_zh_a_hist(...,        |
                |     adjust="qfq")             |
                +---------------+--------------+
                                | writes JSON
                                v
                +------------------------------+
                |    data/akshare/*.json       |
                |   (per-symbol cache +        |
                |    import-report.json)       |
                +---------------+--------------+
                                |
                                v
                +------------------------------+
                |        Data adapters         |
                |  (mock | akshareLocal |      |
                |   csv | akshare† | tushare†) |
                +---------------+--------------+
                                |
                                v
                +------------------------------+
                |          Indicators          |
                |  MA · RSI · OBV · turnover · |
                |  limit-up / failed limit-up  |
                +---------------+--------------+
                                |
                                v
                +------------------------------+
                |          Strategies          |
                |  pure (ctx) -> candidate|null|
                |  · limit-up second buy        |
                |  · max-turnover breakout      |
                |  · sector leader              |
                |  · trend pullback             |
                |  · low-base first breakout    |
                +---------------+--------------+
                                |
        +-----------------------+--------------------------+
        |                                                  |
        v                                                  v
+--------------------+                          +----------------------+
|     Risk filter    |  --(penalty / FORBIDDEN)>|     Score engine     |
| ST · delisting ·   |                          | 30/25/20/15/10 mix - |
| 炸板 · overextended|                          | risk penalty         |
| · weak/panic regime|                          +----------+-----------+
+--------------------+                                     |
                                                            v
                                                +----------------------+
                                                |    Signal engine     |
                                                |  per-stock merge,    |
                                                |  corroborating list, |
                                                |  asOfDate slicing    |
                                                +-----+----------------+
                                                      |
                +-------------------------------------+--------------------+
                |                                                          |
                v                                                          v
        +-------------+                                          +-----------------+
        |  /signals   |                                          | Backtest engine |
        | /stocks/... |                                          | day-by-day      |
        | /dashboard  |                                          | portfolio sim,  |
        | /review     |                                          | T+1, costs,     |
        +-------------+                                          | limit-open gate |
                                                                  +--------+--------+
                                                                            |
                                                                            v
                                                                  +-------------------+
                                                                  |    Diagnostics    |
                                                                  | by regime/sector/ |
                                                                  | score bucket etc. |
                                                                  +-------------------+
```

† AkShare and Tushare adapters are interface stubs in v1.1 — fail loudly until
wired up. See "Connecting real data" below.

### Data flow (textual)

`adapter.getStockMetas()` + `adapter.getDailyBarsForUniverse(...)` +
`adapter.getSectorSnapshots(date)` + `adapter.getMarketSentiment(date)` →
`indicators` (computed inside strategy/engine code) →
`strategy(ctx)` returns `StrategyCandidate | null` →
`evaluateRisk()` produces penalty + may exclude →
`scoreCandidate()` produces 0–100 score + suggested action →
`runSignalEngine()` merges candidates per stock, sorts by score →
either consumed by **UI** (`/signals`, `/stocks`, `/dashboard`, `/review`) or
fed into **`runBacktest()`** for point-in-time replay over a window.

---

## Pages

| Route | Purpose |
|-------|---------|
| `/dashboard` | Market regime, limit-up/down counts, sector strength |
| `/signals`   | Today's candidate stocks with score breakdown |
| `/stocks/[symbol]` | Per-stock detail: chart, MAs, key levels, score, risks |
| `/backtest` | Point-in-time portfolio backtest + diagnostics |
| `/review`   | Daily review: forward returns and labels |

---

## Engine pipeline

```
StockMeta[] + bars + sectors + sentiment
  │
  ▼
risk filter (FORBIDDEN cases short-circuit)
  │
  ▼
each strategy(ctx) → StrategyCandidate | null
  │
  ▼
score engine (weighted 0-100 components - risk penalty)
  │
  ▼
merge per stock (highest score wins, others recorded as corroborating)
  │
  ▼
StockSignal[]
```

### Score formula (`src/lib/config/constants.ts`)

```
total = 0.30·technical + 0.25·sector + 0.20·sentiment + 0.15·liquidity
      + 0.10·fundamentalSafety - riskPenalty
```

Action thresholds: `STANDARD_POSITION ≥ 75`, `LIGHT_POSITION ≥ 60`,
`WATCH ≥ 45`, else `AVOID`.

The weights sum is checked at module load (`constants.ts`); a unit test
re-asserts it (`src/tests/config/scoreWeights.test.ts`).

---

## Backtest engine (v1.1 — point-in-time portfolio replay)

- **Day-by-day calendar walk.** Each trading day:
  1. Mark-to-market open positions and check exit conditions.
  2. Re-evaluate strategies with **bars truncated to that date** (no
     look-ahead).
  3. Apply portfolio caps (concurrent positions, sector cap, no
     same-symbol overlap) and execute entries.
  4. Record an equity point with `{cash, positionsValue, positionCount}`.
- **T+1 enforced.** First exit-eligible bar is `entryIdx + 1`.
- **A-share execution model.**
  - Default costs: `commissionRateBuy/Sell = 0.03%`, `stampDutyRate = 0.05%`
    (sell only), `slippageBps = 10` per round trip. Configurable via
    `BacktestParams.costs`.
  - If the entry bar opens at limit-up (no offer), the entry is skipped with
    reason `LIMIT_OPEN_BLOCKED`.
  - If the exit bar is locked at limit-down, the exit is deferred to the next
    bar.
- **Portfolio config** (`BacktestParams.portfolio`):
  - `startingCapital`, `allowConcurrentPositions`,
    `maxConcurrentPositions`, `maxPositionsPerSector`,
    `allowSameSymbolOverlap`, `minScore`.
- **Metrics returned:** `totalReturn`, `annualizedReturn`, `winRate`,
  `averageReturn`, `profitLossRatio`, `maxDrawdown`, `maxConsecutiveLosses`,
  `exposureRatio`, `averageHoldingDays`, `turnover`, `totalFeesCny`,
  `totalSlippageCny`, `signalCount`, `executedTradeCount`,
  `skippedSignalCount`, `skipReasonCounts`.
- **Diagnostics** (`buildDiagnostics()` in `backtestDiagnostics.ts`):
  by-strategy, by-sector, by-signal-type, by-score-bucket (90+/80-90/70-80/<70),
  by-risk-level, by-holding-period, by-market-regime; best/worst 10 trades;
  most common failure reasons.

---

## Strategies included

| ID | Name | Core idea |
|----|------|-----------|
| `limitUpSecondBuy`    | 涨停后二买 | After a 5-60d prior 涨停, look for pullback that respects key support and reclaims MA10/MA20/限板实体高 |
| `maxTurnoverBreakout` | 最大换手位突破 | The 120-day max-turnover day is a capital battle zone; reclaim of body high with volume = breakout |
| `sectorLeader`        | 板块龙头 | Score sector strength (rank, momentum, limit-ups) and reward listed top stocks |
| `trendPullback`       | 趋势回踩 | Bullish MA stack, recent MA10/MA20 retest, volume contracts then expands on rebound |
| `firstBreakout`       | 低位首爆 | Low base (≤60% 60d rise), 40-day high break, amount + turnover both expand |

---

## How to add a new strategy

1. Implement a pure function in `src/lib/strategies/yourStrategy.ts`
   matching `Strategy = (ctx: StrategyContext) => StrategyCandidate | null`.
2. Register it in `src/lib/strategies/index.ts`:
   ```ts
   def("yourId", "中文名", "English Name", yourStrategy),
   ```
3. Add the id to the BacktestForm dropdown in
   `src/app/backtest/BacktestForm.tsx`.
4. Write 3+ tests in `src/tests/strategies/<id>.test.ts`:
   valid setup → signal, invalid setup → null, risk/scoring interaction.

Avoid hardcoded magic numbers — put them in `src/lib/config/constants.ts`.

---

## How to import CSV data

```ts
import { importDailyBarsCsv } from "@/lib/data/csvImporter";
import { createCsvAdapter } from "@/lib/data/adapters";

const csv = await readFile("./bars.csv", "utf8");
const adapter = createCsvAdapter({
  metas: myStockMetas,
  csv,
  sectorsByDate: { "2024-12-31": [...] },
  sentimentByDate: { "2024-12-31": {...} },
});

const bars = await adapter.getDailyBars("600000", "2024-01-01", "2024-12-31");
```

Expected CSV columns (header required, order-independent):

```
symbol,name,date,open,high,low,close,volume,amount,turnoverRate,pctChange
```

Validation surfaces structured warnings (`MISSING_COLUMN`, `INVALID_DATE`,
`INVALID_NUMBER`, `DUPLICATE_ROW`, `MISSING_TRADING_DATE`, `BAD_ROW_LENGTH`,
`EMPTY_FILE`). Fatal kinds (missing column / empty file) abort import.

---

## How to connect AkShare later

`src/lib/data/adapters/akshareAdapter.ts` is a stub. AkShare is a Python
library; two viable shapes:

1. **Sidecar service.** Run a small FastAPI app that exposes
   `/getDailyBars?symbol=...&start=...&end=...` calling `akshare.stock_zh_a_hist`.
   The TS adapter does HTTP fetches.
2. **Offline export.** Run a daily Python script to dump bars to CSV/Parquet,
   then use `csvAdapter` directly.

The adapter interface (`src/lib/data/adapters/types.ts`) is fully defined.
Implement all six methods; engines and UI need no further changes.

---

## How to connect Tushare later

`src/lib/data/adapters/tushareAdapter.ts` is a stub. Tushare Pro is HTTP/JSON:

```
POST https://api.tushare.pro
{ "api_name": "daily", "token": "...", "params": {...}, "fields": "..." }
```

Map each call to the equivalent type. Key endpoints:

- `stock_basic` → `getStockMetas`
- `daily` (apply `adj_factor`) → `getDailyBars`
- `index_dailybasic`, `ths_daily` → `getSectorSnapshots`
- `trade_cal` → `getTradingCalendar`

Handle quotas (per-minute caps), 停牌 (omit bars), 除权除息 (apply
`adj_factor`), and 退市整理 (set `hasDelistingRisk: true` on `StockMeta`).

---

## Known limitations (v1.1)

- **Mock data is engineered to fire on `EVAL_DATE`.** Treat `/signals` and
  `/review` as UI demos; only the **backtest** over a wider window is a
  meaningful test of strategy quality.
- **Mock sector + sentiment snapshots are static** — every backtest day sees
  the same snapshot. Strategies that key on regime change can't be tested
  with mock alone. The adapter interface supports per-date snapshots; real
  adapters should ship them.
- **No 除权除息 adjustment.** Real adapters must forward/back-adjust prices
  using corporate-action factors.
- **No 停牌 (suspension) handling beyond "bar is missing".** Strategies will
  silently treat the gap as continuous.
- **No 北交所 board type yet.** Only MAIN / CHINEXT / STAR thresholds are
  modeled.
- **ACTION_THRESHOLDS and per-strategy `tech +=` bonuses are uncalibrated.**
  Use diagnostics over real data to recalibrate.
- **Chart is line+MA hybrid**, not a true candlestick.
- **Backtest does not yet model**: minimum commission floor, broker-specific
  fee tiers, intraday minute-level execution, multi-strategy concurrent
  backtests (one strategy per run).
- **Limit-up detection is close+high heuristic** (no minute data); real
  adapters with a `limitState` field should override.

See [AUDIT.md](./AUDIT.md) for the full severity-classified list.

---

## Project structure

```
src/
  app/                Next.js App-Router pages
    backtest/         page.tsx, BacktestForm.tsx, actions.ts
    dashboard/, signals/, stocks/[symbol]/, review/
  components/         UI building blocks
  lib/
    config/           constants.ts, costs.ts — thresholds & A-share defaults
    indicators/       MA, RSI, OBV, turnover, limit-up
    strategies/       five strategy modules + registry
    engine/           riskFilter, scoreEngine, signalEngine, backtestEngine,
                      backtestDiagnostics, reviewEngine
    data/
      adapters/       types, mock, csv, akshare-stub, tushare-stub
      csvImporter.ts  CSV → bars with structured warnings
      mock*.ts        deterministic seeded fixture
    types/            stock, market, signal, backtest
  tests/              vitest suite (indicators, strategies, engine, config, data)
```

---

## Disclaimer

This software is for research and decision-support only. It does not
constitute investment advice and does not predict future stock prices. Past
backtest performance is not indicative of future returns. Use at your own
risk.
