# -*- coding: utf-8 -*-
"""CSS 架構靜態規則（docs/CSS架構重構設計.md §6.3）。

規則隨重構階段逐步啟用；每條規則都是為了避免「改 A 頁、B 頁跟著壞」再發生。
"""
import json
import os
import re

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CSS_DIR = os.path.join(ROOT, "static", "css")
HTML_PAGES = ("index.html", "settings.html", "permissions.html", "login.html")
LAYER_ORDER = ("tokens", "base", "layout", "components", "pages", "utilities")
# 目錄 → 允許的 layer
DIR_LAYERS = {
    "0-tokens": {"tokens"},
    "1-base": {"base"},
    "2-layout": {"layout"},
    "3-components": {"components"},
    "4-pages": {"pages"},
    "5-utilities": {"utilities"},
}
# 斷點白名單（P8 收斂為 639 / 767 / 959 三個；1200 / 1440 只給頁面做桌機寬度微調，390 為小尺寸手機例外）
MEDIA_WHITELIST = {
    "print",
    "(max-width: 390px)", "(max-width: 639px)", "(max-width: 767px)",
    "(max-width: 1200px)", "(max-width: 1440px)",
    "(min-width: 640px)", "(min-width: 768px)", "(min-width: 960px)",
}
# 頁面規則的範圍例外：login.css 只由 login.html 載入，其 * reset 需要涵蓋 html
PAGE_SCOPE_EXCEPTIONS = {("4-pages/login.css", "*")}


def _css_files():
    """static/css 下所有 .css 的相對路徑。"""
    out = []
    for base, _dirs, files in os.walk(CSS_DIR):
        for name in files:
            if name.endswith(".css"):
                out.append(os.path.relpath(os.path.join(base, name), CSS_DIR).replace(os.sep, "/"))
    return sorted(out)


def _read(rel):
    with open(os.path.join(CSS_DIR, rel), encoding="utf-8") as fh:
        return fh.read()


def _top_level_statements(css):
    """去掉註解後，回傳最外層的 at-rule / 規則開頭（'{' 或 ';' 之前的文字）。"""
    css = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
    depth, buf, out = 0, "", []
    for ch in css:
        if depth == 0 and ch in "{;":
            out.append(buf.strip())
            buf = ""
        elif depth == 0:
            buf += ch
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
    assert depth == 0, "大括號不成對"
    assert not buf.strip(), f"檔尾有未結束的內容：{buf.strip()[:60]}"
    return out


def test_css_files_live_in_known_directories():
    """所有 CSS 都在分層目錄內（不再有 static/css/style.*.css 平鋪檔）。"""
    for rel in _css_files():
        assert rel.split("/")[0] in DIR_LAYERS, f"{rel} 不在分層目錄內"


@pytest.mark.parametrize("rel", _css_files())
def test_every_css_file_is_wrapped_in_its_layer(rel):
    """每支 CSS 最外層只能是所屬目錄允許的 @layer（未分層的樣式會勝過所有 layer，破壞分層）。"""
    statements = _top_level_statements(_read(rel))
    if rel == "0-tokens/tokens.css":
        assert statements[0] == "@layer " + ", ".join(LAYER_ORDER), "tokens.css 第一行必須宣告完整 layer 順序"
        statements = statements[1:]
    allowed = DIR_LAYERS[rel.split("/")[0]]
    for stmt in statements:
        m = re.fullmatch(r"@layer\s+([\w-]+)", stmt)
        assert m, f"{rel} 最外層出現未分層內容：{stmt[:80]}"
        assert m.group(1) in allowed, f"{rel} 不可使用 @layer {m.group(1)}（允許：{sorted(allowed)}）"


def test_html_pages_have_no_inline_style_blocks():
    """HTML 不得內嵌 <style>：內嵌樣式不在任何 layer，會蓋過全部分層樣式。"""
    for page in HTML_PAGES:
        with open(os.path.join(ROOT, "static", page), encoding="utf-8") as fh:
            assert "<style" not in fh.read(), f"{page} 仍有 <style>，請搬到 css/4-pages/"


