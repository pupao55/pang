# Data policy

Owner: backend-engineer agent. Canonical decision: `DECISIONS.md` D-007.
Enforcement: `scripts/check-data-policy.mjs` (`npm run check:data-policy`).

## Principle

**Local provider caches are not source code.** Bars, sector snapshots,
sentiment, the signal store, and generated reports are *derived* from
upstream APIs (or from our own scripts) and are regenerable. Keeping them
in the repo balloons clone size, blurs diff signal, and creates ambiguity
about who is allowed to redistribute provider data.

## Allowed in the repo

- Source under `src/`, `scripts/`, `docs/`, ops files at the root.
- **Tiny fixtures** under `data/fixtures/**`, ≤ ~50 KB per file (hard
  cap 1 MB enforced by `check:data-policy`).
- `.gitkeep` markers preserving directory structure where tools need a
  parent directory to exist.

## Not allowed in the repo

- `data/baostock/daily-bars/*.json`
- `data/baostock/sectors/*.json`
- `data/baostock/sentiment/sentiment.jsonl`
- `data/baostock/metadata/stocks.json`
- `data/baostock/import-report.json`, `fetch-status.json`, `fetch-runs/*.json`
- `data/akshare/*` equivalents
- `data/signals/**/*.{jsonl,json}` (the persistent signal store)
- `reports/*.{md,json,jsonl}` (every report is generated)

## What if the cache already exists locally?

Keep it. The `.gitignore` only stops *new* commits — existing local files
are untouched on disk. Pages that read these files (`/signals`,
`/validation`, `/backtest`, `/review`) will continue to work locally as
before.

## Refreshing the local cache

```bash
# BaoStock (recommended — see D-003)
npm run setup:baostock
npm run fetch:baostock:sample            # 5 symbols, quick
npm run fetch:baostock:resume            # ~100 symbols, slow + polite
npm run refresh:baostock-context         # metadata + sectors + sentiment
npm run rebuild:signals -- --source baostockLocal --rebuild

# AkShare (degraded, IP-blocked on most machines — B-001)
npm run fetch:akshare:sample:slow
npm run refresh:akshare-context
npm run rebuild:signals -- --source akshareLocal --rebuild

# Reports
npm run validate:strategies -- --source baostockLocal
npm run calibrate:strategies -- --source baostockLocal
npm run calibrate:horizons               # v1.9 horizon-aware report
```

## Verifying the policy

```bash
npm run check:data-policy
```

The script reads `git ls-files` and any staged additions, then fails if
it finds a file that matches the "not allowed" patterns or exceeds the
1 MB size cap (unless under `data/fixtures/`). Exit code 1 means a
commit will pollute the repo; fix it before pushing.

`check:data-policy` is intentionally not wired into `npm test` —
that decision is tracked separately as T-001. For now it is run
manually or, when CI exists, as a CI step.

## Migration to git history rewrite

`.gitignore` patterns do not retroactively untrack already-tracked files.
A two-step migration is therefore required to make the repo physically
slim:

1. **Untrack (non-destructive)** — `git rm --cached <paths>` removes the
   files from the index for new commits. Old commits still carry them,
   so a fresh clone still downloads the bytes. See
   `reports/data-cache-audit.md` for the exact command list.
2. **Rewrite history (destructive — needs explicit user approval)** —
   `git filter-repo --path data/baostock/daily-bars --invert-paths` (etc.)
   purges the files from every prior commit, then a force-push reduces
   GitHub storage. **Anyone who has the repo cloned must re-clone after
   this step.** Skip unless the user explicitly opts in.

## Future options (not adopted)

- **Git LFS** for versioned research datasets. Adds a per-contributor
  dependency. Re-evaluate only when a reproducible-research dataset is
  a hard requirement.
- **Separate `pangzi-data` repo** with its own retention policy. Adds
  coordination cost; defer until multi-user collaboration begins.
- **External artifact store** (S3, R2). Most flexible; also the most
  external dependency. Re-evaluate at launch (see `docs/launch.md`).
