"""Symbol normalization utilities for A-share codes.

Used by akshare_fetcher.py and any future Python tooling.

Rules — first digit of the 6-digit code maps to exchange:
  6, 9        -> SH (Shanghai main + B-share)
  0, 2, 3     -> SZ (Shenzhen main / B / ChiNext)
  4, 8        -> BJ (Beijing Stock Exchange / former 三板 codes)
"""

from __future__ import annotations

import re
from typing import Literal

Exchange = Literal["SH", "SZ", "BJ"]

_SUFFIX_RE = re.compile(r"^(?P<code>\d{6})(?:\.(?P<suf>SH|SZ|BJ))?$", re.IGNORECASE)


def _bare_code(symbol: str) -> str:
    """Return the bare 6-digit code, raising on malformed input."""
    if symbol is None:
        raise ValueError("symbol is None")
    s = symbol.strip().upper()
    m = _SUFFIX_RE.match(s)
    if not m:
        raise ValueError(f"Malformed symbol: {symbol!r}")
    return m.group("code")


def infer_exchange(symbol: str) -> Exchange:
    """Infer the exchange from a 6-digit code (with or without suffix)."""
    code = _bare_code(symbol)
    head = code[0]
    if head in ("6", "9"):
        return "SH"
    if head in ("0", "2", "3"):
        return "SZ"
    if head in ("4", "8"):
        return "BJ"
    raise ValueError(f"Cannot infer exchange for code: {code}")


def normalize_symbol(raw_symbol: str) -> str:
    """Return CODE.EXCHANGE (e.g. '600000.SH', '000001.SZ', '430000.BJ')."""
    code = _bare_code(raw_symbol)
    return f"{code}.{infer_exchange(code)}"


def strip_exchange_suffix(symbol: str) -> str:
    """Return just the 6-digit code, dropping any .SH/.SZ/.BJ suffix."""
    return _bare_code(symbol)


if __name__ == "__main__":  # pragma: no cover — manual smoke test
    samples = ["600000", "000001.SZ", "300750", "430000", "688981", "0001"]
    for s in samples:
        try:
            print(f"{s:>14}  ->  {normalize_symbol(s)}  ({infer_exchange(s)})")
        except Exception as exc:  # pragma: no cover
            print(f"{s:>14}  ->  ERROR: {exc}")