def test_every_css_file_is_loaded_by_some_page():
    """每支 CSS 至少被一個 HTML 載入（避免搬移後留下沒人用的檔案）。"""
    html = ""
    for page in HTML_PAGES:
        with open(os.path.join(ROOT, "static", page), encoding="utf-8") as fh:
            html += fh.read()
    for rel in _css_files():
        assert f'href="/static/css/{rel}"' in html, f"{rel} 沒有任何頁面載入"


def _style_rules(css):
    """回傳 [(media_stack, selector_text, body)]，走訪 @layer / @media 巢狀區塊。"""
    css = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
    out = []

    def walk(text, media):
        i, n = 0, len(text)
        while i < n:
            j = text.find("{", i)
            if j < 0:
                return
            head = text[i:j].strip()
            depth, k = 0, j
            while True:
                depth += {"{": 1, "}": -1}.get(text[k], 0)
                if depth == 0:
                    break
                k += 1
            inner = text[j + 1:k]
            if head.startswith("@media"):
                walk(inner, media + [head[len("@media"):].strip()])
            elif head.startswith("@layer") or head.startswith("@supports"):
                walk(inner, media)
            elif not head.startswith("@"):
                out.append((media, head, inner))
            i = k + 1

    walk(css, [])
    return out


def _split_selectors(text):
    parts, depth, buf = [], 0, ""
    for ch in text:
        depth += {"(": 1, "[": 1, ")": -1, "]": -1}.get(ch, 0)
        if ch == "," and depth == 0:
            parts.append(buf.strip())
            buf = ""
        else:
            buf += ch
    return parts + ([buf.strip()] if buf.strip() else [])


def test_no_legacy_layer_left():
    """重構過渡層 legacy 已清空：不得再有 legacy 目錄或 @layer legacy。"""
    assert not os.path.exists(os.path.join(CSS_DIR, "legacy"))
    for rel in _css_files():
        assert "@layer legacy" not in _read(rel), f"{rel} 仍有 @layer legacy"


@pytest.mark.parametrize("rel", [r for r in _css_files() if r.startswith("4-pages/")])
def test_page_rules_are_scoped_by_data_page(rel):
    """頁面檔的每個選擇器都必須以 [data-page] 限定範圍，modal 也不例外（改 A 頁不會影響 B 頁的根本保證）。"""
    scoped = re.compile(r'^(body)?(\[data-page="[\w-]+"\]|:is\(\[data-page="[\w-]+"\](,\[data-page="[\w-]+"\])*\))')
    for _media, selector, _body in _style_rules(_read(rel)):
        for part in _split_selectors(selector):
            if (rel, part) in PAGE_SCOPE_EXCEPTIONS:
                continue
            assert scoped.match(part), f"{rel} 的選擇器未限定頁面範圍：{part}"


@pytest.mark.parametrize("rel", _css_files())
def test_no_important(rel):
    """禁止 !important：優先順序由 layer 決定，需要更高優先權時提高選擇器特異度。"""
    assert "!important" not in re.sub(r"/\*.*?\*/", "", _read(rel), flags=re.S), f"{rel} 使用了 !important"


@pytest.mark.parametrize("rel", _css_files())
def test_media_queries_use_whitelisted_breakpoints(rel):
    """斷點只能用白名單內的寫法（同一斷點不同寫法會讓規則散落、難以預測）。"""
    for media in re.findall(r"@media\s+([^{]+)\{", re.sub(r"/\*.*?\*/", "", _read(rel), flags=re.S)):
        assert media.strip() in MEDIA_WHITELIST, f"{rel} 使用非白名單斷點：{media.strip()}"


