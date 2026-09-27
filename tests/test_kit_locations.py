"""Kit 多位置 & Cabinet 全站共用管理測試"""
import os
import sys
import pytest
from fastapi.testclient import TestClient

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
            {'cabinet': '編號A', 'position': '1-1', 'qty': 5, 'note': '主存區'},
            {'cabinet': '編號B', 'position': '2-2', 'qty': 3, 'note': '備用'}
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
