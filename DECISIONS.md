# DECISIONS.md — architectural & product decision log

Each non-trivial choice gets a `D-NNN` entry. Append, do not rewrite history.

```
## D-NNN: <decision>
Date: YYYY-MM-DD
Context: <what triggered the decision>
Decision: <what was chosen>
Reason: <why>
Rejected Alternatives: <what else was considered and why not>
```

---

## D-001: Adopt agentic operating files in this repo
Date: 2026-05-20
Context: Previous Pangzi sessions ran through ad-hoc prompts and copy-paste briefs. As the surface area grew (v1.0–v1.9, 54 test files, 5 strategies, 4 diagnostic scripts) handoff and context-loss became a recurring problem.
Decision: Add `CLAUDE.md`, `SPEC.md`, `TASKS.md`, `DECISIONS.md`, `HANDOFF.md`, `RESEARCH_LOG.md`, `BUGS.md` plus role definitions in `.claude/agents/*.md`. Add `scripts/check-agent-workspace.mjs` to verify the contract.
Reason: Persistent, file-based context is cheaper than re-briefing every session. Agent role definitions force the right reading order before acting.
Rejected Alternatives:
- Keep using free-form chat — does not survive context resets.
- Adopt a heavier tool (Notion, Linear) — adds external dependency and pulls
  history out of the repo where diffs/blame live.

## D-002: Scripts may recommend; only humans edit constants
Date: 2026-05-20 (retroactively codifying v1.3 + v1.6 + v1.9 user mandate)
Context: Pangzi's diagnostic scripts (`validate_strategies`, `calibrate_strategies`, `horizon_calibration`) compute optimal weights, gate thresholds, and strategy parameters. It is tempting to have them auto-update `src/lib/config/constants.ts`.
Decision: Diagnostic scripts produce **markdown reports + recommendations**. They never edit constants, strategy code, or strategy registration. Humans approve and apply manually.
Reason: Auto-applied weights create circular validation — the system that decides "a weight is good" is the system that picked the weight. Removes the human veto and risks overfitting to the dataset used for tuning.
Rejected Alternatives:
- Auto-apply best weights when calibration verdict is `CALIBRATED` — rejected because v1.9 showed the verdict was wrong before horizon-awareness was added; auto-application would have silently propagated the error.

## D-003: BaoStock is the primary data provider
Date: 2026-04 (retroactively, codified v1.7)
Context: AkShare's underlying Eastmoney endpoints rate-limit aggressively and block at the IP level on the current dev machine. BaoStock requires login/logout + Python but is reliable and free.
Decision: BaoStock is the recommended primary; AkShare is supported as a comparison provider only. UI defaults to BaoStock when both caches exist.
Reason: Reliable data > nominally richer data.
Rejected Alternatives:
- Switch to Tushare Pro — requires a paid token for any useful coverage.
- Buy access to 同花顺 / 东方财富 concept boards — out of budget for this hobby project.

## D-004: A-share convention `red = up`, `green = down`
Date: 2026-04 (retroactively)
Context: A-share displays bull moves in red, bear moves in green — opposite of US markets. Tokens are encoded directly in `tailwind.config.ts` as `bull: "#dc2626"` and `bear: "#16a34a"`.
Decision: Never invert these. Every chart, badge, and table cell uses the tokens.
Reason: Matching the convention is correct for the target audience and ships with mature A-share research tools (同花顺, 东方财富).
Rejected Alternatives:
- US-style green-up to avoid confusion for English readers — rejected; the target user is mainland or HK-based and reads A-share data daily.

## D-006: Keep `firstBreakout` as EXPERIMENTAL / DIAGNOSTIC_ONLY
Date: 2026-05-20
Context: The v1.9 horizon-aware calibration report (`reports/horizon-calibration-report.md`) showed `firstBreakout` produced only 33 historical signals across the full BaoStock cache and classified the strategy as `NO_EDGE` (1d +1.23%, 5d -1.72%, win5d 33%). The gate-review diagnostic (`scripts/horizon_calibration.ts` §6) showed the `platformBreakout` gate rejects 96.3% of candidates that survive the 60-day rise cap; the strategy is therefore better described as **too strict** than as **broken**.
Decision: `firstBreakout` stays in `src/lib/strategies/index.ts`, but is treated as **EXPERIMENTAL / DIAGNOSTIC_ONLY**:
- Not promoted as production-ready in UI copy or marketing.
- Not removed from the registry — its low signal count is currently a calibration risk for itself, not for the rest of the system.
- Next action is a **relaxed-variant experiment** owned by T-006:
  - Drop platform lookback from 40 → 30 days.
  - Accept a "near breakout" condition: `last.close >= platformHigh * 0.99`.
  - Re-run `rebuild:signals` + `calibrate:horizons` and compare signal count + win rate against the current strict variant.
