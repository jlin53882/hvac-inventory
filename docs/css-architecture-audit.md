# CSS Architecture Audit — PR A

> Audit-only baseline. This report intentionally does not migrate, normalize, or rewrite production CSS.
> Protected CSS diff must remain zero for the entire PR.

## Executive Summary

- Audited commit: `f4e2768b78dfc8f649959134843ce59dd14ba6f0`.
- CSS footprint: `13` files, `220910` bytes, `2055` rule blocks, `2261` selector records, `1801` unique selectors.
- Cascade debt indicators: `345` duplicate selector groups, `3` cross-file duplicate groups, `21` `!important`, `83` ID-selector uses, `157` high-specificity records.
- Responsive evidence: `238` max/min-width declarations, `67` media-query breakpoint constraints, across `13` CSS files.
- Cross-feature risk: `15` generic component ownership candidates and `145` external-to-PR8 compatibility matches require explicit follow-up or regression coverage.
- Current health assessment: the project already has feature-split stylesheets, but ownership is not yet a contract. `style.core.css`, feature files, and page-local inline CSS still share generic selectors and source-order-sensitive components.
- Highest-risk areas: generic `.modal*`, `.btn-*`, `.topbar`, `.tab`, table/form element selectors; page-local inline CSS in settings/permissions; and cross-file duplicate selectors loaded in a fixed order.

## CSS Inventory

| File | Bytes | Rules | Selectors | Owner | Protected | !important | Breakpoints |
|---|---:|---:|---:|---|---|---:|---|
| `static/css/style.calendar.css` | 24367 | 224 | 239 | CALENDAR | no | 3 | 768px, 767px, 767px, 768px, 767px, 768px, 767px, 767px |
| `static/css/style.core.css` | 58246 | 512 | 531 | GLOBAL / BASE / SHELL / SHARED COMPONENT | no | 12 | 767px, 767px, 768px, 767px, 768px, 767px, 767px |
| `static/css/style.inventory.css` | 31076 | 276 | 327 | INVENTORY | no | 3 | 768px, 1440px, 1200px, 767px, 767px, 767px, 767px, 767px |
| `static/css/style.kit.css` | 10673 | 103 | 109 | KIT | no | 0 | 1440px, 1200px, 767px, 390px |
| `static/css/style.performance.css` | 728 | 6 | 6 | GLOBAL / BASE | no | 0 | 767px |
| `static/css/style.petty-cash-engineering.css` | 12499 | 129 | 162 | PETTY CASH — PROTECTED | YES | 0 | 767px, 767px, 767px, 767px, 767px, 767px, 767px, 767px |
| `static/css/style.petty-cash-reports.css` | 10591 | 105 | 135 | PETTY CASH — PROTECTED | YES | 0 | 767px, 768px, 767px, 767px, 767px, 768px |
| `static/css/style.petty-cash.css` | 14550 | 141 | 147 | PETTY CASH — PROTECTED | YES | 0 | 768px, 720px, 1200px, 767px, 767px |
| `static/css/style.quotation-upload.css` | 14051 | 141 | 150 | QUOTATION UPLOAD | no | 0 | 768px, 960px, 767px, 560px, 639px |
| `static/css/style.quotation.css` | 6507 | 71 | 83 | QUOTATION | no | 2 | 768px, 960px, 639px |
| `static/css/style.signed-reports.css` | 14303 | 144 | 154 | SIGNED REPORTS | no | 1 | 768px, 960px, 767px, 560px, 639px |
| `static/css/style.stockout.css` | 10604 | 94 | 98 | STOCKOUT | no | 0 | 1440px, 1200px, 767px |
| `static/css/style.stocktake.css` | 12715 | 109 | 120 | STOCKTAKE | no | 0 | 1440px, 1200px, 767px, 767px |

### Full machine-readable inventory

The complete selector-level inventory, line evidence, ownership candidates, and compatibility records are in [`css-architecture-inventory.json`](css-architecture-inventory.json).

## Stylesheet Load Order Audit

`static/index.html` loads the following stylesheets in this exact order:

1. `css/style.core.css`
2. `css/style.calendar.css`
3. `css/style.signed-reports.css`
4. `css/style.quotation.css`
5. `css/style.quotation-upload.css`
6. `css/style.petty-cash.css`
7. `css/style.petty-cash-reports.css`
8. `css/style.petty-cash-engineering.css`
9. `css/style.performance.css`
10. `css/style.inventory.css`
11. `css/style.kit.css`
12. `css/style.stocktake.css`
13. `css/style.stockout.css`

Cross-file duplicate groups whose result can depend on this order:

- `.header` → `static/css/style.core.css` → `static/css/style.quotation.css`
- `.main` → `static/css/style.core.css` → `static/css/style.quotation.css`
- `.sidebar` → `static/css/style.core.css` → `static/css/style.quotation.css`

Finding: `CSS-AUDIT-001` is a **P1 LOAD ORDER DEPENDENCY** whenever a generic selector is defined by more than one owner and a later stylesheet wins by source order rather than an explicit ownership contract.

## Ownership Map

Owner model used by this audit: `GLOBAL`, `BASE`, `SHELL`, `SHARED COMPONENT`, feature owners (`CALENDAR`, `INVENTORY`, `KIT`, `STOCKTAKE`, `STOCKOUT`, `SIGNED REPORTS`, `QUOTATION`, `QUOTATION UPLOAD`), `PETTY CASH — PROTECTED`, `UNKNOWN`, and `MIXED OWNERSHIP`.

| Selector / component | Defined in | Used by | Owner | Risk | Proposed action |
|---|---|---|---|---|---|
| `.cal-icon-btn.btn-delete:hover` | `static/css/style.calendar.css:89` | not proven in HTML | CALENDAR | MANUAL REVIEW REQUIRED | Confirm canonical shared-component owner before migration |
| `.btn-sm` | `static/css/style.calendar.css:91` | not proven in HTML | CALENDAR | MANUAL REVIEW REQUIRED | Confirm canonical shared-component owner before migration |
| `.btn-card` | `static/css/style.calendar.css:117` | not proven in HTML | CALENDAR | MANUAL REVIEW REQUIRED | Confirm canonical shared-component owner before migration |
| `.filter-panel.inventory-filter-panel .filter-chip .badge` | `static/css/style.inventory.css:81` | `static/index.html` | INVENTORY | MANUAL REVIEW REQUIRED | Confirm canonical shared-component owner before migration |
| `.inventory-content .btn-sm` | `static/css/style.inventory.css:231` | not proven in HTML | INVENTORY | MANUAL REVIEW REQUIRED | Confirm canonical shared-component owner before migration |
| `.inventory-content .btn-add-inv` | `static/css/style.inventory.css:231` | not proven in HTML | INVENTORY | MANUAL REVIEW REQUIRED | Confirm canonical shared-component owner before migration |
| `.inventory-content .tbl-wrap .inventory-stockout-actions .btn-prepare` | `static/css/style.inventory.css:297` | `static/index.html` | INVENTORY | MANUAL REVIEW REQUIRED | Confirm canonical shared-component owner before migration |
| `.inventory-content .tbl-wrap .inventory-stockout-actions .btn-out` | `static/css/style.inventory.css:297` | not proven in HTML | INVENTORY | MANUAL REVIEW REQUIRED | Confirm canonical shared-component owner before migration |
| `.prepared-row-actions .btn-del` | `static/css/style.inventory.css:897` | not proven in HTML | INVENTORY | MANUAL REVIEW REQUIRED | Confirm canonical shared-component owner before migration |
| `.qtyd-quick .btn-ghost` | `static/css/style.inventory.css:1326` | `static/index.html`, `static/permissions.html`, `static/settings.html` | INVENTORY | SHARED OWNERSHIP LEAK | Confirm canonical shared-component owner before migration |
| `#qty-dialog .modal` | `static/css/style.inventory.css:1328` | `static/index.html`, `static/permissions.html` | INVENTORY | SHARED OWNERSHIP LEAK | Confirm canonical shared-component owner before migration |
| `#content .pc-kpi-card__head .ui-kpi-icon` | `static/css/style.petty-cash.css:155` | not proven in HTML | PETTY CASH — PROTECTED | MANUAL REVIEW REQUIRED | Confirm canonical shared-component owner before migration |
| `#content .pc-kpi-card__head .ui-kpi-label` | `static/css/style.petty-cash.css:159` | not proven in HTML | PETTY CASH — PROTECTED | MANUAL REVIEW REQUIRED | Confirm canonical shared-component owner before migration |
| `#content .pc-kpi-card .ui-kpi-value` | `static/css/style.petty-cash.css:162` | not proven in HTML | PETTY CASH — PROTECTED | MANUAL REVIEW REQUIRED | Confirm canonical shared-component owner before migration |
| `.header` | `static/css/style.quotation.css:67` | `static/index.html` | QUOTATION | MANUAL REVIEW REQUIRED | Confirm canonical shared-component owner before migration |

## Shared Ownership Leaks

The audit does not delete duplicates mechanically. A duplicate is a finding only when consumer evidence, source order, specificity, media context, or feature boundaries indicate unintentional cascade coupling.

- **SHARED OWNERSHIP LEAK** — `.qtyd-quick .btn-ghost` in `static/css/style.inventory.css:1326`; HTML consumers: static/index.html, static/permissions.html, static/settings.html.
- **SHARED OWNERSHIP LEAK** — `#qty-dialog .modal` in `static/css/style.inventory.css:1328`; HTML consumers: static/index.html, static/permissions.html.

## Collision Map