def test_html_inline_styles_only_toggle_visibility():
    """HTML 的 style="" 只允許 display:none（JS 以 el.style.display 切換顯示）；
    其他靜態排版一律用 5-utilities/utilities.css 的 class，否則 inline 會蓋過所有分層樣式。"""
    for page in HTML_PAGES:
        with open(os.path.join(ROOT, "static", page), encoding="utf-8") as fh:
            for style in re.findall(r'\sstyle="([^"]*)"', fh.read()):
                assert style.replace(" ", "").rstrip(";") == "display:none", f"{page} 有靜態 inline style：{style}"


LEGACY_STATE_CLASSES = ("active", "open", "show", "on", "off", "collapsed", "expanded", "changed")


@pytest.mark.parametrize("rel", _css_files())
def test_state_classes_use_is_prefix(rel):
    """狀態一律用 is-*（.is-active / .is-open / .is-collapsed …），不得再出現 .active / .open / .show / .on 等舊寫法
    （P7 統一；.open 與 .show 已合併為 .is-open，.on 併入 .is-active）。"""
    pattern = re.compile(r"\.(" + "|".join(LEGACY_STATE_CLASSES) + r")(?![\w-])")
    for _media, selector, _body in _style_rules(_read(rel)):
        assert not pattern.search(selector), f"{rel} 使用舊狀態 class：{selector}"


# ---------- P7.5 設計系統：按鈕 / chip 外觀只有一個來源 ----------
COMPONENT_OWNERS = {"3-components/button.css", "3-components/chip.css"}
APPEARANCE_PROP = re.compile(
    r"^(background(-color)?|border(-(top|right|bottom|left))?(-(color|width|style))?|border-radius|color|"
    r"font-size|font-weight|padding(-(top|right|bottom|left))?|height|min-height|box-shadow)$"
)
# 不屬於 .btn / .chip 的專用控制項：與瀏覽器測試共用 tests/button_contract.json（單一來源，避免兩份清單各自漂移）
with open(os.path.join(ROOT, "tests", "button_contract.json"), encoding="utf-8") as _fh:
    NON_STANDARD_BUTTON_CLASSES = set(json.load(_fh)["specialized_button_classes"])
# 沒有 class 的 <button>：下拉選單項目、照片圖卡、燈箱上一張 / 下一張（各檔數量固定，新增按鈕必須套標準 class）
UNCLASSED_BUTTONS = {"js/render/inventory.js": 2, "js/render/petty-cash.js": 1, "js/render/work-progress.js": 5}


def _markup_sources():
    base = os.path.join(ROOT, "static")
    for dirpath, _dirs, files in os.walk(base):
        for name in files:
            if name.endswith((".js", ".html")):
                path = os.path.join(dirpath, name)
                with open(path, encoding="utf-8") as fh:
                    yield os.path.relpath(path, base).replace(os.sep, "/"), fh.read()


def _static_tokens(value):
    """class 字串去掉 JS 內插（${...} 與 ' + ... + '）後的 token。"""
    return set(re.sub(r"\$\{.*?\}|' \+ .*? \+ '", " ", value).split())


def _button_hook_classes():
    """和 .btn / .chip 一起出現在標記上的舊 class（現在只當 JS / 排版掛鉤）。"""
    hooks = set()
    for _rel, text in _markup_sources():
        for match in re.finditer(r"class(?:Name)?\s*=\s*([\"'])(.*?)\1", text):
            tokens = _static_tokens(match.group(2))
            if tokens & {"btn", "chip"}:
                hooks |= {t for t in tokens if re.match(r"^[a-z][\w-]*$", t) and not re.match(r"^(btn|chip)(--|$)|^is-|^u-", t)}
    return hooks


def _subject(selector):
    selector = re.sub(r":not\((?:[^()]|\([^()]*\))*\)", "", selector)
    return re.split(r"\s*[>+~]\s*|\s+", selector.strip())[-1]


