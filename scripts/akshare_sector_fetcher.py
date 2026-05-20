"""Fetch current-day A-share industry + concept board snapshots via AkShare.

v1.6 — current-day only. Historical sector data via stock_board_industry_hist_em
is supported but requires one call per board (≈ 80 industry + 200+ concept
boards) so it stays off by default; pass --history-days N to backfill.

Output:
  data/akshare/sectors/{date}.json

Each file is a flat array of SectorSnapshot objects:
  {
    "date": "YYYY-MM-DD",
    "sectorName": "电池",
    "sectorType": "INDUSTRY" | "CONCEPT",
    "pctChange": 1.23,
    "limitUpCount": 0,        # AkShare doesn't expose per-board LU count
    "topStocks": [...],
    "strengthRank": 1,
    "momentumScore": 78
  }

Notes:
  * AkShare current-day board endpoints do NOT report per-board limit-up
    counts directly. Pangzi sets `limitUpCount = 0` for current-day rows
    and instead derives the cohort limit-up count from cached bars at
    consumption time. Documented as a known gap.
  * `momentumScore` is a simple 0–100 mapping of the current-day pct change
    rank within the universe (best = 95, worst = 5).
  * `topStocks` is filled from constituent endpoints only when
    --with-top-stocks is passed (slow).
"""

from __future__ import annotations

import argparse
import datetime as _dt
import json
import os
import random
import sys
import time
from typing import Any

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from akshare_symbol_utils import normalize_symbol  # noqa: E402


def _require_akshare():
    try:
        import akshare as ak  # noqa: F401
    except ImportError as exc:
        sys.stderr.write(
            "ERROR: akshare is not installed. Run: pip install akshare --upgrade\n"
            f"Original error: {exc}\n",
        )
        sys.exit(2)


def _now_iso() -> str:
    return _dt.datetime.now(_dt.timezone.utc).isoformat(timespec="seconds")


def _atomic_write(path: str, data: Any) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=2)
    os.replace(tmp, path)


def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Fetch A-share sector snapshots via AkShare.")
    p.add_argument("--date", default=None, help="YYYY-MM-DD; defaults to today.")
    p.add_argument("--output-dir", default="data/akshare/sectors")
    p.add_argument("--with-top-stocks", action="store_true",
                   help="Fill topStocks via stock_board_industry_cons_em (one call per top sector).")
    p.add_argument("--top-stocks-per-sector", type=int, default=5)
    p.add_argument("--max-top-sectors", type=int, default=20,
                   help="How many top-ranked sectors to enrich with topStocks.")
    p.add_argument("--sleep-min-seconds", type=float, default=2.0)
    p.add_argument("--sleep-max-seconds", type=float, default=4.0)
    p.add_argument("--skip-concept", action="store_true",
                   help="Skip concept boards (only fetch industry).")
    return p.parse_args()


def _rank_to_momentum(rank: int, total: int) -> int:
    if total <= 1:
        return 50
    pct = (total - rank) / (total - 1)
    return int(round(5 + pct * 90))


def _fetch_boards(board_type: str, sleep_min: float, sleep_max: float, warnings: list[str]) -> list[dict[str, Any]]:
    """Return a list of {name, pctChange} dicts ranked by current-day pct change."""
    import akshare as ak  # type: ignore

    fn_name = (
        "stock_board_industry_name_em"
        if board_type == "INDUSTRY"
        else "stock_board_concept_name_em"
    )
    fn = getattr(ak, fn_name, None)
    if not callable(fn):
        warnings.append(f"AkShare missing {fn_name}; skipping {board_type} boards.")
        return []
    try:
        df = fn()
    except Exception as exc:  # noqa: BLE001
        warnings.append(f"{fn_name} failed: {exc}; skipping {board_type} boards.")
        return []

    name_col = next((c for c in ("板块名称", "industry_name", "concept_name") if c in df.columns), None)
    pct_col = next((c for c in ("涨跌幅", "pct_chg", "pctChg") if c in df.columns), None)
    if not name_col or not pct_col:
        warnings.append(f"{fn_name} schema mismatch: {list(df.columns)}; skipping.")
        return []

    rows: list[dict[str, Any]] = []
    for _, r in df.iterrows():
        try:
            pct = float(r[pct_col])
        except (TypeError, ValueError):
            continue
        rows.append({"name": str(r[name_col]).strip(), "pctChange": pct})
    rows.sort(key=lambda x: x["pctChange"], reverse=True)
    # Light pacing to avoid hitting rate limits when called twice in a row.
    time.sleep(random.uniform(sleep_min, sleep_max))
    return rows


