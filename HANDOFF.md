# HANDOFF.md — current state for the next agent

Append a new entry at the **top** of "Session log" each time you finish work.
Older entries decay naturally — do not delete them, but you can collapse
detail after 5+ entries.

## TL;DR (most recent state)

- **Version**: Pangzi v1.9 + agentic workspace framework (first cleanup pass complete).
- **Branch / commit**: `main` @ `310be5e` on disk; this cleanup pass is uncommitted (`CLAUDE.md` and ops files added previously already committed).
- **Tests**: 224 / 224 passing in 54 files.
- **Typecheck**: clean.
- **Ops contract**: 13 / 13 required files present (`npm run check:agent-workspace`).
- **Data policy**: enforced by `npm run check:data-policy` — **passes**
  after T-012 (4 tracked files: `.gitkeep` stubs + `data/fixtures/README.md`).
  Commit not yet made — see "Pending commit" below.
- **Data status**:
  - **Primary provider**: BaoStock (local). AkShare blocked at the dev IP (B-001).
  - **169-symbol local BaoStock cache** under `data/baostock/daily-bars/` (~26 MB, currently tracked — see B-002 / D-007).
  - 94,918 daily bars, 46,551 historical signals carrying component scores.
  - `sectorMode = GENERATED`, `sentimentMode = GENERATED` (synthetic, see B-003 / B-009).
- **Latest report**: `reports/horizon-calibration-report.md` (2026-05-20).
- **Top horizon finding**: high-score signals (≥ 80) are **1d momentum that mean-reverts by day 5** (`MEAN_REVERTS_AFTER_1D`). The score model is calibrated — just not at the 5-day horizon every previous validation report assumed.

## Where to start next time

### Pending commit (from T-012)

The working tree has 756 staged deletions (`git rm --cached`). Local files
on disk are untouched. To finalize, the user runs:

```bash
git commit -m "untrack bulk provider caches per D-007"
git push
```

If the user wants to also strip the bytes from GitHub history (destructive
to existing clones — anyone with the repo must re-clone), open a new task
T-013 and follow the `git filter-repo` workflow there.

### Next task after the commit

Pick one of:

1. **T-007 — walk `AUDIT.md` for any still-open findings** beyond what
   B-001…B-014 cover. Low risk, no code change.
2. **T-001 — wire `check:data-policy` + `check:agent-workspace`** into a
   pre-commit hook or CI step so the contract stays enforced.
3. **T-008 — write the data-redistribution + license position** in
   `docs/launch.md`. T-012 already removed the bulk cache from the index;
   this closes the open product question.

(T-006 closed 2026-05-20 with verdict `KEEP_STRICT`. The per-strategy
holding-horizons follow-up that was implicit in T-006 should be a new
P-NNN product decision before any code task is opened.)

### Verification (run before reporting a task done)

```bash
npm test && npm run typecheck && npm run check:agent-workspace
```

Add `npm run build` if any route was touched.

### Required reading before acting

- `SPEC.md` — current product spec.
- `TASKS.md` — current queue.
- `DECISIONS.md` — D-001 through D-007.
- `BUGS.md` — B-001 through B-014 (14 open).
- For engine / backtest / risk work: still-load-bearing `AUDIT.md`.
- For calibration / horizon work: `reports/horizon-calibration-report.md`.

## Known risks

- **Public repo contains 67 MB of BaoStock daily bars** under
  `data/baostock/daily-bars/`. The `.gitignore` was designed to allow these
  through (only akshare bars are excluded). BaoStock data is itself public,
  but redistribution position is undocumented. See T-008.
- **`firstBreakout` strategy has only 33 historical signals and shows
  NO_EDGE.** Decision pending (T-005). Do not preemptively remove from
  `src/lib/strategies/index.ts`.
- **`sectorLeader` is too broad** (~18,800 historical signals). v1.9 report
  recommends a tightening variant but does not yet apply it. Wait for the
  v2 plan (T-006) before editing the strategy.
- **Score calibration verdict is `NOT_CALIBRATED` at 5d** by design — the
  v1.9 finding is that the score IS calibrated at 1d for the top bucket.
  Do not "fix" this by tweaking weights without going through the v2 plan.

## Commands to run before reporting a task done

```bash
npm test                  # 224 tests should still pass
npm run typecheck         # strict TS
npm run build             # only if you touched UI / route code
npm run check:agent-workspace
```

For larger refactors:

```bash
npm run rebuild:signals -- --source baostockLocal --rebuild
npm run validate:strategies -- --source baostockLocal
npm run calibrate:horizons
```

## Session log

### 2026-05-20 — T-007 audit walk-through (council-picked)
- Reconciled every AUDIT.md finding (43 total) to its v1.9 state.
- Added "Status as of v1.9" table to `AUDIT.md` at the top, with each
  finding labelled resolved / open / wontfix-by-design / wontfix-with-context
  and (where open) cross-referenced to a B-NNN entry in `BUGS.md`.