@pytest.mark.parametrize("rel", [r for r in _css_files() if r not in COMPONENT_OWNERS])
def test_button_appearance_only_in_button_and_chip_css(rel):
    """按鈕與 chip 的外觀（顏色、框線、圓角、字級、高度、內距）只能由 button.css / chip.css 定義；
    頁面 CSS 對按鈕只能調位置與寬度。這樣改一個按鈕樣式，全站同步，不會 A 頁改了 B 頁沒改。"""
    hooks = _button_hook_classes()
    target = re.compile(r"\.(btn|chip)(--[\w-]+)?(?![\w-])|\.(" + "|".join(map(re.escape, sorted(hooks))) + r")(?![\w-])")
    for _media, selector, body in _style_rules(_read(rel)):
        for part in _split_selectors(selector):
            subject = _subject(part)
            if "::" in subject or not target.search(subject):
                continue
            props = [d.split(":", 1)[0].strip().lower() for d in body.split(";") if ":" in d]
            bad = [p for p in props if APPEARANCE_PROP.match(p)]
            assert not bad, f"{rel} 的 {part} 改了按鈕外觀 {bad}；請改用 .btn / .chip 的變體"


def test_every_button_uses_the_standard_classes():
    """新按鈕一律套 .btn（動作）或 .chip（選取 / 篩選 / 頁籤）；專用控制項需列入 NON_STANDARD_BUTTON_CLASSES。"""
    unclassed = {}
    for rel, text in _markup_sources():
        for match in re.finditer(r"<button\b((?:[^>`]|`[^`]*`|\$\{[^}]*\})*)>", text):
            cls = re.search(r"class=([\"'])(.*?)\1", match.group(1))
            if not cls:
                unclassed[rel] = unclassed.get(rel, 0) + 1
                continue
            tokens = _static_tokens(cls.group(2))
            if not tokens:  # 只有動態 class（如選單項目的危險色）
                unclassed[rel] = unclassed.get(rel, 0) + 1
                continue
            if tokens & {"btn", "chip"} or tokens & NON_STANDARD_BUTTON_CLASSES:
                continue
            raise AssertionError(f"{rel} 的按鈕沒有套 .btn / .chip：class=\"{cls.group(2)}\"")
    assert unclassed == UNCLASSED_BUTTONS, f"沒有 class 的按鈕數量改變：{unclassed}"


def test_specialized_button_list_has_no_stale_entries():
    """tests/button_contract.json 的每個專用控制項 class 都必須還有 <button> 在用（清單只能反映現況）。"""
    used = set()
    for _rel, text in _markup_sources():
        for match in re.finditer(r"<button\b((?:[^>`]|`[^`]*`|\$\{[^}]*\})*)>", text):
            cls = re.search(r"class=([\"'])(.*?)\1", match.group(1))
            if cls:
                used |= _static_tokens(cls.group(2))
    stale = sorted(NON_STANDARD_BUTTON_CLASSES - used)
    assert not stale, f"button_contract.json 有已不存在的專用控制項：{stale}"


# ---------- P8：數值一律走 token ----------
TOKEN_FILE = "0-tokens/tokens.css"


def _declarations(rel):
    for media, selector, body in _style_rules(_read(rel)):
        for decl in body.split(";"):
            if ":" in decl:
                prop, value = decl.split(":", 1)
                yield selector, prop.strip().lower(), value.strip()


@pytest.mark.parametrize("rel", [r for r in _css_files() if r != TOKEN_FILE])
def test_colors_come_from_tokens(rel):
    """色碼只能寫在 tokens.css；其他檔用 var(--c-*)，換色只改一處。"""
    for selector, prop, value in _declarations(rel):
        assert not re.search(r"#[0-9a-fA-F]{3,8}\b", value), f"{rel} 的 {selector} {prop} 寫死色碼：{value}"