- If the relaxed variant fails to produce ≥ 100 signals/year **and** a positive 1d or 3d edge, the next decision (a future D-NNN) will be to remove the strategy.
Reason: Removing a strategy that has never been honestly tested would discard signal we have not gathered. Promoting it without evidence would violate D-002. The middle path — keeping the registration but labeling it EXPERIMENTAL and committing to a relaxation experiment — preserves optionality at zero behavioral cost.
Rejected Alternatives:
- **Remove from registry immediately** — premature; we have not yet falsified the hypothesis that the strategy is starved by gate strictness rather than absent edge.
- **Keep as-is, no labeling change** — leaves a strategy in the production list whose calibration is `NO_EDGE`; misleading to a new user reading `/validation`.
- **Auto-relax the gate in the script** — violates D-002 (scripts recommend, humans edit).

## D-007: No large provider caches in the repo; sample fixtures only
Date: 2026-05-20
Context: The current commit (`310be5e`) pushed 26 MB of BaoStock daily-bar JSON under `data/baostock/daily-bars/` (758 tracked files in `data/`). The `.gitignore` was intentionally crafted to exclude only AkShare bars, letting BaoStock through. As the cache grows (planned 300+ symbol expansion), this becomes a maintenance and licensing risk.
Decision: Going forward:
- **Tiny sample fixtures** (≤ 5 symbols, ≤ 1 year of bars) may live in the repo if a test or demo depends on them. They live under `data/fixtures/` (new) and are tracked.
- **Full provider caches** (current `data/baostock/daily-bars/`, future `data/akshare/daily-bars/` expansions) live locally and are **gitignored**. Each user regenerates them with the existing fetcher scripts.
- **If versioned research datasets become necessary** (e.g., to reproduce a published calibration report), use Git LFS or an external artifact store, not the main repo.
Reason: Public repos do not need to redistribute provider data; the BaoStock cache is large, regenerable, and grows monotonically. Keeping caches local keeps the diff signal-to-noise high and avoids ambiguity around data redistribution.
Rejected Alternatives:
- **Keep the cache in the repo** — simplest for a new clone but couples repo size to dataset size.
- **Move the cache to a separate `pangzi-data` repo** — adds a coordination burden; deferred until a versioned dataset becomes a real requirement.
- **Use Git LFS now** — overkill at 26 MB; introduces a new dependency for every contributor.

The transition to this policy is gradual: history is not rewritten in this pass. T-011 (data-cache audit) decides whether and how to slim the existing tracked cache. Until then, no new daily-bar JSONs should be committed.

**Amendment (2026-05-20, T-011 closeout)**: enforcement is now machine-checkable via `scripts/check-data-policy.mjs` (`npm run check:data-policy`). The script reads `git ls-files` + staged additions and flags any path matching forbidden patterns or exceeding 1 MB (with `data/fixtures/**` allowlisted). Until T-012 executes the user-approved `git rm --cached` cleanup, the check intentionally fails on the 758 existing offenders — that is the script's purpose, not a bug.

## D-005: Persistent JSONL signal store with append + optional rebuild
Date: 2026-04 (retroactively, v1.3)
Context: Forward-return analysis needs point-in-time signal history; rerunning the engine on each request would be slow and would lose historical comparisons.
Decision: Signals are appended to `data/signals/<source>/signals.jsonl`. A `--rebuild` flag wipes and regenerates; otherwise the store is additive and refuses overwrites.
Reason: Append-only protects against hindsight rewriting; explicit `--rebuild` makes the destructive choice visible.
Rejected Alternatives:
- SQLite — heavier dependency, harder to diff, the dataset is small.
- Per-date JSON files — file count explodes; harder to grep.
