# Architecture

Concise map of the moving parts. Detailed module-level docs live in the
source code; this file exists so a new agent can locate a concern in
≤ 30 seconds.

## Top-level layout

```
src/
├── app/                   Next.js App Router pages (server components)
│   ├── dashboard/         market sentiment + quick links
│   ├── signals/           ranked candidate table
│   ├── validation/        calibration + horizon verdicts
│   ├── backtest/          parameterized backtest
│   ├── review/            day-after review
│   └── stocks/[symbol]/   per-stock detail
├── components/            shared UI primitives + cards
│   └── ui/                Card, Button, Badge, Select, Input
├── lib/
│   ├── config/            constants.ts (sum-to-1 SCORE_WEIGHTS, gates)
│   ├── data/adapters/     mock, akshareLocal, baostockLocal, csv
│   ├── engine/            scoring, risk, calibration, sweeps, gate review
│   ├── strategies/        5 strategy modules + types
│   ├── store/             paths.ts + signalStore.ts (JSONL append)
│   ├── reports/           markdown renderers
│   └── types/             shared types (StockMeta, signal, market)
└── tests/                 vitest suites mirroring lib structure
scripts/                   TS (tsx) + Python ingestion + diagnostic scripts
data/                      cached daily bars, sectors, sentiment, signals
reports/                   generated markdown reports
```

## Data flow

```
Python fetchers (akshare_fetcher.py, baostock_fetcher.py)
   ↓ writes JSON per symbol
data/<provider>/daily-bars/*.json
   ↓ adapter loads
Adapter (baostockLocalAdapter, akshareLocalAdapter)
   ↓ produces StockMeta + bars + sector + sentiment
runSignalEngine (signalEngine.ts)
   ↓ runs strategies + risk filter + score engine per (asOfDate, symbol)
StockSignal[]  →  rebuild_signals script appends to
data/signals/<source>/signals.jsonl  (HistoricalSignalRecord[])
   ↓ read by
calibrateScores / validateRiskFilter / calibrateHorizons / etc.
   ↓ rendered to
reports/*.md
```

## Key invariants

- **Pure strategies**: `src/lib/strategies/*.ts` modules are pure functions
  of `StrategyContext`. They never read from disk or network.
- **Adapter boundary**: `src/lib/data/adapters/*.ts` is the only place that
  reads cached files. Engine modules consume the adapter's outputs.
- **Sum-to-1 score weights**: enforced at module load in `constants.ts`.
- **Append-only signal store**: scripts may `--rebuild` (wipe + regenerate)
  but cannot rewrite individual records.
- **Sector mode discipline**: every signal carries a `sectorScoreMode`
  marker (`REAL` / `GENERATED` / `FALLBACK` / `MISSING`) so reports can
  show caveats. Do not strip this metadata.
- **A-share color convention**: `bull = #dc2626` (red), `bear = #16a34a`
  (green). Tokens in `tailwind.config.ts`.

## Where to add things

- New strategy → `src/lib/strategies/` + register in `index.ts` + test +
  rebuild signals.
- New diagnostic → `src/lib/engine/` + a renderer in `src/lib/reports/` + a
  script in `scripts/` + an npm command + a /validation card if relevant.
- New page → `src/app/<route>/page.tsx` + likely a server component + tests
  if logic is involved.
- New ops file → root of repo; teach `scripts/check-agent-workspace.mjs`
  about it.
