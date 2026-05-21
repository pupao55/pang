# BUGS.md — QA findings

Open findings go at the top. Closed findings move to the `Resolved` section.
QA agents own this file. **QA does not fix bugs** unless explicitly asked —
they reproduce, classify, and propose. Implementers spawn a `TASKS.md` entry.

```
## B-NNN: <title>
Severity: blocker | critical | major | minor | nit
Area: <screen, module, or "data">
Found: YYYY-MM-DD
Repro Steps:
1.
Expected:
Actual:
Suggested Fix:
Status: open | in_progress | fixed | wontfix
Source: <audit ref, report path, or session>
Linked Task: <T-NNN or "-">
```

---

## Open

### B-001: AkShare endpoints rate-limit / 412 at IP level
Severity: major
Area: data ingestion (`scripts/akshare_fetcher.py`, `scripts/akshare_sector_fetcher.py`)
Found: 2026-04 (v1.5 era), reaffirmed 2026-05-20.
Repro Steps:
1. Run `npm run fetch:akshare` without aggressive sleep/UA rotation.
Expected: bars stream in for the requested universe.
Actual: HTTP 412 or hangs after ~5 sequential calls; many IPs are blocked outright by Eastmoney.
Suggested Fix: BaoStock is already the recommended primary (D-003); document the AkShare degradation in `README.md` Quick Start and add a `--fail-loud` flag to the script so silent failure isn't possible.
Status: open
Source: README "Building the AkShare cache safely (v1.5)"; multiple session-log entries in `HANDOFF.md`.
Linked Task: -

### B-002: Bulk provider caches committed to a public repo
Severity: major
Area: repo policy
Found: 2026-05-20.
Repro Steps:
1. `npm run check:data-policy` → 758 tracked files flagged.
2. Largest offenders: 169 BaoStock daily-bar JSONs (~26 MB) and 571
   generated sector snapshots (~11 MB).
Expected: provider caches live locally; only sample fixtures committed.
Actual: full BaoStock cache, sector snapshots, sentiment, metadata, fetch
status, and one stale calibration snapshot are all tracked.
Suggested Fix: Per D-007 + T-011, `.gitignore` now prevents future additions
and `check:data-policy` makes the violation loud. The actual `git rm
--cached` of the existing 758 files is queued as T-012 and requires
explicit user approval (and an optional follow-up history rewrite).
Status: **mitigated** (commit pending) — T-012 (2026-05-20) executed the
non-destructive `git rm --cached` cleanup. 756 offenders removed from the
index; on-disk files preserved; `npm run check:data-policy` now passes.
History rewrite remains explicitly out-of-scope.
Source: D-007, `reports/data-cache-audit.md` (cleanup-result section).
Linked Task: T-011 (done partial), T-012 (done — commit awaits user).

### B-003: Sector / concept data is `GENERATED` from price action, not real boards
Severity: major
Area: `src/lib/engine/localSectorBuilder.ts`, `src/lib/data/adapters/baostockLocalAdapter.ts`
Found: 2026-05 (v1.8 era).
Repro Steps:
1. Open `/validation` with BaoStock as the source.
2. Observe `sectorMode = GENERATED` and the mock-fallback caveat banner.
Expected: real concept / industry boards from a free provider.
Actual: BaoStock free tier does not expose them; the local builder groups by industry/board/prefix as a proxy, so scores depending on sector strength are compressed.
Suggested Fix: Either (a) ship a paid-data integration (Tushare Pro), (b) keep the synthetic mode but make the caveat louder in UI copy, or (c) experiment with scraping/parsing 东方财富 sector pages with attribution. None are urgent — but the limitation should appear in every calibration report.
Status: open
Source: README "Local sector strength (v1.8)" — Honest limitations section.
Linked Task: -

### B-004: Risk filter cannot be validated — no HIGH / FORBIDDEN diversity in cache
Severity: major
Area: `src/lib/engine/riskFilterValidation.ts`
Found: 2026-05.
Repro Steps:
1. Run `npm run validate:strategies -- --source baostockLocal`.
2. Look at the risk filter section.
Expected: `IMPROVES` / `NO_IMPROVEMENT` verdict supported by samples in each risk cohort.
Actual: `INCONCLUSIVE` because the 169-symbol universe is heavily `LOW`/`MEDIUM` — there are not enough `HIGH` / `FORBIDDEN` candidates to demonstrate filter improvement.
Suggested Fix: Expand the BaoStock cache to include ST / *ST / 退市风险 symbols deliberately; or, after data-cache cleanup (T-011), document this as a known limitation rather than a transient issue.
Status: open
Source: most-recent validation report.
Linked Task: -