| Source CSS | Selector | Intended owner | Other consumers | Risk | Recommendation |
|---|---|---|---|---|---|
| `static/css/style.calendar.css:89` | `.cal-icon-btn.btn-delete:hover` | CALENDAR | dynamic/unknown | MANUAL REVIEW REQUIRED | Confirm canonical owner before PR B/C/D |
| `static/css/style.calendar.css:91` | `.btn-sm` | CALENDAR | dynamic/unknown | MANUAL REVIEW REQUIRED | Confirm canonical owner before PR B/C/D |
| `static/css/style.calendar.css:117` | `.btn-card` | CALENDAR | dynamic/unknown | MANUAL REVIEW REQUIRED | Confirm canonical owner before PR B/C/D |
| `static/css/style.inventory.css:81` | `.filter-panel.inventory-filter-panel .filter-chip .badge` | INVENTORY | static/index.html | MANUAL REVIEW REQUIRED | Confirm canonical owner before PR B/C/D |
| `static/css/style.inventory.css:231` | `.inventory-content .btn-sm` | INVENTORY | dynamic/unknown | MANUAL REVIEW REQUIRED | Confirm canonical owner before PR B/C/D |
| `static/css/style.inventory.css:231` | `.inventory-content .btn-add-inv` | INVENTORY | dynamic/unknown | MANUAL REVIEW REQUIRED | Confirm canonical owner before PR B/C/D |
| `static/css/style.inventory.css:297` | `.inventory-content .tbl-wrap .inventory-stockout-actions .btn-prepare` | INVENTORY | static/index.html | MANUAL REVIEW REQUIRED | Confirm canonical owner before PR B/C/D |
| `static/css/style.inventory.css:297` | `.inventory-content .tbl-wrap .inventory-stockout-actions .btn-out` | INVENTORY | dynamic/unknown | MANUAL REVIEW REQUIRED | Confirm canonical owner before PR B/C/D |
| `static/css/style.inventory.css:897` | `.prepared-row-actions .btn-del` | INVENTORY | dynamic/unknown | MANUAL REVIEW REQUIRED | Confirm canonical owner before PR B/C/D |
| `static/css/style.inventory.css:1326` | `.qtyd-quick .btn-ghost` | INVENTORY | static/index.html, static/permissions.html, static/settings.html | SHARED OWNERSHIP LEAK | Confirm canonical owner before PR B/C/D |
| `static/css/style.inventory.css:1328` | `#qty-dialog .modal` | INVENTORY | static/index.html, static/permissions.html | SHARED OWNERSHIP LEAK | Confirm canonical owner before PR B/C/D |
| `static/css/style.petty-cash.css:155` | `#content .pc-kpi-card__head .ui-kpi-icon` | PETTY CASH — PROTECTED | dynamic/unknown | MANUAL REVIEW REQUIRED | Confirm canonical owner before PR B/C/D |
| `static/css/style.petty-cash.css:159` | `#content .pc-kpi-card__head .ui-kpi-label` | PETTY CASH — PROTECTED | dynamic/unknown | MANUAL REVIEW REQUIRED | Confirm canonical owner before PR B/C/D |
| `static/css/style.petty-cash.css:162` | `#content .pc-kpi-card .ui-kpi-value` | PETTY CASH — PROTECTED | dynamic/unknown | MANUAL REVIEW REQUIRED | Confirm canonical owner before PR B/C/D |
| `static/css/style.quotation.css:67` | `.header` | QUOTATION | static/index.html | MANUAL REVIEW REQUIRED | Confirm canonical owner before PR B/C/D |

## Specificity Audit

- ID selector records: `83`.
- High-specificity records (any ID or at least four class/attribute/pseudo components): `157`.
- Global element selector records: `5`.
- Classification rule: `KEEP` only when the selector expresses a documented shell/layout boundary; `MIGRATE` for feature overrides; `MANUAL REVIEW` when changing it could alter an unknown DOM contract.

### Highest-specificity evidence

- `static/css/style.calendar.css:5` `#content.cal-content`
- `static/css/style.calendar.css:156` `.switch.on::after`
- `static/css/style.calendar.css:276` `.cal-day-card.cal-search-mode #cal-day-list`
- `static/css/style.calendar.css:276` `.cal-day-card.cal-search-mode #cal-helper-panel`
- `static/css/style.calendar.css:278` `.cal-day-card.cal-search-mode #cal-search-results`
- `static/css/style.core.css:23` `.sb-nav-link.active::before`
- `static/css/style.core.css:141` `.unit-search:focus::placeholder`
- `static/css/style.core.css:278` `#photo-lightbox`
- `static/css/style.core.css:284` `#photo-lightbox .lightbox-content`
- `static/css/style.core.css:285` `#photo-lightbox img`
- `static/css/style.core.css:290` `#photo-lightbox .lightbox-close`
- `static/css/style.core.css:297` `#photo-lightbox .lightbox-close:hover`
- `static/css/style.core.css:485` `.data-table tr:last-child td`
- `static/css/style.core.css:536` `#content .ui-kpi-grid`
- `static/css/style.core.css:537` `#content .ui-kpi-card`
- `static/css/style.core.css:543` `#content .ui-kpi-card--stacked`
- `static/css/style.core.css:544` `#content .ui-kpi-icon`
- `static/css/style.core.css:548` `#content .ui-kpi-body`
- `static/css/style.core.css:549` `#content .ui-kpi-value`
- `static/css/style.core.css:550` `#content .ui-kpi-label`
- `static/css/style.core.css:551` `#content .ui-kpi-meta`
- `static/css/style.core.css:552` `#content .ui-kpi-card--stacked .ui-kpi-meta`
- `static/css/style.core.css:553` `#content .ui-kpi-card--blue .ui-kpi-value`
- `static/css/style.core.css:554` `#content .ui-kpi-card--indigo .ui-kpi-value`
- `static/css/style.core.css:555` `#content .ui-kpi-card--slate .ui-kpi-value`
- `static/css/style.core.css:556` `#content .ui-kpi-card--purple .ui-kpi-value`
- `static/css/style.core.css:557` `#content .ui-kpi-card--green .ui-kpi-value`
- `static/css/style.core.css:558` `#content .ui-kpi-card--amber .ui-kpi-value`
- `static/css/style.core.css:559` `#content .ui-kpi-card--red .ui-kpi-value`
- `static/css/style.core.css:560` `#content .ui-kpi-grid--compact`
- `static/css/style.core.css:561` `#content .ui-kpi-card--compact`
- `static/css/style.core.css:562` `#content .ui-kpi-card--compact .ui-kpi-icon`
- `static/css/style.core.css:563` `#content .ui-kpi-card--compact .ui-kpi-body`
- `static/css/style.core.css:564` `#content .ui-kpi-card--compact .ui-kpi-value`
- `static/css/style.core.css:565` `#content .ui-kpi-card--compact .ui-kpi-label`
- `static/css/style.core.css:566` `#content .ui-kpi-card--compact .ui-kpi-meta`
- `static/css/style.core.css:567` `#content .ui-kpi-card--inline`
- `static/css/style.core.css:570` `#content .ui-kpi-grid`
- `static/css/style.core.css:571` `#content .ui-kpi-card`
- `static/css/style.core.css:572` `#content .ui-kpi-icon`
- `static/css/style.core.css:573` `#content .ui-kpi-value`
- `static/css/style.core.css:574` `#content .ui-kpi-label`
- `static/css/style.core.css:575` `#content .ui-kpi-meta`
- `static/css/style.core.css:576` `#content .ui-kpi-card--compact`
- `static/css/style.core.css:577` `#content .ui-kpi-card--compact .ui-kpi-icon`
- `static/css/style.core.css:578` `#content .ui-kpi-card--compact .ui-kpi-value`
- `static/css/style.core.css:579` `#content .ui-kpi-card--compact .ui-kpi-meta`
- `static/css/style.core.css:580` `#content .ui-kpi-card--inline`
- `static/css/style.core.css:692` `.selected-row input[type="number"]`
- `static/css/style.core.css:719` `#kit-modal .btn-confirm`
- `static/css/style.core.css:769` `.selected-row .info .bd .model`
- `static/css/style.core.css:894` `.m-card .qty-actions .act:last-child`
- `static/css/style.core.css:895` `.m-card .qty-actions .act.mn`
- `static/css/style.core.css:896` `.m-card .qty-actions .act.pl`
- `static/css/style.core.css:897` `.m-card .qty-actions .act:disabled`
- `static/css/style.core.css:898` `.m-card .qty-actions .act.mid`
- `static/css/style.core.css:902` `.m-card .qty-actions .act.mid .unit`
- `static/css/style.core.css:922` `.tbl-wrap .col-actions .inventory-stockout-actions .btn-prepare`
- `static/css/style.core.css:925` `.tbl-wrap .col-actions .inventory-stockout-actions .btn-out`
- `static/css/style.core.css:928` `.tbl-wrap .col-actions .inventory-stockout-actions .btn-prepare:hover`
- `static/css/style.core.css:929` `.tbl-wrap .col-actions .inventory-stockout-actions .btn-out:hover`
- `static/css/style.core.css:939` `.m-card .kit-comp .cphoto .cphoto-empty`
- `static/css/style.core.css:948` `.m-card .kit-comp .cneed b.ok`
- `static/css/style.core.css:949` `.m-card .kit-comp .cneed b.low`
- `static/css/style.core.css:1012` `.tbl-wrap table.data-table tr:last-child td`
- `static/css/style.core.css:1027` `.tbl-wrap .inventory-action-dropdown .inventory-action-item:hover`
- `static/css/style.core.css:1028` `.tbl-wrap .inventory-action-dropdown .inventory-action-item.del`
- `static/css/style.inventory.css:72` `.filter-panel.inventory-filter-panel .filter-chip:hover`
- `static/css/style.inventory.css:76` `.filter-panel.inventory-filter-panel .filter-chip.active`
- `static/css/style.inventory.css:81` `.filter-panel.inventory-filter-panel .filter-chip .badge`
- `static/css/style.inventory.css:93` `.filter-panel.inventory-filter-panel .filter-clear:hover`
- `static/css/style.inventory.css:270` `.inventory-content .tbl-wrap table.data-table tr:hover td`
- `static/css/style.inventory.css:273` `.inventory-content .tbl-wrap table.data-table tr.row-warn td`
- `static/css/style.inventory.css:276` `.inventory-content .tbl-wrap table.data-table tr.row-danger td`
- `static/css/style.inventory.css:297` `.inventory-content .tbl-wrap .inventory-stockout-actions .btn-prepare`
- `static/css/style.inventory.css:297` `.inventory-content .tbl-wrap .inventory-stockout-actions .btn-out`
- `static/css/style.inventory.css:365` `.inventory-content .loc-group .item-card:last-child`
- `static/css/style.inventory.css:368` `.inventory-content .loc-group .item-card:hover`
- `static/css/style.inventory.css:807` `.prepared-table tbody tr:last-child td`
- `static/css/style.inventory.css:810` `.prepared-table tbody tr:hover td`
- `static/css/style.inventory.css:1259` `.inventory-content .loc-export-bar .btn-add-inv:hover`
- `static/css/style.inventory.css:1328` `#qty-dialog .modal`
- `static/css/style.inventory.css:1329` `#qtyd-input`
- `static/css/style.kit.css:89` `.kit-content .kit-kpi-card.is-warning .kit-kpi-icon`
- `static/css/style.kit.css:90` `.kit-content .kit-kpi-card.is-danger .kit-kpi-icon`
- `static/css/style.kit.css:92` `.kit-content .kit-kpi-card.is-warning .kit-kpi-number`
- `static/css/style.kit.css:93` `.kit-content .kit-kpi-card.is-danger .kit-kpi-number`
- `static/css/style.kit.css:165` `.kit-content .kit-action.is-prepare:hover`
- `static/css/style.kit.css:167` `.kit-content .kit-action.is-out:hover`
- `static/css/style.kit.css:170` `.kit-content .kit-action.is-delete:hover`
- `static/css/style.kit.css:246` `.kit-content .kit-kpi-card.is-clickable:hover`
- `static/css/style.kit.css:247` `.kit-content .kit-kpi-card.is-clickable:focus-visible`
- `static/css/style.performance.css:26` `.inventory-pagination button:not(:disabled):hover`
- `static/css/style.performance.css:30` `img[loading="lazy"]`
- `static/css/style.petty-cash-engineering.css:51` `.eng-detail-table tbody tr:last-child td`
- `static/css/style.petty-cash-reports.css:60` `.pc-report-list-table tbody tr.pc-more-menu-row--open td:last-child`
- `static/css/style.petty-cash.css:4` `#content.pc-content`
- `static/css/style.petty-cash.css:134` `#content .pc-kpi-row`
- `static/css/style.petty-cash.css:140` `#content .pc-kpi-card`
- `static/css/style.petty-cash.css:154` `#content .pc-kpi-card__head`
- … 57 more (see `docs/css-architecture-inventory.json`).

