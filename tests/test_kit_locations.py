"""Kit 多位置 & Cabinet 全站共用管理測試"""
import io
import os
import sqlite3
import subprocess
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from PIL import Image

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BASE_DIR)

import app.database as app_db
import main as app_main


@pytest.fixture()
def client(tmp_path, monkeypatch):
    test_db = tmp_path / "kit_locations.db"
    monkeypatch.setattr(app_db, "DB_PATH", str(test_db))
    app_db.init_db()
    from app.services.auth import SESSION_COOKIE, create_session, init_admin_if_missing
    conn = app_db.get_db()
    try:
        init_admin_if_missing(conn)
        admin_id = conn.execute("SELECT id FROM users WHERE username='admin'").fetchone()["id"]
        token = create_session(conn, admin_id)
    finally:
        conn.close()
    with TestClient(app_main.app) as c:
        c.cookies.set(SESSION_COOKIE, token)
        yield c


@pytest.fixture()
def upgraded_client(tmp_path, monkeypatch):
    """建立缺少 duplicate Kit metadata 欄位的舊 schema 並執行正式 migration。"""
    test_db = tmp_path / "upgraded_kit.db"
    monkeypatch.setattr(app_db, "DB_PATH", str(test_db))
    with sqlite3.connect(test_db) as conn:
        conn.execute("""
            CREATE TABLE kits (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                item_id INTEGER NOT NULL,
                name TEXT NOT NULL,
                note TEXT DEFAULT '',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
    app_db.init_db()
    from app.services.auth import SESSION_COOKIE, create_session, init_admin_if_missing
    conn = app_db.get_db()
    try:
        init_admin_if_missing(conn)
        admin_id = conn.execute("SELECT id FROM users WHERE username='admin'").fetchone()["id"]
        token = create_session(conn, admin_id)
    finally:
        conn.close()
    with TestClient(app_main.app) as test_client:
        test_client.cookies.set(SESSION_COOKIE, token)
        yield test_client


@pytest.fixture
def sample_item(client):
    """建立測試品項（office 站點）"""
    res = client.post('/api/items', json={
        'name': '冷媒',
        'brand': '台灣化工',
        'unit': '罐',
        'site': 'office',
        'category': '耗材'
    })
    assert res.status_code == 201
    return res.json()


def test_cabinet_list(client):
    """測試查詢櫃子清單"""
    res = client.get('/api/cabinets')
    assert res.status_code == 200
    data = res.json()
    assert len(data) >= 8  # 預設 8 個
    names = [c['name'] for c in data]
    assert '編號A' in names
    assert '鐵架' in names


def test_cabinet_update(client):
    """測試編輯櫃子"""
    res = client.get('/api/cabinets')
    assert res.status_code == 200
    data = res.json()
    assert len(data) > 0
    cabinet = data[0]
    cabinet_id = cabinet['id']
    
    res = client.put(f'/api/cabinets/{cabinet_id}', json={'name': '測試編號', 'note': '更新備註'})
    assert res.status_code == 200
    result = res.json()
    assert result['name'] == '測試編號'


def test_kit_with_locations(client, sample_item):
    """測試新增 Kit 多位置清單"""
    res = client.post('/api/kits', json={
        'name': '冷氣套件',
        'brand': '大金',
        'code': 'FXSQ50',
        'site': 'office',
        'items': [{'item_id': sample_item['id'], 'qty': 1}],
        'locations': [
            {'cabinet': '編號A', 'position': '1-1', 'note': '主存區'},
            {'cabinet': '編號B', 'position': '2-2', 'note': '備用'}
        ]
    })
    assert res.status_code == 201
    kit_id = res.json()['id']
    
    res = client.get('/api/kits')
    kits = res.json()
    kit = next((k for k in kits if k['id'] == kit_id), None)
    assert kit is not None
    assert len(kit['locations']) == 2
    assert kit['locations'][0]['cabinet'] == '編號A'


def _create_kit(client, item_id, locations=None):
    """Create a kit linked to one valid component for lifecycle integration tests."""
    response = client.post('/api/kits', json={
        'name': '測試整組', 'brand': '品牌', 'code': 'KIT-TEST', 'site': 'office',
        'items': [{'item_id': item_id, 'qty': 1}], 'locations': locations or [],
    })
    assert response.status_code == 201, response.text
    return response.json()


def test_cabinet_rename_updates_spaced_pipe_stock_prefix_without_touching_similar_name(client, sample_item):
    """Only exact cabinet-prefix boundaries are renamed; sub-location text is preserved."""
    other = client.post('/api/items', json={'name': '另一材料', 'brand': '牌', 'site': 'office'})
    assert other.status_code == 201, other.text
    stock_a = client.post(f"/api/items/{sample_item['id']}/stocks", json={'location': 'A | 1-1', 'qty': 1})
    stock_a1 = client.post(f"/api/items/{other.json()['id']}/stocks", json={'location': 'A1 | 2-1', 'qty': 1})
    assert stock_a.status_code == stock_a1.status_code == 201
    cabinet_a = client.post('/api/cabinets', json={'name': 'A'})
    assert cabinet_a.status_code == 201
    renamed = client.put(f"/api/cabinets/{cabinet_a.json()['id']}", json={'name': 'X', 'note': ''})
    assert renamed.status_code == 200, renamed.text
    rows = client.get('/api/items?site=all').json()
    item_a = next(row for row in rows if row['id'] == sample_item['id'])
    item_a1 = next(row for row in rows if row['id'] == other.json()['id'])
    assert 'X | 1-1' in [stock['location'] for stock in item_a['stocks']]
    assert 'A1 | 2-1' in [stock['location'] for stock in item_a1['stocks']]


def test_cabinet_delete_guards_spaced_pipe_stock_and_allows_unused_cabinet(client, sample_item):
    """Cabinet deletion rejects the production separator but permits unused entries."""
    cabinet = next(row for row in client.get('/api/cabinets').json() if row['name'] == '編號A')
    stock = client.post(f"/api/items/{sample_item['id']}/stocks", json={'location': '編號A | 1-1', 'qty': 1})
    assert stock.status_code == 201
    blocked = client.delete(f"/api/cabinets/{cabinet['id']}")
    assert blocked.status_code == 409
    unused = client.post('/api/cabinets', json={'name': '未使用櫃'})
    assert unused.status_code == 201
    deleted = client.delete(f"/api/cabinets/{unused.json()['id']}")
    assert deleted.status_code == 200


def test_put_empty_locations_clears_saved_kit_metadata(client, sample_item):
    """An explicit empty location array clears the previously persisted metadata."""
    kit = _create_kit(client, sample_item['id'], [
        {'cabinet': '編號A', 'position': '1-1', 'note': '主存'},
        {'cabinet': '編號B', 'position': '2-1', 'note': '備用'},
    ])
    payload = {
        'name': '測試整組', 'brand': '品牌', 'code': 'KIT-TEST', 'site': 'office',
        'items': [{'item_id': sample_item['id'], 'qty': 1}], 'locations': [],
    }
    updated = client.put(f"/api/kits/{kit['id']}", json=payload)
    assert updated.status_code == 200, updated.text
    found = next(row for row in client.get('/api/kits').json() if row['id'] == kit['id'])
    assert found['locations'] == []


def test_kit_location_dom_runtime_contract():
    """Execute the shipped render/get functions against a DOM test double."""
    script = Path(BASE_DIR) / 'tests' / 'kit_locations_runtime.test.js'
    result = subprocess.run(['node', str(script)], capture_output=True, text=True, check=False)
    assert result.returncode == 0, result.stdout + result.stderr
    assert 'kit location runtime contract passed' in result.stdout


def test_upgraded_db_can_create_kit_without_duplicate_metadata_columns(upgraded_client):
    """The production POST path works after migration from a Kit table without duplicate fields."""
    conn = app_db.get_db()
    try:
        columns = {row['name'] for row in conn.execute('PRAGMA table_info(kits)')}
        assert not columns.intersection({'brand', 'code', 'site', 'has_photo'})
        assert 'site' not in columns
    finally:
        conn.close()
    component = upgraded_client.post('/api/items', json={
        'name': '舊資料庫材料', 'brand': '材料牌', 'site': 'office',
    })
    assert component.status_code == 201, component.text
    created = _create_kit(upgraded_client, component.json()['id'])
    assert created['id'] > 0


def test_fresh_kit_schema_has_no_duplicate_metadata_columns(client):
    """Fresh schema keeps Kit identity in items instead of parallel metadata fields."""
    conn = app_db.get_db()
    try:
        columns = {row['name'] for row in conn.execute('PRAGMA table_info(kits)')}
    finally:
        conn.close()
    assert not columns.intersection({'brand', 'code', 'site', 'has_photo', 'location'})


def test_delete_kit_cleans_asset_variants_and_legacy_preview(client, sample_item, tmp_path, monkeypatch):
    """Deleting a Kit removes its asset metadata and every stored photo variant."""
    from app import config as app_config
    from app.services.file_storage import safe_upload_path

    upload_dir = tmp_path / 'uploads'
    monkeypatch.setattr(app_config, 'UPLOAD_DIR', str(upload_dir))
    kit = _create_kit(client, sample_item['id'])
    image = Image.new('RGB', (24, 24), color='red')
    data = io.BytesIO()
    image.save(data, format='JPEG')
    uploaded = client.post(
        f"/api/kits/{kit['id']}/photo",
        files={'file': ('kit.jpg', data.getvalue(), 'image/jpeg')},
    )
    assert uploaded.status_code == 200, uploaded.text
    conn = app_db.get_db()
    try:
        asset = conn.execute(
            "SELECT * FROM file_assets WHERE category='item_photo' AND owner_type='item' AND owner_id=?",
            (str(kit['item_id']),),
        ).fetchone()
        assert asset is not None
        asset_paths = [safe_upload_path(asset[column], upload_dir) for column in ('original_path', 'preview_path', 'thumbnail_path')]
        legacy_path = upload_dir / f"{kit['item_id']}.jpg"
        assert all(path.exists() for path in asset_paths)
        assert legacy_path.exists()
    finally:
        conn.close()
    deleted = client.delete(f"/api/kits/{kit['id']}")
    assert deleted.status_code == 200, deleted.text
    conn = app_db.get_db()
    try:
        assert conn.execute(
            "SELECT 1 FROM file_assets WHERE category='item_photo' AND owner_type='item' AND owner_id=?",
            (str(kit['item_id']),),
        ).fetchone() is None
    finally:
        conn.close()
    assert all(not path.exists() for path in asset_paths)
    assert not legacy_path.exists()


def test_delete_kit_preserves_photo_paths_referenced_by_another_asset(client, sample_item, tmp_path, monkeypatch):
    """A Kit delete removes its metadata without unlinking paths still referenced elsewhere."""
    from app import config as app_config
    from app.services.file_storage import safe_upload_path

    upload_dir = tmp_path / 'uploads'
    monkeypatch.setattr(app_config, 'UPLOAD_DIR', str(upload_dir))
    kit = _create_kit(client, sample_item['id'])
    image = Image.new('RGB', (24, 24), color='blue')
    data = io.BytesIO()
    image.save(data, format='JPEG')
    uploaded = client.post(
        f"/api/kits/{kit['id']}/photo",
        files={'file': ('kit.jpg', data.getvalue(), 'image/jpeg')},
    )
    assert uploaded.status_code == 200, uploaded.text

    conn = app_db.get_db()
    try:
        asset = conn.execute(
            "SELECT * FROM file_assets WHERE category='item_photo' AND owner_type='item' AND owner_id=?",
            (str(kit['item_id']),),
        ).fetchone()
        assert asset is not None
        shared_legacy = f"{kit['item_id']}.jpg"
        conn.execute(
            "INSERT INTO file_assets (asset_id, category, owner_type, owner_id, original_path, "
            "preview_path, thumbnail_path, sha256) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (
                'shared-kit-photo-test', 'item_photo', 'item', str(sample_item['id']),
                asset['original_path'], asset['preview_path'], asset['thumbnail_path'], asset['sha256'],
            ),
        )
        conn.execute(
            "INSERT INTO file_assets (asset_id, category, owner_type, owner_id, original_path, sha256) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            ('shared-kit-legacy-test', 'quote_upload', 'quotation', 'shared', shared_legacy, asset['sha256']),
        )
        conn.commit()
        shared_paths = [
            safe_upload_path(asset[column], upload_dir)
            for column in ('original_path', 'preview_path', 'thumbnail_path')
            if asset[column]
        ] + [upload_dir / shared_legacy]
        assert all(path.exists() for path in shared_paths)
    finally:
        conn.close()

    deleted = client.delete(f"/api/kits/{kit['id']}")
    assert deleted.status_code == 200, deleted.text
    conn = app_db.get_db()
    try:
        assert conn.execute(
            "SELECT 1 FROM file_assets WHERE asset_id='shared-kit-photo-test'"
        ).fetchone() is not None
    finally:
        conn.close()
    assert all(path.exists() for path in shared_paths), [(path.name, path.exists()) for path in shared_paths]
