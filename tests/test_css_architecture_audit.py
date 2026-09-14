from __future__ import annotations

import subprocess
from pathlib import Path

from scripts.audit_css_architecture import PROTECTED_FILES, build_inventory

ROOT = Path(__file__).resolve().parents[1]
BASE_SHA = "f4e2768b78dfc8f649959134843ce59dd14ba6f0"


def git_blob(path: str, revision: str) -> bytes:
    return subprocess.check_output(
        ["git", "show", f"{revision}:{path}"], cwd=ROOT
    )


def test_css_audit_covers_expected_frontend_surface() -> None:
    inventory = build_inventory(ROOT)
    summary = inventory["summary"]

    assert summary["css_files"] == 13
    assert summary["html_files"] == 4
    assert summary["js_files"] == 36
    assert set(inventory["protected_files"]) == PROTECTED_FILES
    assert summary["css_selector_count"] > summary["unique_selector_count"]
    assert summary["duplicate_selector_groups"] > 0
    assert summary["inline_style_blocks"] >= 3
    assert summary["js_style_operations"] > 0
    assert summary["js_class_operations"] > 0


def test_stylesheet_load_order_is_explicit_and_protected_files_are_mounted() -> None:
    inventory = build_inventory(ROOT)
    order = inventory["load_order"]["index_stylesheets"]

    assert order[0] == "css/style.core.css"
    protected_order = [name for name in order if name in {
        "css/style.petty-cash.css",
        "css/style.petty-cash-reports.css",
        "css/style.petty-cash-engineering.css",
    }]
    assert protected_order == [
        "css/style.petty-cash.css",
        "css/style.petty-cash-reports.css",
        "css/style.petty-cash-engineering.css",
    ]
    assert inventory["load_order"]["duplicate_selector_dependencies"]


def test_pr8_protected_css_matches_audit_base_blob() -> None:
    for path in sorted(PROTECTED_FILES):
        assert (ROOT / path).read_bytes() == git_blob(path, BASE_SHA), path


def test_audit_report_and_inventory_are_reproducible_artifacts() -> None:
    report = (ROOT / "docs/css-architecture-audit.md").read_text(encoding="utf-8")
    inventory = (ROOT / "docs/css-architecture-inventory.json").read_text(encoding="utf-8")

    assert "# CSS Architecture Audit — PR A" in report
    assert "PR8 Compatibility Map" in report
    assert "Protected CSS diff contract" in report
    assert '"schema_version": 1' in inventory
    assert '"protected_compatibility"' in inventory
