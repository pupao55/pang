"""BaoStock industry metadata fetcher.

Walks the cached BaoStock universe (data/baostock/daily-bars/*.json) and
calls baostock.query_stock_industry per symbol to backfill the industry
field. Writes data/baostock/metadata/stocks.json.

If BaoStock's industry endpoint returns nothing for a symbol, the script
does NOT fabricate a name — it leaves `industry: ""` and emits a synthetic
fallback group (BOARD_* / PREFIX_*) so the downstream sector builder still
has something to group on.

The synthetic fallback categories are intentionally honest:
  BOARD_MAIN     上海主板 / 深圳主板
  BOARD_CHINEXT  创业板 (300xxx)
  BOARD_STAR     科创板 (688/689)
  PREFIX_000     深圳 000xxx
  PREFIX_002     深圳 002xxx
  PREFIX_300     深圳 300xxx
  PREFIX_600     上海 600xxx
  PREFIX_601     上海 601xxx
  PREFIX_603     上海 603xxx

Usage:
  python3 scripts/baostock_metadata_fetcher.py
    --bars-dir data/baostock/daily-bars
    --output data/baostock/metadata/stocks.json
    [--sleep-min-seconds 0.5] [--sleep-max-seconds 1.5]
    [--max-symbols 0]
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
from baostock_symbol_utils import (  # type: ignore  # noqa: E402
    infer_exchange,
    pangzi_to_baostock,
)


def _require_baostock():
    try:
        import baostock  # noqa: F401
    except ImportError as exc:
        sys.stderr.write(
            "ERROR: baostock not installed. Run npm run setup:baostock.\n"
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


def _board_type(symbol: str) -> str:
    code = symbol.split(".")[0]
    head = code[0]
    head3 = code[:3]
    if head3 in ("688", "689"):
        return "STAR"
    if head == "3":
        return "CHINEXT"
    return "MAIN"


def _synthetic_groups(symbol: str) -> dict[str, str]:
    """Return {board, prefix} synthetic groups for the symbol."""
    code = symbol.split(".")[0]
    board = _board_type(symbol)
    prefix = code[:3]
    return {
        "board": f"BOARD_{board}",
        "prefix": f"PREFIX_{prefix}",
    }


def _list_cached_symbols(bars_dir: str) -> list[tuple[str, str]]:
    """Return [(pangzi_symbol, name)]."""
    out: list[tuple[str, str]] = []
    if not os.path.isdir(bars_dir):
        return out
    for f in sorted(os.listdir(bars_dir)):
        if not f.endswith(".json"):
            continue
        try:
            with open(os.path.join(bars_dir, f), "r", encoding="utf-8") as fh:
                data = json.load(fh)
            out.append((data.get("symbol") or f.replace(".json", ""), data.get("name") or ""))
        except Exception:
            out.append((f.replace(".json", ""), ""))
    return out


def _query_industry(bs, symbol: str) -> str:
    """Returns the industry label for a symbol or "" if unavailable."""
    baostock_symbol = pangzi_to_baostock(symbol)
    try:
        rs = bs.query_stock_industry(code=baostock_symbol)
    except Exception:
        return ""
    if rs.error_code != "0":
        return ""
    industry = ""
    while rs.next():
        row = rs.get_row_data()
        if not row:
            continue
        # BaoStock returns: [updateDate, code, code_name, industry, industryClassification]
        for cell in (row[3] if len(row) > 3 else "", row[4] if len(row) > 4 else ""):
            if cell:
                industry = cell
                break
        if industry:
            break
    return industry


def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="BaoStock industry metadata fetcher.")
    p.add_argument("--bars-dir", default="data/baostock/daily-bars")
    p.add_argument("--output", default="data/baostock/metadata/stocks.json")
    p.add_argument("--sleep-min-seconds", type=float, default=0.5)
    p.add_argument("--sleep-max-seconds", type=float, default=1.5)
    p.add_argument("--max-symbols", type=int, default=0,
                   help="Cap for testing; 0 = no cap.")
    return p.parse_args()


def main() -> int:
    _require_baostock()
    import baostock as bs  # type: ignore

    args = _parse_args()
    symbols = _list_cached_symbols(args.bars_dir)
    if args.max_symbols > 0:
        symbols = symbols[: args.max_symbols]
    if not symbols:
        sys.stderr.write(
            f"No cached symbols in {args.bars_dir}; run fetch:baostock:sample first.\n",
        )
        return 2

    print(f"BaoStock metadata: {len(symbols)} symbols", flush=True)
    warnings: list[str] = []
    rs_login = bs.login()
    if rs_login.error_code != "0":
        sys.stderr.write(f"baostock.login failed: {rs_login.error_msg}\n")
        return 2
    started = _now_iso()

    stocks: list[dict[str, Any]] = []
    with_industry = 0
    try:
        for i, (sym, name) in enumerate(symbols, start=1):
            industry = _query_industry(bs, sym)
            groups = _synthetic_groups(sym)
            board_type = _board_type(sym)
            record: dict[str, Any] = {
                "symbol": sym,
                "name": name,
                "exchange": infer_exchange(sym),
                "boardType": board_type,
                "industry": industry or "",
                "industrySource": "baostock.query_stock_industry" if industry else "synthetic",
                "syntheticBoardGroup": groups["board"],
                "syntheticPrefixGroup": groups["prefix"],
                "concepts": [],
                "isST": False,
                "marketCap": 0,
                "floatMarketCap": 0,
                "fetchedAt": _now_iso(),
            }
            if industry:
                with_industry += 1
            else:
                warnings.append(f"{sym}: no industry from BaoStock; using synthetic groups only.")
            stocks.append(record)
            if i % 10 == 0 or i == len(symbols):
                print(
                    f"  [{i}/{len(symbols)}] industry hits: {with_industry}",
                    flush=True,
                )
            time.sleep(random.uniform(args.sleep_min_seconds, args.sleep_max_seconds))
    finally:
        bs.logout()

    payload = {
        "source": "baostock.query_stock_industry",
        "fetchedAt": _now_iso(),
        "startedAt": started,
        "totalSymbols": len(stocks),
        "withIndustry": with_industry,
        "withoutIndustry": len(stocks) - with_industry,
        "warnings": warnings,
        "stocks": stocks,
    }
    _atomic_write(args.output, payload)
    print(
        f"Wrote metadata: {len(stocks)} symbols ({with_industry} with industry, "
        f"{len(stocks) - with_industry} synthetic-fallback) → {args.output}",
        flush=True,
    )
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