## !important Audit

No `!important` was removed in PR A. Each occurrence remains a finding to classify as `KEEP`, `MIGRATE`, `REMOVE`, or `MANUAL REVIEW` after ownership and computed-style evidence are available.

- `static/css/style.calendar.css:115` `.cal-export-btn { flex-shrink: 0; background: #2563eb !important; border-color: #2563eb !important; }`
- `static/css/style.calendar.css:115` `.cal-export-btn { flex-shrink: 0; background: #2563eb !important; border-color: #2563eb !important; }`
- `static/css/style.calendar.css:278` `.cal-day-card.cal-search-mode #cal-search-results { display: flex !important; flex-direction: column; }`
- `static/css/style.core.css:677` `.kit-rm { flex: none; width: 40px; height: 40px; padding: 0 !important; }`
- `static/css/style.core.css:913` `flex: 1; margin: 0 !important; padding: 10px 4px !important; font-size: 12.5px;`
- `static/css/style.core.css:913` `flex: 1; margin: 0 !important; padding: 10px 4px !important; font-size: 12.5px;`
- `static/css/style.core.css:920` `margin: 0 !important; padding: 5px 7px !important; font-size: 11px; white-space: nowrap;`
- `static/css/style.core.css:920` `margin: 0 !important; padding: 5px 7px !important; font-size: 11px; white-space: nowrap;`
- `static/css/style.core.css:1022` `.tbl-wrap .inventory-action-trigger{border:1px solid #dbe3ec !important;border-radius:6px;background:#fff !important;font-size:18px !important;line-height:1;padding:1px 7px !important;color:#475569}`
- `static/css/style.core.css:1022` `.tbl-wrap .inventory-action-trigger{border:1px solid #dbe3ec !important;border-radius:6px;background:#fff !important;font-size:18px !important;line-height:1;padding:1px 7px !important;color:#475569}`
- `static/css/style.core.css:1022` `.tbl-wrap .inventory-action-trigger{border:1px solid #dbe3ec !important;border-radius:6px;background:#fff !important;font-size:18px !important;line-height:1;padding:1px 7px !important;color:#475569}`
- `static/css/style.core.css:1022` `.tbl-wrap .inventory-action-trigger{border:1px solid #dbe3ec !important;border-radius:6px;background:#fff !important;font-size:18px !important;line-height:1;padding:1px 7px !important;color:#475569}`
- `static/css/style.core.css:1023` `.tbl-wrap .inventory-action-trigger:hover{background:#f1f5f9 !important;color:#1e3a5f}`
- `static/css/style.core.css:1026` `.tbl-wrap .inventory-action-dropdown .inventory-action-item{display:block;width:100%;padding:8px 10px !important;border-radius:5px;text-align:left;font-size:12px !important;white-space:nowrap;color:#334155}`
- `static/css/style.core.css:1026` `.tbl-wrap .inventory-action-dropdown .inventory-action-item{display:block;width:100%;padding:8px 10px !important;border-radius:5px;text-align:left;font-size:12px !important;white-space:nowrap;color:#334155}`
- `static/css/style.inventory.css:299` `padding: 0 10px !important;`
- `static/css/style.inventory.css:313` `font-size: 12px !important;`
- `static/css/style.inventory.css:326` `font-size: 12px !important;`
- `static/css/style.quotation.css:67` `.sidebar, .header, .quote-page-header .dsr-page-actions, .quote-side, .quote-history-card, .quote-empty-hint, .quote-items-table td:last-child, .quote-items-table th:last-child { display: none !important; }`
- `static/css/style.quotation.css:68` `.main { margin: 0 !important; }`
- `static/css/style.signed-reports.css:321` `.dsr-edit-modal .dsr-field + .dsr-field { margin-top: 14px !important; }`

## Responsive Audit

Breakpoint values observed:

- `1200px` — 5 occurrence(s).
- `1440px` — 4 occurrence(s).
- `390px` — 1 occurrence(s).
- `560px` — 2 occurrence(s).
- `639px` — 3 occurrence(s).
- `720px` — 1 occurrence(s).
- `767px` — 36 occurrence(s).
- `768px` — 12 occurrence(s).
- `960px` — 3 occurrence(s).

- Contract proposal: desktop/base is canonical; mobile is a delta owned by the same feature file and placed next to the base rule.
- PR A disposition: `DEFER`; no breakpoint normalization or mobile override rewrite is performed.
- Manual review required for layout contracts where header/row/column intent is not encoded in repository evidence.

## Inline Style Audit

- Inline `style=""` attributes: `71` across `4` HTML files.
- Inline `<style>` blocks: `3`.
- `static/settings.html` and `static/permissions.html` each define page-local `.topbar`, `.modal`, form/table, and responsive rules after loading `style.core.css`; this is an explicit source-order dependency that needs a future page-style ownership decision.
- PR A disposition: `MIGRATE` proposal only; inline rules remain unchanged.

- `<style>` block: `static/login.html:7`
- `<style>` block: `static/permissions.html:8`
- `<style>` block: `static/settings.html:8`

## JS Hook / CSS Hook Audit

- JavaScript files scanned: `36`.
- Inline style mutations: `123`.
- `classList` mutations: `125`.
- JS class/style mutations are inventory evidence only; PR A does not rename DOM hooks or restructure markup.

