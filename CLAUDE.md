# CLAUDE.md — Pangzi agent operating instructions

This file is the entry point for any Claude Code session working in this repo.
Read it first, then read the linked operating files, then act.

## Project at a glance

**Pangzi** is an A-share (Chinese mainland equities) research dashboard.
Stack: Next.js 14 App Router + TypeScript + Tailwind, Vitest, Python ingestion scripts
(AkShare, BaoStock). It screens, scores, explains, and backtests short-term / swing
setups derived from Tongdaxin-style formulas — research only, never connects to a
broker, never places orders.

Highlights:
- 5 strategies (`firstBreakout`, `limitUpSecondBuy`, `maxTurnoverBreakout`,
  `sectorLeader`, `trendPullback`) + a scoring engine + a risk filter.
- BaoStock is the primary live data provider; AkShare is supported but
  rate-limited on most IPs.
- Persistent signal store at `data/signals/<source>/signals.jsonl`; current
  cache has 169 symbols / 94,918 bars / 46,551 signals.
- v1.9 added horizon-aware calibration — see `reports/horizon-calibration-report.md`.

## Files to read before any non-trivial change

1. `SPEC.md` — current product spec / source of truth.
2. `TASKS.md` — the active task queue. Pick a task or get blocked clearly.
3. `DECISIONS.md` — past architectural / product decisions and why.
4. `HANDOFF.md` — the most recent session's state, known risks, next steps.
5. `BUGS.md` — current QA findings.
6. `RESEARCH_LOG.md` — open research questions and answered ones.
7. `README.md` — user-facing description of the running system.
8. `AUDIT.md` — engineering audit from v1.1 (still load-bearing — check before
   touching the backtest engine, score engine, or risk filter).

## Working rules

**Scope**
- Make small, scoped changes that match a single task in `TASKS.md`.
- Do not refactor unrelated code "while you're in there."
- Do not silently modify files outside the task's listed `Files:`.
- Do not introduce new dependencies without recording the decision in `DECISIONS.md`.

**Preserve architecture**
- Strategy logic, score logic, risk-filter logic, and data-adapter logic are
  load-bearing. Do not edit them without an explicit task and a recorded decision.
- The A-share convention `bull = red (#dc2626)` / `bear = green (#16a34a)` is
  inverted from US markets. Never flip these.
- Analysis scripts produce **recommendations**, not auto-edits. Never let a
  script modify `src/lib/config/constants.ts` or strategy code.

**Tests**
- When touching engine / strategy / scoring / adapter logic, add or update a
  `vitest` test. Run `npm test` before reporting a task done.
- Run `npm run typecheck` and (for UI / route changes) `npm run build`.

**Documentation hygiene after work**
- Update the status of any `TASKS.md` entries you advanced.
- Append a new entry to `HANDOFF.md` summarizing what you changed, what's
  next, and any new risks.
- If you made a non-obvious choice, add it to `DECISIONS.md`.
- If you found something broken, log it in `BUGS.md` rather than silently
  fixing unrelated things.

**Things you must not do**
- Connect to live brokerage APIs or place real orders.
- Auto-edit `SCORE_WEIGHTS`, gate thresholds, or strategy parameters from a
  diagnostic script.
- Run destructive git commands (`reset --hard`, `push --force`, `branch -D`,
  etc.) without explicit user instruction.
- Inflate the data directory — `data/baostock/daily-bars/` is tracked, but
  do not add new gigabyte-scale dumps without a decision entry.

## Useful commands

```bash
npm run dev               # local dashboard at http://localhost:3000
npm test                  # run all vitest tests (currently 224 passing)
npm run typecheck         # strict TS check
npm run build             # production build

npm run rebuild:signals -- --source baostockLocal --rebuild
npm run validate:strategies -- --source baostockLocal
npm run calibrate:strategies -- --source baostockLocal
npm run calibrate:horizons          # v1.9 horizon-aware report
npm run check:agent-workspace       # verify ops files (added by retrofit)
npm run check:data-policy           # enforce no-bulk-cache policy (D-007)
npm run agent:council               # pick next task autonomously
```

## Autonomous next-task selection

When the user asks "what should the agents do next?" or "continue without
me" or otherwise hands over agency without naming a specific task:

1. Run `npm run agent:council`. This deterministic planner reads
   `TASKS.md`, `BUGS.md`, `HANDOFF.md`, `DECISIONS.md`,
   `RESEARCH_LOG.md`, and `AUDIT.md`, scores every ready task with the
   rubric in `docs/agent-council.md`, and writes:
   - `reports/agent-council/<timestamp>.md` (full report, gitignored)
   - `reports/agent-council/latest.md` (pointer)
   - `NEXT_ACTION.md` (single-page summary, tracked)
2. **Read `NEXT_ACTION.md` first.**
3. If `STATUS: SAFE_TO_PROCEED` and the task is in a safe risk class
   (`docs-only`), execute under the verification plan in `NEXT_ACTION.md`.
4. If `STATUS: APPROVAL_REQUIRED`, **stop and ask the user** before
   touching any file in the listed paths. Surface the selected task
   plainly and quote the reason from `docs/approval-policy.md`.
5. Never change strategy / scoring / risk-filter / data-adapter logic
   without an explicit user "go," even when the council picks such a
   task.

The council is a planner, not a doer. It does not run tests, edit
production code, or commit. With `--execute-safe` it records that
execution *would* be permitted but still takes no action — that
remains a human decision in v1.

## Agent roles

Specialized roles live in `.claude/agents/*.md`. Read the relevant file before
acting in that lane:

- `product-strategist.md` — owns `SPEC.md` + `TASKS.md`.
- `researcher.md` — owns `RESEARCH_LOG.md`.
- `frontend-engineer.md` — UI tasks, must follow existing component patterns.
- `backend-engineer.md` — engine / adapter / data tasks, must add tests.
- `qa-reviewer.md` — owns `BUGS.md`, reviews work, does not fix unless asked.
- `growth-strategist.md` — positioning / launch / demo narrative.

When in doubt, default to the most conservative option, and ask before making
non-trivial product changes.
