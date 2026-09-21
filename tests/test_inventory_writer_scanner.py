"""Regression tests for the reproducible inventory-writer scanner."""
from __future__ import annotations

import importlib.util
from pathlib import Path
from types import ModuleType


BASE_DIR = Path(__file__).resolve().parents[1]
SCANNER_PATH = BASE_DIR / "scripts" / "scan_inventory_writers.py"


def _load_scanner() -> ModuleType:
    """Load the standalone scanner without importing application runtime code."""
    spec = importlib.util.spec_from_file_location("inventory_writer_scanner", SCANNER_PATH)
    if spec is None or spec.loader is None:
        raise AssertionError(f"unable to load scanner: {SCANNER_PATH}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_scanner_recognizes_multiline_inventory_write_forms(tmp_path: Path) -> None:
    """Keep the required multiline and upsert SQL forms visible to the scanner."""
    source = tmp_path / "app" / "routes" / "inventory.py"
    source.parent.mkdir(parents=True)
    source.write_text(
        """
conn.execute(\"\"\"
    UPDATE item_stocks
       SET qty=?
     WHERE id=?
\"\"\")
conn.execute(\"\"\"
    INSERT INTO movements (item_id, delta)
    VALUES (?, ?)
    ON CONFLICT(item_id) DO UPDATE SET delta=excluded.delta
\"\"\")
conn.execute(\"INSERT OR REPLACE INTO items (prepared_qty) VALUES (?)\")
conn.execute(\"DELETE FROM movements WHERE id=?\")
""",
        encoding="utf-8",
    )

    results = _load_scanner().scan(tmp_path)
    operations = {
        (table, row["operation"])
        for table, rows in results.items()
        for row in rows
    }

    assert ("item_stocks", "UPDATE") in operations
    assert ("items.prepared_qty", "INSERT OR REPLACE") in operations
    assert ("movements", "INSERT + ON CONFLICT (UPSERT)") in operations
    assert ("movements", "DELETE") in operations


def test_scanner_labels_non_executable_sql_as_static_source_text(tmp_path: Path) -> None:
    """Document that comments are inventory evidence candidates, not runtime proof."""
    source = tmp_path / "app" / "routes" / "example.py"
    source.parent.mkdir(parents=True)
    update_sql = "UPDATE" + " item_stocks SET qty=? WHERE id=?"
    source.write_text(f'\"\"\"{update_sql}\"\"\"\n', encoding="utf-8")

    results = _load_scanner().scan(tmp_path)

    assert len(results["item_stocks"]) == 1
    assert results["item_stocks"][0]["scope"] == "production/source"


def test_scanner_does_not_claim_dynamic_table_sql(tmp_path: Path) -> None:
    """Preserve the documented limitation for helper-generated table names."""
    source = tmp_path / "dynamic.py"
    source.write_text(
        """
table_name = \"item_stocks\"
conn.execute(f\"UPDATE {table_name} SET qty=? WHERE id=?\")
""",
        encoding="utf-8",
    )

    results = _load_scanner().scan(tmp_path)

    assert results["item_stocks"] == []
    assert results["items.prepared_qty"] == []
    assert results["movements"] == []
