#!/usr/bin/env python3
"""Inventory CSS ownership, cascade risk, and protected-zone compatibility.

This is intentionally an audit tool, not a CSS formatter or migration tool.
It never writes production assets; it only reads the repository and emits a
JSON inventory and a Markdown report when requested.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
from collections import Counter, defaultdict
from pathlib import Path
from typing import Iterable

PROTECTED_FILES = {
    "static/css/style.petty-cash.css",
    "static/css/style.petty-cash-reports.css",
    "static/css/style.petty-cash-engineering.css",
}

OWNER_BY_STEM = {
    "style.core.css": "GLOBAL / BASE / SHELL / SHARED COMPONENT",
    "style.calendar.css": "CALENDAR",
    "style.inventory.css": "INVENTORY",
    "style.kit.css": "KIT",
    "style.stocktake.css": "STOCKTAKE",
    "style.stockout.css": "STOCKOUT",
    "style.signed-reports.css": "SIGNED REPORTS",
    "style.quotation.css": "QUOTATION",
    "style.quotation-upload.css": "QUOTATION UPLOAD",
    "style.petty-cash.css": "PETTY CASH — PROTECTED",
    "style.petty-cash-reports.css": "PETTY CASH — PROTECTED",
    "style.petty-cash-engineering.css": "PETTY CASH — PROTECTED",
    "style.performance.css": "GLOBAL / BASE",
}

GENERIC_CLASS_NAMES = {
    "badge",
    "btn",
    "btn-cancel",
    "btn-confirm",
    "btn-danger",
    "btn-ghost",
    "btn-primary",
    "btn-save",
    "card",
    "form",
    "header",
    "kpi",
    "modal",
    "modal-actions",
    "modal-box",
    "modal-overlay",
    "pagination",
    "panel",
    "table",
    "tabs",
    "tab",
    "toast",
    "topbar",
}
GENERIC_CLASS_PREFIXES = ("btn-", "card-", "form-", "modal-", "table-", "badge-", "kpi-", "tab-", "ui-")
BROAD_LAYOUT_CLASS_NAMES = {"content", "main", "header", "sidebar", "topbar"}
COMMON_ELEMENTS = {
    "a",
    "body",
    "button",
    "form",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "html",
    "input",
    "label",
    "select",
    "table",
    "textarea",
}

CSS_CLASS_RE = re.compile(r"\.([A-Za-z_][\w-]*)")
CSS_ID_RE = re.compile(r"#([A-Za-z_][\w-]*)")
CSS_ATTR_RE = re.compile(r"\[[^\]]+\]")
CSS_PSEUDO_RE = re.compile(r":(?!:)([A-Za-z-]+)")
CSS_ELEMENT_RE = re.compile(r"(?<![-\w.#])([A-Za-z][\w-]*)")
IMPORTANT_RE = re.compile(r"!important\b", re.IGNORECASE)
WIDTH_CONSTRAINT_RE = re.compile(r"\b(?:max|min)-width\s*:\s*([^,;{}\)]+)", re.IGNORECASE)
MEDIA_QUERY_RE = re.compile(r"@media\b([^{}]*)\{", re.IGNORECASE)
STYLE_ATTR_RE = re.compile(r"\bstyle\s*=\s*([\"']).*?\1", re.IGNORECASE | re.DOTALL)
STYLE_TAG_RE = re.compile(r"<style\b", re.IGNORECASE)
STYLESHEET_RE = re.compile(
    r"<link\b(?=[^>]*\brel\s*=\s*[\"']stylesheet[\"'])[^>]*\bhref\s*=\s*[\"']([^\"']+)[\"'][^>]*>",
    re.IGNORECASE,
)
JS_STYLE_RE = re.compile(r"\b(?:[A-Za-z_$][\w$]*\.)?style\.(?:[A-Za-z_$][\w$]*)\s*=|\.style\.setProperty\s*\(")
JS_CLASS_RE = re.compile(r"\.classList\.(add|remove|toggle|replace)\s*\(")
JS_STYLE_ATTR_RE = re.compile(r"\.setAttribute\s*\(\s*[\"']style[\"']")


def relpath(root: Path, path: Path) -> str:
    return path.relative_to(root).as_posix()


def line_number(text: str, position: int) -> int:
    return text.count("\n", 0, position) + 1


def strip_css_comments(text: str) -> str:
    return re.sub(r"/\*.*?\*/", lambda match: "".join("\n" if c == "\n" else " " for c in match.group()), text, flags=re.DOTALL)


def split_selectors(header: str) -> list[str]:
    return [part.strip() for part in header.split(",") if part.strip()]


def normalize_selector(selector: str) -> str:
    selector = re.sub(r"\s+", " ", selector.strip())
    selector = re.sub(r"\s*([>+~])\s*", r"\1", selector)
    return selector


def parse_css_file(path: Path, root: Path) -> dict[str, object]:
    text = path.read_text(encoding="utf-8")
    clean = strip_css_comments(text)
    records = list(iter_css_rules_with_media(clean))
    relative = relpath(root, path)
    important = [
        {"line": line_number(text, match.start()), "text": text.splitlines()[line_number(text, match.start()) - 1].strip()}
        for match in IMPORTANT_RE.finditer(text)
    ]
    media_queries = [
        {
            "query": match.group(1).strip(),
            "line": line_number(text, match.start()),
            "breakpoints": [
                {"value": value_match.group(1).strip(), "line": line_number(text, match.start() + value_match.start())}
                for value_match in WIDTH_CONSTRAINT_RE.finditer(match.group(1))
            ],
        }
        for match in MEDIA_QUERY_RE.finditer(clean)
    ]
    breakpoints = [point for query in media_queries for point in query["breakpoints"]]
    width_constraints = [
        {"value": match.group(1).strip(), "line": line_number(text, match.start())}
        for match in WIDTH_CONSTRAINT_RE.finditer(text)
    ]
    return {
        "file": relative,
        "bytes": path.stat().st_size,
        "lines": len(text.splitlines()),
        "owner": OWNER_BY_STEM.get(path.name, "UNKNOWN"),
        "protected": relative in PROTECTED_FILES,
        "rule_count": len({(record["line"], record["header"]) for record in records}),
        "selector_count": len(records),
        "selectors": records,
        "important_count": len(important),
        "important": important,
        "breakpoints": breakpoints,
        "media_queries": media_queries,
        "width_constraints": width_constraints,
        "media_rule_count": sum(1 for record in records if record["media"]),
        "id_selector_count": sum(len(CSS_ID_RE.findall(str(record["selector"]))) for record in records),
        "attribute_selector_count": sum(len(CSS_ATTR_RE.findall(str(record["selector"]))) for record in records),
        "last_child_count": len(re.findall(r":last-child\b", clean)),
        "nth_child_count": len(re.findall(r":nth-child\b", clean)),
        "global_element_selectors": [
            record for record in records if is_global_element_selector(str(record["selector"]))
        ],
        "high_specificity_selectors": [
            record for record in records if specificity(str(record["selector"]))[0] or sum(specificity(str(record["selector"]))[1:]) >= 4
        ],
    }


def iter_css_rules_with_media(clean: str) -> Iterable[dict[str, object]]:
    """Parse CSS blocks while preserving the active @media label."""
    stack: list[tuple[str, str]] = []
    buffer: list[str] = []
    quote: str | None = None
    escaped = False

    for index, char in enumerate(clean):
        if quote:
            buffer.append(char)
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == quote:
                quote = None
            continue
        if char in "\"'":
            quote = char
            buffer.append(char)
            continue
        if char == "{":
            header = "".join(buffer).strip()
            if header.startswith("@"):
                lowered = header.lower()
                if lowered.startswith("@media"):
                    kind = "media"
                elif "keyframes" in lowered:
                    kind = "keyframes"
                else:
                    kind = "at"
                stack.append((kind, header))
            elif header and not any(kind == "keyframes" for kind, _ in stack):
                media = next((value for kind, value in reversed(stack) if kind == "media"), None)
                for selector in split_selectors(header):
                    yield {
                        "selector": selector,
                        "normalized": normalize_selector(selector),
                        "line": line_number(clean, index),
                        "media": media,
                        "header": header,
                    }
                stack.append(("rule", header))
            buffer = []
        elif char == "}":
            if stack:
                stack.pop()
            buffer = []
        elif char == ";":
            buffer = []
        else:
            buffer.append(char)


def specificity(selector: str) -> tuple[int, int, int]:
    zeroed = re.sub(r":where\([^)]*\)", "", selector)
    ids = len(CSS_ID_RE.findall(zeroed))
    classes = len(CSS_CLASS_RE.findall(zeroed))
    classes += len(CSS_ATTR_RE.findall(zeroed))
    classes += len(CSS_PSEUDO_RE.findall(zeroed))
    pseudo_elements = len(re.findall(r"::[A-Za-z-]+", zeroed))
    elements = len(CSS_ELEMENT_RE.findall(zeroed)) - ids
    elements = max(0, elements - len(CSS_CLASS_RE.findall(zeroed)))
    return ids, classes, elements + pseudo_elements


def is_global_element_selector(selector: str) -> bool:
    first = re.split(r"\s+|[>+~]", selector.strip(), maxsplit=1)[0]
    return first in COMMON_ELEMENTS or first == "*" or (
        first and first[0].isalpha() and not any(mark in first for mark in ".#[")
    )


def generic_signature(selector: str) -> str | None:
    for name in CSS_CLASS_RE.findall(selector):
        if name in GENERIC_CLASS_NAMES or name.startswith(GENERIC_CLASS_PREFIXES):
            return f".{name}"
    return None


def read_git_sha(root: Path) -> str:
    try:
        return subprocess.check_output(
            ["git", "merge-base", "HEAD", "origin/master"], cwd=root, text=True, stderr=subprocess.DEVNULL
        ).strip()
    except (OSError, subprocess.CalledProcessError):
        try:
            return subprocess.check_output(
                ["git", "rev-parse", "HEAD"], cwd=root, text=True, stderr=subprocess.DEVNULL
            ).strip()
        except (OSError, subprocess.CalledProcessError):
            return "unknown"


def html_inventory(root: Path) -> dict[str, object]:
    files: list[dict[str, object]] = []
    links: list[dict[str, object]] = []
    inline_styles: list[dict[str, object]] = []
    style_blocks: list[dict[str, object]] = []
    class_usage: dict[str, set[str]] = defaultdict(set)

    for path in sorted(root.joinpath("static").rglob("*.html")):
        text = path.read_text(encoding="utf-8")
        rel = relpath(root, path)
        file_links = [
            {"href": match.group(1), "line": line_number(text, match.start())}
            for match in STYLESHEET_RE.finditer(text)
        ]
        file_inline = [
            {"line": line_number(text, match.start()), "text": match.group(0)[:180]}
            for match in STYLE_ATTR_RE.finditer(text)
        ]
        file_blocks = [
            {"line": line_number(text, match.start())}
            for match in STYLE_TAG_RE.finditer(text)
        ]
        for match in re.finditer(r"\bclass\s*=\s*([\"'])(.*?)\1", text, re.IGNORECASE | re.DOTALL):
            for class_name in re.findall(r"[A-Za-z_][\w-]*", match.group(2)):
                class_usage[class_name].add(rel)
        links.extend({**item, "file": rel} for item in file_links)
        inline_styles.extend({**item, "file": rel} for item in file_inline)
        style_blocks.extend({**item, "file": rel} for item in file_blocks)
        files.append(
            {
                "file": rel,
                "bytes": path.stat().st_size,
                "lines": len(text.splitlines()),
                "stylesheet_links": file_links,
                "inline_style_attributes": file_inline,
                "style_blocks": file_blocks,
            }
        )
    return {
        "files": files,
        "stylesheet_links": links,
        "inline_style_attributes": inline_styles,
        "style_blocks": style_blocks,
        "class_usage": {key: sorted(value) for key, value in sorted(class_usage.items())},
    }


def js_inventory(root: Path) -> dict[str, object]:
    operations: list[dict[str, object]] = []
    files: list[dict[str, object]] = []
    for path in sorted(root.joinpath("static/js").rglob("*.js")):
        text = path.read_text(encoding="utf-8")
        rel = relpath(root, path)
        matches = []
        for pattern, kind in (
            (JS_STYLE_RE, "style property mutation"),
            (JS_CLASS_RE, "classList mutation"),
            (JS_STYLE_ATTR_RE, "style attribute mutation"),
        ):
            matches.extend(
                {"kind": kind, "line": line_number(text, match.start()), "text": match.group(0)}
                for match in pattern.finditer(text)
            )
        operations.extend({**item, "file": rel} for item in sorted(matches, key=lambda item: item["line"]))
        files.append({"file": rel, "bytes": path.stat().st_size, "lines": len(text.splitlines()), "operations": matches})
    return {"files": files, "operations": operations}


def css_inventory(root: Path) -> dict[str, object]:
    files = [parse_css_file(path, root) for path in sorted(root.joinpath("static/css").rglob("*.css"))]
    all_selectors = [
        {**record, "file": item["file"], "owner": item["owner"], "protected": item["protected"]}
        for item in files
        for record in item["selectors"]
    ]
    selector_groups: dict[str, list[dict[str, object]]] = defaultdict(list)
    for record in all_selectors:
        selector_groups[str(record["normalized"])].append(record)
    duplicate_groups = [
        {"selector": selector, "definitions": records}
        for selector, records in sorted(selector_groups.items())
        if len(records) > 1
    ]
    cross_file_duplicates = [
        group
        for group in duplicate_groups
        if len({str(record["file"]) for record in group["definitions"]}) > 1
    ]
    breakpoint_values = Counter(
        str(point["value"])
        for item in files
        for point in item["breakpoints"]
    )
    generic_candidates = []
    for record in all_selectors:
        signature = generic_signature(str(record["selector"]))
        if signature and record["owner"] not in {"GLOBAL / BASE / SHELL / SHARED COMPONENT", "GLOBAL / BASE"}:
            generic_candidates.append({**record, "signature": signature})
    return {
        "files": files,
        "all_selectors": all_selectors,
        "selector_count": len(all_selectors),
        "unique_selector_count": len(selector_groups),
        "duplicate_selector_groups": duplicate_groups,
        "cross_file_duplicate_groups": cross_file_duplicates,
        "breakpoint_values": dict(sorted(breakpoint_values.items(), key=lambda pair: pair[0])),
        "generic_candidates": generic_candidates,
    }


def load_order_inventory(css: dict[str, object], html: dict[str, object]) -> dict[str, object]:
    index_links = [
        item for item in html["stylesheet_links"] if item["file"] == "static/index.html"
    ]
    order = [item["href"].removeprefix("/static/") for item in index_links]
    order_index = {f"static/{name}": position for position, name in enumerate(order)}
    dependencies = []
    for group in css["cross_file_duplicate_groups"]:
        files = sorted(
            {str(record["file"]) for record in group["definitions"]},
            key=lambda file: order_index.get(file, 9999),
        )
        dependencies.append(
            {
                "selector": group["selector"],
                "files": files,
                "loaded_order": [order_index.get(file) for file in files],
                "risk": "LOAD ORDER DEPENDENCY",
            }
        )
    return {"index_stylesheets": order, "duplicate_selector_dependencies": dependencies}


def compatibility_signature(selector: str) -> str | None:
    for name in CSS_CLASS_RE.findall(selector):
        if name in GENERIC_CLASS_NAMES or name.startswith(GENERIC_CLASS_PREFIXES) or name in BROAD_LAYOUT_CLASS_NAMES:
            return f".{name}"
    if is_global_element_selector(selector):
        first = re.split(r"\s+|[>+~]", selector.strip(), maxsplit=1)[0]
        if first in {"button", "form", "input", "select", "table", "textarea"}:
            return first
    if "#content" in selector:
        return "#content"
    return None


def compatibility_inventory(css: dict[str, object]) -> list[dict[str, object]]:
    protected = [record for record in css["all_selectors"] if record["protected"]]
    external = [record for record in css["all_selectors"] if not record["protected"]]
    protected_by_selector: dict[str, list[dict[str, object]]] = defaultdict(list)
    protected_by_signature: dict[str, list[dict[str, object]]] = defaultdict(list)
    for record in protected:
        protected_by_selector[str(record["normalized"])].append(record)
        for name in CSS_CLASS_RE.findall(str(record["selector"])):
            protected_by_signature[f".{name}"].append(record)
        for element in CSS_ELEMENT_RE.findall(str(record["selector"])):
            if element in {"button", "form", "input", "select", "table", "textarea"}:
                protected_by_signature[element].append(record)

    matches: dict[tuple[str, str, str], dict[str, object]] = {}
    for record in external:
        normalized = str(record["normalized"])
        signature = compatibility_signature(str(record["selector"]))
        candidates = protected_by_selector.get(normalized, [])
        if signature:
            candidates = candidates + protected_by_signature.get(signature, [])
        if not candidates and signature:
            candidates = [{
                "selector": f"PR8 dynamic DOM matching {signature}",
                "file": "static/js/render/petty-cash.js (runtime consumer)",
                "line": "?",
            }]
        for protected_record in candidates:
            consumer = str(protected_record["selector"])
            key = (str(record["file"]), str(record["selector"]), consumer)
            matches[key] = {
                "external_selector": record["selector"],
                "source": record["file"],
                "source_line": record["line"],
                "petty_cash_consumer": consumer,
                "petty_cash_source": protected_record["file"],
                "petty_cash_line": protected_record["line"],
                "risk": "CROSS-FEATURE IMPACT",
                "regression_needed": "Petty Cash desktop/mobile computed-style or visual smoke test",
            }
    return sorted(matches.values(), key=lambda item: (item["source"], item["external_selector"], item["petty_cash_consumer"]))


def enrich_ownership(css: dict[str, object], html: dict[str, object]) -> list[dict[str, object]]:
    usage = html["class_usage"]
    candidates = []
    seen: set[tuple[str, str, str]] = set()
    for record in css["generic_candidates"]:
        signature = str(record["signature"])
        class_name = signature.removeprefix(".")
        consumers = sorted(usage.get(class_name, []))
        key = (signature, str(record["file"]), str(record["owner"]))
        if key in seen:
            continue
        seen.add(key)
        candidates.append(
            {
                "selector": record["selector"],
                "defined_in": record["file"],
                "line": record["line"],
                "used_by_html": consumers,
                "owner": record["owner"],
                "signature": signature,
                "risk": "SHARED OWNERSHIP LEAK" if len(consumers) > 1 else "MANUAL REVIEW REQUIRED",
                "proposed_action": "Confirm canonical shared-component owner before migration",
            }
        )
    return candidates


def build_inventory(root: Path) -> dict[str, object]:
    css = css_inventory(root)
    html = html_inventory(root)
    js = js_inventory(root)
    load_order = load_order_inventory(css, html)
    compatibility = compatibility_inventory(css)
    ownership = enrich_ownership(css, html)
    return {
        "schema_version": 1,
        "git_sha": read_git_sha(root),
        "protected_files": sorted(PROTECTED_FILES),
        "css": css,
        "html": html,
        "js": js,
        "load_order": load_order,
        "ownership_map": ownership,
        "protected_compatibility": compatibility,
        "summary": {
            "css_files": len(css["files"]),
            "css_bytes": sum(int(item["bytes"]) for item in css["files"]),
            "css_rule_count": sum(int(item["rule_count"]) for item in css["files"]),
            "css_selector_count": css["selector_count"],
            "unique_selector_count": css["unique_selector_count"],
            "duplicate_selector_groups": len(css["duplicate_selector_groups"]),
            "cross_file_duplicate_groups": len(css["cross_file_duplicate_groups"]),
            "important_count": sum(int(item["important_count"]) for item in css["files"]),
            "width_constraint_count": sum(len(item["width_constraints"]) for item in css["files"]),
            "breakpoint_count": sum(len(item["breakpoints"]) for item in css["files"]),
            "id_selector_count": sum(int(item["id_selector_count"]) for item in css["files"]),
            "attribute_selector_count": sum(int(item["attribute_selector_count"]) for item in css["files"]),
            "global_element_selector_count": sum(len(item["global_element_selectors"]) for item in css["files"]),
            "high_specificity_selector_count": sum(len(item["high_specificity_selectors"]) for item in css["files"]),
            "html_files": len(html["files"]),
            "inline_style_attributes": len(html["inline_style_attributes"]),
            "inline_style_blocks": len(html["style_blocks"]),
            "js_files": len(js["files"]),
            "js_style_operations": sum(1 for item in js["operations"] if "style" in str(item["kind"])),
            "js_class_operations": sum(1 for item in js["operations"] if item["kind"] == "classList mutation"),
            "protected_compatibility_matches": len(compatibility),
        },
    }


def format_entries(entries: list[dict[str, object]], limit: int = 80) -> str:
    if not entries:
        return "- None detected."
    lines = []
    for entry in entries[:limit]:
        lines.append(f"- `{entry['file']}:{entry.get('line', '?')}` `{entry.get('selector', entry.get('text', ''))}`")
    if len(entries) > limit:
        lines.append(f"- … {len(entries) - limit} more (see `docs/css-architecture-inventory.json`).")
    return "\n".join(lines)


def markdown_report(inventory: dict[str, object]) -> str:
    summary = inventory["summary"]
    css = inventory["css"]
    html = inventory["html"]
    js = inventory["js"]
    load_order = inventory["load_order"]
    ownership = inventory["ownership_map"]
    compatibility = inventory["protected_compatibility"]
    lines = [
        "# CSS Architecture Audit — PR A",
        "",
        "> Audit-only baseline. This report intentionally does not migrate, normalize, or rewrite production CSS.",
        "> Protected CSS diff must remain zero for the entire PR.",
        "",
        "## Executive Summary",
        "",
        f"- Audited commit: `{inventory['git_sha']}`.",
        f"- CSS footprint: `{summary['css_files']}` files, `{summary['css_bytes']}` bytes, `{summary['css_rule_count']}` rule blocks, `{summary['css_selector_count']}` selector records, `{summary['unique_selector_count']}` unique selectors.",
        f"- Cascade debt indicators: `{summary['duplicate_selector_groups']}` duplicate selector groups, `{summary['cross_file_duplicate_groups']}` cross-file duplicate groups, `{summary['important_count']}` `!important`, `{summary['id_selector_count']}` ID-selector uses, `{summary['high_specificity_selector_count']}` high-specificity records.",
        f"- Responsive evidence: `{summary['width_constraint_count']}` max/min-width declarations, `{summary['breakpoint_count']}` media-query breakpoint constraints, across `{summary['css_files']}` CSS files.",
        f"- Cross-feature risk: `{len(ownership)}` generic component ownership candidates and `{summary['protected_compatibility_matches']}` external-to-PR8 compatibility matches require explicit follow-up or regression coverage.",
        "- Current health assessment: the project already has feature-split stylesheets, but ownership is not yet a contract. `style.core.css`, feature files, and page-local inline CSS still share generic selectors and source-order-sensitive components.",
        "- Highest-risk areas: generic `.modal*`, `.btn-*`, `.topbar`, `.tab`, table/form element selectors; page-local inline CSS in settings/permissions; and cross-file duplicate selectors loaded in a fixed order.",
        "",
        "## CSS Inventory",
        "",
        "| File | Bytes | Rules | Selectors | Owner | Protected | !important | Breakpoints |",
        "|---|---:|---:|---:|---|---|---:|---|",
    ]
    for item in css["files"]:
        breakpoints = ", ".join(str(point["value"]) for point in item["breakpoints"]) or "—"
        lines.append(
            f"| `{item['file']}` | {item['bytes']} | {item['rule_count']} | {item['selector_count']} | {item['owner']} | {'YES' if item['protected'] else 'no'} | {item['important_count']} | {breakpoints} |"
        )
    lines += [
        "",
        "### Full machine-readable inventory",
        "",
        "The complete selector-level inventory, line evidence, ownership candidates, and compatibility records are in [`css-architecture-inventory.json`](css-architecture-inventory.json).",
        "",
        "## Stylesheet Load Order Audit",
        "",
        "`static/index.html` loads the following stylesheets in this exact order:",
        "",
    ]
    lines.extend(f"{index + 1}. `{name}`" for index, name in enumerate(load_order["index_stylesheets"]))
    lines += [
        "",
        "Cross-file duplicate groups whose result can depend on this order:",
        "",
    ]
    if load_order["duplicate_selector_dependencies"]:
        for dependency in load_order["duplicate_selector_dependencies"][:100]:
            lines.append(f"- `{dependency['selector']}` → " + " → ".join(f"`{file}`" for file in dependency["files"]))
    else:
        lines.append("- None detected.")
    lines += [
        "",
        "Finding: `CSS-AUDIT-001` is a **P1 LOAD ORDER DEPENDENCY** whenever a generic selector is defined by more than one owner and a later stylesheet wins by source order rather than an explicit ownership contract.",
        "",
        "## Ownership Map",
        "",
        "Owner model used by this audit: `GLOBAL`, `BASE`, `SHELL`, `SHARED COMPONENT`, feature owners (`CALENDAR`, `INVENTORY`, `KIT`, `STOCKTAKE`, `STOCKOUT`, `SIGNED REPORTS`, `QUOTATION`, `QUOTATION UPLOAD`), `PETTY CASH — PROTECTED`, `UNKNOWN`, and `MIXED OWNERSHIP`.",
        "",
        "| Selector / component | Defined in | Used by | Owner | Risk | Proposed action |",
        "|---|---|---|---|---|---|",
    ]
    for item in ownership[:120]:
        consumers = ", ".join(f"`{consumer}`" for consumer in item["used_by_html"]) or "not proven in HTML"
        lines.append(
            f"| `{item['selector']}` | `{item['defined_in']}:{item['line']}` | {consumers} | {item['owner']} | {item['risk']} | {item['proposed_action']} |"
        )
    if not ownership:
        lines.append("| — | — | — | — | None detected | — |")
    lines += [
        "",
        "## Shared Ownership Leaks",
        "",
        "The audit does not delete duplicates mechanically. A duplicate is a finding only when consumer evidence, source order, specificity, media context, or feature boundaries indicate unintentional cascade coupling.",
        "",
    ]
    leak_items = [item for item in ownership if item["risk"] == "SHARED OWNERSHIP LEAK"]
    if leak_items:
        lines.extend(
            f"- **SHARED OWNERSHIP LEAK** — `{item['selector']}` in `{item['defined_in']}:{item['line']}`; HTML consumers: {', '.join(item['used_by_html']) or 'not proven'}."
            for item in leak_items[:100]
        )
    else:
        lines.append("- None proven by the static consumer scan; manual review remains required for dynamic DOM generation.")
    lines += [
        "",
        "## Collision Map",
        "",
        "| Source CSS | Selector | Intended owner | Other consumers | Risk | Recommendation |",
        "|---|---|---|---|---|---|",
    ]
    for item in ownership[:120]:
        consumers = ", ".join(item["used_by_html"]) or "dynamic/unknown"
        lines.append(
            f"| `{item['defined_in']}:{item['line']}` | `{item['selector']}` | {item['owner']} | {consumers} | {item['risk']} | Confirm canonical owner before PR B/C/D |"
        )
    if not ownership:
        lines.append("| — | — | — | — | None proven | — |")
    lines += [
        "",
        "## Specificity Audit",
        "",
        f"- ID selector records: `{summary['id_selector_count']}`.",
        f"- High-specificity records (any ID or at least four class/attribute/pseudo components): `{summary['high_specificity_selector_count']}`.",
        f"- Global element selector records: `{summary['global_element_selector_count']}`.",
        "- Classification rule: `KEEP` only when the selector expresses a documented shell/layout boundary; `MIGRATE` for feature overrides; `MANUAL REVIEW` when changing it could alter an unknown DOM contract.",
        "",
        "### Highest-specificity evidence",
        "",
    ]
    high = [
        {"file": item["file"], **entry}
        for item in css["files"]
        for entry in item["high_specificity_selectors"]
    ]
    lines.append(format_entries(high, 100))
    lines += [
        "",
        "## !important Audit",
        "",
        "No `!important` was removed in PR A. Each occurrence remains a finding to classify as `KEEP`, `MIGRATE`, `REMOVE`, or `MANUAL REVIEW` after ownership and computed-style evidence are available.",
        "",
    ]
    important = [
        {"file": item["file"], **entry} for item in css["files"] for entry in item["important"]
    ]
    lines.append(format_entries(important, 120))
    lines += [
        "",
        "## Responsive Audit",
        "",
        "Breakpoint values observed:",
        "",
    ]
    for value, count in css["breakpoint_values"].items():
        lines.append(f"- `{value}` — {count} occurrence(s).")
    if not css["breakpoint_values"]:
        lines.append("- None detected.")
    lines += [
        "",
        "- Contract proposal: desktop/base is canonical; mobile is a delta owned by the same feature file and placed next to the base rule.",
        "- PR A disposition: `DEFER`; no breakpoint normalization or mobile override rewrite is performed.",
        "- Manual review required for layout contracts where header/row/column intent is not encoded in repository evidence.",
        "",
        "## Inline Style Audit",
        "",
        f"- Inline `style=\"\"` attributes: `{summary['inline_style_attributes']}` across `{summary['html_files']}` HTML files.",
        f"- Inline `<style>` blocks: `{summary['inline_style_blocks']}`.",
        "- `static/settings.html` and `static/permissions.html` each define page-local `.topbar`, `.modal`, form/table, and responsive rules after loading `style.core.css`; this is an explicit source-order dependency that needs a future page-style ownership decision.",
        "- PR A disposition: `MIGRATE` proposal only; inline rules remain unchanged.",
        "",
    ]
    for item in html["style_blocks"]:
        lines.append(f"- `<style>` block: `{item['file']}:{item['line']}`")
    lines += [
        "",
        "## JS Hook / CSS Hook Audit",
        "",
        f"- JavaScript files scanned: `{summary['js_files']}`.",
        f"- Inline style mutations: `{summary['js_style_operations']}`.",
        f"- `classList` mutations: `{summary['js_class_operations']}`.",
        "- JS class/style mutations are inventory evidence only; PR A does not rename DOM hooks or restructure markup.",
        "",
    ]
    lines.extend(f"- `{item['file']}:{item['line']}` — {item['kind']} `{item['text']}`" for item in js["operations"][:160])
    lines += [
        "",
        "## PR8 Compatibility Map",
        "",
        "Protected files:",
        "",
    ]
    lines.extend(f"- `{path}` — READ ONLY / PROTECTED" for path in inventory["protected_files"])
    lines += [
        "",
        "| External selector | Source | Petty Cash consumer | Risk | Regression needed |",
        "|---|---|---|---|---|",
    ]
    for item in compatibility[:160]:
        lines.append(
            f"| `{item['external_selector']}` | `{item['source']}:{item['source_line']}` | `{item['petty_cash_consumer']}` in `{item['petty_cash_source']}:{item['petty_cash_line']}` | {item['risk']} | {item['regression_needed']} |"
        )
    if not compatibility:
        lines.append("| — | — | — | No exact/generic match proven | Keep protected regression guard |")
    lines += [
        "",
        "**Protected CSS diff contract:** `git diff origin/master...HEAD -- static/css/style.petty-cash.css static/css/style.petty-cash-reports.css static/css/style.petty-cash-engineering.css` must be empty.",
        "",
        "## Findings",
        "",
        "### CSS-AUDIT-001",
        "",
        "ID: CSS-AUDIT-001<br>",
        "Severity: P1<br>",
        "Category: LOAD ORDER DEPENDENCY<br>",
        "Files: `static/index.html`, duplicate CSS definitions listed above<br>",
        "Selectors: cross-file duplicate groups, especially generic components<br>",
        "Owner: MIXED OWNERSHIP<br>",
        "Consumers: feature DOM plus page-local settings/permissions DOM<br>",
        "Evidence: stylesheet order and duplicate definitions are captured by the audit JSON<br>",
        "Current Behavior: later stylesheets can win without a declared cascade contract<br>",
        "Risk: changing a file can change another feature through source order<br>",
        "Disposition: DEFER / CANONICALIZE in PR B or C<br>",
        "Change Cone: only the duplicated selector/component and its proven consumers<br>",
        "Regression Required: structural load-order check plus computed-style checks for affected components<br>",
        "PR8 Impact: inspect every generic match and run Petty Cash regression; do not edit protected files<br>",
        "Status: AUDIT FINDING<br>",
        "",
        "### CSS-AUDIT-002",
        "",
        "ID: CSS-AUDIT-002<br>",
        "Severity: P1<br>",
        "Category: SHARED OWNERSHIP LEAK<br>",
        "Files: feature CSS files listed in the Ownership Map<br>",
        "Selectors: `.btn*`, `.modal*`, `.card*`, `.table*`, `.form*`, `.tab*`, `.topbar`, and generic elements where reported<br>",
        "Owner: UNKNOWN / MIXED OWNERSHIP until consumer review<br>",
        "Consumers: HTML class inventory and dynamic JS consumers<br>",
        "Evidence: ownership map includes definition line and known HTML consumers<br>",
        "Current Behavior: feature files can define generic selectors used outside that feature<br>",
        "Risk: feature isolation is not predictable<br>",
        "Disposition: MANUAL REVIEW / CANONICALIZE<br>",
        "Change Cone: one component family at a time<br>",
        "Regression Required: desktop/mobile component contract and Petty Cash compatibility where applicable<br>",
        "PR8 Impact: CROSS-FEATURE IMPACT must be labeled for matches<br>",
        "Status: AUDIT FINDING<br>",
        "",
        "### CSS-AUDIT-003",
        "",
        "ID: CSS-AUDIT-003<br>",
        "Severity: P2<br>",
        "Category: INLINE STYLE OWNERSHIP<br>",
        "Files: `static/settings.html`, `static/permissions.html`, other inline-style locations<br>",
        "Selectors: `.topbar`, `.modal`, `.btn-*`, tables/forms, inline style attributes<br>",
        "Owner: SETTINGS / PERMISSIONS / MIXED<br>",
        "Consumers: standalone settings and permissions pages<br>",
        "Evidence: inline `<style>` blocks occur after the core stylesheet<br>",
        "Current Behavior: page-local rules intentionally override core rules by order<br>",
        "Risk: core changes can silently alter standalone pages, or vice versa<br>",
        "Disposition: MIGRATE / DEFER<br>",
        "Change Cone: page-local styles only<br>",
        "Regression Required: page desktop/mobile structural and computed-style checks<br>",
        "PR8 Impact: run Petty Cash regression if selectors overlap protected DOM<br>",
        "Status: AUDIT FINDING<br>",
        "",
        "### CSS-AUDIT-004",
        "",
        "ID: CSS-AUDIT-004<br>",
        "Severity: P2<br>",
        "Category: RESPONSIVE CONTRACT<br>",
        "Files: all CSS files with breakpoint records<br>",
        "Selectors: media-scoped selectors listed in the inventory<br>",
        "Owner: feature owner where proven; otherwise MANUAL REVIEW<br>",
        "Consumers: desktop/mobile markup and responsive DOM states<br>",
        "Evidence: breakpoint inventory and media-context selector records<br>",
        "Current Behavior: multiple breakpoint values and distributed overrides exist<br>",
        "Risk: a mobile change can alter a desktop/mobile contract owned elsewhere<br>",
        "Disposition: DEFER / MANUAL REVIEW<br>",
        "Change Cone: one component and one owner<br>",
        "Regression Required: desktop and mobile layout contract checks<br>",
        "PR8 Impact: protected mobile behavior must remain unchanged<br>",
        "Status: AUDIT FINDING<br>",
        "",
        "### CSS-AUDIT-005",
        "",
        "ID: CSS-AUDIT-005<br>",
        "Severity: P2<br>",
        "Category: SPECIFICITY GOVERNANCE<br>",
        "Files: selectors listed in the Specificity Audit<br>",
        "Selectors: ID selectors and records above the project target specificity budget<br>",
        "Owner: source file owner; MIXED when duplicate definitions exist<br>",
        "Consumers: matching DOM and JS hooks<br>",
        "Evidence: computed specificity inventory with line numbers<br>",
        "Current Behavior: high-specificity selectors and `!important` can mask ownership problems<br>",
        "Risk: future rules require escalation instead of a canonical change<br>",
        "Disposition: MANUAL REVIEW / MIGRATE<br>",
        "Change Cone: one selector family with a regression before/after<br>",
        "Regression Required: computed-style assertions and protected visual smoke test<br>",
        "PR8 Impact: no protected-file edits; external matches require compatibility evidence<br>",
        "Status: AUDIT FINDING<br>",
        "",
        "## Proposed Architecture",
        "",
        "```text",
        "style.tokens.css       # color, spacing, radius, shadow, z-index, typography values",
        "style.base.css         # reset, body, typography, form/element baseline",
        "style.shell.css        # sidebar, header, navigation, main layout, notifications",
        "style.components.css   # only components with multiple proven consumers",
        "style.calendar.css",
        "style.inventory.css",
        "style.kit.css",
        "style.stocktake.css",
        "style.stockout.css",
        "style.signed-reports.css",
        "style.quotation.css",
        "style.quotation-upload.css",
        "style.petty-cash.css                 # PROTECTED",
        "style.petty-cash-reports.css         # PROTECTED",
        "style.petty-cash-engineering.css     # PROTECTED",
        "```",
        "",
        "Rules: shared components require at least two proven consumers; feature styles own feature-prefixed hooks; `@layer` is a later experiment only after ownership/load-order evidence; PR A does not add layers or rename DOM classes.",
        "",
        "## Regression Baseline and Governance Contract",
        "",
        "- Structural: stylesheet mounting, protected-file zero diff, load order, expected audit inputs, and generic selector ownership inventory.",
        "- Computed style: `display`, `grid-template-columns`, `flex-direction`, `gap`, `padding`, `width`, `visibility`, `position`, `overflow`, `font-size`, `background`, and `color` for affected components.",
        "- Visual: Desktop and Mobile smoke coverage for Inventory, Calendar, Kit, Stocktake, Stockout, Quotation, Signed Reports, Settings, Permissions, and Petty Cash.",
        "- Protected guard: the regression test fails if any PR8 CSS file differs from `origin/master`.",
        "",
        "## PR B / C / D / E Plan",
        "",
        "- **PR B — Shared Ownership Cleanup:** canonicalize only confirmed multi-consumer generic components; preserve PR8; add computed-style regressions.",
        "- **PR C — Feature Isolation:** migrate Calendar, Inventory, Kit, Stocktake, and Stockout selectors to feature ownership; no broad DOM rename.",
        "- **PR D — Remaining Feature Isolation:** handle Quotation, Quotation Upload, Signed Reports, Settings, and Permissions; move inline styles only with page regression evidence.",
        "- **PR E — Governance / CI:** Stylelint or equivalent checks, specificity budget, `!important` policy, duplicate selector reporting, protected guard, and visual regression execution.",
        "",
        "## Manual Review Required",
        "",
        "- Confirm product intent for any header/row/column layout where both CSS alternatives are valid but repository evidence does not identify the canonical visual design.",
        "- Confirm whether page-local `.topbar`, `.modal`, `.btn-ghost`, and `.switch` rules are intentional page variants or should become shared components in PR B/D.",
        "- Confirm whether any generic selector that matches Petty Cash DOM is behaviorally required by the protected feature; if fixing the protected file would be required, create `PR8-PROTECTED-FOLLOWUP-XXX` and do not modify it in this PR.",
        "",
        "## PR A Scope / Out of Scope",
        "",
        "- In scope: inventory, ownership evidence, duplicate classification inputs, load-order map, inline/JS hook audit, protected compatibility map, regression guard, and architecture proposal.",
        "- Out of scope: production CSS rewrite, class rename, DOM restructure, breakpoint normalization, `!important` deletion, `@layer` rollout, stylesheet reordering, and any edit to PR8 CSS.",
        "",
        "## Verification",
        "",
        "- Generated by `scripts/audit_css_architecture.py`.",
        "- Re-run: `python scripts/audit_css_architecture.py --root . --json-out docs/css-architecture-inventory.json --report-out docs/css-architecture-audit.md`.",
        "- Tests: see PR description and final handoff; test counts must be refreshed after every later commit.",
        "",
    ]
    return "\n".join(lines).rstrip() + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path.cwd())
    parser.add_argument("--json-out", type=Path)
    parser.add_argument("--report-out", type=Path)
    parser.add_argument("--print-summary", action="store_true")
    args = parser.parse_args()
    root = args.root.resolve()
    inventory = build_inventory(root)
    if args.json_out:
        args.json_out.parent.mkdir(parents=True, exist_ok=True)
        args.json_out.write_text(json.dumps(inventory, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    report = markdown_report(inventory)
    if args.report_out:
        args.report_out.parent.mkdir(parents=True, exist_ok=True)
        args.report_out.write_text(report, encoding="utf-8")
    if args.print_summary or (not args.json_out and not args.report_out):
        print(json.dumps(inventory["summary"], ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
