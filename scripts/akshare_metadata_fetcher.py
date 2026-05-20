"""Fetch the A-share spot universe + per-symbol industry mapping via AkShare.

Output:
  data/akshare/metadata/stocks.json

Schema (one element per symbol):
  {
    "symbol": "300750.SZ",
    "name": "宁德时代",
    "exchange": "SZ",
    "boardType": "CHINEXT",
    "industry": "电池" | null,
    "concepts": [],
    "marketCap": 1.2e12,
    "floatMarketCap": 9.8e11,
    "source": "akshare",
    "fetchedAt": "..."
  }

Top-level wrapper:
  {
    "source": "akshare",
    "fetchedAt": "...",
    "totalSymbols": N,
    "withIndustry": M,
    "warnings": [...],
    "stocks": [...]
  }

Concept mapping (per-stock) requires per-symbol calls and is intentionally
NOT done by default in v1.6. The script emits a warning explaining the
limitation. Pass `--with-industry` to spend one AkShare call per industry
board (≈ 80 calls total) to backfill the industry column. This is rate-
limited and cooperates with the v1.5 throttling guidance.
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


def _infer_board(code6: str) -> str:
    head = code6[:1]
    head3 = code6[:3]
    if head3 in ("688", "689"):
        return "STAR"
    if head == "3":
        return "CHINEXT"
    if head in ("4", "8"):
        return "MAIN"  # BJ not modelled; see AUDIT
    return "MAIN"


def _parse_float(v: Any) -> float | None:
    if v is None:
        return None
    try:
        f = float(v)
        return f if f == f else None  # filter NaN
    except (TypeError, ValueError):
        return None


def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Fetch A-share universe metadata via AkShare.")
    p.add_argument("--output", default="data/akshare/metadata/stocks.json")
    p.add_argument("--with-industry", action="store_true",
                   help="Backfill industry column via stock_board_industry_cons_em (slow).")
    p.add_argument("--sleep-min-seconds", type=float, default=2.0)
    p.add_argument("--sleep-max-seconds", type=float, default=4.0)
    p.add_argument("--max-industries", type=int, default=0,
                   help="Cap the number of industry boards processed (0 = all).")
    return p.parse_args()


def _fetch_universe() -> list[dict[str, Any]]:
    import akshare as ak  # type: ignore
    df = ak.stock_zh_a_spot_em()
    needed = {"代码", "名称"}
    if not needed.issubset(df.columns):
        raise RuntimeError(f"stock_zh_a_spot_em schema unexpected: {list(df.columns)}")
    out: list[dict[str, Any]] = []
    # Optional columns
    cap_col = next((c for c in ("总市值", "市值", "total_mv") if c in df.columns), None)
    float_col = next((c for c in ("流通市值", "float_mv") if c in df.columns), None)
    for _, r in df.iterrows():
        code = str(r["代码"]).strip()
        try:
            sym = normalize_symbol(code)
        except ValueError:
            continue
        rec: dict[str, Any] = {
            "symbol": sym,
            "name": str(r["名称"]).strip(),
            "exchange": sym.split(".")[1],
            "boardType": _infer_board(code),
            "industry": None,
            "concepts": [],
            "marketCap": _parse_float(r[cap_col]) if cap_col else None,
            "floatMarketCap": _parse_float(r[float_col]) if float_col else None,
            "source": "akshare.stock_zh_a_spot_em",
            "fetchedAt": _now_iso(),
        }
        out.append(rec)
    return out


def _backfill_industry(
    records: list[dict[str, Any]],
    sleep_min: float,
    sleep_max: float,
    max_industries: int,
    warnings: list[str],
) -> int:
    import akshare as ak  # type: ignore

    by_symbol = {r["symbol"]: r for r in records}
    try:
        boards = ak.stock_board_industry_name_em()
    except Exception as exc:  # noqa: BLE001
        warnings.append(f"stock_board_industry_name_em failed: {exc}; industry mapping skipped.")
        return 0
    name_col = next((c for c in ("板块名称", "industry_name") if c in boards.columns), None)
    if not name_col:
        warnings.append(f"industry-name column not in stock_board_industry_name_em output ({list(boards.columns)}).")
        return 0

    names = [str(n).strip() for n in boards[name_col].tolist()]
    if max_industries > 0:
        names = names[:max_industries]
    print(f"Mapping {len(names)} industry boards to symbols...", flush=True)

    enriched = 0
    consecutive_fail = 0
    for i, ind_name in enumerate(names, start=1):
        try:
            cons = ak.stock_board_industry_cons_em(symbol=ind_name)
        except Exception as exc:  # noqa: BLE001
            warnings.append(f"stock_board_industry_cons_em({ind_name}) failed: {exc}")
            consecutive_fail += 1
            if consecutive_fail >= 5:
                warnings.append("Too many consecutive industry-board failures; stopping early.")
                break
            time.sleep(random.uniform(sleep_min, sleep_max))
            continue
        consecutive_fail = 0
        code_col = next((c for c in ("代码", "code") if c in cons.columns), None)
        if not code_col:
            warnings.append(f"missing code column for industry {ind_name}: {list(cons.columns)}")
            continue
        for code in cons[code_col].astype(str):
            try:
                sym = normalize_symbol(code)
            except ValueError:
                continue
            rec = by_symbol.get(sym)
            if rec and not rec.get("industry"):
                rec["industry"] = ind_name
                enriched += 1
        if i % 5 == 0:
            print(f"  [{i}/{len(names)}] industry={ind_name} (cumulative enriched={enriched})", flush=True)
        time.sleep(random.uniform(sleep_min, sleep_max))
    return enriched


def main() -> int:
    _require_akshare()
    args = _parse_args()
    started = _now_iso()
    warnings: list[str] = []

    print("Fetching universe via stock_zh_a_spot_em() ...", flush=True)
    records = _fetch_universe()
    print(f"Loaded {len(records)} symbols.", flush=True)

    enriched = 0
    if args.with_industry:
        enriched = _backfill_industry(
            records, args.sleep_min_seconds, args.sleep_max_seconds, args.max_industries, warnings,
        )
    else:
        warnings.append(
            "Industry mapping skipped (use --with-industry to backfill via "
            "stock_board_industry_cons_em — rate-limited).",
        )

    payload = {
        "source": "akshare",
        "fetchedAt": _now_iso(),
        "startedAt": started,
        "totalSymbols": len(records),
        "withIndustry": enriched,
        "warnings": warnings,
        "stocks": records,
    }
    _atomic_write(args.output, payload)
    print(
        f"Wrote {len(records)} stocks ({enriched} with industry) → {args.output}",
        flush=True,
    )
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
