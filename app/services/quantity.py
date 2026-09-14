"""Canonical inventory quantity policy shared by write paths."""
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP


_QTY_QUANTUM = Decimal("0.001")


def canonical_qty(value) -> float:
    """Return a finite quantity rounded half-up to the inventory 3dp contract.

    ``Decimal(str(value))`` avoids making the caller's binary float determine a
    tie.  Routes convert the result to float only at the SQLite boundary;
    SQLite ROUND then operates on already-canonical 3dp quantities.
    """
    try:
        decimal_value = Decimal(str(value))
        if not decimal_value.is_finite():
            raise ValueError("數量格式錯誤")
        return float(decimal_value.quantize(_QTY_QUANTUM, rounding=ROUND_HALF_UP))
    except (InvalidOperation, TypeError, ValueError):
        raise ValueError("數量格式錯誤")
