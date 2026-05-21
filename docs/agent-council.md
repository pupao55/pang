# Agent council protocol

A lightweight, deterministic operating loop that lets the existing role
agents (product, research, frontend, backend, qa, growth) propose the
next task without the user manually deciding every step.

## Purpose

When the user has not specified a next task — or explicitly asks "what
should I do next?" / "continue without me" — the council:

1. Inspects the current repo state (TASKS, BUGS, HANDOFF, DECISIONS,
   RESEARCH_LOG, AUDIT).
2. Considers every ready, unblocked task as a candidate.
3. Scores each candidate against a fixed rubric.
4. Picks the highest-scoring candidate.
5. Classifies whether the user must approve before execution.
6. Writes a structured report + a one-page `NEXT_ACTION.md`.

The council never edits production code on its own. It is a planner.

## When to run

- The user asks for autonomous mode.
- A long session is wrapping up and the next session needs a starting
  point.
- After a major task closes (e.g., T-006 done) and the queue has multiple
  ready candidates.
- As part of a daily / weekly project health check.

Do **not** run it during an active in-progress task — let the human
finish the work in flight first.

## Required inputs

The council reads:

- `TASKS.md` — task queue (status, owner, priority, depends-on, files, goal, acceptance criteria, notes).
- `BUGS.md` — open QA findings (severity, linked tasks).
- `HANDOFF.md` — most recent session log + next-recommended-task suggestions.
- `DECISIONS.md` — settled product/architectural choices (to avoid relitigating).
- `RESEARCH_LOG.md` — open research questions and findings.
- `AUDIT.md` — v1.1 engineering audit (still-load-bearing for engine work).
- `reports/*.md` — any recent calibration / experiment / audit reports.
- `package.json` — available npm scripts for the execution + verification plan.

It does not call any external API and does not need network access.

## Roles

| Role | Lens applied to each candidate task |
|---|---|
| Product Strategist | Does it move a user-visible workflow forward? Is it on-spec (no Non-Goals violation)? |
| Researcher | Will it teach us something measurable, or close an open research question? |
| Backend Engineer | Will it preserve architecture? Is the implementation cost bounded? |
| Frontend Engineer | Does it affect screen quality, accessibility, A-share color discipline? |
| QA Reviewer | Does it reduce risk / close a bug? Does it touch load-bearing modules? |
| Growth Strategist | Does it improve demo readiness, launch story, positioning? |

In this lightweight implementation the heuristic script *embodies* all
six lenses through the rubric below — each rubric dimension corresponds
to one role's signal. A future implementation can replace the heuristic
with literal sub-agent calls.

## Debate format

For each candidate task:

1. The script extracts: title, status, owner, priority, depends-on, body keywords.
2. Each role's signal is computed from keywords + owner + file paths.
3. The signals are combined into `priorityScore` (see rubric below).
4. The risk class is determined from file paths and body keywords.
5. The script emits the *what* (the chosen task) and the *why*
   (top-three contributors to the score + the risk class).

The script does not generate free-form opinion text. The "debate" is
the explainable score breakdown.

## Scoring rubric

Each candidate is scored 1–5 on:

- **userValue** — how much it moves an actual user workflow.
- **researchValue** — how much it advances calibration / honesty / open questions.
- **riskReduction** — how much it closes a bug, audit item, or risk-class regression surface.
- **reversibility** — how easy to roll back.
- **implementationCost** — engineering cost (higher = more expensive).
- **dependencyClearing** — how many other tasks unblock when this one ships.
- **demoValue** — contribution to demo / launch story.

A **riskPenalty** is added based on the file class touched:

| Touch class | Risk penalty |
|---|---:|
| docs / reports / tests only | 0 |
| UI-only | 2 |
| backend / data scripts | 4 |
| strategy / scoring / risk filter | 6 |
| destructive git / data operations | 10 |

The combined formula:

```
priorityScore =
    userValue * 2
  + researchValue * 2
  + riskReduction * 1.5
  + dependencyClearing * 1.5
  + demoValue
  + reversibility
  - implementationCost
  - riskPenalty
```

The top-scoring task is selected. Ties are broken by lower risk class,
then by lower id (earlier-numbered tasks first).

## Auto-execution rules

`agent:council` runs in **planner mode** by default — it writes the plan
and does not act. With `--execute-safe`, it may proceed automatically
**only** when the chosen task is in a safe class:

- docs-only
- report-only
- test-only (no production code change)
- audit-only

In this v1 even `--execute-safe` does not actually execute the task. It
just records that execution would have been permitted. Execution
remains a human-driven step until a future revision wires it up.

## Approval-required rules

The script writes `approval_required: true` in `NEXT_ACTION.md` when the
chosen task touches:

- a strategy / scoring / risk-filter module
- a data adapter
- destructive git operations (`git rm`, `git filter-repo`, force push)
- file/data deletion on disk
- live trading / brokerage / external account
- a new runtime dependency
- a database / schema change

See `docs/approval-policy.md` for the exhaustive list.

The agent that resumes work must read `NEXT_ACTION.md`, surface the
chosen task to the user, and wait for an explicit "go" before touching
anything in the approval-required set.

## Output artifacts

- `reports/agent-council/<YYYY-MM-DDTHHMMSS>.md` — append-only history
  of every council run, full debate.
- `reports/agent-council/latest.md` — convenience pointer to the most
  recent run.
- `NEXT_ACTION.md` (repo root) — single-page summary the next session
  reads first.

`reports/agent-council/` is gitignored along with the rest of
`reports/*.md`; commit the council output deliberately if you want it
preserved across machines. `NEXT_ACTION.md` lives at the repo root and
is meant to be tracked.

## Stop conditions

The council aborts (writes `STATUS: STOP` in `NEXT_ACTION.md`) when:

- `TASKS.md` has zero `Status: ready` entries.
- Every ready task is `blocked` by a missing dependency.
- Every ready task requires approval and the user is asking for
  autonomous mode.

In any of those cases the script prints what is blocking progress and
how to unblock it.
