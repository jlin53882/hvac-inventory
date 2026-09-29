# -*- coding: utf-8 -*-
"""CSS 架構靜態規則（docs/CSS架構重構設計.md §6.3）。

規則隨重構階段逐步啟用；每條規則都是為了避免「改 A 頁、B 頁跟著壞」再發生。
"""
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
# 斷點白名單（P5 只統一寫法；數值收斂於 P7.5 設計系統統一時處理）
MEDIA_WHITELIST = {
    "print",
    "(max-width: 390px)", "(max-width: 639px)", "(max-width: 767px)", "(max-width: 768px)",
    "(max-width: 1200px)", "(max-width: 1440px)",
    "(min-width: 560px)", "(min-width: 720px)", "(min-width: 768px)", "(min-width: 960px)",
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