@pytest.mark.parametrize("rel", [r for r in _css_files() if r != TOKEN_FILE])
def test_font_sizes_weights_radii_use_tokens(rel):
    """字級（40px 以上的圖示除外）、字重、圓角（3px 以下細線除外）只能用 token。"""
    for selector, prop, value in _declarations(rel):
        if prop == "font-size":
            if "clamp(" in value:  # 隨螢幕寬度縮放的流體字級
                continue
            for px in re.findall(r"(?<![\w.-])([\d.]+)px", value):
                assert float(px) >= 40, f"{rel} 的 {selector} 字級寫死 {px}px，請用 var(--fs-*)"
        elif prop == "font-weight":
            assert value.startswith("var(--fw-") or value in ("inherit", "normal", "bold"), (
                f"{rel} 的 {selector} 字重寫死 {value}，請用 var(--fw-*)"
            )
        elif re.match(r"border(-(top|bottom)-(left|right))?-radius$", prop):
            for px in re.findall(r"(?<![\w.-])([\d.]+)px", value):
                assert float(px) <= 3, f"{rel} 的 {selector} 圓角寫死 {px}px，請用 var(--r-*)"


@pytest.mark.parametrize("rel", [r for r in _css_files() if r != TOKEN_FILE])
def test_stacking_levels_use_tokens(rel):
    """z-index 20 以上代表跨元件的疊層順序，只能用 var(--z-*)（元件內部 0–10 的小堆疊可直接寫）。"""
    for selector, prop, value in _declarations(rel):
        if prop == "z-index" and value.isdigit():
            assert int(value) < 20, f"{rel} 的 {selector} z-index 寫死 {value}，請用 var(--z-*)"


def test_every_used_token_is_defined():
    """用到的 var(--*) 都必須在 tokens.css 定義（打錯字會讓樣式靜默失效）。"""
    defined = set(re.findall(r"(--[\w-]+)\s*:", _read(TOKEN_FILE)))
    for rel in _css_files():
        text = re.sub(r"/\*.*?\*/", "", _read(rel), flags=re.S)
        local = set(re.findall(r"(--[\w-]+)\s*:", text))
        for name in set(re.findall(r"var\((--[\w-]+)", text)):
            assert name in defined or name in local, f"{rel} 使用未定義的 {name}"


# --fs-9 是唯一低於 11px 的字級，只為手機月曆格高密度顯示存在（4–6 字客戶名兩行內完整顯示）
FS9_FILE = "4-pages/calendar.css"
FS9_MEDIA = "(max-width: 767px)"
FS9_SELECTORS = {
    '[data-page="calendar"] .cal-evt',
    '[data-page="calendar"] .cal-evt .cal-evt-time',
    '[data-page="calendar"] .cal-evt .cal-evt-body',
}


def _fs9_violations(rel, css):
    """回傳違反「--fs-9 只能用於手機月曆事件格」的規則。"""
    bad = []
    for media, selector, body in _style_rules(css):
        if "var(--fs-9)" not in body:
            continue
        where = f"{rel} {' '.join(media)} {selector}"
        if rel != FS9_FILE:
            bad.append(f"{where}：--fs-9 只能用在 {FS9_FILE}")
        elif media != [FS9_MEDIA]:
            bad.append(f"{where}：--fs-9 只能用在 @media {FS9_MEDIA}")
        else:
            outside = [s.strip() for s in selector.split(",") if " ".join(s.split()) not in FS9_SELECTORS]
            if outside:
                bad.append(f"{where}：--fs-9 只能用於月曆事件格 {sorted(FS9_SELECTORS)}")
    return bad


@pytest.mark.parametrize("rel,css", [
    ("4-pages/inventory.css", '[data-page="inventory"] .qty { font-size: var(--fs-9); }'),
    (FS9_FILE, '[data-page="calendar"] .cal-evt { font-size: var(--fs-9); }'),
    (FS9_FILE, '@media (min-width: 768px) { [data-page="calendar"] .cal-evt { font-size: var(--fs-9); } }'),
    (FS9_FILE, '@media (max-width: 767px) { [data-page="calendar"] .cal-page-subtitle { font-size: var(--fs-9); } }'),
    (FS9_FILE, '@media (max-width: 767px) { [data-page="calendar"] .cal-evt, .cal-title { font-size: var(--fs-9); } }'),
])
def test_fs9_guard_rejects_other_uses(rel, css):
    """守衛本身要擋下：其他檔案、非手機、月曆頁其他元素、夾帶其他 selector。"""
    assert _fs9_violations(rel, css), css


