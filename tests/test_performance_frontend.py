"""前端效能契約：圖片變體與 lazy rendering。"""

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_shared_photo_renderer_prefers_thumbnail_and_preview():
    source = (ROOT / "static/js/render/card.js").read_text(encoding="utf-8")
    assert "function photoSrc(id, variant)" in source
    assert "item.thumbnail_url" in source
    assert "item.preview_url" in source
    assert "loading=\"lazy\"" in source
    assert "decoding=\"async\"" in source


def test_inventory_and_document_lists_do_not_use_original_photo_url():
    for relative in (
        "static/js/render/inventory.js",
        "static/js/render/stocktake.js",
        "static/js/render/stockout.js",
        "static/js/render/prepared.js",
        "static/js/render/kits.js",
    ):
        source = (ROOT / relative).read_text(encoding="utf-8")
        assert "/uploads/" not in source, f"{relative} still directly loads legacy image URL"
        assert "photoSrc(" in source or "thumbnail_url" in source




def test_inventory_page_load_and_startup_skip_full_items():
    api = (ROOT / "static/js/api.js").read_text(encoding="utf-8")
    app = (ROOT / "static/js/app.js").read_text(encoding="utf-8")
    assert "async function loadInventoryPage(page)" in api
    assert "page_size" in api
    assert "/api/items/facets" in api
    assert "loadInventoryPage(1)" in app
    assert "['calendar', 'signed-reports', 'quotation']" in api
    globals = (ROOT / "static/js/globals.js").read_text(encoding="utf-8")
    inventory = (ROOT / "static/js/render/inventory.js").read_text(encoding="utf-8")
    assert "destinationsLoadedSite" in globals
    assert "destinationsLoadedSite !== currentSite" in inventory


def test_performance_stylesheet_is_mounted():
    index = (ROOT / "static/index.html").read_text(encoding="utf-8")
    css = (ROOT / "static/css/style.performance.css").read_text(encoding="utf-8")
    assert "/static/css/style.performance.css" in index
    assert ".inventory-pagination" in css


def test_photo_lightbox_uses_preview_variant():
    source = (ROOT / "static/js/modals/photo.js").read_text(encoding="utf-8")
    assert "photoSrc(itemId, 'preview')" in source
    assert "photoSrc(itemId, 'thumbnail')" in source
    assert "body.thumbnail_url" in source
    assert "body.preview_url" in source



def test_inventory_async_requests_are_site_safe_and_notifications_are_unpaged():
    api = (ROOT / "static/js/api.js").read_text(encoding="utf-8")
    app = (ROOT / "static/js/app.js").read_text(encoding="utf-8")
    globals_source = (ROOT / "static/js/globals.js").read_text(encoding="utf-8")
    inventory = (ROOT / "static/js/render/inventory.js").read_text(encoding="utf-8")
    assert "AbortController" in api
    assert "inventoryRequestSeq" in api
    assert "dataRequestSeq" in api
    assert "signal: controller.signal" in api
    assert "requestId !== inventoryRequestSeq" in api
    assert "ALERTS_BY_SITE" in globals_source
    assert "zero_items" in app and "low_items" in app
    assert "jsStr(loc)" in inventory
    assert "onclick=\\'toggleLoc" not in inventory



def test_inventory_facets_are_cached_between_page_requests():
    api = (ROOT / "static/js/api.js").read_text(encoding="utf-8")
    globals_source = (ROOT / "static/js/globals.js").read_text(encoding="utf-8")
    assert "inventoryFacetsLoadedSite" in api
    assert "inventoryFacetsLoadedSite" in globals_source
    assert "Promise.resolve(null)" in api


def test_inventory_items_state_is_not_orphaned():
    for relative in ("static/js/api.js", "static/js/app.js", "static/js/globals.js"):
        source = (ROOT / relative).read_text(encoding="utf-8")
        assert "INVENTORY_ITEMS" not in source, relative