- Added 5 new entries B-015 through B-019 covering the still-open audit
  items not previously mirrored:
  - B-015 (B-2) `limitUpSecondBuy` state machine bias — minor
  - B-016 (E-2) `riskPenalty` cap at 60 — minor
  - B-017 (H-2) Single sector / sentiment mock snapshot — minor
  - B-018 (I-2) Recharts horizontal-reference cosmetic — nit
  - B-019 (J-7) No ST / *ST / 退市整理 differentiation — minor
- Counts: 27 audit findings resolved, 12 open (B-008, B-010–B-019),
  4 wontfix-by-design (F-2, H-3, L-1, L-2), 1 wontfix-with-context (M-1
  — staged-mock issue mooted by real BaoStock data).
- **No code changed.** TASKS.md T-007 marked done.

### 2026-05-20 — T-004 /validation smoke test + council meta-loop fix
- First task executed via the new agent-council loop (`npm run agent:council`
  picked it; `NEXT_ACTION.md` flagged `SAFE_TO_PROCEED`).
- Added `src/tests/app/validation.smoke.test.ts` with 6 source-level
  assertions (horizon engine import, HorizonVerdictCard component,
  conditional render shape, report link, async server component signature,
  `dynamic = "force-dynamic"`).
- Source-level over `await import()` because the page's adapter imports
  fire at module load and would couple this test to the live cache.
- After marking T-004 done, the council recursively re-picked the
  heartbeat task `T-AGENT-001` itself. One-line fix in
  `scripts/agent_council.mjs` excludes `T-AGENT-*` / `T-META-*` prefixes
  from candidate selection; added a regression test. The council now
  correctly picks T-007 (audit walk) next.
- Verified: 258/258 tests passing, typecheck clean, ops 13/13,
  data policy OK.
- **No application code changed.** TASKS.md T-004 marked done.
- Council's current pick: T-007.

### 2026-05-20 — agent-council loop installed (T-133–T-136)
- Added `docs/agent-council.md` (protocol), `docs/approval-policy.md`,
  `reports/agent-council/template.md`, `scripts/agent_council.mjs`
  (deterministic planner with exported pure functions), `NEXT_ACTION.md`
  (generated single-page summary).
- Added `npm run agent:council` and 13 tests covering parser / risk
  classification / scoring / approval / rendering.
- Updated `CLAUDE.md` with the autonomous-next-task section and added
  standing `T-AGENT-001` to `TASKS.md`.
- Council picks T-004 on the current queue.

### 2026-05-20 — T-006 relaxed firstBreakout experiment
- Created `src/lib/strategies/firstBreakoutRelaxedStrategy.ts` (research-only,
  duplicates strict logic with two relaxations: lookback 40→30, near-breakout
  close ≥ platformHigh × 0.99). Strict file untouched.
- Created `src/lib/strategies/experimental.ts` (`EXPERIMENTAL_STRATEGIES`
  registry + `experimentalStrategiesEnabled()` env-var helper). Default
  `STRATEGY_LIST` unchanged — relaxed strategy is NOT exposed to `/signals`.
- Created `src/lib/engine/firstBreakoutExperiment.ts` (gate-attributing A/B
  runner + `classifyVerdict()`).
- Created `src/lib/reports/firstBreakoutExperimentReport.ts` (markdown renderer).
- Created `scripts/first_breakout_experiment.ts` +
  `npm run experiment:first-breakout`.
- 15 new tests across strategy, experiment runner, and report — all pass.
- **Result**: verdict `KEEP_STRICT`. Strict raw fires = 1,652 (1.74% pass,
  +5d 0.58%, win5d 42%). Relaxed raw fires = 2,476 (2.61% pass, +5d 0.89%,
  win5d 45%). Relaxation helps marginally but does not clear the
  PROMISING_RELAXED bar (win 45% < 52%) and lands one signal short of the
  1.5× sample boost threshold for TEST_RELAXED.
- Updated: `RESEARCH_LOG.md` (dated finding), `TASKS.md` (T-006 done),
  `BUGS.md` (B-006 re-classified to minor, marked investigated).
- **No production constant or strategy logic changed.**
- Verification: `npm test` 239/239, `npm run typecheck` clean,
  `npm run check:data-policy` OK, `npm run check:agent-workspace` 13/13.

### 2026-05-20 — T-012 non-destructive cache untrack
- Ran the 13-path `git rm --cached` command list from
  `reports/data-cache-audit.md` after explicit user approval.
- **Files removed from index**: 756 (169 BaoStock daily bars, 571 sector
  snapshots, sentiment, metadata, import/fetch-status snapshots, 5
  BaoStock + 2 AkShare fetch-runs, AkShare sectors / sentiment /
  calendar / fetch-status, `reports/baostockLocal-score-buckets.json`).