- `static/js/app.js:23` — classList mutation `.classList.remove(`
- `static/js/app.js:25` — classList mutation `.classList.add(`
- `static/js/app.js:39` — classList mutation `.classList.add(`
- `static/js/app.js:40` — classList mutation `.classList.add(`
- `static/js/app.js:43` — classList mutation `.classList.remove(`
- `static/js/app.js:44` — classList mutation `.classList.remove(`
- `static/js/app.js:59` — classList mutation `.classList.toggle(`
- `static/js/app.js:60` — classList mutation `.classList.toggle(`
- `static/js/app.js:72` — classList mutation `.classList.toggle(`
- `static/js/app.js:73` — classList mutation `.classList.toggle(`
- `static/js/app.js:79` — classList mutation `.classList.toggle(`
- `static/js/app.js:83` — classList mutation `.classList.remove(`
- `static/js/app.js:98` — style property mutation `sbUser.style.display =`
- `static/js/app.js:121` — classList mutation `.classList.toggle(`
- `static/js/app.js:122` — classList mutation `.classList.toggle(`
- `static/js/app.js:123` — classList mutation `.classList.toggle(`
- `static/js/app.js:124` — classList mutation `.classList.toggle(`
- `static/js/app.js:125` — classList mutation `.classList.toggle(`
- `static/js/app.js:126` — classList mutation `.classList.toggle(`
- `static/js/app.js:127` — classList mutation `.classList.toggle(`
- `static/js/app.js:128` — classList mutation `.classList.toggle(`
- `static/js/app.js:129` — classList mutation `.classList.toggle(`
- `static/js/app.js:130` — classList mutation `.classList.remove(`
- `static/js/app.js:131` — classList mutation `.classList.remove(`
- `static/js/app.js:133` — classList mutation `.classList.add(`
- `static/js/app.js:135` — classList mutation `.classList.add(`
- `static/js/app.js:144` — style property mutation `sb.style.display =`
- `static/js/app.js:145` — style property mutation `st.style.display =`
- `static/js/app.js:148` — style property mutation `fp.style.display =`
- `static/js/app.js:154` — classList mutation `.classList.remove(`
- `static/js/app.js:162` — classList mutation `.classList.remove(`
- `static/js/app.js:198` — style property mutation `el.style.display =`
- `static/js/app.js:202` — style property mutation `el.style.display =`
- `static/js/app.js:267` — classList mutation `.classList.remove(`
- `static/js/app.js:269` — classList mutation `.classList.add(`
- `static/js/app.js:272` — classList mutation `.classList.add(`
- `static/js/auth.js:72` — style property mutation `sbNavStocktake.style.display =`
- `static/js/auth.js:74` — style property mutation `saveBar.style.display =`
- `static/js/bottomsheet.js:54` — classList mutation `.classList.add(`
- `static/js/modals/add.js:9` — style property mutation `warnBox.style.display =`
- `static/js/modals/add.js:23` — style property mutation `fUnitAdd.style.display =`
- `static/js/modals/calendar-settings.js:43` — style property mutation `style.display =`
- `static/js/modals/calendar-settings.js:53` — style property mutation `style.display =`
- `static/js/modals/calendar.js:57` — style property mutation `style.display =`
- `static/js/modals/calendar.js:93` — style property mutation `style.display =`
- `static/js/modals/calendar.js:118` — style property mutation `box.style.display =`
- `static/js/modals/calendar.js:164` — style property mutation `style.display =`
- `static/js/modals/calendar.js:166` — style property mutation `set.style.display =`
- `static/js/modals/changepw.js:8` — style property mutation `style.display =`
- `static/js/modals/changepw.js:16` — classList mutation `.classList.remove(`
- `static/js/modals/changepw.js:31` — classList mutation `.classList.toggle(`
- `static/js/modals/changepw.js:46` — style property mutation `style.display =`
- `static/js/modals/edit.js:23` — style property mutation `eUnitAdd.style.display =`
- `static/js/modals/edit.js:37` — style property mutation `warnBox.style.display =`
- `static/js/modals/expiry.js:11` — style property mutation `btn.style.display =`
- `static/js/modals/expiry.js:12` — style property mutation `ack.style.display =`
- `static/js/modals/expiry.js:13` — style property mutation `adminOnly.style.display =`
- `static/js/modals/gcal-key.js:16` — style property mutation `meta.style.display =`
- `static/js/modals/gcal-key.js:29` — style property mutation `meta.style.display =`
- `static/js/modals/gcal-key.js:55` — classList mutation `.classList.add(`
- `static/js/modals/gcal-key.js:60` — classList mutation `.classList.remove(`
- `static/js/modals/petty-cash.js:246` — classList mutation `.classList.toggle(`
- `static/js/modals/petty-cash.js:343` — classList mutation `.classList.toggle(`
- `static/js/modals/petty-cash.js:344` — classList mutation `.classList.toggle(`
- `static/js/modals/petty-cash.js:345` — style property mutation `style.display =`
- `static/js/modals/petty-cash.js:388` — style property mutation `req.style.display =`
- `static/js/modals/photo.js:17` — style property mutation `this.style.display=`
- `static/js/modals/photo.js:135` — style property mutation `style.display =`
- `static/js/modals/photo.js:164` — style property mutation `box.style.display =`
- `static/js/modals/photo.js:173` — style property mutation `box.style.display =`
- `static/js/modals/stockout.js:61` — style property mutation `nsUnitAdd.style.display =`
- `static/js/modals/stockout.js:107` — style property mutation `nspUnitAdd.style.display =`
- `static/js/modals/stockout.js:249` — style property mutation `style.display =`
- `static/js/modals/stockout.js:415` — style property mutation `style.display =`
- `static/js/modals/stockout.js:449` — style property mutation `style.display =`
- `static/js/notifications.js:97` — style property mutation `badge.style.display =`
- `static/js/notifications.js:157` — classList mutation `.classList.remove(`
- `static/js/notifications.js:158` — classList mutation `.classList.remove(`
- `static/js/notifications.js:160` — classList mutation `.classList.remove(`
- `static/js/notifications.js:170` — classList mutation `.classList.add(`
- `static/js/notifications.js:171` — classList mutation `.classList.add(`
- `static/js/notifications.js:173` — classList mutation `.classList.add(`
- `static/js/notifications.js:201` — classList mutation `.classList.remove(`
- `static/js/notifications.js:202` — classList mutation `.classList.remove(`
- `static/js/perms.js:203` — classList mutation `.classList.add(`
- `static/js/perms.js:207` — classList mutation `.classList.remove(`
- `static/js/perms.js:256` — classList mutation `.classList.add(`
- `static/js/perms.js:293` — classList mutation `.classList.toggle(`
- `static/js/perms.js:294` — style property mutation `style.display =`
- `static/js/perms.js:295` — style property mutation `style.display =`
- `static/js/perms.js:306` — classList mutation `.classList.add(`
- `static/js/perms.js:310` — classList mutation `.classList.remove(`
- `static/js/perms.js:315` — style property mutation `style.display =`
- `static/js/perms.js:316` — style property mutation `style.display =`
- `static/js/perms.js:317` — classList mutation `.classList.toggle(`
- `static/js/perms.js:372` — classList mutation `.classList.add(`
- `static/js/perms.js:376` — classList mutation `.classList.remove(`
- `static/js/perms.js:410` — classList mutation `.classList.remove(`
- `static/js/render/calendar.js:159` — style property mutation `el.style.display =`
- `static/js/render/calendar.js:204` — style property mutation `legend.style.display =`
- `static/js/render/calendar.js:205` — style property mutation `helper.style.display =`
- `static/js/render/calendar.js:216` — style property mutation `legend.style.display =`
- `static/js/render/calendar.js:217` — style property mutation `helper.style.display =`
- `static/js/render/calendar.js:276` — style property mutation `el.style.display =`
- `static/js/render/calendar.js:280` — style property mutation `el.style.display =`
- `static/js/render/calendar.js:288` — style property mutation `el.style.display =`
- `static/js/render/calendar.js:292` — style property mutation `el.style.display =`
- `static/js/render/calendar.js:549` — classList mutation `.classList.remove(`
- `static/js/render/calendar.js:550` — style property mutation `results.style.display =`
- `static/js/render/calendar.js:551` — style property mutation `list.style.display =`
- `static/js/render/calendar.js:554` — classList mutation `.classList.toggle(`
- `static/js/render/calendar.js:555` — style property mutation `results.style.display =`
- `static/js/render/calendar.js:556` — style property mutation `list.style.display =`
- `static/js/render/calendar.js:557` — style property mutation `helper.style.display =`
- `static/js/render/calendar.js:622` — style property mutation `el.style.display =`
- `static/js/render/inventory.js:338` — classList mutation `.classList.add(`
- `static/js/render/inventory.js:362` — classList mutation `.classList.remove(`
- `static/js/render/inventory.js:522` — style property mutation `this.style.display=`
- `static/js/render/inventory.js:647` — classList mutation `.classList.add(`
- `static/js/render/inventory.js:653` — classList mutation `.classList.remove(`
- `static/js/render/inventory.js:733` — classList mutation `.classList.toggle(`
- `static/js/render/inventory.js:739` — classList mutation `.classList.toggle(`
- `static/js/render/inventory.js:787` — classList mutation `.classList.toggle(`
- `static/js/render/inventory.js:883` — classList mutation `.classList.toggle(`
- `static/js/render/inventory.js:909` — classList mutation `.classList.toggle(`
- `static/js/render/inventory.js:913` — classList mutation `.classList.add(`
- `static/js/render/inventory.js:915` — classList mutation `.classList.remove(`
- `static/js/render/inventory.js:963` — classList mutation `.classList.toggle(`
- `static/js/render/inventory.js:969` — classList mutation `.classList.remove(`
- `static/js/render/inventory.js:996` — classList mutation `.classList.add(`
- `static/js/render/inventory.js:1000` — classList mutation `.classList.remove(`
- `static/js/render/inventory.js:1053` — classList mutation `.classList.toggle(`
- `static/js/render/inventory.js:1057` — classList mutation `.classList.remove(`
- `static/js/render/inventory.js:1061` — classList mutation `.classList.remove(`
- `static/js/render/inventory.js:1063` — classList mutation `.classList.toggle(`
- `static/js/render/inventory.js:1066` — classList mutation `.classList.remove(`
- `static/js/render/kits.js:286` — classList mutation `.classList.add(`
- `static/js/render/kits.js:316` — classList mutation `.classList.remove(`
- `static/js/render/kits.js:332` — classList mutation `.classList.remove(`
- `static/js/render/petty-cash.js:106` — style property mutation `style.display =`
- `static/js/render/petty-cash.js:107` — style property mutation `style.display =`
- `static/js/render/petty-cash.js:108` — classList mutation `.classList.toggle(`
- `static/js/render/petty-cash.js:109` — classList mutation `.classList.toggle(`
- `static/js/render/petty-cash.js:110` — style property mutation `style.display =`
- `static/js/render/petty-cash.js:111` — style property mutation `style.display =`
- `static/js/render/petty-cash.js:249` — style property mutation `empty.style.display =`
- `static/js/render/petty-cash.js:251` — style property mutation `empty.style.display =`
- `static/js/render/petty-cash.js:321` — style property mutation `list.style.top =`
- `static/js/render/petty-cash.js:322` — style property mutation `list.style.left =`
- `static/js/render/petty-cash.js:329` — classList mutation `.classList.remove(`
- `static/js/render/petty-cash.js:330` — style property mutation `list.style.position =`
- `static/js/render/petty-cash.js:331` — style property mutation `list.style.top =`
- `static/js/render/petty-cash.js:332` — style property mutation `list.style.left =`
- `static/js/render/petty-cash.js:333` — style property mutation `list.style.right =`
- `static/js/render/petty-cash.js:334` — style property mutation `list.style.zIndex =`
- `static/js/render/petty-cash.js:340` — classList mutation `.classList.remove(`
- `static/js/render/petty-cash.js:357` — classList mutation `.classList.add(`
- `static/js/render/petty-cash.js:359` — style property mutation `list.style.position =`
- `static/js/render/petty-cash.js:360` — style property mutation `list.style.right =`
- `static/js/render/petty-cash.js:361` — style property mutation `list.style.zIndex =`

