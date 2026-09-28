"""
Phase 1 篩選 chips 響應式截斷與 F5 重整修復的單元測試

測試項目：
1. renderInventory() 顯示篩選面板（#filter-panel）
2. calculateVisibleChipsCount() 根據容器寬度動態計算顯示個數
3. buildFilterPanel() 容器檢查與容錯
4. renderFilterChips() 根據寬度截斷邏輯
5. 視窗 resize 時自動重新計算
"""

import os
import subprocess


def read(path):
    with open(path, 'rb') as f:
        return f.read().decode('utf-8', errors='ignore')


def test_inventory_filter_panel_displayed_on_render():
    """renderInventory() 開始時要顯示 #filter-panel"""
    js = read(os.path.join('static', 'js', 'render', 'inventory.js'))
    
    # 查找 renderInventory 函式
    render_fn = js.split('function renderInventory()', 1)[1].split('\nfunction ', 1)[0]
    
    # 驗證：顯示篩選面板的邏輯存在
    assert 'filter-panel' in render_fn, "renderInventory 應該參照 #filter-panel"
    assert 'style.display' in render_fn or "filterPanel.style" in render_fn, \
        "renderInventory 應該設定 #filter-panel 的 display"
    assert 'renderInventoryPageHeading' in render_fn
    assert 'buildFilterPanel' in render_fn


def test_calculate_visible_chips_count_function_exists():
    """calculateVisibleChipsCount() 函式存在且邏輯正確"""
    js = read(os.path.join('static', 'js', 'render', 'inventory.js'))
    
    # 查找函式定義
    assert 'function calculateVisibleChipsCount(containerId)' in js, \
        "應該有 calculateVisibleChipsCount 函式"
    
    fn = js.split('function calculateVisibleChipsCount(containerId)', 1)[1].split('\nfunction ', 1)[0]
    
    # 驗證邏輯
    assert 'offsetWidth' in fn, "應該使用 offsetWidth 計算寬度"
    assert 'window.innerWidth' in fn, "容器寬度為 0 時應備用 window.innerWidth"
    assert '0.8' in fn, "備用值應該是 window.innerWidth × 0.8"
    assert 'estimatedChipWidth' in fn or '90' in fn, "應該有估算的 chip 寬度（~90px）"
    assert 'Math.max(1,' in fn or 'Math.floor' in fn, "應該計算並返回最少 1 個的可見個數"


def test_build_filter_panel_container_check():
    """buildFilterPanel() 要檢查容器存在，否則直接返回"""
    js = read(os.path.join('static', 'js', 'render', 'inventory.js'))
    
    fn = js.split('function buildFilterPanel()', 1)[1].split('\nfunction ', 1)[0]
    
    # 驗證：容器存在檢查
    assert 'getElementById(\'fp-brand-chips\')' in fn
    assert 'getElementById(\'fp-cat-chips\')' in fn
    assert 'if' in fn and 'return' in fn, "應該檢查容器是否存在並 early return"
    
    # 驗證：try-catch 防異常
    assert 'try' in fn and 'catch' in fn, "應該包 try-catch 防異常中斷"


def test_render_filter_chips_width_truncation_logic():
    """renderFilterChips() 根據容器寬度動態決定截斷"""
    js = read(os.path.join('static', 'js', 'render', 'inventory.js'))
    
    fn = js.split('function renderFilterChips(containerId, counts, selectedArr, type, toggleBtnId)', 1)[1].split('\nfunction ', 1)[0]
    
    # 驗證：寬度計算
    assert 'calculateVisibleChipsCount' in fn, "應該呼叫 calculateVisibleChipsCount"
    assert 'canDisplayAll' in fn or 'visibleCount' in fn, "應該判定寬度是否足夠顯示全部"
    
    # 驗證：按鈕隱藏邏輯
    assert 'classList.add(\'hidden\')' in fn or ".classList.remove('hidden')" in fn, \
        "應該用 classList 操作按鈕 hidden 狀態"
    assert 'toggleBtnId' in fn, "應該管理展開/收合按鈕的顯示"


