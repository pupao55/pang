"""Symbol normalization for BaoStock.

BaoStock uses lowercase prefixes: sh.600000 / sz.000001 / sz.300750.
Pangzi's canonical form is 600000.SH / 000001.SZ / 300750.SZ (uppercase
suffix). This module converts in both directions and exposes the same
infer_exchange helper as akshare_symbol_utils.

BaoStock does not have BJ (北交所) symbols on the free tier — those will
fall back to a sz.* attempt and likely fail at fetch time.
"""

from __future__ import annotations

import re
from typing import Literal

Exchange = Literal["SH", "SZ", "BJ"]

_PANGZI_RE = re.compile(r"^(?P<code>\d{6})\.(?P<suf>SH|SZ|BJ)$", re.IGNORECASE)
_BAOSTOCK_RE = re.compile(r"^(?P<pref>sh|sz|bj)\.(?P<code>\d{6})$", re.IGNORECASE)
_BARE_RE = re.compile(r"^(?P<code>\d{6})$")


def infer_exchange(symbol: str) -> Exchange:
    code = _bare_code(symbol)
    head = code[0]
    if head in ("6", "9"):
        return "SH"
    if head in ("0", "2", "3"):
        return "SZ"
    if head in ("4", "8"):
        return "BJ"
    raise ValueError(f"Cannot infer exchange for code: {code}")


def _bare_code(symbol: str) -> str:
    s = symbol.strip()
    m = _PANGZI_RE.match(s)
    if m:
        return m.group("code")
    m = _BAOSTOCK_RE.match(s.lower())
    if m:
        return m.group("code")
    m = _BARE_RE.match(s)
    if m:
        return m.group("code")
    raise ValueError(f"Malformed symbol: {symbol!r}")


def pangzi_to_baostock(symbol: str) -> str:
    """600000.SH -> sh.600000."""
    code = _bare_code(symbol)
    return f"{infer_exchange(code).lower()}.{code}"


def baostock_to_pangzi(symbol: str) -> str:
    """sh.600000 -> 600000.SH."""
    code = _bare_code(symbol)
    return f"{code}.{infer_exchange(code)}"


if __name__ == "__main__":  # pragma: no cover
    samples = ["600000.SH", "sh.600000", "300750.SZ", "sz.300750", "688981.SH"]
    for s in samples:
        try:
            print(f"{s:>14}  pangzi={baostock_to_pangzi(s)}  baostock={pangzi_to_baostock(s)}")
        except Exception as exc:  # pragma: no cover
            print(f"{s:>14}  ERROR: {exc}")