### B-005: Score calibration verdict was `NOT_CALIBRATED` at 5d — but only because horizon was fixed
Severity: major (methodology)
Area: `src/lib/engine/scoreCalibration.ts`
Found: 2026-05-20 (v1.9 root-cause).
Repro Steps:
1. Read `reports/horizon-calibration-report.md` §3.
Expected: a single calibration verdict that correctly characterises the score.
Actual: the top score buckets are `MOMENTUM_1D` / `MEAN_REVERTS_AFTER_1D`. The 5d verdict reads `NOT_CALIBRATED` because the edge has already evaporated by day 5; the score IS calibrated, but at 1d.
Suggested Fix: v2 plan — backtest engine should accept per-strategy holding horizons; the `/validation` page should show calibration verdicts per horizon, not just at 5d.
Status: open
Source: v1.9 horizon-calibration-report.md.
Linked Task: T-006 (relaxed firstBreakout experiment is a precursor; per-strategy horizons should follow).

### B-006: `firstBreakout` `platformBreakout` gate rejects most candidates
Severity: major → minor (re-classified after T-006)
Area: `src/lib/strategies/firstBreakoutStrategy.ts`
Found: 2026-05-20.
Repro Steps:
1. Read `reports/horizon-calibration-report.md` §6 (persisted-store view).
2. Or run `npm run experiment:first-breakout` (raw-fire A/B view).
Expected: a useful firstBreakout cohort with measurable edge.
Actual: with the strict gate, raw fires = 1,652 / 94,918 candidates
(1.74%, +5d 0.58%, win5d 42%). Persisted store undercounts because the
engine keeps only the top-scoring strategy per (symbol, date).
Suggested Fix: T-006 ran the relaxed-variant experiment (30d lookback,
near-breakout 0.99×). Relaxed: 2,476 raw fires (2.61%, +5d 0.89%, win5d
45%). Verdict **KEEP_STRICT** — relaxation helps marginally but does
not clear the promotion bar. No code change recommended at this time.
Status: **investigated, not fixed** (the gate is strict-by-design;
relaxation does not meaningfully improve quality). Closed as a *bug*;
re-frame as a "strategy quality limit" tracked in the next product
horizon (per-strategy holding horizons, not yet ticketed).
Source: v1.9 `reports/horizon-calibration-report.md` §6;
`reports/first-breakout-experiment.md`; `RESEARCH_LOG.md` 2026-05-20 entry.
Linked Task: T-006 (done — verdict KEEP_STRICT).

### B-007: BaoStock volume unit differs from AkShare (lots vs shares; CNY vs 万元)
Severity: major
Area: `src/lib/data/adapters/baostockLocalAdapter.ts`, `src/lib/data/providers/compare.ts`
Found: 2026-04 (v1.7), documented in `compare.ts:225`.
Repro Steps:
1. Compare a single symbol's `volume` and `amount` columns between providers.
Expected: identical units after adapter normalization.
Actual: providers disagree by 100× or more on some rows. The comparison util prints a warning but the adapter does not normalize.
Suggested Fix: Document the unit convention in each adapter file with a top-of-file comment, then add a normalization step or a `units: "lots" | "shares"` field on `StockDailyBar`. Until that lands, users should not mix providers in a single signal-store rebuild.
Status: open
Source: `src/lib/data/providers/compare.ts:225`.
Linked Task: -

### B-008: No native BJ (北交所) board support
Severity: minor
Area: `src/lib/types/stock.ts` (`BoardType`), `src/lib/config/constants.ts` (`LIMIT_UP_THRESHOLDS`)
Found: v1.1 (`AUDIT.md` J-6); still open at v1.9.
Repro Steps:
1. Look at `BoardType` union → `MAIN | CHINEXT | STAR` only.
2. Search for `BJ` or `北交所` handling.
Expected: BJ-listed symbols are correctly categorized with their own ±30% daily limit.
Actual: BJ symbols (if any made it into the cache) fall through to one of the existing buckets.
Suggested Fix: Add `BJ` to `BoardType`, define `LIMIT_UP_THRESHOLDS.BJ = 0.2995`, audit `boardType` detection in `inferBoard`.
Status: open
Source: AUDIT.md J-6.
Linked Task: -

