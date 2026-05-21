# TASKS.md — Pangzi task queue

Agent task format. Pick a task with `Status: ready` whose `Depends on:` are
satisfied. Move to `in_progress` when starting, `done` when shipping. If you
add tasks, use the next free `T-NNN` id and the same template.

```
## T-NNN: <title>
Status: ready | in_progress | blocked | done
Owner: product | research | frontend | backend | qa | growth
Priority: P0 | P1 | P2
Depends on: <other T-NNN, comma separated, or "none">
Files: <list of files this task is allowed to touch>
Goal: <one-sentence goal>
Acceptance Criteria:
- <criterion 1>
- <criterion 2>
Notes:
- <free-form notes, decisions, links>
```

---

## T-001: Wire `check:agent-workspace` into the test/build flow
Status: ready
Owner: backend
Priority: P2
Depends on: none
Files: `package.json`, `scripts/check-agent-workspace.mjs`
Goal: Decide whether `check:agent-workspace` should run automatically (pre-commit hook or part of `npm test`) so the ops-files contract does not silently rot.
Acceptance Criteria:
- A decision is recorded in `DECISIONS.md`.
- If automated: a single command (`npm test` or a hook) fails when an ops
  file is missing.
- If not automated: `HANDOFF.md` documents that the script is manual.
Notes:
- Avoid coupling to husky / lefthook without an explicit decision — adding a
  hook tool is a dependency change.

## T-002: Document the "no auto-tune constants" rule in code
Status: ready
Owner: backend
Priority: P2
Depends on: none
Files: `src/lib/config/constants.ts`, `scripts/horizon_calibration.ts`, `scripts/calibrate_strategies.ts`
Goal: Add a clear top-of-file comment block to constants.ts and to every diagnostic script restating: "This file is the human-approved source of truth. Scripts may recommend; only humans edit."
Acceptance Criteria:
- `constants.ts` carries the rule at the top.
- All diagnostic scripts in `scripts/` that read components also carry the rule.
- No behavioral change.
Notes:
- Matches the v1.3 / v1.6 / v1.9 user mandate captured in `DECISIONS.md` D-002.

## T-003: Fill in missing test coverage for `localSectorBuilder` edge cases
Status: ready
Owner: backend
Priority: P1
Depends on: none
Files: `src/lib/engine/localSectorBuilder.ts`, `src/tests/engine/localSectorBuilder.test.ts`
Goal: Add tests for: (a) a sector with exactly `minMembers` members, (b) PREFIX-only groups when industry is missing, (c) duplicate symbols in a group.
Acceptance Criteria:
- New tests pass under `npm test`.
- No production code changes unless a test exposes a real bug — and only then
  with a `BUGS.md` entry.
Notes:
- v1.8 introduced this module; coverage is currently happy-path biased.

## T-004: Add a smoke test that `/validation` renders the v1.9 horizon card
Status: done
Owner: qa
Priority: P1
Depends on: none
Files: `src/tests/app/validation.smoke.test.ts`
Goal: A vitest-based smoke test that confirms `HorizonVerdictCard` is wired into `/validation` and gated on `horizon` data.
Acceptance Criteria:
- ✅ Test file exists and passes (6 assertions, 2ms).
- ✅ Source-level assertion — no React rendering, no module evaluation (avoids the brittle path of loading a server component into the node test env).
- ✅ Asserts: horizon engine imported, card component defined, conditional render shape preserved, report link present, async server component signature unchanged, dynamic export present.
Notes:
- Picked source-level over `await import()` because the page's adapter imports execute during module load and would couple this test to the live cache. The "pure import-level" wording in the original AC allows either; we chose the more deterministic one.
- Picked by the agent council (T-AGENT-001) on 2026-05-20 with score 32.50, risk class `docs-only`, no approval required.

## T-005: Decide whether `firstBreakout` stays in the registry
Status: done
Owner: product
Priority: P1
Depends on: none
Files: `DECISIONS.md`
Goal: Per the v1.9 report, decide keep vs. remove for `firstBreakout`.
Acceptance Criteria:
- `DECISIONS.md` D-006 (2026-05-20) records the verdict.
- `SPEC.md` Current Functionality reflects the experimental status.
Notes:
- **Outcome**: Keep as EXPERIMENTAL / DIAGNOSTIC_ONLY. See D-006. Follow-up
  experiment lives in T-006 (relaxed variant).

