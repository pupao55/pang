"""BaoStock A-share daily-bar fetcher (v1.7).

Mirrors the AkShare fetcher's CLI / resume / status semantics so the rest of
Pangzi can treat BaoStock as a drop-in alternative provider when AkShare's
upstream is blocked.

Output layout (parallel to data/akshare/):
  data/baostock/daily-bars/{symbol}.json
  data/baostock/fetch-status.json
  data/baostock/import-report.json
  data/baostock/fetch-runs/{timestamp}.json

Symbol form:
  pangzi  → 300750.SZ        (what we store)
  baostock → sz.300750       (what we send to query_history_k_data_plus)

BaoStock free tier provides:
  - daily K with adjustment factors via query_history_k_data_plus
  - basic stock universe via query_all_stock
  - no concept tags; industry sometimes via query_stock_industry

This script writes the daily bars + a minimal name/exchange field; richer
metadata (industry/concept/market cap) is left to AkShare's metadata
fetcher unless / until a BaoStock-specific metadata fetcher is added.
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
    baostock_to_pangzi,
    infer_exchange,
    pangzi_to_baostock,
)


REQUIRED_BAOSTOCK_FIELDS = [
    "date",
    "open",
    "high",
    "low",
    "close",
    "preclose",
    "volume",
    "amount",
    "turn",
    "pctChg",
]


def _require_baostock():
    try:
        import baostock as bs  # noqa: F401
    except ImportError as exc:
        sys.stderr.write(
            "ERROR: baostock is not installed. Run:\n"
            "  npm run setup:baostock\n"
            "  (or: pip install baostock pandas --upgrade)\n\n"
            f"Original error: {exc}\n",
        )
        sys.exit(2)


def _now_iso() -> str:
    return _dt.datetime.now(_dt.timezone.utc).isoformat(timespec="seconds")


def _atomic_write_json(path: str, data: Any) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=2)
    os.replace(tmp, path)


def _load_json(path: str) -> Any:
    if not os.path.exists(path):
        return None
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)


# BaoStock requires login()/logout() to bracket all queries. Manage a single
# session for the whole run.
class BaostockSession:
    def __init__(self) -> None:
        self._logged_in = False

    def __enter__(self):
        import baostock as bs  # type: ignore
        rs = bs.login()
        if rs.error_code != "0":
            raise RuntimeError(f"baostock.login failed: {rs.error_msg}")
        self._logged_in = True
        return self

    def __exit__(self, *_):
        import baostock as bs  # type: ignore
        if self._logged_in:
            bs.logout()
            self._logged_in = False


def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Fetch A-share daily bars via BaoStock (resumable).")
    p.add_argument("--start-date", required=True, help="YYYY-MM-DD")
    p.add_argument("--end-date", required=True, help="YYYY-MM-DD")
    p.add_argument("--symbols", default=None, help="Comma-separated pangzi-format symbols (300750.SZ,...).")
    p.add_argument("--symbols-file", default=None, help="One pangzi symbol per line.")
    p.add_argument("--limit", type=int, default=0, help="When using universe mode, cap to first N.")
    p.add_argument("--adjust", default="qfq", choices=["qfq", "hfq", ""])
    p.add_argument("--output", default="data/baostock")
    p.add_argument("--retry", type=int, default=3)
    p.add_argument("--sleep-min-seconds", type=float, default=1.0)
    p.add_argument("--sleep-max-seconds", type=float, default=3.0)
    p.add_argument("--max-symbols-per-run", type=int, default=0)
    p.add_argument("--resume", action="store_true")
    p.add_argument("--force", action="store_true")
    p.add_argument("--skip-existing", action="store_true")
    p.add_argument("--failed-only", action="store_true")
    p.add_argument("--status-file", default=None)
    p.add_argument("--stop-after-consecutive-failures", type=int, default=10)
    return p.parse_args()


def _empty_status(args: argparse.Namespace) -> dict:
    return {
        "source": "baostock",
        "adjust": args.adjust or "raw",
        "startDate": args.start_date,
        "endDate": args.end_date,
        "updatedAt": _now_iso(),
        "totalSymbols": 0,
        "succeeded": 0,
        "failed": 0,
        "empty": 0,
        "skipped": 0,
        "symbols": {},
    }


def _load_status(args: argparse.Namespace, path: str) -> dict:
    raw = _load_json(path)
    if not raw or not isinstance(raw, dict):
        return _empty_status(args)
    same_scope = (
        raw.get("adjust") == (args.adjust or "raw")
        and raw.get("startDate") == args.start_date
        and raw.get("endDate") == args.end_date
    )
    if not same_scope:
        new = _empty_status(args)
        prior = raw.get("symbols") or {}
        for sym, entry in prior.items():
            new["symbols"][sym] = {
                **entry,
                "status": "SKIPPED",
                "lastError": "scope-changed-since-last-run",
            }
        return new
    raw.setdefault("symbols", {})
    return raw


def _recount(status: dict) -> None:
    counts = {"SUCCESS": 0, "FAILED": 0, "EMPTY_DATA": 0, "SKIPPED": 0,
              "SCHEMA_ERROR": 0, "INVALID_SYMBOL": 0}
    for v in status["symbols"].values():
        st = v.get("status") or "SKIPPED"
        counts[st] = counts.get(st, 0) + 1
    status["totalSymbols"] = sum(counts.values())
    status["succeeded"] = counts["SUCCESS"]
    status["failed"] = counts["FAILED"] + counts["SCHEMA_ERROR"] + counts["INVALID_SYMBOL"]
    status["empty"] = counts["EMPTY_DATA"]
    status["skipped"] = counts["SKIPPED"]
    status["updatedAt"] = _now_iso()


def _resolve_universe(args: argparse.Namespace) -> list[tuple[str, str]]:
    """Return [(pangzi_symbol, name)] tuples to fetch."""
    if args.symbols:
        out: list[tuple[str, str]] = []
        for raw in args.symbols.split(","):
            s = raw.strip()
            if not s:
                continue
            out.append((baostock_to_pangzi(s), ""))
        return out
    if args.symbols_file:
        out = []
        with open(args.symbols_file, "r", encoding="utf-8") as fh:
            for line in fh:
                s = line.strip()
                if not s or s.startswith("#"):
                    continue
                out.append((baostock_to_pangzi(s), ""))
        return out

    # Universe via baostock query_all_stock (current trading day's listing).
    import baostock as bs  # type: ignore
    today = _dt.date.today().isoformat()
    print(f"Fetching universe via baostock.query_all_stock({today}) ...", flush=True)
    rs = bs.query_all_stock(day=today)
    if rs.error_code != "0":
        raise RuntimeError(f"query_all_stock failed: {rs.error_msg}")
    pairs: list[tuple[str, str]] = []
    while rs.next():
        row = rs.get_row_data()
        if not row:
            continue
        code = row[0]
        name = row[2] if len(row) > 2 else ""
        if not code.startswith(("sh.", "sz.")):
            continue  # skip indices / non-A-share
        try:
            pairs.append((baostock_to_pangzi(code), name))
        except ValueError:
            continue
    if args.limit > 0:
        pairs = pairs[: args.limit]
    return pairs


def _fetch_one(
    pangzi_symbol: str,
    start_date: str,
    end_date: str,
    adjust: str,
    retries: int,
    intra_retry_sleep: float,
) -> tuple[list[dict[str, Any]], str | None]:
    """Returns (rows, classification)."""
    import baostock as bs  # type: ignore

    baostock_symbol = pangzi_to_baostock(pangzi_symbol)
    # BaoStock adjustment mapping: 1=qfq, 2=hfq, 3=raw.
    adj_map = {"qfq": "2", "hfq": "1", "": "3", "raw": "3"}
    bs_adjust = adj_map.get(adjust, "2")
    fields = ",".join(REQUIRED_BAOSTOCK_FIELDS)

    for attempt in range(1, retries + 1):
        try:
            rs = bs.query_history_k_data_plus(
                baostock_symbol,
                fields,
                start_date=start_date,
                end_date=end_date,
                frequency="d",
                adjustflag=bs_adjust,
            )
            if rs.error_code != "0":
                msg = (rs.error_msg or "").lower()
                if "no record" in msg or "stop list" in msg:
                    return [], "EMPTY_DATA"
                if "invalid" in msg or "stock not exist" in msg:
                    return [], "INVALID_SYMBOL"
                raise RuntimeError(f"baostock error {rs.error_code}: {rs.error_msg}")
            rows: list[dict[str, Any]] = []
            while rs.next():
                r = rs.get_row_data()
                if not r:
                    continue
                # Field order matches REQUIRED_BAOSTOCK_FIELDS exactly.
                date_s, open_s, high_s, low_s, close_s, prec_s, vol_s, amt_s, turn_s, pct_s = r
                def _f(x: str) -> float | None:
                    try:
                        return float(x) if x not in ("", None) else None
                    except (TypeError, ValueError):
                        return None
                rows.append({
                    "date": date_s,
                    "open": _f(open_s),
                    "high": _f(high_s),
                    "low": _f(low_s),
                    "close": _f(close_s),
                    "preclose": _f(prec_s),
                    "volume": _f(vol_s),
                    "amount": _f(amt_s),
                    "turnoverRate": _f(turn_s),
                    "pctChange": _f(pct_s),
                })
            if not rows:
                return [], "EMPTY_DATA"
            return rows, None
        except Exception as exc:  # noqa: BLE001
            wait = intra_retry_sleep * (2 ** (attempt - 1))
            print(
                f"  [retry {attempt}/{retries}] {pangzi_symbol} failed: {exc} — sleeping {wait:.2f}s",
                flush=True,
            )
            time.sleep(wait)
    return [], "FAILED"


def _is_cache_present_and_valid(path: str) -> bool:
    if not os.path.exists(path):
        return False
    try:
        with open(path, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        return isinstance(data, dict) and isinstance(data.get("bars"), list) and len(data["bars"]) > 0
    except Exception:
        return False


def _scan_cache_for_report(bars_dir: str) -> tuple[int, int, str, str]:
    if not os.path.isdir(bars_dir):
        return 0, 0, "—", "—"
    files = sorted(f for f in os.listdir(bars_dir) if f.endswith(".json"))
    sym_count = 0
    total = 0
    start = "9999-99-99"
    end = "0000-00-00"
    for fname in files:
        try:
            with open(os.path.join(bars_dir, fname), "r", encoding="utf-8") as fh:
                f = json.load(fh)
            bars = f.get("bars") or []
            if not bars:
                continue
            sym_count += 1
            total += len(bars)
            if bars[0]["date"] < start:
                start = bars[0]["date"]
            if bars[-1]["date"] > end:
                end = bars[-1]["date"]
        except Exception:
            continue
    if sym_count == 0:
        return 0, 0, "—", "—"
    return sym_count, total, start, end


def _write_cumulative_import_report(out_dir: str, status: dict, warnings: list[str]) -> None:
    bars_dir = os.path.join(out_dir, "daily-bars")
    sym_count, total_rows, start, end = _scan_cache_for_report(bars_dir)
    failed = [
        {"symbol": k, "error": v.get("lastError") or v.get("status", "UNKNOWN")}
        for k, v in (status.get("symbols") or {}).items()
        if v.get("status") in ("FAILED", "SCHEMA_ERROR", "INVALID_SYMBOL")
    ]
    report = {
        "source": "baostock",
        "adjust": status.get("adjust", "qfq"),
        "startDate": status.get("startDate"),
        "endDate": status.get("endDate"),
        "lastUpdatedAt": _now_iso(),
        "totalSymbolsKnown": len(status.get("symbols") or {}),
        "totalSymbolsSucceeded": sym_count,
        "totalSymbolsFailed": len(failed),
        "totalSymbolsEmpty": sum(
            1 for v in (status.get("symbols") or {}).values() if v.get("status") == "EMPTY_DATA"
        ),
        "totalRows": total_rows,
        "dateRange": {"start": start, "end": end},
        "failedSymbols": failed,
        "warnings": warnings,
    }
    _atomic_write_json(os.path.join(out_dir, "import-report.json"), report)


def main() -> int:
    _require_baostock()
    args = _parse_args()
    out_dir = os.path.abspath(args.output)
    bars_dir = os.path.join(out_dir, "daily-bars")
    runs_dir = os.path.join(out_dir, "fetch-runs")
    os.makedirs(bars_dir, exist_ok=True)
    os.makedirs(runs_dir, exist_ok=True)
    status_path = args.status_file or os.path.join(out_dir, "fetch-status.json")

    status = _load_status(args, status_path)

    sleep_min = args.sleep_min_seconds
    sleep_max = max(args.sleep_max_seconds, sleep_min)

    started_at = _now_iso()
    run_record = {
        "startedAt": started_at,
        "completedAt": None,
        "args": {
            "startDate": args.start_date,
            "endDate": args.end_date,
            "adjust": args.adjust,
            "limit": args.limit,
            "resume": args.resume,
            "force": args.force,
            "skip_existing": args.skip_existing,
            "failed_only": args.failed_only,
            "max_symbols_per_run": args.max_symbols_per_run,
            "sleep_range": [sleep_min, sleep_max],
            "retry": args.retry,
            "stop_after_consecutive_failures": args.stop_after_consecutive_failures,
        },
        "attempts": [],
    }

    with BaostockSession():
        # --failed-only mode draws from status; otherwise resolve universe.
        if args.failed_only and not args.symbols and not args.symbols_file:
            bad = ("FAILED", "EMPTY_DATA", "SCHEMA_ERROR")
            universe = [
                (sym, (entry.get("name") or ""))
                for sym, entry in (status.get("symbols") or {}).items()
                if entry.get("status") in bad
            ]
        else:
            universe = _resolve_universe(args)
        print(
            f"Universe: {len(universe)} symbols, {args.start_date}–{args.end_date}, adjust={args.adjust}",
            flush=True,
        )
        print(f"Inter-symbol sleep: {sleep_min:.1f}–{sleep_max:.1f}s", flush=True)

        attempted = 0
        consecutive_failures = 0

        for i, (symbol, name) in enumerate(universe, start=1):
            if args.max_symbols_per_run and attempted >= args.max_symbols_per_run:
                print(f"Reached --max-symbols-per-run={args.max_symbols_per_run}; stopping.", flush=True)
                break

            entry = status["symbols"].get(symbol) or {
                "symbol": symbol,
                "name": name,
                "status": None,
                "rows": 0,
                "firstDate": None,
                "lastDate": None,
                "attemptCount": 0,
                "lastAttemptAt": None,
                "lastSuccessAt": None,
                "lastError": None,
            }
            cache_path = os.path.join(bars_dir, f"{symbol}.json")

            reason_skipped: str | None = None
            if not args.force:
                if args.resume and entry.get("status") == "SUCCESS":
                    reason_skipped = "resume:already-success"
                elif args.skip_existing and _is_cache_present_and_valid(cache_path):
                    reason_skipped = "skip-existing:cache-present"
                elif args.failed_only and entry.get("status") not in (
                    "FAILED", "EMPTY_DATA", "SCHEMA_ERROR", None,
                ):
                    reason_skipped = "failed-only:not-failed"
            if reason_skipped:
                cached_promoted = False
                if _is_cache_present_and_valid(cache_path):
                    try:
                        with open(cache_path, "r", encoding="utf-8") as fh:
                            cached = json.load(fh)
                        bars_c = cached.get("bars") or []
                        if bars_c:
                            entry["status"] = "SUCCESS"
                            entry["rows"] = len(bars_c)
                            entry["firstDate"] = bars_c[0].get("date")
                            entry["lastDate"] = bars_c[-1].get("date")
                            entry["name"] = entry.get("name") or cached.get("name") or ""
                            entry["lastSuccessAt"] = entry.get("lastSuccessAt") or _now_iso()
                            cached_promoted = True
                    except Exception:
                        pass
                if not cached_promoted and entry.get("status") is None:
                    entry["status"] = "SKIPPED"
                entry["lastAttemptAt"] = _now_iso()
                status["symbols"][symbol] = entry
                run_record["attempts"].append({"symbol": symbol, "outcome": "SKIPPED", "reason": reason_skipped})
                print(f"[{i}/{len(universe)}] SKIP {symbol} ({reason_skipped})", flush=True)
                _recount(status)
                _atomic_write_json(status_path, status)
                _write_cumulative_import_report(out_dir, status, [])
                continue

            attempted += 1
            entry["attemptCount"] = entry.get("attemptCount", 0) + 1
            entry["lastAttemptAt"] = _now_iso()
            entry["name"] = entry.get("name") or name

            rows, failure = _fetch_one(
                symbol, args.start_date, args.end_date, args.adjust,
                args.retry, max(sleep_min / 6, 0.5),
            )

            if rows and failure is None:
                payload = {
                    "symbol": symbol,
                    "name": entry.get("name") or "",
                    "exchange": infer_exchange(symbol),
                    "adjust": args.adjust or "raw",
                    "source": "baostock.query_history_k_data_plus",
                    "fetchedAt": _now_iso(),
                    "startDate": args.start_date,
                    "endDate": args.end_date,
                    "barCount": len(rows),
                    "bars": rows,
                }
                _atomic_write_json(cache_path, payload)
                entry["status"] = "SUCCESS"
                entry["rows"] = len(rows)
                entry["firstDate"] = rows[0].get("date")
                entry["lastDate"] = rows[-1].get("date")
                entry["lastSuccessAt"] = entry["lastAttemptAt"]
                entry["lastError"] = None
                consecutive_failures = 0
                print(f"[{i}/{len(universe)}] OK   {symbol}  ({len(rows)} bars)", flush=True)
                run_record["attempts"].append({"symbol": symbol, "outcome": "SUCCESS", "rows": len(rows)})
            elif failure == "EMPTY_DATA":
                entry["status"] = "EMPTY_DATA"
                entry["rows"] = 0
                entry["lastError"] = "baostock returned no rows"
                consecutive_failures = 0
                print(f"[{i}/{len(universe)}] EMPTY {symbol}", flush=True)
                run_record["attempts"].append({"symbol": symbol, "outcome": "EMPTY_DATA"})
            else:
                entry["status"] = failure or "FAILED"
                entry["lastError"] = entry.get("lastError") or "baostock failure after retries"
                consecutive_failures += 1
                print(f"[{i}/{len(universe)}] FAIL {symbol}  ({entry['status']})", flush=True)
                run_record["attempts"].append({"symbol": symbol, "outcome": entry["status"]})

            status["symbols"][symbol] = entry
            _recount(status)
            _atomic_write_json(status_path, status)
            _write_cumulative_import_report(out_dir, status, [])

            if 0 < args.stop_after_consecutive_failures <= consecutive_failures:
                print(
                    f"Hit {consecutive_failures} consecutive failures; aborting.",
                    flush=True,
                )
                break

            if i != len(universe):
                time.sleep(random.uniform(sleep_min, sleep_max))

    run_record["completedAt"] = _now_iso()
    _atomic_write_json(
        os.path.join(runs_dir, f"{started_at.replace(':', '-')}.json"),
        run_record,
    )
    _recount(status)
    _atomic_write_json(status_path, status)
    _write_cumulative_import_report(
        out_dir,
        status,
        warnings=["Cumulative import report. Per-run details under data/baostock/fetch-runs/."],
    )

    print(
        f"\nDone. succeeded={status['succeeded']} failed={status['failed']} "
        f"empty={status['empty']} skipped={status['skipped']}",
        flush=True,
    )
    print(f"Output: {out_dir}", flush=True)
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