### B-009: No full historical concept-board coverage from any free provider
Severity: major (data, structural)
Area: `src/lib/data/adapters/`, `src/lib/engine/localSectorBuilder.ts`
Found: 2026-05 (v1.7-v1.8 framing).
Repro Steps:
1. Try to fetch real per-date concept boards from BaoStock — endpoint does not exist.
2. AkShare exposes the boards but only intraday / current; historical-board membership is inferred, not authoritative.
Expected: per-date concept membership and concept-level returns directly from upstream.
Actual: synthetic `localSectorBuilder` is the only viable path; sector scores are explicitly tagged `GENERATED`.
Suggested Fix: Document the limitation more prominently on `/validation`; investigate Tushare Pro (paid) or scrape 同花顺/东方财富 sector pages with attribution. Until then, the synthetic builder is the contract.
Status: open
Source: README "Local sector strength (v1.8)".
Linked Task: -

### B-010: Annualized return uses calendar days, not trading days
Severity: minor (cosmetic)
Area: `src/lib/engine/backtestEngine.ts`
Found: v1.1 (`AUDIT.md` A-9); documented and deferred.
Repro Steps:
1. Run any backtest spanning weekends/holidays; check the annualized return.
Expected: scaled by ~250 trading days/year.
Actual: scaled by ~365 calendar days/year, so annualized return is biased low by ~30%.
Suggested Fix: Switch to trading-day count from the adapter's `getTradingCalendar`.
Status: open
Source: AUDIT.md A-9.
Linked Task: -

### B-011: `findMaxTurnoverBar` semantics — "most recent N bars" vs "max in the window"
Severity: minor
Area: `src/lib/indicators/turnover.ts`
Found: v1.1 (`AUDIT.md` C-3); documented, behavior unchanged.
Repro Steps:
1. Read `findMaxTurnoverBar` and `maxTurnoverBreakoutStrategy` together.
Expected: clear contract whether the function returns the global max within the lookback or the most recent max.
Actual: documented in JSDoc but the naming is still ambiguous, which has caused subtle confusion at least twice during reviews.
Suggested Fix: Rename to `findMaxTurnoverBarWithinWindow` or split into two helpers; update call sites.
Status: open
Source: AUDIT.md C-3.
Linked Task: -

### B-012: `ACTION_THRESHOLDS` are arbitrary (75 / 60 / 45)
Severity: minor
Area: `src/lib/config/constants.ts`
Found: v1.1 (`AUDIT.md` D-3); v1.9 partially addresses by surfacing horizon profile, but thresholds remain hand-picked.
Repro Steps:
1. Inspect `ACTION_THRESHOLDS`.
Expected: thresholds tuned to the calibration data.
Actual: round numbers chosen before any calibration was performed.
Suggested Fix: After per-strategy horizons land (post-T-006), derive thresholds from the calibration report rather than hand-picking.
Status: open
Source: AUDIT.md D-3.
Linked Task: -

### B-013: `scoreFundamentalSafety` rewards large market cap
Severity: minor
Area: `src/lib/engine/scoreEngine.ts`
Found: v1.1 (`AUDIT.md` D-4); deferred to calibration.
Repro Steps:
1. Read `scoreFundamentalSafety`.
Expected: a real "safety" measure (e.g., liquidity floor, debt ratio).
Actual: market-cap bucket bonus, which double-counts liquidity and biases the score toward megacaps.
Suggested Fix: Either rename to `scoreSize` or replace with a true fundamental signal once Pangzi has access to fundamentals data.
Status: open
Source: AUDIT.md D-4.
Linked Task: -

### B-015: `limitUpSecondBuy` state machine biases toward older real limit-ups
Severity: minor
Area: `src/lib/strategies/limitUpSecondBuyStrategy.ts`
Found: v1.1 (`AUDIT.md` B-2); refactor deferred at v1.1, still open at v1.9.
Repro Steps:
1. Read `limitUpSecondBuyStrategy.ts` and trace which prior limit-up the
   state machine selects when several candidates exist in the window.
Expected: deterministic, well-justified pick (e.g., the most recent valid
limit-up).
Actual: order of evaluation biases toward earlier (older) limit-ups within
the lookback window. Documented in AUDIT B-2 but the refactor was
"deferred — no behavior change needed."
Suggested Fix: refactor to walk the window most-recent-first and select
the first valid candidate. Add a regression test pinning the chosen bar.
Status: open (cosmetic / behavior-stable).
Source: AUDIT.md B-2.
Linked Task: -

