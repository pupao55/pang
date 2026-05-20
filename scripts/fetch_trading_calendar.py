"""Fetch the A-share trading calendar from AkShare.

Tries (in order):
  1. ak.tool_trade_date_hist_sina()
  2. ak.stock_zh_a_trade_date_hist()   — older name, kept as a fallback
  3. ak.tool_trade_date_hist()         — even older fallback

Output:
  data/akshare/trading-calendar.json
  {
    "source": "akshare.tool_trade_date_hist_sina",
    "fetchedAt": "...",
    "startDate": "...",
    "endDate": "...",
    "dates": ["2024-01-02", "2024-01-03", ...]
  }

Run once and reuse — the calendar changes once a year when the next-year
holiday schedule is announced.
"""

from __future__ import annotations

import argparse
import datetime as _dt
import json
import os
import sys


def _require_akshare():
    try:
        import akshare as ak  # noqa: F401
    except ImportError as exc:
        sys.stderr.write(
            "ERROR: akshare is not installed. Run:\n"
            "  pip install akshare --upgrade\n\n"
            f"Original error: {exc}\n",
        )
        sys.exit(2)


def _now_iso() -> str:
    return _dt.datetime.now(_dt.timezone.utc).isoformat(timespec="seconds")


def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Fetch A-share trading calendar via AkShare.")
    p.add_argument("--start-date", required=True, help="YYYYMMDD")
    p.add_argument("--end-date", required=True, help="YYYYMMDD")
    p.add_argument("--output", default="data/akshare/trading-calendar.json")
    return p.parse_args()


def _normalize_dates(series) -> list[str]:
    out: list[str] = []
    for v in series:
        if v is None:
            continue
        s = str(v)[:10]
        if len(s) == 10 and s[4] == "-" and s[7] == "-":
            out.append(s)
    return sorted(set(out))


def main() -> int:
    _require_akshare()
    import akshare as ak  # type: ignore

    args = _parse_args()
    start = args.start_date  # YYYYMMDD
    end = args.end_date
    start_dash = f"{start[:4]}-{start[4:6]}-{start[6:8]}"
    end_dash = f"{end[:4]}-{end[4:6]}-{end[6:8]}"

    candidates = [
        "tool_trade_date_hist_sina",
        "stock_zh_a_trade_date_hist",
        "tool_trade_date_hist",
    ]
    df = None
    used_fn = None
    for fn_name in candidates:
        fn = getattr(ak, fn_name, None)
        if not callable(fn):
            continue
        try:
            df = fn()
            used_fn = fn_name
            break
        except Exception as exc:  # noqa: BLE001
            sys.stderr.write(f"WARN: {fn_name} failed: {exc}\n")
            continue

    if df is None:
        sys.stderr.write(
            "ERROR: no working AkShare trading-calendar function found. "
            "Tried: " + ", ".join(candidates) + "\n",
        )
        sys.exit(1)

    # AkShare returns either a DataFrame with column 'trade_date' or similar.
    # Be liberal: take the first column with date-like content.
    try:
        # If there's a 'trade_date' column, use it.
        col = "trade_date" if "trade_date" in df.columns else df.columns[0]
        dates = _normalize_dates(df[col])
    except Exception:
        dates = _normalize_dates(df.iloc[:, 0])

    # Filter to requested range.
    dates = [d for d in dates if start_dash <= d <= end_dash]

    payload = {
        "source": f"akshare.{used_fn}",
        "fetchedAt": _now_iso(),
        "startDate": start_dash,
        "endDate": end_dash,
        "count": len(dates),
        "dates": dates,
    }

    out_path = os.path.abspath(args.output)
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    tmp = out_path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=2)
    os.replace(tmp, out_path)
    print(f"Wrote {len(dates)} trading days to {out_path} (via {used_fn})", flush=True)
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