## PR8 Compatibility Map

Protected files:

- `static/css/style.petty-cash-engineering.css` — READ ONLY / PROTECTED
- `static/css/style.petty-cash-reports.css` — READ ONLY / PROTECTED
- `static/css/style.petty-cash.css` — READ ONLY / PROTECTED

| External selector | Source | Petty Cash consumer | Risk | Regression needed |
|---|---|---|---|---|
| `#content.cal-content` | `static/css/style.calendar.css:5` | `PR8 dynamic DOM matching #content` in `static/js/render/petty-cash.js (runtime consumer):?` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `.btn-card` | `static/css/style.calendar.css:117` | `PR8 dynamic DOM matching .btn-card` in `static/js/render/petty-cash.js (runtime consumer):?` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `.btn-card.btn-delete` | `static/css/style.calendar.css:119` | `PR8 dynamic DOM matching .btn-card` in `static/js/render/petty-cash.js (runtime consumer):?` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `.btn-card.btn-edit` | `static/css/style.calendar.css:118` | `PR8 dynamic DOM matching .btn-card` in `static/js/render/petty-cash.js (runtime consumer):?` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `.btn-sm` | `static/css/style.calendar.css:91` | `PR8 dynamic DOM matching .btn-sm` in `static/js/render/petty-cash.js (runtime consumer):?` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `.btn-sm.btn-primary` | `static/css/style.calendar.css:92` | `PR8 dynamic DOM matching .btn-sm` in `static/js/render/petty-cash.js (runtime consumer):?` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `.cal-card-actions .cal-icon-btn.btn-delete` | `static/css/style.calendar.css:206` | `PR8 dynamic DOM matching .btn-delete` in `static/js/render/petty-cash.js (runtime consumer):?` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `.cal-icon-btn.btn-delete:focus-visible` | `static/css/style.calendar.css:89` | `PR8 dynamic DOM matching .btn-delete` in `static/js/render/petty-cash.js (runtime consumer):?` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `.cal-icon-btn.btn-delete:hover` | `static/css/style.calendar.css:89` | `PR8 dynamic DOM matching .btn-delete` in `static/js/render/petty-cash.js (runtime consumer):?` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `#content .ui-kpi-body` | `static/css/style.core.css:548` | `PR8 dynamic DOM matching .ui-kpi-body` in `static/js/render/petty-cash.js (runtime consumer):?` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `#content .ui-kpi-card` | `static/css/style.core.css:571` | `PR8 dynamic DOM matching .ui-kpi-card` in `static/js/render/petty-cash.js (runtime consumer):?` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `#content .ui-kpi-card--amber .ui-kpi-value` | `static/css/style.core.css:558` | `PR8 dynamic DOM matching .ui-kpi-card--amber` in `static/js/render/petty-cash.js (runtime consumer):?` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `#content .ui-kpi-card--blue .ui-kpi-value` | `static/css/style.core.css:553` | `PR8 dynamic DOM matching .ui-kpi-card--blue` in `static/js/render/petty-cash.js (runtime consumer):?` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `#content .ui-kpi-card--compact` | `static/css/style.core.css:576` | `PR8 dynamic DOM matching .ui-kpi-card--compact` in `static/js/render/petty-cash.js (runtime consumer):?` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `#content .ui-kpi-card--compact .ui-kpi-body` | `static/css/style.core.css:563` | `PR8 dynamic DOM matching .ui-kpi-card--compact` in `static/js/render/petty-cash.js (runtime consumer):?` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `#content .ui-kpi-card--compact .ui-kpi-icon` | `static/css/style.core.css:577` | `PR8 dynamic DOM matching .ui-kpi-card--compact` in `static/js/render/petty-cash.js (runtime consumer):?` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `#content .ui-kpi-card--compact .ui-kpi-label` | `static/css/style.core.css:565` | `PR8 dynamic DOM matching .ui-kpi-card--compact` in `static/js/render/petty-cash.js (runtime consumer):?` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `#content .ui-kpi-card--compact .ui-kpi-meta` | `static/css/style.core.css:579` | `PR8 dynamic DOM matching .ui-kpi-card--compact` in `static/js/render/petty-cash.js (runtime consumer):?` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `#content .ui-kpi-card--compact .ui-kpi-value` | `static/css/style.core.css:578` | `PR8 dynamic DOM matching .ui-kpi-card--compact` in `static/js/render/petty-cash.js (runtime consumer):?` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `#content .ui-kpi-card--green .ui-kpi-value` | `static/css/style.core.css:557` | `PR8 dynamic DOM matching .ui-kpi-card--green` in `static/js/render/petty-cash.js (runtime consumer):?` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `#content .ui-kpi-card--indigo .ui-kpi-value` | `static/css/style.core.css:554` | `PR8 dynamic DOM matching .ui-kpi-card--indigo` in `static/js/render/petty-cash.js (runtime consumer):?` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `#content .ui-kpi-card--inline` | `static/css/style.core.css:580` | `PR8 dynamic DOM matching .ui-kpi-card--inline` in `static/js/render/petty-cash.js (runtime consumer):?` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `#content .ui-kpi-card--purple .ui-kpi-value` | `static/css/style.core.css:556` | `PR8 dynamic DOM matching .ui-kpi-card--purple` in `static/js/render/petty-cash.js (runtime consumer):?` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `#content .ui-kpi-card--red .ui-kpi-value` | `static/css/style.core.css:559` | `PR8 dynamic DOM matching .ui-kpi-card--red` in `static/js/render/petty-cash.js (runtime consumer):?` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `#content .ui-kpi-card--slate .ui-kpi-value` | `static/css/style.core.css:555` | `PR8 dynamic DOM matching .ui-kpi-card--slate` in `static/js/render/petty-cash.js (runtime consumer):?` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `#content .ui-kpi-card--stacked` | `static/css/style.core.css:543` | `PR8 dynamic DOM matching .ui-kpi-card--stacked` in `static/js/render/petty-cash.js (runtime consumer):?` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `#content .ui-kpi-card--stacked .ui-kpi-meta` | `static/css/style.core.css:552` | `PR8 dynamic DOM matching .ui-kpi-card--stacked` in `static/js/render/petty-cash.js (runtime consumer):?` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `#content .ui-kpi-grid` | `static/css/style.core.css:570` | `PR8 dynamic DOM matching .ui-kpi-grid` in `static/js/render/petty-cash.js (runtime consumer):?` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `#content .ui-kpi-grid--compact` | `static/css/style.core.css:560` | `PR8 dynamic DOM matching .ui-kpi-grid--compact` in `static/js/render/petty-cash.js (runtime consumer):?` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `#content .ui-kpi-icon` | `static/css/style.core.css:572` | `#content .pc-kpi-card:nth-child(1) .ui-kpi-icon` in `static/css/style.petty-cash.css:163` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `#content .ui-kpi-icon` | `static/css/style.core.css:572` | `#content .pc-kpi-card:nth-child(2) .ui-kpi-icon` in `static/css/style.petty-cash.css:164` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `#content .ui-kpi-icon` | `static/css/style.core.css:572` | `#content .pc-kpi-card:nth-child(3) .ui-kpi-icon` in `static/css/style.petty-cash.css:165` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `#content .ui-kpi-icon` | `static/css/style.core.css:572` | `#content .pc-kpi-card__head .ui-kpi-icon` in `static/css/style.petty-cash.css:376` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `#content .ui-kpi-label` | `static/css/style.core.css:574` | `#content .pc-kpi-card__head .ui-kpi-label` in `static/css/style.petty-cash.css:377` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `#content .ui-kpi-meta` | `static/css/style.core.css:575` | `PR8 dynamic DOM matching .ui-kpi-meta` in `static/js/render/petty-cash.js (runtime consumer):?` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `#content .ui-kpi-value` | `static/css/style.core.css:573` | `#content .pc-kpi-card .ui-kpi-value` in `static/css/style.petty-cash.css:374` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `#kit-modal .btn-confirm` | `static/css/style.core.css:719` | `PR8 dynamic DOM matching .btn-confirm` in `static/js/render/petty-cash.js (runtime consumer):?` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `.btn-add-inv` | `static/css/style.core.css:219` | `PR8 dynamic DOM matching .btn-add-inv` in `static/js/render/petty-cash.js (runtime consumer):?` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `.btn-add-inv:hover` | `static/css/style.core.css:220` | `PR8 dynamic DOM matching .btn-add-inv` in `static/js/render/petty-cash.js (runtime consumer):?` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `.btn-add-row` | `static/css/style.core.css:713` | `PR8 dynamic DOM matching .btn-add-row` in `static/js/render/petty-cash.js (runtime consumer):?` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `.btn-add-row:hover` | `static/css/style.core.css:718` | `PR8 dynamic DOM matching .btn-add-row` in `static/js/render/petty-cash.js (runtime consumer):?` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `.btn-batch` | `static/css/style.core.css:457` | `PR8 dynamic DOM matching .btn-batch` in `static/js/render/petty-cash.js (runtime consumer):?` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `.btn-batch.active` | `static/css/style.core.css:458` | `PR8 dynamic DOM matching .btn-batch` in `static/js/render/petty-cash.js (runtime consumer):?` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `.btn-cancel` | `static/css/style.core.css:724` | `PR8 dynamic DOM matching .btn-cancel` in `static/js/render/petty-cash.js (runtime consumer):?` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `.btn-cancel-ghost` | `static/css/style.core.css:814` | `PR8 dynamic DOM matching .btn-cancel-ghost` in `static/js/render/petty-cash.js (runtime consumer):?` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `.btn-cancel-ghost:hover` | `static/css/style.core.css:818` | `PR8 dynamic DOM matching .btn-cancel-ghost` in `static/js/render/petty-cash.js (runtime consumer):?` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `.btn-confirm` | `static/css/style.core.css:725` | `PR8 dynamic DOM matching .btn-confirm` in `static/js/render/petty-cash.js (runtime consumer):?` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `.btn-confirm.orange` | `static/css/style.core.css:726` | `PR8 dynamic DOM matching .btn-confirm` in `static/js/render/petty-cash.js (runtime consumer):?` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `.btn-del` | `static/css/style.core.css:798` | `PR8 dynamic DOM matching .btn-del` in `static/js/render/petty-cash.js (runtime consumer):?` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `.btn-del:active` | `static/css/style.core.css:805` | `PR8 dynamic DOM matching .btn-del` in `static/js/render/petty-cash.js (runtime consumer):?` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `.btn-del:hover` | `static/css/style.core.css:804` | `PR8 dynamic DOM matching .btn-del` in `static/js/render/petty-cash.js (runtime consumer):?` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `.btn-deselect-all` | `static/css/style.core.css:459` | `PR8 dynamic DOM matching .btn-deselect-all` in `static/js/render/petty-cash.js (runtime consumer):?` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `.btn-deselect-all:hover` | `static/css/style.core.css:460` | `PR8 dynamic DOM matching .btn-deselect-all` in `static/js/render/petty-cash.js (runtime consumer):?` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `.btn-edit` | `static/css/style.core.css:791` | `PR8 dynamic DOM matching .btn-edit` in `static/js/render/petty-cash.js (runtime consumer):?` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `.btn-edit:hover` | `static/css/style.core.css:797` | `PR8 dynamic DOM matching .btn-edit` in `static/js/render/petty-cash.js (runtime consumer):?` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `.btn-export` | `static/css/style.core.css:217` | `PR8 dynamic DOM matching .btn-export` in `static/js/render/petty-cash.js (runtime consumer):?` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `.btn-export:hover` | `static/css/style.core.css:223` | `PR8 dynamic DOM matching .btn-export` in `static/js/render/petty-cash.js (runtime consumer):?` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `.btn-ghost` | `static/css/style.core.css:108` | `PR8 dynamic DOM matching .btn-ghost` in `static/js/render/petty-cash.js (runtime consumer):?` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `.btn-ghost:hover` | `static/css/style.core.css:119` | `PR8 dynamic DOM matching .btn-ghost` in `static/js/render/petty-cash.js (runtime consumer):?` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `.btn-more-actions` | `static/css/style.core.css:1038` | `PR8 dynamic DOM matching .btn-more-actions` in `static/js/render/petty-cash.js (runtime consumer):?` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `.btn-out` | `static/css/style.core.css:369` | `PR8 dynamic DOM matching .btn-out` in `static/js/render/petty-cash.js (runtime consumer):?` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `.btn-out:hover` | `static/css/style.core.css:384` | `PR8 dynamic DOM matching .btn-out` in `static/js/render/petty-cash.js (runtime consumer):?` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `.btn-prepare` | `static/css/style.core.css:385` | `PR8 dynamic DOM matching .btn-prepare` in `static/js/render/petty-cash.js (runtime consumer):?` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `.btn-prepare:hover` | `static/css/style.core.css:400` | `PR8 dynamic DOM matching .btn-prepare` in `static/js/render/petty-cash.js (runtime consumer):?` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `.btn-primary` | `static/css/style.core.css:146` | `PR8 dynamic DOM matching .btn-primary` in `static/js/render/petty-cash.js (runtime consumer):?` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `.btn-primary:disabled` | `static/css/style.core.css:158` | `PR8 dynamic DOM matching .btn-primary` in `static/js/render/petty-cash.js (runtime consumer):?` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `.btn-primary:hover` | `static/css/style.core.css:157` | `PR8 dynamic DOM matching .btn-primary` in `static/js/render/petty-cash.js (runtime consumer):?` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `.btn-save` | `static/css/style.core.css:437` | `PR8 dynamic DOM matching .btn-save` in `static/js/render/petty-cash.js (runtime consumer):?` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `.btn-select-all` | `static/css/style.core.css:459` | `PR8 dynamic DOM matching .btn-select-all` in `static/js/render/petty-cash.js (runtime consumer):?` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `.btn-select-all:hover` | `static/css/style.core.css:460` | `PR8 dynamic DOM matching .btn-select-all` in `static/js/render/petty-cash.js (runtime consumer):?` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `.content` | `static/css/style.core.css:970` | `PR8 dynamic DOM matching .content` in `static/js/render/petty-cash.js (runtime consumer):?` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `.filter-chip .badge` | `static/css/style.core.css:204` | `PR8 dynamic DOM matching .badge` in `static/js/render/petty-cash.js (runtime consumer):?` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `.filter-chip.active .badge` | `static/css/style.core.css:205` | `PR8 dynamic DOM matching .badge` in `static/js/render/petty-cash.js (runtime consumer):?` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `.form-2col` | `static/css/style.core.css:720` | `PR8 dynamic DOM matching .form-2col` in `static/js/render/petty-cash.js (runtime consumer):?` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `.form-row` | `static/css/style.core.css:632` | `PR8 dynamic DOM matching .form-row` in `static/js/render/petty-cash.js (runtime consumer):?` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `.form-row input` | `static/css/style.core.css:634` | `PR8 dynamic DOM matching .form-row` in `static/js/render/petty-cash.js (runtime consumer):?` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `.form-row input:focus` | `static/css/style.core.css:639` | `PR8 dynamic DOM matching .form-row` in `static/js/render/petty-cash.js (runtime consumer):?` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `.form-row label` | `static/css/style.core.css:633` | `PR8 dynamic DOM matching .form-row` in `static/js/render/petty-cash.js (runtime consumer):?` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `.form-row select` | `static/css/style.core.css:634` | `PR8 dynamic DOM matching .form-row` in `static/js/render/petty-cash.js (runtime consumer):?` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `.form-row select:focus` | `static/css/style.core.css:639` | `PR8 dynamic DOM matching .form-row` in `static/js/render/petty-cash.js (runtime consumer):?` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `.form-row textarea` | `static/css/style.core.css:640` | `PR8 dynamic DOM matching .form-row` in `static/js/render/petty-cash.js (runtime consumer):?` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `.form-row textarea:focus` | `static/css/style.core.css:639` | `PR8 dynamic DOM matching .form-row` in `static/js/render/petty-cash.js (runtime consumer):?` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `.h-right .btn-ghost` | `static/css/style.core.css:52` | `PR8 dynamic DOM matching .btn-ghost` in `static/js/render/petty-cash.js (runtime consumer):?` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `.h-right .btn-ghost:hover` | `static/css/style.core.css:53` | `PR8 dynamic DOM matching .btn-ghost` in `static/js/render/petty-cash.js (runtime consumer):?` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `.header` | `static/css/style.core.css:961` | `PR8 dynamic DOM matching .header` in `static/js/render/petty-cash.js (runtime consumer):?` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `.inventory-stockout-actions .btn-out` | `static/css/style.core.css:919` | `PR8 dynamic DOM matching .btn-out` in `static/js/render/petty-cash.js (runtime consumer):?` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `.inventory-stockout-actions .btn-prepare` | `static/css/style.core.css:919` | `PR8 dynamic DOM matching .btn-prepare` in `static/js/render/petty-cash.js (runtime consumer):?` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `.m-card .card-main` | `static/css/style.core.css:869` | `PR8 dynamic DOM matching .card-main` in `static/js/render/petty-cash.js (runtime consumer):?` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `.m-card-actions .btn-out` | `static/css/style.core.css:912` | `PR8 dynamic DOM matching .btn-out` in `static/js/render/petty-cash.js (runtime consumer):?` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `.m-card-actions .btn-prepare` | `static/css/style.core.css:912` | `PR8 dynamic DOM matching .btn-prepare` in `static/js/render/petty-cash.js (runtime consumer):?` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `.main` | `static/css/style.core.css:956` | `PR8 dynamic DOM matching .main` in `static/js/render/petty-cash.js (runtime consumer):?` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `.main.sidebar-expanded` | `static/css/style.core.css:749` | `PR8 dynamic DOM matching .main` in `static/js/render/petty-cash.js (runtime consumer):?` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `.modal` | `static/css/style.core.css:743` | `PR8 dynamic DOM matching .modal` in `static/js/render/petty-cash.js (runtime consumer):?` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `.modal .btn-ghost` | `static/css/style.core.css:132` | `PR8 dynamic DOM matching .modal` in `static/js/render/petty-cash.js (runtime consumer):?` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `.modal .btn-ghost:hover` | `static/css/style.core.css:133` | `PR8 dynamic DOM matching .modal` in `static/js/render/petty-cash.js (runtime consumer):?` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `.modal h3` | `static/css/style.core.css:623` | `PR8 dynamic DOM matching .modal` in `static/js/render/petty-cash.js (runtime consumer):?` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `.modal-actions` | `static/css/style.core.css:721` | `PR8 dynamic DOM matching .modal-actions` in `static/js/render/petty-cash.js (runtime consumer):?` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `.modal-actions button` | `static/css/style.core.css:723` | `PR8 dynamic DOM matching .modal-actions` in `static/js/render/petty-cash.js (runtime consumer):?` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `.modal-close` | `static/css/style.core.css:626` | `PR8 dynamic DOM matching .modal-close` in `static/js/render/petty-cash.js (runtime consumer):?` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `.modal-close:hover` | `static/css/style.core.css:631` | `PR8 dynamic DOM matching .modal-close` in `static/js/render/petty-cash.js (runtime consumer):?` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `.modal-header` | `static/css/style.core.css:624` | `PR8 dynamic DOM matching .modal-header` in `static/js/render/petty-cash.js (runtime consumer):?` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `.modal-header h3` | `static/css/style.core.css:625` | `PR8 dynamic DOM matching .modal-header` in `static/js/render/petty-cash.js (runtime consumer):?` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `.modal-item-row` | `static/css/style.core.css:461` | `PR8 dynamic DOM matching .modal-item-row` in `static/js/render/petty-cash.js (runtime consumer):?` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `.modal-item-row:last-child` | `static/css/style.core.css:462` | `PR8 dynamic DOM matching .modal-item-row` in `static/js/render/petty-cash.js (runtime consumer):?` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `.modal-overlay` | `static/css/style.core.css:744` | `PR8 dynamic DOM matching .modal-overlay` in `static/js/render/petty-cash.js (runtime consumer):?` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `.modal-overlay.show` | `static/css/style.core.css:614` | `PR8 dynamic DOM matching .modal-overlay` in `static/js/render/petty-cash.js (runtime consumer):?` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `.sb-nav-link .badge` | `static/css/style.core.css:25` | `PR8 dynamic DOM matching .badge` in `static/js/render/petty-cash.js (runtime consumer):?` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `.sidebar` | `static/css/style.core.css:954` | `PR8 dynamic DOM matching .sidebar` in `static/js/render/petty-cash.js (runtime consumer):?` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `.sidebar.expanded` | `static/css/style.core.css:747` | `PR8 dynamic DOM matching .sidebar` in `static/js/render/petty-cash.js (runtime consumer):?` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `.sidebar.mob-open` | `static/css/style.core.css:955` | `PR8 dynamic DOM matching .sidebar` in `static/js/render/petty-cash.js (runtime consumer):?` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `.tbl-wrap .col-actions .inventory-stockout-actions .btn-out` | `static/css/style.core.css:925` | `PR8 dynamic DOM matching .btn-out` in `static/js/render/petty-cash.js (runtime consumer):?` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `.tbl-wrap .col-actions .inventory-stockout-actions .btn-out:hover` | `static/css/style.core.css:929` | `PR8 dynamic DOM matching .btn-out` in `static/js/render/petty-cash.js (runtime consumer):?` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `.tbl-wrap .col-actions .inventory-stockout-actions .btn-prepare` | `static/css/style.core.css:922` | `PR8 dynamic DOM matching .btn-prepare` in `static/js/render/petty-cash.js (runtime consumer):?` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `.tbl-wrap .col-actions .inventory-stockout-actions .btn-prepare:hover` | `static/css/style.core.css:928` | `PR8 dynamic DOM matching .btn-prepare` in `static/js/render/petty-cash.js (runtime consumer):?` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `.toast` | `static/css/style.core.css:596` | `PR8 dynamic DOM matching .toast` in `static/js/render/petty-cash.js (runtime consumer):?` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `.toast.error` | `static/css/style.core.css:607` | `PR8 dynamic DOM matching .toast` in `static/js/render/petty-cash.js (runtime consumer):?` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `.toast.show` | `static/css/style.core.css:605` | `PR8 dynamic DOM matching .toast` in `static/js/render/petty-cash.js (runtime consumer):?` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `.toast.success` | `static/css/style.core.css:606` | `PR8 dynamic DOM matching .toast` in `static/js/render/petty-cash.js (runtime consumer):?` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `.topbar` | `static/css/style.core.css:105` | `PR8 dynamic DOM matching .topbar` in `static/js/render/petty-cash.js (runtime consumer):?` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `.topbar .btn-primary` | `static/css/style.core.css:160` | `PR8 dynamic DOM matching .topbar` in `static/js/render/petty-cash.js (runtime consumer):?` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `.topbar .btn-primary:hover` | `static/css/style.core.css:161` | `PR8 dynamic DOM matching .topbar` in `static/js/render/petty-cash.js (runtime consumer):?` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `#qty-dialog .modal` | `static/css/style.inventory.css:1328` | `PR8 dynamic DOM matching .modal` in `static/js/render/petty-cash.js (runtime consumer):?` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `.content.inventory-content` | `static/css/style.inventory.css:976` | `PR8 dynamic DOM matching .content` in `static/js/render/petty-cash.js (runtime consumer):?` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `.content.prepared-content` | `static/css/style.inventory.css:976` | `PR8 dynamic DOM matching .content` in `static/js/render/petty-cash.js (runtime consumer):?` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `.filter-panel.inventory-filter-panel .filter-chip .badge` | `static/css/style.inventory.css:81` | `PR8 dynamic DOM matching .badge` in `static/js/render/petty-cash.js (runtime consumer):?` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `.inventory-content .btn-add-inv` | `static/css/style.inventory.css:1123` | `PR8 dynamic DOM matching .btn-add-inv` in `static/js/render/petty-cash.js (runtime consumer):?` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `.inventory-content .btn-sm` | `static/css/style.inventory.css:231` | `PR8 dynamic DOM matching .btn-sm` in `static/js/render/petty-cash.js (runtime consumer):?` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `.inventory-content .loc-export-bar .btn-add-inv` | `static/css/style.inventory.css:1254` | `PR8 dynamic DOM matching .btn-add-inv` in `static/js/render/petty-cash.js (runtime consumer):?` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `.inventory-content .loc-export-bar .btn-add-inv:hover` | `static/css/style.inventory.css:1259` | `PR8 dynamic DOM matching .btn-add-inv` in `static/js/render/petty-cash.js (runtime consumer):?` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `.inventory-content .tbl-wrap .inventory-stockout-actions .btn-out` | `static/css/style.inventory.css:297` | `PR8 dynamic DOM matching .btn-out` in `static/js/render/petty-cash.js (runtime consumer):?` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `.inventory-content .tbl-wrap .inventory-stockout-actions .btn-prepare` | `static/css/style.inventory.css:297` | `PR8 dynamic DOM matching .btn-prepare` in `static/js/render/petty-cash.js (runtime consumer):?` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `.prepared-page-header .btn-add-inv` | `static/css/style.inventory.css:1085` | `PR8 dynamic DOM matching .btn-add-inv` in `static/js/render/petty-cash.js (runtime consumer):?` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `.prepared-row-actions .btn-del` | `static/css/style.inventory.css:897` | `PR8 dynamic DOM matching .btn-del` in `static/js/render/petty-cash.js (runtime consumer):?` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `.prepared-row-actions .btn-del:hover` | `static/css/style.inventory.css:910` | `PR8 dynamic DOM matching .btn-del` in `static/js/render/petty-cash.js (runtime consumer):?` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `.prepared-row-actions .btn-out` | `static/css/style.inventory.css:897` | `PR8 dynamic DOM matching .btn-out` in `static/js/render/petty-cash.js (runtime consumer):?` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `.prepared-row-actions .btn-out:hover` | `static/css/style.inventory.css:904` | `PR8 dynamic DOM matching .btn-out` in `static/js/render/petty-cash.js (runtime consumer):?` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `.prepared-row-actions .btn-prepare` | `static/css/style.inventory.css:897` | `PR8 dynamic DOM matching .btn-prepare` in `static/js/render/petty-cash.js (runtime consumer):?` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `.prepared-row-actions .btn-prepare:hover` | `static/css/style.inventory.css:907` | `PR8 dynamic DOM matching .btn-prepare` in `static/js/render/petty-cash.js (runtime consumer):?` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `.qtyd-quick .btn-ghost` | `static/css/style.inventory.css:1326` | `PR8 dynamic DOM matching .btn-ghost` in `static/js/render/petty-cash.js (runtime consumer):?` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `#content.quotation-upload-content` | `static/css/style.quotation-upload.css:4` | `PR8 dynamic DOM matching #content` in `static/js/render/petty-cash.js (runtime consumer):?` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `#content.quotation-content` | `static/css/style.quotation.css:69` | `PR8 dynamic DOM matching #content` in `static/js/render/petty-cash.js (runtime consumer):?` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `.header` | `static/css/style.quotation.css:67` | `PR8 dynamic DOM matching .header` in `static/js/render/petty-cash.js (runtime consumer):?` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `.main` | `static/css/style.quotation.css:68` | `PR8 dynamic DOM matching .main` in `static/js/render/petty-cash.js (runtime consumer):?` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `.sidebar` | `static/css/style.quotation.css:67` | `PR8 dynamic DOM matching .sidebar` in `static/js/render/petty-cash.js (runtime consumer):?` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |
| `#content.dsr-content` | `static/css/style.signed-reports.css:4` | `PR8 dynamic DOM matching #content` in `static/js/render/petty-cash.js (runtime consumer):?` | CROSS-FEATURE IMPACT | Petty Cash desktop/mobile computed-style or visual smoke test |

