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
LAYER_ORDER = ("tokens", "base", "layout", "components", "pages", "utilities", "legacy")
# 目錄 → 允許的 layer
DIR_LAYERS = {
    "0-tokens": {"tokens"},
    "1-base": {"base"},
    "2-layout": {"layout"},
    # P4 過渡：自頁面檔抽出的共用規則（panel / status-list / product-thumbnail）暫留 legacy，P5 歸位後收回
    "3-components": {"components", "legacy"},
    "4-pages": {"pages", "legacy"},
    "5-utilities": {"utilities", "legacy"},
    "legacy": {"legacy"},
}


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