### B-016: `riskPenalty` cap at 60 is arbitrary
Severity: minor
Area: `src/lib/engine/riskFilter.ts`, `src/lib/config/constants.ts`
Found: v1.1 (`AUDIT.md` E-2); documented and kept.
Repro Steps:
1. Stack three or more risk reasons on a single signal (regulatory + recent
   unlock + failed limit-up); observe the total penalty saturates at 60.
Expected: a tuned cap derived from the calibration data, not a round number.
Actual: the cap is a hand-picked guardrail; no calibration-driven
justification.
Suggested Fix: derive the cap from the per-strategy quality + calibration
data (after T-006-equivalent work on the score model). Until then leave
as-is.
Status: open (low-priority tuning).
Source: AUDIT.md E-2.
Linked Task: -

### B-017: Mock sector / sentiment is a single date snapshot
Severity: minor
Area: `src/lib/data/adapters/mockAdapter.ts`, `src/lib/data/mockSectors.ts`, `src/lib/data/mockSentiment.ts`
Found: v1.1 (`AUDIT.md` H-2); v1.8 local sector builder closes the
*live-data* side, but the mock adapter still serves a single static snapshot.
Repro Steps:
1. Run any test or demo that walks dates against the mock adapter.
2. Sector and sentiment are identical for every date.
Expected: a small per-date series so historical-replay tests cover the
sector/sentiment time axis.
Actual: one snapshot for the entire EVAL_DATE.
Suggested Fix: ship a tiny synthetic time series under `data/fixtures/` and
have the mock adapter walk it by date. Bounded by T-011 fixture conventions.
Status: open (test / fixture quality).
Source: AUDIT.md H-2.
Linked Task: see also T-011 (fixture conventions).

### B-018: Recharts horizontal-reference uses `dataKey={() => support}`
Severity: nit
Area: `src/components/KLineChart.tsx`
Found: v1.1 (`AUDIT.md` I-2); deferred as cosmetic.
Repro Steps:
1. Open any stock detail page in `npm run dev` and inspect the KLine chart.
Expected: idiomatic Recharts pattern (a numeric `y` prop on the reference
line).
Actual: a function-form `dataKey` that returns a constant — works, but
verbose and confuses future readers.
Suggested Fix: switch to `<ReferenceLine y={support} ... />` form.
Status: open (cosmetic).
Source: AUDIT.md I-2.
Linked Task: -

### B-019: No `风险警示` differentiation (ST vs *ST vs 退市整理)
Severity: minor
Area: `src/lib/types/stock.ts` (`StockMeta`), `src/lib/engine/riskFilter.ts`
Found: v1.1 (`AUDIT.md` J-7); documented and deferred.
Repro Steps:
1. Inspect `StockMeta` — only a boolean `isST` flag exists.
2. Run the risk filter on a `*ST` or `退市整理` stock — penalty is the same
   as ordinary ST.
Expected: separate severity for `*ST` (delisting risk) and `退市整理`
(delisting underway), with progressively heavier penalties.
Actual: a single `isST` boolean conflates all three categories.
Suggested Fix: extend `StockMeta` with `stRiskLevel: "NONE" | "ST" | "STAR_ST"
| "DELISTING"` (or similar), update `riskFilter` to penalize accordingly,
update the BaoStock fetcher to populate the field.
Status: open.
Source: AUDIT.md J-7.
Linked Task: -

### B-014: No suspension / 停牌 / 除权 awareness
Severity: minor
Area: backtest + risk filter
Found: v1.1 (`AUDIT.md` E-3, J-5); documented.
Repro Steps:
1. Find a stock with a 停牌 gap in the cache (multi-day no-trade).
2. Run a backtest crossing the suspension.
Expected: position is held / paused / closed per a documented rule.
Actual: gap is silently traversed; no flag in trade-level diagnostics.
Suggested Fix: Adapter should emit a `suspendedDates` series per symbol; backtest engine respects it; risk filter penalizes recent suspension.
Status: open
Source: AUDIT.md E-3 + J-5.
Linked Task: -

## Resolved

> Populated as bugs are fixed. Keep at least a one-line summary so future
> agents can search for "did we ever hit X?"

(none yet)