def test_fs9_is_calendar_mobile_only():
    """--fs-9 只能用於手機版（≤767px）月曆事件格；其他地方的小字請用 --fs-11 以上。"""
    bad = [v for rel in _css_files() if rel != TOKEN_FILE for v in _fs9_violations(rel, _read(rel))]
    assert not bad, "\n".join(bad)
    assert _fs9_violations(FS9_FILE, '@media (max-width: 767px) { [data-page="calendar"] .cal-evt .cal-evt-body { font-size: var(--fs-9); } }') == []


# ---------- utility 命名：名稱描述語意，不寫原始色碼 / 舊數值 ----------
UTILITIES = "5-utilities/utilities.css"
TOKEN_UTILITY_PREFIX = {"c": ("u-text-", "u-bg-"), "fs": ("u-fs-",), "r": ("u-r-",)}


def _utility_rules():
    for _media, selector, body in _style_rules(_read(UTILITIES)):
        for part in _split_selectors(selector):
            yield part.lstrip("."), body


def test_token_utilities_are_named_after_their_token():
    """用到 token 的 utility，名稱必須就是 token 名稱（.u-text-muted ↔ --c-muted、.u-r-md ↔ --r-md）。
    禁止 .u-c-2563eb 這類以歷史色碼命名的 class——token 改值後名稱就會說謊。"""
    for name, body in _utility_rules():
        for kind, token in re.findall(r"var\(--(c|fs|r)-([\w-]+)\)", body):
            expected = [prefix + token for prefix in TOKEN_UTILITY_PREFIX[kind]]
            if token.startswith("text-"):  # --c-text-subtle → .u-text-subtle
                expected.append("u-" + token)
            assert name in expected, f".{name} 使用 --{kind}-{token}，名稱應為 {' 或 '.join('.' + e for e in expected)}"


def test_color_utilities_have_no_hex_like_names():
    """顏色 / 背景 utility 名稱不得含色碼片段（例如 u-c-666、u-bg-f9fafb）。"""
    for name, body in _utility_rules():
        if re.search(r"(^|;)\s*(color|background(-color)?)\s*:", body):
            assert not re.search(r"-(?=[0-9a-f]*[0-9])(?:[0-9a-f]{3}|[0-9a-f]{6})$", name), f".{name} 以色碼命名"


def test_every_utility_is_used():
    """utility 沒有任何標記使用就刪掉（避免取代後殘留死碼）。"""
    markup = "".join(text for _rel, text in _markup_sources())
    for name, _body in _utility_rules():
        assert re.search(r"(?<![\w-])" + re.escape(name) + r"(?![\w-])", markup), f".{name} 沒有任何 HTML / JS 使用"


# ---------- JS 產生的畫面：外觀一律交給 CSS class + token ----------
# 使用者自訂的行事曆人員顏色屬於資料（存在資料庫），不是設計色票
JS_COLOR_DATA = {"js/globals.js": ("var CAL_PALETTE = [",)}
JS_RUNTIME_STYLE_PROPS = {"display", "width", "position", "top", "left", "right", "zIndex"}  # 顯示切換、進度條、下拉定位
# 只能用 setProperty 設定、且屬於「執行期版面狀態」的 CSS 變數；不可用 "--" 前綴整批放行，否則等於繞過 token
JS_RUNTIME_CUSTOM_PROPERTIES = {"--cal-week-count"}  # 月曆每月 4 / 5 / 6 週的列數


def _js_sources():
    return [(rel, text) for rel, text in _markup_sources() if rel.endswith(".js")]