**Protected CSS diff contract:** `git diff origin/master...HEAD -- static/css/style.petty-cash.css static/css/style.petty-cash-reports.css static/css/style.petty-cash-engineering.css` must be empty.

## Findings

### CSS-AUDIT-001

ID: CSS-AUDIT-001<br>
Severity: P1<br>
Category: LOAD ORDER DEPENDENCY<br>
Files: `static/index.html`, duplicate CSS definitions listed above<br>
Selectors: cross-file duplicate groups, especially generic components<br>
Owner: MIXED OWNERSHIP<br>
Consumers: feature DOM plus page-local settings/permissions DOM<br>
Evidence: stylesheet order and duplicate definitions are captured by the audit JSON<br>
Current Behavior: later stylesheets can win without a declared cascade contract<br>
Risk: changing a file can change another feature through source order<br>
Disposition: DEFER / CANONICALIZE in PR B or C<br>
Change Cone: only the duplicated selector/component and its proven consumers<br>
Regression Required: structural load-order check plus computed-style checks for affected components<br>
PR8 Impact: inspect every generic match and run Petty Cash regression; do not edit protected files<br>
Status: AUDIT FINDING<br>

### CSS-AUDIT-002

ID: CSS-AUDIT-002<br>
Severity: P1<br>
Category: SHARED OWNERSHIP LEAK<br>
Files: feature CSS files listed in the Ownership Map<br>
Selectors: `.btn*`, `.modal*`, `.card*`, `.table*`, `.form*`, `.tab*`, `.topbar`, and generic elements where reported<br>
Owner: UNKNOWN / MIXED OWNERSHIP until consumer review<br>
Consumers: HTML class inventory and dynamic JS consumers<br>
Evidence: ownership map includes definition line and known HTML consumers<br>
Current Behavior: feature files can define generic selectors used outside that feature<br>
Risk: feature isolation is not predictable<br>
Disposition: MANUAL REVIEW / CANONICALIZE<br>
Change Cone: one component family at a time<br>
Regression Required: desktop/mobile component contract and Petty Cash compatibility where applicable<br>
PR8 Impact: CROSS-FEATURE IMPACT must be labeled for matches<br>
Status: AUDIT FINDING<br>

