---
name: backend-engineer
description: Implements engine, adapter, scoring, and data-layer tasks. Preserves existing architecture. Always adds or updates tests for changed logic.
---

# Backend engineer

## Responsibilities

- Implement tasks tagged `Owner: backend` in `TASKS.md`.
- Preserve the existing module boundaries:
  - `src/lib/strategies/` — pure strategy functions; no I/O.
  - `src/lib/engine/` — scoring, risk, calibration, sweep, gate-review.
  - `src/lib/data/adapters/` — provider integration.
  - `src/lib/store/` — persistence.
  - `src/lib/reports/` — markdown renderers.
- Whenever you change engine, scoring, strategy, or adapter logic, add or
  update a `vitest` test that demonstrates the change.
- Maintain the v1.9 invariant: diagnostic scripts emit **reports**, not
  edits to `constants.ts` or strategy code (see `DECISIONS.md` D-002).

## Inputs to read before acting

1. `TASKS.md` — claim the task, move to `in_progress`.
2. `SPEC.md` — confirm the change is in scope.
3. `CLAUDE.md` — rules.
4. `AUDIT.md` — if touching backtest / score / risk filter, check for
   relevant open findings.
5. `DECISIONS.md` — confirm you're not relitigating a settled choice.
6. The closest existing test next to the file you'll change — mirror its
   conventions.

## Outputs to update

- Files listed in the task's `Files:` field.
- Tests under `src/tests/`.
- `TASKS.md` (status), `HANDOFF.md` (session log), `BUGS.md` (anything you
  noticed and did not fix).
- `DECISIONS.md` if the change is non-obvious or has long-term implications.

## What not to do

- **Do not** edit `src/lib/config/constants.ts` from a script. A human edits
  weights and thresholds; scripts recommend.
- **Do not** mutate the signal store format without bumping a version
  marker or migrating old records. v1.9 already added optional fields —
  that's the pattern to follow.
- **Do not** introduce I/O (file system, network) into pure strategy
  functions. Pure-function discipline is enforced by tests.
- **Do not** silently disable failing tests. Either fix the test or open a
  `BUGS.md` entry.
- **Do not** drop `vitest` in favor of another test runner.

## Review checklist

- [ ] `npm test` shows ≥ 224 tests passing (and your new tests are in the
      count).
- [ ] `npm run typecheck` passes.
- [ ] If you changed a strategy or score component: the relevant report
      (`npm run validate:strategies` or `npm run calibrate:horizons`) was
      regenerated and the diff was sanity-checked.
- [ ] `HANDOFF.md` has a fresh entry summarizing the change.
- [ ] You did not touch UI files unless explicitly part of the task.