## T-006: Run relaxed `firstBreakout` variant experiment
Status: done
Owner: backend
Priority: P1
Depends on: T-005
Files: `src/lib/strategies/firstBreakoutRelaxedStrategy.ts`, `src/lib/strategies/experimental.ts`, `src/lib/engine/firstBreakoutExperiment.ts`, `src/lib/reports/firstBreakoutExperimentReport.ts`, `scripts/first_breakout_experiment.ts`, `package.json`, `reports/first-breakout-experiment.md`, tests under `src/tests/`
Goal: Run a single, reversible, A/B-style experiment of the relaxed firstBreakout variant defined in D-006.
Acceptance Criteria:
- ✅ Relaxed variant lives in its own file; strict file unchanged.
- ✅ Experimental registry (`EXPERIMENTAL_STRATEGIES` + `experimentalStrategiesEnabled()`) keeps the relaxed strategy out of the default `/signals` flow.
- ✅ `npm run experiment:first-breakout` produces `reports/first-breakout-experiment.md`.
- ✅ 15 new tests (relaxed strategy fires, lookback/ratio constants, strict output unchanged, default registry excludes experimental, verdict classifier in 5 regimes, report renders required sections + sample-size warning).
- ✅ `RESEARCH_LOG.md` carries the dated finding.
- ✅ No production constant changed. `SCORE_WEIGHTS` untouched.
Notes:
- **Result**: verdict `KEEP_STRICT`. Strict raw fires = 1,652 / 94,918
  candidates (1.74%, +5d 0.58%, win5d 42%). Relaxed raw fires = 2,476
  (2.61%, +5d 0.89%, win5d 45%). Relaxed is *marginally* better but
  doesn't clear the bar for promotion. Raw fires ≠ persisted-store
  records (see report note on counts).

## T-007: Audit `AUDIT.md` for open items
Status: done
Owner: qa
Priority: P2
Depends on: none
Files: `AUDIT.md`, `BUGS.md`
Goal: Walk every `AUDIT-x-y` finding and confirm whether it has been
addressed in v1.1–v1.9. Move open / not-fixed items into `BUGS.md` with
severity, and mark the audit entry as `resolved` or `open`.
Acceptance Criteria:
- ✅ `AUDIT.md` carries a "Status as of v1.9" table covering all 43
  findings (resolved / open / wontfix-by-design / wontfix-with-context).
- ✅ `BUGS.md` carries B-015 (B-2 state machine bias), B-016 (E-2 risk
  penalty cap), B-017 (H-2 single mock snapshot), B-018 (I-2 recharts
  cosmetic), B-019 (J-7 ST tiering) — the five still-open audit items
  that were not already mirrored.
- ✅ No code was changed.
Notes:
- Counts: 27 resolved, 12 open (covered by B-008, B-010–B-019), 4
  wontfix-by-design, 1 wontfix-with-context (M-1 mooted by real data).
- Picked by the agent council on 2026-05-21 (score 23.50, docs-only).

## T-008: Document the licensing + data-redistribution position
Status: ready
Owner: growth
Priority: P2
Depends on: none
Files: `docs/launch.md`, `README.md`
Goal: We push 169 BaoStock daily-bar JSON files to a public repo. Decide and document whether that's intentional (BaoStock data is public-but-redistributed), and whether a `LICENSE` / data-attribution note belongs in the repo.
Acceptance Criteria:
- `docs/launch.md` carries a position statement.
- `README.md` link to it.
- If "remove from repo": a separate T-NNN is created to update `.gitignore`
  and rewrite history (heavy operation — needs explicit user approval).

## T-009: Add a `/positions` page or explicitly decline to add one
Status: ready
Owner: product
Priority: P2
Depends on: none
Files: `SPEC.md`, `DECISIONS.md`
Goal: Several places imply position-tracking is out of scope ("does not place orders"). Confirm in writing whether the product will ever track user-entered positions, or whether that is permanently out of scope.
Acceptance Criteria:
- `SPEC.md` Non-Goals reflects the decision.
- `DECISIONS.md` carries the rationale.
- No code change.