### CSS-AUDIT-003

ID: CSS-AUDIT-003<br>
Severity: P2<br>
Category: INLINE STYLE OWNERSHIP<br>
Files: `static/settings.html`, `static/permissions.html`, other inline-style locations<br>
Selectors: `.topbar`, `.modal`, `.btn-*`, tables/forms, inline style attributes<br>
Owner: SETTINGS / PERMISSIONS / MIXED<br>
Consumers: standalone settings and permissions pages<br>
Evidence: inline `<style>` blocks occur after the core stylesheet<br>
Current Behavior: page-local rules intentionally override core rules by order<br>
Risk: core changes can silently alter standalone pages, or vice versa<br>
Disposition: MIGRATE / DEFER<br>
Change Cone: page-local styles only<br>
Regression Required: page desktop/mobile structural and computed-style checks<br>
PR8 Impact: run Petty Cash regression if selectors overlap protected DOM<br>
Status: AUDIT FINDING<br>

### CSS-AUDIT-004

ID: CSS-AUDIT-004<br>
Severity: P2<br>
Category: RESPONSIVE CONTRACT<br>
Files: all CSS files with breakpoint records<br>
Selectors: media-scoped selectors listed in the inventory<br>
Owner: feature owner where proven; otherwise MANUAL REVIEW<br>
Consumers: desktop/mobile markup and responsive DOM states<br>
Evidence: breakpoint inventory and media-context selector records<br>
Current Behavior: multiple breakpoint values and distributed overrides exist<br>
Risk: a mobile change can alter a desktop/mobile contract owned elsewhere<br>
Disposition: DEFER / MANUAL REVIEW<br>
Change Cone: one component and one owner<br>
Regression Required: desktop and mobile layout contract checks<br>
PR8 Impact: protected mobile behavior must remain unchanged<br>
Status: AUDIT FINDING<br>

