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
    globals = (ROOT / "static/js/globals.js").read_text(encoding="utf-8")
    assert "ITEMLESS_TABS" in globals
    assert "DATA_REFRESH_PRESERVE_MOUNT_TABS" in globals
    assert "'calendar', 'work-progress', 'signed-reports', 'quotation', 'petty-cash'" in globals
    inventory = (ROOT / "static/js/render/inventory.js").read_text(encoding="utf-8")
    assert "destinationsLoadedSite" in globals
    assert "destinationsLoadedSite !== currentSite" in inventory
    assert "stats: body.stats || null" in api
    assert "renderInventoryDashboard(list, aggregateStats)" in inventory
    assert "getInventoryDashboardStats" in inventory
    assert "INVENTORY_PENDING_ITEMS[id] = item" in inventory
    assert "const savedPendingItems" in inventory
    assert "keptItems" in api
    assert "async function loadInventoryAlertItems(type, requestId)" in inventory
    assert "include_alert_items: '1'" in inventory
    assert "await loadInventoryAlertItems(type, requestId)" in inventory
    switch_start = app.index("function switchTab")
    current_tab_assignment = app.index("  currentTab = tab;", switch_start)
    assert "closeInventoryStatusModal();" in app[switch_start:current_tab_assignment]


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



def test_photo_replace_updates_item_state_before_modal_render():
    source = (ROOT / "static/js/modals/photo.js").read_text(encoding="utf-8")
    state_update = source.index("const item = ALL_ITEMS.find(i => i.id === itemId);")
    modal_render = source.index("renderPhotoBox(itemId, true);")
    assert state_update < modal_render
    assert source.index("item.thumbnail_url = body.thumbnail_url", state_update) < modal_render
    assert source.index("item.preview_url = body.preview_url", state_update) < modal_render


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
    notif = (ROOT / "static/js/notifications.js").read_text(encoding="utf-8")
    assert "zero_items" in notif and "low_items" in notif
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