def _fetch_top_stocks(
    board_type: str,
    board_name: str,
    n: int,
    warnings: list[str],
) -> list[str]:
    import akshare as ak  # type: ignore

    fn_name = (
        "stock_board_industry_cons_em"
        if board_type == "INDUSTRY"
        else "stock_board_concept_cons_em"
    )
    fn = getattr(ak, fn_name, None)
    if not callable(fn):
        warnings.append(f"AkShare missing {fn_name}; topStocks left empty.")
        return []
    try:
        df = fn(symbol=board_name)
    except Exception as exc:  # noqa: BLE001
        warnings.append(f"{fn_name}({board_name}) failed: {exc}")
        return []
    code_col = next((c for c in ("代码", "code") if c in df.columns), None)
    if not code_col:
        warnings.append(f"{fn_name}({board_name}) missing code column.")
        return []
    out: list[str] = []
    for code in df[code_col].astype(str).tolist():
        try:
            out.append(normalize_symbol(code))
        except ValueError:
            continue
        if len(out) >= n:
            break
    return out


def main() -> int:
    _require_akshare()
    args = _parse_args()
    date = args.date or _dt.date.today().isoformat()
    warnings: list[str] = []

    industry = _fetch_boards("INDUSTRY", args.sleep_min_seconds, args.sleep_max_seconds, warnings)
    concept = [] if args.skip_concept else _fetch_boards(
        "CONCEPT", args.sleep_min_seconds, args.sleep_max_seconds, warnings,
    )

    snapshots: list[dict[str, Any]] = []

    def add(rows: list[dict[str, Any]], stype: str) -> None:
        total = len(rows)
        for rank, r in enumerate(rows, start=1):
            snapshots.append({
                "date": date,
                "sectorName": r["name"],
                "sectorType": stype,
                "pctChange": round(r["pctChange"], 2),
                "limitUpCount": 0,  # not reported by current-day endpoint
                "topStocks": [],
                "strengthRank": rank,
                "momentumScore": _rank_to_momentum(rank, total),
            })

    add(industry, "INDUSTRY")
    add(concept, "CONCEPT")

    if args.with_top_stocks:
        top_targets = sorted(
            (s for s in snapshots if s["sectorType"] == "INDUSTRY"),
            key=lambda x: x["strengthRank"],
        )[: args.max_top_sectors]
        for s in top_targets:
            s["topStocks"] = _fetch_top_stocks(
                s["sectorType"], s["sectorName"], args.top_stocks_per_sector, warnings,
            )
            time.sleep(random.uniform(args.sleep_min_seconds, args.sleep_max_seconds))

    payload = {
        "source": "akshare.stock_board_*",
        "fetchedAt": _now_iso(),
        "date": date,
        "industryCount": len(industry),
        "conceptCount": len(concept),
        "warnings": warnings,
        "snapshots": snapshots,
    }
    out_path = os.path.join(args.output_dir, f"{date}.json")
    _atomic_write(out_path, payload)
    print(
        f"Wrote {len(snapshots)} sector snapshots ({len(industry)} industry, "
        f"{len(concept)} concept) → {out_path}",
        flush=True,
    )
    if warnings:
        print("Warnings:", flush=True)
        for w in warnings:
            print(f"  - {w}", flush=True)
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