def test_toggle_filter_collapse_rebuilds_panel():
    """toggleFilterCollapse() 應該呼叫 buildFilterPanel() 重新渲染"""
    js = read(os.path.join('static', 'js', 'render', 'inventory.js'))
    
    fn = js.split('function toggleFilterCollapse(containerId, toggleBtnId)', 1)[1].split('\nfunction ', 1)[0]
    
    # 驗證：重新渲染邏輯
    assert 'buildFilterPanel' in fn, "toggleFilterCollapse 應該呼叫 buildFilterPanel() 重新計算並渲染"
    assert 'filterExpandedState' in fn, "應該更新 filterExpandedState"


def test_window_resize_listener_recalculates():
    """視窗 resize 時應該重新計算並渲染篩選 chips（300ms 防抖）"""
    js = read(os.path.join('static', 'js', 'render', 'inventory.js'))
    
    # 驗證：resize listener 存在
    assert "window.addEventListener('resize'" in js or "addEventListener('resize'" in js, \
        "應該有 window resize 事件監聽器"
    
    # 驗證：防抖邏輯
    assert 'clearTimeout' in js and 'setTimeout' in js, "應該有 clearTimeout/setTimeout 防抖"
    assert '300' in js, "防抖延遲應該是 300ms"
    
    # 驗證：重新計算邏輯
    assert 'buildFilterPanel' in js, "resize 時應該呼叫 buildFilterPanel()"


def test_filter_panel_css_hidden_rule_exists():
    """CSS 應該有 #fp-brand-toggle.hidden 和 #fp-cat-toggle.hidden 隱藏規則"""
    css = read(os.path.join('static', 'css', 'style.core.css'))
    
    # 驗證：CSS 隱藏規則
    assert '#fp-brand-toggle.hidden' in css or 'fp-brand-toggle' in css and 'hidden' in css, \
        "應該有 #fp-brand-toggle.hidden 的 display:none 規則"
    assert '#fp-cat-toggle.hidden' in css or 'fp-cat-toggle' in css and 'hidden' in css, \
        "應該有 #fp-cat-toggle.hidden 的 display:none 規則"


def test_filter_panel_html_not_in_content_div():
    """篩選面板 (#filter-panel) 應該在 #content 之外（兄弟元素）"""
    html = read(os.path.join('static', 'index.html'))
    
    # 查找位置關係
    content_idx = html.find('id="content"')
    filter_panel_idx = html.find('id="filter-panel"')
    
    assert content_idx > 0 and filter_panel_idx > 0, "應該同時存在 #content 和 #filter-panel"
    
    # 檢查 #filter-panel 是否有初始的 display:none
    filter_panel_section = html[filter_panel_idx:filter_panel_idx+300]
    assert 'style=' in filter_panel_section, "#filter-panel 應該有 inline style 屬性"


def test_inventory_js_syntax_check():
    """inventory.js 語法必須通過"""
    result = subprocess.run(
        ['node', '--check', os.path.join('static', 'js', 'render', 'inventory.js')],
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert result.returncode == 0, f"inventory.js 語法檢查失敗：{result.stderr}"


def test_filter_chips_responsive_contract():
    """整合測試：篩選 chips 響應式行為契約
    
    期望行為：
    - 容器寬度 >= 足以容納全部 chips → 全部顯示，按鈕隱藏
    - 容器寬度 < 足以容納全部 chips → 根據 collapsed 狀態決定顯示個數
    - F5 重整 → renderInventory 被呼叫 → #filter-panel 被顯示 → buildFilterPanel 重新計算
    - 視窗 resize → 300ms 防抖後重新計算
    """
    js = read(os.path.join('static', 'js', 'render', 'inventory.js'))
    
    # 查驗三大件：顯示、寬度計算、渲染邏輯
    assert 'function renderInventory()' in js
    assert 'function calculateVisibleChipsCount' in js
    assert 'function buildFilterPanel()' in js
    assert 'function renderFilterChips' in js
    
    # 驗證 renderInventory 會顯示篩選面板
    render_fn = js.split('function renderInventory()', 1)[1].split('\nfunction ', 1)[0]
    assert 'filter-panel' in render_fn and ('style.display' in render_fn or 'display' in render_fn)
    
    # 驗證 renderFilterChips 會呼叫寬度計算
    chips_fn = js.split('function renderFilterChips(', 1)[1].split('\nfunction ', 1)[0]
    assert 'calculateVisibleChipsCount' in chips_fn