## T-AGENT-001: Run the agent council to pick the next task
Status: ready
Owner: backend
Priority: P2
Depends on: none
Files: `reports/agent-council/`, `NEXT_ACTION.md` (both regenerated; no source edits)
Goal: Whenever the queue has multiple ready tasks and the user hands over agency without naming one, the next session runs `npm run agent:council`, reads `NEXT_ACTION.md`, and either proceeds (safe risk class) or surfaces the chosen task for approval (anything else).
Acceptance Criteria:
- `npm run agent:council` runs cleanly and writes the three artifacts.
- The chosen task is reported back to the user with its risk class and approval requirement before any source file is touched.
- This standing task is never marked `done` — it is a recurring loop. Use it as a heartbeat, not a one-shot.
Notes:
- See `docs/agent-council.md` for the protocol and `docs/approval-policy.md` for the approval matrix.
- The council is heuristic in v1; the rubric is in the script. A future revision can replace it with literal sub-agent calls.

## T-011: Audit committed data caches; propose slim sample fixture
Status: done (partial — destructive cleanup is T-012, awaits user approval)
Owner: backend
Priority: P1
Depends on: none
Files: `.gitignore`, `data/fixtures/`, `docs/data-policy.md`, `scripts/check-data-policy.mjs`, `package.json`, `reports/data-cache-audit.md`
Goal: Implement D-007. Inventory + classify every tracked file, ignore future bulk caches, add a guard script, scaffold a fixture directory.
Acceptance Criteria:
- ✅ `reports/data-cache-audit.md` inventories all 758 tracked files with
  per-category recommendations and an exact `git rm --cached` command list.
- ✅ `.gitignore` ignores future `data/baostock/{daily-bars,sectors,sentiment,metadata,fetch-runs}/*` and `reports/*.json` etc.; `data/fixtures/**` is allowlisted.
- ✅ `data/fixtures/README.md` documents fixture conventions and size budget.
- ✅ `scripts/check-data-policy.mjs` + `npm run check:data-policy` enforce the policy on every run.
- ✅ Verified: `npm run check:data-policy` intentionally fails with the 758
  existing offenders (the script's job — surface the violation, do not
  auto-delete). `npm test` + `npm run typecheck` + `npm run check:agent-workspace` all pass.
- 📋 Follow-up T-012 carries the destructive cleanup, gated on user approval.

## T-012: Untrack bulk provider caches per D-007 (non-destructive)
Status: done (commit pending — see HANDOFF.md)
Owner: backend
Priority: P1
Depends on: T-011, explicit user approval (received 2026-05-20)
Files: tracked files under `data/baostock/`, `data/akshare/`, `reports/baostockLocal-score-buckets.json`
Goal: Execute the `git rm --cached` command list from `reports/data-cache-audit.md`. Index-only removal; no `rm` of on-disk files; no history rewrite.
Acceptance Criteria:
- ✅ 756 offenders removed from the index.
- ✅ All 13 paths still exist on disk (26 MB BaoStock bars, 11 MB sectors, etc.).
- ✅ `npm run check:data-policy` now passes (scans 4 tracked files; 0 violations).
- ✅ `npm test`, `npm run typecheck`, `npm run check:agent-workspace` all pass unchanged.
- 📋 The actual `git commit` is **not executed** by this task — the user runs it manually (command in `HANDOFF.md`).
Notes:
- The optional history-rewrite step (`git filter-repo`) is still NOT performed — it is destructive to existing clones and remains gated behind a separate, explicit user opt-in (would be T-013 if requested).
- Until the commit lands, `git status` shows ~758 `D` (deleted from index) entries. That is expected.

## T-010: Run the agentic-workspace contract on every push
Status: ready
Owner: backend
Priority: P2
Depends on: T-001
Files: `.github/workflows/ops-check.yml` (new), `package.json`
Goal: If CI is added later, have it run `npm run check:agent-workspace` so the operating files contract survives long-term.
Acceptance Criteria:
- A minimal GitHub Actions workflow exists (or task explicitly closed with a
  `DECISIONS.md` entry that CI is not used for this project).
- The workflow runs typecheck + test + ops-check.
Notes:
- Holding off until the user signals interest in CI — until then this is just
  a "future-state" task. Coordinate with the user before adding workflows.
