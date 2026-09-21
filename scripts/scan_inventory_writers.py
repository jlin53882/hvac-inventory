#!/usr/bin/env python3
"""Static architecture-fitness scanner for inventory SQL writers.

This scanner identifies SQL-like writes to protected inventory state. It does
not import the application, execute SQL, or prove runtime reachability,
transaction correctness, atomicity, rollback, or concurrency behavior.
"""

from __future__ import annotations

import argparse
import re
from pathlib import Path


TABLES = ("item_stocks", "items.prepared_qty", "movements")
SQL_EXTENSIONS = {".py", ".js", ".html", ".sql"}


def _line_number(text: str, offset: int) -> int:
    return text.count("\n", 0, offset) + 1


def _operation(sql: str, table: str) -> str | None:
    # ``items.prepared_qty`` is a state column, not a qualified SQL table
    # name.  Match writes to ``items`` that mention that column.
    target_table = "items" if table == "items.prepared_qty" else table
    escaped = re.escape(target_table)
    patterns = (
        (rf"\bUPDATE\s+(?:OR\s+\w+\s+)?{escaped}\b", "UPDATE"),
        (rf"\bINSERT\s+(?:(OR\s+REPLACE)\s+)?INTO\s+{escaped}\b", "INSERT"),
        (rf"\bDELETE\s+FROM\s+{escaped}\b", "DELETE"),
    )
    for pattern, label in patterns:
        match = re.search(pattern, sql, re.IGNORECASE | re.DOTALL)
        if match and (
            table != "items.prepared_qty"
            or re.search(r"\bprepared_qty\b", sql, re.IGNORECASE)
        ):
            if label == "INSERT" and match.group(1):
                label = "INSERT OR REPLACE"
            if re.search(r"\bON\s+CONFLICT\b", sql, re.IGNORECASE):
                return f"{label} + ON CONFLICT (UPSERT)"
            return label
    if table == "items.prepared_qty" and not re.search(r"\bprepared_qty\b", sql, re.IGNORECASE):
        return None
    if re.search(rf"\bUPSERT\b.*?{escaped}\b", sql, re.IGNORECASE | re.DOTALL):
        return "UPSERT"
    if re.search(rf"\bON\s+CONFLICT\b.*?{escaped}\b", sql, re.IGNORECASE | re.DOTALL):
        return "ON CONFLICT"
    return None


def scan(root: Path) -> dict[str, list[dict[str, str | int]]]:
    results = {table: [] for table in TABLES}
    string_pattern = re.compile(r"(?:'''[\s\S]*?'''|\"\"\"[\s\S]*?\"\"\"|'[^'\n]*'|\"[^\"\n]*\")")
    for path in sorted(root.rglob("*")):
        if not path.is_file() or path.suffix.lower() not in SQL_EXTENSIONS:
            continue
        if any(part in {".git", ".venv", ".gitnexus", "__pycache__"} for part in path.parts):
            continue
        text = path.read_text(encoding="utf-8", errors="replace")
        for match in string_pattern.finditer(text):
            sql = match.group(0)
            for table in TABLES:
                operation = _operation(sql, table)
                if operation:
                    relative = path.relative_to(root).as_posix()
                    results[table].append(
                        {
                            "operation": operation,
                            "location": f"{relative}:{_line_number(text, match.start())}",
                            "scope": "test fixture" if relative.startswith("tests/") else "production/source",
                            "snippet": " ".join(sql.split())[:180],
                        }
                    )
    return results


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    args = parser.parse_args()
    results = scan(args.root.resolve())
    print("Inventory writer static scan")
    print("Scanner: scripts/scan_inventory_writers.py")
    print("Mode: static SQL literals only; no runtime SQL tracing")
    for table, rows in results.items():
        production = sum(row["scope"] == "production/source" for row in rows)
        fixtures = len(rows) - production
        print(f"\n{table}: {len(rows)} match(es); production/source={production}; test fixture={fixtures}")
        for row in rows:
            print(f"- {row['operation']} | {row['scope']} | {row['location']} | {row['snippet']}")
    print("\nKnown Scanner Limitation: helper-generated or dynamic SQL that is not present as a single discoverable SQL literal may be missed or cannot be reliably attributed to its eventual table writer.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