- **On-disk preservation**: verified — `data/baostock/daily-bars` still
  26 MB, `data/baostock/sectors` still 11 MB. Nothing was deleted from
  disk.
- **Tracked count**: 760 → 4 (`.gitkeep` × 3 + `data/fixtures/README.md`).
- **Policy state**: `npm run check:data-policy` now passes; the other
  three checks remain green.
- **Commit was NOT executed** — the user runs the commit manually
  (command in "Pending commit" above).
- Updated `TASKS.md` (T-012 → done, commit pending), `BUGS.md` (B-002 →
  mitigated), and `reports/data-cache-audit.md` (cleanup-result section).

### 2026-05-20 — T-011 data-cache audit + policy enforcement
- Inspected: 760 tracked files under `data/` + `reports/` (67 MB on disk).
- Added `reports/data-cache-audit.md` with per-file classification and the
  exact `git rm --cached` cleanup commands.
- Updated `.gitignore` to block future bulk additions across BaoStock /
  AkShare caches, the signal store, and generated reports — with
  `data/fixtures/**` and `.gitkeep` markers allowlisted.
- Added `data/fixtures/README.md` + `baostock-sample/daily-bars/.gitkeep`
  scaffold; no tests currently depend on real provider files.
- Added `docs/data-policy.md` (canonical policy + refresh commands).
- Added `scripts/check-data-policy.mjs` + `npm run check:data-policy` (1 MB
  cap; pattern + size enforcement; prints suggested `git rm --cached`
  commands).
- Marked T-011 done (partial). Queued T-012 for the destructive cleanup
  (blocked on explicit user approval).
- Updated B-002 to `partially mitigated`; amended D-007 to reference the
  guard script.
- **No application code touched.** Verification:
  - `npm run check:data-policy` → **fails intentionally** with 758
    existing offenders (the script's job).
  - `npm run check:agent-workspace` → 13/13 OK.
  - `npm test` → 224/224 passing.
  - `npm run typecheck` → clean.

### 2026-05-20 — first agentic workspace cleanup pass
- Resolved T-005 → D-006 (firstBreakout = EXPERIMENTAL / DIAGNOSTIC_ONLY).
- Reshaped T-006 to be the **relaxed-variant experiment** (lookback 40→30, near-breakout ratio 0.99).
- Added D-007 (no large provider caches in the repo; sample fixtures only).
- Added T-011 (committed-data-cache audit, P1).
- Migrated 14 still-open issues from `AUDIT.md` and from prior session knowledge into `BUGS.md` with stable B-001…B-014 ids.
- Strengthened this `HANDOFF.md` with explicit data status and verification command.
- **No application code touched.** Verified via `npm test` (224/224), `npm run typecheck` (clean), `npm run check:agent-workspace` (13/13).

### 2026-05-20 — agentic workspace retrofit
- Inspected repo: Next.js 14 + TS + Tailwind, npm, 54 test files / 224 tests.
- Created: `CLAUDE.md`, `SPEC.md`, `TASKS.md` (10 tasks), `DECISIONS.md` (5
  decisions retroactively captured), `HANDOFF.md`, `RESEARCH_LOG.md`,
  `BUGS.md`, `.claude/agents/{product-strategist,researcher,frontend-engineer,backend-engineer,qa-reviewer,growth-strategist}.md`,
  `docs/{architecture,product,launch}.md`,
  `scripts/check-agent-workspace.mjs`.
- Added `check:agent-workspace` npm script.
- **No application code was changed**: the entire app still builds and
  tests stay at 224 passing.
- Open follow-ups: T-001 (CI integration of ops check), T-005
  (`firstBreakout` keep/remove decision), T-007 (audit walk-through).

### 2026-05-20 — v1.9 horizon-aware calibration
- Added `horizonCalibration`, `scoreWeightSweep`, `sectorLeaderTuning`,
  `strategyGateReview` engine modules; `horizonCalibrationReport` renderer;
  `scripts/horizon_calibration.ts`; `npm run calibrate:horizons`.
- Extended `HistoricalSignalRecord` with optional component scores.
- Rebuilt signal store: 46,551 signals now carry component scores.
- Generated `reports/horizon-calibration-report.md` — key finding:
  high-score bucket is `MEAN_REVERTS_AFTER_1D` (1d +8.26% / 88% win →
  5d -1.07% / 32% win).
- Added 17 tests, total 224 passing.
- `SCORE_WEIGHTS` constants **were not modified** (per D-002).

### 2026-05-20 — v1.9 UI light-mode redesign
- Flipped Tailwind tokens dark → light, kept `bull` / `bear` A-share colors.
- Rebuilt `/signals` table (filter bar + summary cards + expandable detail).
- Added prominent honesty alert on `/validation`.
- `/dashboard` became the landing page with CTAs.
- All page-level color classes audited.
