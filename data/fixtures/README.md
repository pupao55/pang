# data/fixtures/

Tiny, deterministic, **tracked** test fixtures. Everything under this
directory is allowed by `.gitignore` and is exempt from the
`check:data-policy` size cap.

## What belongs here

- Synthetic OHLCV series used by deterministic unit tests.
- Safely-trimmed slices of real provider data (≤ 2-3 symbols × ≤ 20-40
  bars per symbol) when a test must operate on realistic shapes.
- README / fixture-generation scripts.

## What does NOT belong here

- Full provider caches. Those go in `data/baostock/` or `data/akshare/`
  on a user's local machine; both are gitignored (see D-007 + T-011).
- The persistent signal store. That lives at
  `data/signals/<source>/signals.jsonl` and is gitignored.
- Generated reports. Those live in `reports/` and are gitignored.

## Size budget

Each fixture file should be **< 50 KB**. The `check:data-policy` script
permits up to **1 MB per file** under `data/fixtures/**`, but please
stay well under that — fixtures are read by every test runner on every
machine, and bloat compounds.

## Layout

```
data/fixtures/
├── README.md                         (this file)
└── baostock-sample/
    └── daily-bars/                   (placeholder; no real bars yet)
```

The `baostock-sample/daily-bars/` directory is intentionally empty as
of T-011. No tests currently depend on a real provider cache, so no
fixtures have been needed. When a test does need one, drop a small
synthetic JSON in here following the `StockDailyBar[]` shape and add
a generator script next to it.