def test_js_has_no_hardcoded_colors():
    """static/js 不得寫死色碼：畫面顏色用 CSS class（token），只有行事曆人員調色盤這類「資料」例外。"""
    color = re.compile(r"(?<![\w-])#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b(?![\w-])")
    for rel, text in _js_sources():
        for lineno, line in enumerate(text.splitlines(), start=1):
            if any(line.lstrip().startswith(prefix) for prefix in JS_COLOR_DATA.get(rel, ())):
                continue
            code = re.sub(r"(querySelector(All)?|getElementById|closest|matches)\([^)]*\)", "", line)
            for match in color.finditer(code):
                before = code[max(0, match.start() - 1):match.start()]
                if before in ("'", '"', ":", " ", "(", ",") and not re.match(r"#[a-z]+-", code[match.start():]):
                    raise AssertionError(f"{rel}:{lineno} 寫死色碼 {match.group(0)}")


def _js_style_violations(text):
    """回傳 JS 以 inline style 寫外觀的地方；每一種能寫 style 的入口都要檢查，不能只看 el.style.x = 。"""
    bad = []
    if "style.cssText" in text:
        bad.append("style.cssText，請改用 class")
    for prop in re.findall(r"\.style\.([a-zA-Z]+)\s*\+?=(?!=)", text):
        if prop not in JS_RUNTIME_STYLE_PROPS:
            bad.append(f"style.{prop}，請改用 class")
    if re.search(r"\.style\s*=(?!=)", text):
        bad.append("整個指派 el.style = ...（等同 cssText），請改用 class")
    if re.search(r"\.style\s*\[", text):
        bad.append("style[...] 中括號寫法（會繞過屬性檢查），請改用 class 或 el.style.<允許的屬性>")
    if re.search(r"setAttribute\(\s*['\"`]style['\"`]", text):
        bad.append("setAttribute('style', ...)，請改用 class")
    if re.search(r"Object\.assign\(\s*[\w$.\[\]]*\bstyle\b", text):
        bad.append("Object.assign(el.style, ...)，請改用 class")
    for call in re.finditer(r"\.style\.setProperty\(\s*(?:(['\"`])(.*?)\1)?", text):
        name = call.group(2)
        if name is None:
            bad.append("style.setProperty 的屬性名稱必須是字串常值，才能檢查")
        elif name not in JS_RUNTIME_CUSTOM_PROPERTIES:
            bad.append(f"style.setProperty('{name}')，不在執行期 CSS 變數白名單")
    for match in re.finditer(r"style=\\?([\"'])(.*?)\\?\1", text):
        static = re.sub(r"\$\{.*?\}|' \+ .*? \+ '", "", match.group(2))
        for decl in filter(None, (d.strip() for d in static.split(";"))):
            prop, _, value = decl.partition(":")
            if prop.strip() == "display" and value.strip() == "none":
                continue
            if value.strip():
                bad.append(f"inline style 寫死外觀：{match.group(2)[:80]}")
    return bad


@pytest.mark.parametrize("snippet", [
    "el.style.setProperty('color', '#ff0000');",
    "el.style.setProperty('--button-color', '#f00');",
    "el.style.setProperty(name, value);",
    "el.setAttribute('style', 'color:red');",
    "el.style['fontSize'] = '13px';",
    'el.style["color"] = "red";',
    "Object.assign(el.style, { color: 'red' });",
    "el.style = 'color:red';",
    "el.style.fontSize = '13px';",
    "el.style.cssText = 'color:red';",
    '<div style="color:red">',
])
def test_js_style_guard_rejects_appearance_bypasses(snippet):
    """守衛本身要攔得到所有寫 inline 外觀的入口。"""
    assert _js_style_violations(snippet), snippet


@pytest.mark.parametrize("snippet", [
    "grid.style.setProperty('--cal-week-count', String(weeks));",
    "el.style.display = 'none';",
    "bar.style.width = pct + '%';",
    "if (el.style.display === 'none') show();",
    '<div style="display:none">',
    '<span style="background:${esc(color)}">',
])
def test_js_style_guard_allows_runtime_state(snippet):
    assert not _js_style_violations(snippet), snippet