### CSS-AUDIT-005

ID: CSS-AUDIT-005<br>
Severity: P2<br>
Category: SPECIFICITY GOVERNANCE<br>
Files: selectors listed in the Specificity Audit<br>
Selectors: ID selectors and records above the project target specificity budget<br>
Owner: source file owner; MIXED when duplicate definitions exist<br>
Consumers: matching DOM and JS hooks<br>
Evidence: computed specificity inventory with line numbers<br>
Current Behavior: high-specificity selectors and `!important` can mask ownership problems<br>
Risk: future rules require escalation instead of a canonical change<br>
Disposition: MANUAL REVIEW / MIGRATE<br>
Change Cone: one selector family with a regression before/after<br>
Regression Required: computed-style assertions and protected visual smoke test<br>
PR8 Impact: no protected-file edits; external matches require compatibility evidence<br>
Status: AUDIT FINDING<br>

## Proposed Architecture

```text
style.tokens.css       # color, spacing, radius, shadow, z-index, typography values
style.base.css         # reset, body, typography, form/element baseline
style.shell.css        # sidebar, header, navigation, main layout, notifications
style.components.css   # only components with multiple proven consumers
style.calendar.css
style.inventory.css
style.kit.css
style.stocktake.css
style.stockout.css
style.signed-reports.css
style.quotation.css
style.quotation-upload.css
style.petty-cash.css                 # PROTECTED
style.petty-cash-reports.css         # PROTECTED
style.petty-cash-engineering.css     # PROTECTED
```

Rules: shared components require at least two proven consumers; feature styles own feature-prefixed hooks; `@layer` is a later experiment only after ownership/load-order evidence; PR A does not add layers or rename DOM classes.

## Regression Baseline and Governance Contract

- Structural: stylesheet mounting, protected-file zero diff, load order, expected audit inputs, and generic selector ownership inventory.
- Computed style: `display`, `grid-template-columns`, `flex-direction`, `gap`, `padding`, `width`, `visibility`, `position`, `overflow`, `font-size`, `background`, and `color` for affected components.
- Visual: Desktop and Mobile smoke coverage for Inventory, Calendar, Kit, Stocktake, Stockout, Quotation, Signed Reports, Settings, Permissions, and Petty Cash.
- Protected guard: the regression test fails if any PR8 CSS file differs from `origin/master`.

## PR B / C / D / E Plan

- **PR B — Shared Ownership Cleanup:** canonicalize only confirmed multi-consumer generic components; preserve PR8; add computed-style regressions.
- **PR C — Feature Isolation:** migrate Calendar, Inventory, Kit, Stocktake, and Stockout selectors to feature ownership; no broad DOM rename.
- **PR D — Remaining Feature Isolation:** handle Quotation, Quotation Upload, Signed Reports, Settings, and Permissions; move inline styles only with page regression evidence.
- **PR E — Governance / CI:** Stylelint or equivalent checks, specificity budget, `!important` policy, duplicate selector reporting, protected guard, and visual regression execution.

## Manual Review Required

- Confirm product intent for any header/row/column layout where both CSS alternatives are valid but repository evidence does not identify the canonical visual design.
- Confirm whether page-local `.topbar`, `.modal`, `.btn-ghost`, and `.switch` rules are intentional page variants or should become shared components in PR B/D.
- Confirm whether any generic selector that matches Petty Cash DOM is behaviorally required by the protected feature; if fixing the protected file would be required, create `PR8-PROTECTED-FOLLOWUP-XXX` and do not modify it in this PR.

## PR A Scope / Out of Scope

- In scope: inventory, ownership evidence, duplicate classification inputs, load-order map, inline/JS hook audit, protected compatibility map, regression guard, and architecture proposal.
- Out of scope: production CSS rewrite, class rename, DOM restructure, breakpoint normalization, `!important` deletion, `@layer` rollout, stylesheet reordering, and any edit to PR8 CSS.

## Verification

- Generated by `scripts/audit_css_architecture.py`.
- Re-run: `python scripts/audit_css_architecture.py --root . --json-out docs/css-architecture-inventory.json --report-out docs/css-architecture-audit.md`.
- Tests: see PR description and final handoff; test counts must be refreshed after every later commit.
