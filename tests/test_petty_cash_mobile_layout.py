"""Regression guards for petty-cash layouts that intentionally change on mobile only."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BASE_CSS = (ROOT / "static/css/style.petty-cash.css").read_text(encoding="utf-8")
ENGINEERING_CSS = (ROOT / "static/css/style.petty-cash-engineering.css").read_text(encoding="utf-8")
EDITOR_JS = (ROOT / "static/js/modals/petty-cash.js").read_text(encoding="utf-8")
AMOUNT_HINT_JS = EDITOR_JS.split("function pcEntryAmountHint()", 1)[1].split("\n}", 1)[0]


def test_general_detail_kpis_use_two_by_two_only_on_mobile():
    """Keep the four-card general report summary in a mobile-only 2x2 grid."""
    mobile_block = BASE_CSS.rsplit("@media (max-width: 767px)", 1)[1]
    assert "#content .pc-general-detail-kpi .pc-kpi-row" in mobile_block
    assert "grid-template-columns: repeat(2, minmax(0, 1fr))" in mobile_block


def test_general_editor_item_amount_is_optional_at_every_breakpoint():
    """Keep desktop's five-column layout while showing the optional amount label on every device."""
    assert "grid-template-columns:minmax(0,3fr) minmax(4.5rem,1fr)" in BASE_CSS
    assert ".pc-item-amount-required { display: none; }" in BASE_CSS
    assert ".pc-item-amount-optional { display: inline; }" in BASE_CSS
    mobile_block = BASE_CSS.rsplit("@media (max-width: 767px)", 1)[1]
    assert "grid-template-areas: \"name name del\" \"qty unit amount\"" in mobile_block
    assert ".pc-item-row { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr)" in mobile_block


def test_mobile_editor_modals_and_engineering_fields_can_wrap():
    """Constrain mobile editor overlays and wrap engineering receipt controls without desktop changes."""
    base_mobile = BASE_CSS.rsplit("@media (max-width: 767px)", 1)[1]
    engineering_mobile = ENGINEERING_CSS.rsplit("@media (max-width: 767px)", 1)[1]
    assert "#pc-entry-overlay .pc-modal" in base_mobile
    assert "#pc-entry-overlay .pc-modal__ft > span" in base_mobile
    assert ".eng-editor .eng-group-head" in engineering_mobile
    assert "min-width:0" in engineering_mobile
    assert "flex-wrap:wrap" in engineering_mobile


def test_mobile_engineering_receipt_grid_stacks_and_body_scrolls():
    """Keep invoice fields separate and the scrollable body clear of the fixed footer on phones."""
    mobile_block = ENGINEERING_CSS.rsplit("@media (max-width: 767px)", 1)[1]
    assert "#eng-report-overlay .pc-modal { width:100%; height:calc(100dvh - 24px); max-height:calc(100dvh - 24px); }" in mobile_block
    assert "#eng-report-overlay .pc-modal__bd { flex:1 1 auto; min-height:0; overflow-y:auto; -webkit-overflow-scrolling:touch; }" in mobile_block
    assert ".eng-editor .eng-receipt-grid { grid-template-columns:minmax(0,1fr); }" in mobile_block


def test_unpriced_item_amount_hides_false_zero_mismatch_on_every_device():
    """Hide comparison until one detail has a price, independently of viewport width."""
    assert "window.matchMedia" not in AMOUNT_HINT_JS
    assert "const hasPricedItem = pcEntryItemDraft.some(it => Number(it.amount) > 0);" in AMOUNT_HINT_JS
    assert "if (!hasPricedItem)" in AMOUNT_HINT_JS
    assert "hint.textContent = '';" in AMOUNT_HINT_JS