def test_js_inline_styles_only_carry_runtime_state():
    """JS 只能用 inline style 放執行期狀態（顯示切換、進度條寬度、下拉定位、月曆週數）或資料值；
    字級、顏色、間距、圓角等外觀寫在 CSS，否則會蓋過分層樣式、讓手機版規則失效。"""
    for rel, text in _js_sources():
        assert not _js_style_violations(text), f"{rel}：" + "；".join(_js_style_violations(text))


# ── JS 行為掛鉤不得依賴樣式 class（issue #39 第 3 項）──
# 按鈕 / chip / utility 的 class 會依 CSS 規範改名；JS 若用它們找元素，改 class 後功能會默默失效。
# JS 找元素請用 id、data-role（元素群組）或 data-action（使用者動作），見 docs/CSS架構重構設計.md §4.3。
JS_LOOKUP_CALL = re.compile(
    r"\b(querySelectorAll|querySelector|closest|matches|getElementsByClassName)\(\s*(['\"`])((?:\\.|(?!\2).)*)\2", re.S)
STYLE_CLASS_NAME = re.compile(r"^(?:btn|chip)(?:-[\w-]*)?$|^[\w-]+-chip(?:-[\w-]*)?$|^u-[\w-]+$")


def _style_class_lookups(text):
    """回傳 JS 用樣式 class（.btn / .btn-* / .chip* / .xxx-chip / .u-*）找元素的呼叫。"""
    bad = []
    for match in JS_LOOKUP_CALL.finditer(text):
        api, selector = match.group(1), match.group(3)
        static = re.sub(r"\$\{[^}]*\}", " ", selector)
        static = re.sub(r"\[[^\]]*\]", " ", static)  # data-role="u-..." 這類屬性值不是 class
        if api == "getElementsByClassName":
            names = static.split()
        else:
            names = re.findall(r"\.(-?[_a-zA-Z][\w-]*)", static)
        bad += [f"{api}('{selector}') 使用樣式 class .{name}" for name in names if STYLE_CLASS_NAME.match(name)]
    return bad


@pytest.mark.parametrize("snippet", [
    "document.querySelector('#kit-modal .btn-confirm')",
    'document.querySelector("#expiry-modal .btn-save")',
    "document.querySelectorAll('#settingsChipBar .chip')",
    "document.querySelectorAll('.pc-chip')[3]",
    "tr.querySelector('.u-ci-to')",
    "btn.closest('.btn')",
    "el.matches('.chip--seg.is-active')",
    "document.getElementsByClassName('btn btn--primary')",
    "root.querySelector(`#${id} .btn--secondary`)",
])
def test_style_class_lookup_guard_rejects_style_hooks(snippet):
    """守衛本身要攔得到每一種找元素 API 搭配樣式 class 的寫法。"""
    assert _style_class_lookups(snippet), snippet


@pytest.mark.parametrize("snippet", [
    "document.getElementById('kit-submit')",
    "document.querySelectorAll('[data-role=\"pc-range\"]')",
    "tr.querySelector('[data-role=\"unit-consolidate-to\"]')",
    "document.querySelectorAll('#settingsChipBar [data-panel]')",
    "btn.closest('.stock-row')",
    "document.querySelector('#kit-modal h3')",
    "el.classList.contains('btn-confirm')",
    "document.querySelector(`[data-action=\"${action}\"]`)",
])
def test_style_class_lookup_guard_allows_semantic_hooks(snippet):
    assert not _style_class_lookups(snippet), snippet


def test_js_does_not_find_elements_by_style_classes():
    """static/js 與 HTML 內嵌 script 不得用樣式 class 找元素；改用 id / data-role / data-action。"""
    bad = [f"{rel}：{item}" for rel, text in _markup_sources() for item in _style_class_lookups(text)]
    assert not bad, "\n".join(bad)
