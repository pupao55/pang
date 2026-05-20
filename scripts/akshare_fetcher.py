"""AkShare A-share daily-bar fetcher with resume + status tracking.

v1.5 changes (vs v1.4):
  * --resume reads fetch-status.json and skips symbols already SUCCESS
    for the same (startDate, endDate, adjust) tuple.
  * --skip-existing skips symbols whose JSON cache already exists.
  * --failed-only retries only symbols whose last status was FAILED /
    EMPTY_DATA / SCHEMA_ERROR.
  * --force ignores status / cache and re-fetches.
  * --sleep-min-seconds / --sleep-max-seconds randomize inter-symbol delay
    to stay under upstream rate limits.
  * --stop-after-consecutive-failures aborts early on prolonged outages.
  * --user-agent-rotate cycles UAs across attempts (mild anti-throttle).
  * Persists fetch-status.json and import-report.json after EVERY symbol;
    no longer overwrites an unrelated prior run's import report.
  * Writes an immutable per-run report to data/akshare/fetch-runs/{ts}.json.

Status categories per symbol:
  SUCCESS         — bars saved
  FAILED          — retryable upstream error (connection reset, timeout)
  EMPTY_DATA      — upstream returned 0 rows
  SCHEMA_ERROR    — DataFrame missing expected columns
  INVALID_SYMBOL  — malformed symbol or unrecognised code
  SKIPPED         — skipped because of --resume / --skip-existing / --failed-only
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
from akshare_symbol_utils import (  # type: ignore  # noqa: E402
    infer_exchange,
    normalize_symbol,
    strip_exchange_suffix,
)


AK_COLUMN_MAP = {
    "日期": "date",
    "开盘": "open",
    "收盘": "close",
    "最高": "high",
    "最低": "low",
    "成交量": "volume",
    "成交额": "amount",
    "振幅": "amplitude",
    "涨跌幅": "pctChange",
    "涨跌额": "changeAmount",
    "换手率": "turnoverRate",
}

REQUIRED_AK_COLUMNS = {"日期", "开盘", "收盘", "最高", "最低", "成交量", "成交额"}

USER_AGENTS = [
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Safari/605.1.15",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0 Safari/537.36",
]


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


def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Fetch A-share daily bars via AkShare (resumable).")
    p.add_argument("--start-date", required=True, help="YYYYMMDD")
    p.add_argument("--end-date", required=True, help="YYYYMMDD")
    p.add_argument("--symbols", default=None, help="Comma-separated symbols. Falls back to universe.")
    p.add_argument("--limit", type=int, default=0, help="Universe cap (0 = no cap).")
    p.add_argument("--adjust", default="qfq", choices=["qfq", "hfq", ""])
    p.add_argument("--output", default="data/akshare")
    p.add_argument("--retry", type=int, default=3)
    p.add_argument("--sleep-seconds", type=float, default=0.5, help="Legacy fixed sleep; superseded by --sleep-min/max.")
    p.add_argument("--sleep-min-seconds", type=float, default=None)
    p.add_argument("--sleep-max-seconds", type=float, default=None)
    p.add_argument("--max-symbols-per-run", type=int, default=0, help="0 = no cap.")
    p.add_argument("--resume", action="store_true")
    p.add_argument("--force", action="store_true")
    p.add_argument("--skip-existing", action="store_true")
    p.add_argument("--failed-only", action="store_true")
    p.add_argument("--status-file", default=None, help="Defaults to {output}/fetch-status.json")
    p.add_argument("--user-agent-rotate", action="store_true")
    p.add_argument("--stop-after-consecutive-failures", type=int, default=10)
    return p.parse_args()


def _empty_status(args: argparse.Namespace) -> dict:
    return {
        "source": "akshare",
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


def _resolve_universe(symbols_arg: str | None, limit: int) -> list[tuple[str, str]]:
    if symbols_arg:
        out: list[tuple[str, str]] = []
        for raw in symbols_arg.split(","):
            raw = raw.strip()
            if not raw:
                continue
            out.append((normalize_symbol(raw), ""))
        return out
    import akshare as ak  # type: ignore
    print("Fetching universe via stock_zh_a_spot_em() ...", flush=True)
    df = ak.stock_zh_a_spot_em()
    if "代码" not in df.columns or "名称" not in df.columns:
        raise RuntimeError(f"stock_zh_a_spot_em returned unexpected schema: {list(df.columns)}")
    pairs: list[tuple[str, str]] = []
    for code, name in zip(df["代码"].astype(str), df["名称"].astype(str)):
        try:
            pairs.append((normalize_symbol(code), name))
        except ValueError:
            continue
    if limit > 0:
        pairs = pairs[:limit]
    return pairs


def _classify_failure(exc: Exception) -> str:
    name = type(exc).__name__
    if name in ("ConnectionError", "ProtocolError", "RemoteDisconnected", "Timeout",
                "ReadTimeout", "ConnectTimeout", "ChunkedEncodingError"):
        return "FAILED"
    if name == "ValueError" and "schema" in str(exc).lower():
        return "SCHEMA_ERROR"
    return "FAILED"


def _set_user_agent(ua: str | None) -> None:
    if ua is None:
        return
    try:
        import requests  # type: ignore
        requests.utils.default_headers().update({"User-Agent": ua})
    except Exception:
        pass


def _fetch_one(
    bare_code: str,
    start_date: str,
    end_date: str,
    adjust: str,
    retries: int,
    intra_retry_sleep: float,
    rotate_ua: bool,
) -> tuple[list[dict[str, Any]], str | None]:
    """Returns (rows, classification). classification is None on success."""
    import akshare as ak  # type: ignore

    for attempt in range(1, retries + 1):
        if rotate_ua:
            _set_user_agent(USER_AGENTS[(attempt - 1) % len(USER_AGENTS)])
        try:
            df = ak.stock_zh_a_hist(
                symbol=bare_code,
                period="daily",
                start_date=start_date,
                end_date=end_date,
                adjust=adjust,
            )
            if df is None or df.empty:
                return [], "EMPTY_DATA"
            missing = REQUIRED_AK_COLUMNS - set(df.columns)
            if missing:
                return [], "SCHEMA_ERROR"
            rows: list[dict[str, Any]] = []
            for _, r in df.iterrows():
                obj: dict[str, Any] = {}
                for cn, en in AK_COLUMN_MAP.items():
                    if cn in df.columns:
                        v = r[cn]
                        if en == "date":
                            obj[en] = str(v)[:10]
                        elif v is None:
                            obj[en] = None
                        else:
                            try:
                                obj[en] = float(v)
                            except (TypeError, ValueError):
                                obj[en] = None
                rows.append(obj)
            return rows, None
        except Exception as exc:  # noqa: BLE001
            cls = _classify_failure(exc)
            wait = intra_retry_sleep * (2 ** (attempt - 1))
            print(
                f"  [retry {attempt}/{retries}] {bare_code} failed ({cls}): {exc} — sleeping {wait:.2f}s",
                flush=True,
            )
            if cls in ("SCHEMA_ERROR", "INVALID_SYMBOL"):
                return [], cls
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


def _scan_cache_for_report(bars_dir: str) -> tuple[int, int, str, str, list[str]]:
    if not os.path.isdir(bars_dir):
        return 0, 0, "—", "—", []
    files = sorted(f for f in os.listdir(bars_dir) if f.endswith(".json"))
    symbols: list[str] = []
    total_rows = 0
    start = "9999-99-99"
    end = "0000-00-00"
    for fname in files:
        try:
            with open(os.path.join(bars_dir, fname), "r", encoding="utf-8") as fh:
                f = json.load(fh)
            bars = f.get("bars") or []
            if not bars:
                continue
            symbols.append(f.get("symbol") or fname.replace(".json", ""))
            total_rows += len(bars)
            if bars[0]["date"] < start:
                start = bars[0]["date"]
            if bars[-1]["date"] > end:
                end = bars[-1]["date"]
        except Exception:
            continue
    if not symbols:
        return 0, 0, "—", "—", []
    return len(symbols), total_rows, start, end, symbols


def _write_cumulative_import_report(out_dir: str, status: dict, warnings: list[str]) -> None:
    bars_dir = os.path.join(out_dir, "daily-bars")
    sym_count, total_rows, start, end, _present = _scan_cache_for_report(bars_dir)
    failed = [
        {"symbol": k, "error": v.get("lastError") or v.get("status", "UNKNOWN")}
        for k, v in (status.get("symbols") or {}).items()
        if v.get("status") in ("FAILED", "SCHEMA_ERROR", "INVALID_SYMBOL")
    ]
    report = {
        "source": "akshare",
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
    _require_akshare()
    args = _parse_args()

    out_dir = os.path.abspath(args.output)
    bars_dir = os.path.join(out_dir, "daily-bars")
    runs_dir = os.path.join(out_dir, "fetch-runs")
    os.makedirs(bars_dir, exist_ok=True)
    os.makedirs(runs_dir, exist_ok=True)
    status_path = args.status_file or os.path.join(out_dir, "fetch-status.json")

    status = _load_status(args, status_path)

    # In --failed-only mode, the working set is just the failed symbols on
    # disk; no need to hit stock_zh_a_spot_em() at all.
    if args.failed_only and not args.symbols:
        bad = ("FAILED", "EMPTY_DATA", "SCHEMA_ERROR")
        universe = [
            (sym, (entry.get("name") or ""))
            for sym, entry in (status.get("symbols") or {}).items()
            if entry.get("status") in bad
        ]
    else:
        universe = _resolve_universe(args.symbols, args.limit)
    print(
        f"Universe: {len(universe)} symbols, {args.start_date}–{args.end_date}, adjust={args.adjust}",
        flush=True,
    )

    sleep_min = args.sleep_min_seconds if args.sleep_min_seconds is not None else args.sleep_seconds
    sleep_max = args.sleep_max_seconds if args.sleep_max_seconds is not None else max(sleep_min, args.sleep_seconds)
    if sleep_max < sleep_min:
        sleep_max = sleep_min
    print(f"Inter-symbol sleep: {sleep_min:.1f}–{sleep_max:.1f}s", flush=True)

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

        # Skip rules
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
            # If the cache file is valid on disk, carry its metadata into the
            # status entry and mark it SUCCESS so downstream consumers see a
            # consistent view (fetch-status, import-report, /validation).
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
        bare = strip_exchange_suffix(symbol)
        entry["attemptCount"] = entry.get("attemptCount", 0) + 1
        entry["lastAttemptAt"] = _now_iso()
        entry["name"] = entry.get("name") or name

        try:
            rows, failure = _fetch_one(
                bare,
                args.start_date,
                args.end_date,
                args.adjust,
                args.retry,
                max(sleep_min / 8, 0.5),
                args.user_agent_rotate,
            )
        except Exception as exc:  # noqa: BLE001
            rows, failure = [], _classify_failure(exc)
            entry["lastError"] = str(exc)

        if rows and failure is None:
            payload = {
                "symbol": symbol,
                "name": entry.get("name") or "",
                "exchange": infer_exchange(symbol),
                "adjust": args.adjust or "raw",
                "source": "akshare.stock_zh_a_hist",
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
            entry["lastError"] = "upstream returned no bars (possibly suspended or out-of-range)"
            consecutive_failures = 0  # empty != failure of upstream
            print(f"[{i}/{len(universe)}] EMPTY {symbol}", flush=True)
            run_record["attempts"].append({"symbol": symbol, "outcome": "EMPTY_DATA"})
        else:
            entry["status"] = failure or "FAILED"
            entry["lastError"] = entry.get("lastError") or "upstream failure after retries"
            consecutive_failures += 1
            print(f"[{i}/{len(universe)}] FAIL {symbol}  ({entry['status']})", flush=True)
            run_record["attempts"].append({"symbol": symbol, "outcome": entry["status"]})

        status["symbols"][symbol] = entry
        _recount(status)
        _atomic_write_json(status_path, status)
        _write_cumulative_import_report(out_dir, status, [])

        if 0 < args.stop_after_consecutive_failures <= consecutive_failures:
            print(
                f"Hit {consecutive_failures} consecutive failures "
                f"(>= --stop-after-consecutive-failures); aborting.",
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
        warnings=[
            "Cumulative import report. Per-run details under data/akshare/fetch-runs/.",
        ],
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
