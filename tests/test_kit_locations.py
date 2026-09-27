# -*- coding: utf-8 -*-
"""
Kit 多位置管理與 Cabinet 共用設定測試（2026-09-27）
====================================================
驗證：
1. Cabinet CRUD API
2. Kit 創建/編輯時位置清單持久化
3. Kit 查詢回傳位置清單
"""
import os
import sys
import pytest
from fastapi.testclient import TestClient

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BASE_DIR)

import app.database as app_db
import main as app_main
from app.services.auth import SESSION_COOKIE, create_session, init_admin_if_missing


@pytest.fixture()
def client(tmp_path, monkeypatch):
    """測試客戶端（認證為 admin）"""
    test_db = tmp_path / "kit_cabinet.db"
    monkeypatch.setattr(app_db, "DB_PATH", str(test_db))
    app_db.init_db()
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
def sample_item(client):
    """建立測試品項"""
    res = client.post('/api/items', json={
        'name': '馬達', 'brand': '東芝', 'code': 'M-100',
        'site': 'office', 'category': '電氣組件', 'unit': '個', 'qty': 5, 'low_stock': 1
    })
    assert res.status_code == 201
    return res.json()


# ========== Cabinet 測試 ==========
def test_cabinet_create(client):
    """測試新增櫃子"""
    res = client.post('/api/cabinets', json={
        'name': '編號A',
        'note': '二樓東側'
    })
    assert res.status_code == 201
    data = res.json()
    assert data['name'] == '編號A'
    assert data['note'] == '二樓東側'


def test_cabinet_list(client):
    """測試查詢櫃子清單"""
    # 新增 2 個櫃子
    client.post('/api/cabinets', json={'name': '編號A', 'note': '二樓'})
    client.post('/api/cabinets', json={'name': '編號B', 'note': '倉庫'})
    
    res = client.get('/api/cabinets')
    assert res.status_code == 200
    data = res.json()
    assert len(data) == 2
    assert data[0]['name'] == '編號A'
    assert data[1]['name'] == '編號B'


def test_cabinet_update(client):
    """測試編輯櫃子"""
    create_res = client.post('/api/cabinets', json={'name': '編號A', 'note': '二樓'})
    cab_id = create_res.json()['id']
    
    res = client.put(f'/api/cabinets/{cab_id}', json={
        'name': '編號A-修改',
        'note': '二樓西側'
    })
    assert res.status_code == 200
    data = res.json()
    assert data['name'] == '編號A-修改'
    assert data['note'] == '二樓西側'


def test_cabinet_delete(client):
    """測試刪除櫃子"""
    create_res = client.post('/api/cabinets', json={'name': '編號A', 'note': '二樓'})
    cab_id = create_res.json()['id']
    
    res = client.delete(f'/api/cabinets/{cab_id}')
    assert res.status_code == 200
    
    # 驗證已刪除
    list_res = client.get('/api/cabinets')
    data = list_res.json()
    assert len(data) == 0


def test_cabinet_duplicate_name(client):
    """測試重複的櫃子名稱被拒絕"""
    client.post('/api/cabinets', json={'name': '編號A', 'note': '二樓'})
    
    res = client.post('/api/cabinets', json={'name': '編號A', 'note': '倉庫'})
    assert res.status_code == 409  # UNIQUE constraint


# ========== Kit 多位置測試 ==========
def test_kit_create_with_locations(client, sample_item):
    """測試新增 Kit 並指定多個位置"""
    res = client.post('/api/kits', json={
        'name': '組合套件 A',
        'brand': '台灣製',
        'code': 'KIT-A-001',
        'site': 'office',
        'items': [{'item_id': sample_item['id'], 'qty': 2}],
        'locations': [
            {'cabinet': '編號A', 'position': '1-1', 'qty': 5, 'note': '主存區'},
            {'cabinet': '編號B', 'position': '2-3', 'qty': 3, 'note': '副備區'}
        ],
        'note': '常用備件'
    })
    assert res.status_code == 201
    data = res.json()
    kit_id = data['id']
    assert data['name'] == '組合套件 A'
    assert data['brand'] == '台灣製'
    
    # 查詢 Kit 驗證位置清單
    list_res = client.get('/api/kits')
    assert list_res.status_code == 200
    kits = list_res.json()
    kit = next(k for k in kits if k['id'] == kit_id)
    assert len(kit['locations']) == 2
    assert kit['locations'][0]['cabinet'] == '編號A'
    assert kit['locations'][0]['position'] == '1-1'
    assert kit['locations'][0]['qty'] == 5
    assert kit['locations'][1]['cabinet'] == '編號B'


def test_kit_update_locations(client, sample_item):
    """測試編輯 Kit 位置清單"""
    # 建立初始 Kit
    create_res = client.post('/api/kits', json={
        'name': '套件',
        'brand': '品牌',
        'code': 'KIT-001',
        'site': 'office',
        'items': [{'item_id': sample_item['id'], 'qty': 1}],
        'locations': [
            {'cabinet': '編號A', 'position': '1-1', 'qty': 5, 'note': ''}
        ]
    })
    assert create_res.status_code == 201
    kit_id = create_res.json()['id']
    kit = create_res.json()
    
    # 編輯位置清單
    update_res = client.put(f'/api/kits/{kit_id}', json={
        'name': '套件',
        'brand': '品牌',
        'code': 'KIT-001',
        'items': [{'item_id': sample_item['id'], 'qty': 1}],
        'locations': [
            {'cabinet': '編號A', 'position': '1-2', 'qty': 10, 'note': '新位置'},
            {'cabinet': '編號C', 'position': '3-1', 'qty': 2, 'note': '額外區域'}
        ],
        'updated_at': kit.get('updated_at')
    })
    assert update_res.status_code == 200
    
    # 驗證位置已更新
    list_res = client.get('/api/kits')
    updated_kit = next(k for k in list_res.json() if k['id'] == kit_id)
    assert len(updated_kit['locations']) == 2
    assert updated_kit['locations'][0]['position'] == '1-2'
    assert updated_kit['locations'][0]['qty'] == 10
    assert updated_kit['locations'][1]['cabinet'] == '編號C'


def test_kit_create_without_locations(client, sample_item):
    """測試新增 Kit 不指定位置清單（預設空）"""
    res = client.post('/api/kits', json={
        'name': '簡單套件',
        'brand': '品牌',
        'code': 'KIT-SIMPLE',
        'site': 'office',
        'items': [{'item_id': sample_item['id'], 'qty': 1}],
        'locations': []
    })
    assert res.status_code == 201
    kit_id = res.json()['id']
    
    # 驗證位置清單為空
    list_res = client.get('/api/kits')
    kit = next(k for k in list_res.json() if k['id'] == kit_id)
    assert kit['locations'] == []


def test_kit_with_brand_code_site(client, sample_item):
    """測試 Kit 品牌、型號、分類位置欄位"""
    res = client.post('/api/kits', json={
        'name': '冷氣套件',
        'brand': '大金',
        'code': 'FXSQ50',
        'site': 'office',  # 與 sample_item 同站點
        'items': [{'item_id': sample_item['id'], 'qty': 3}],
        'locations': []
    })
    assert res.status_code == 201
    kit = res.json()
    assert kit['brand'] == '大金'
    assert kit['code'] == 'FXSQ50'
    
    # 查詢驗證
    list_res = client.get('/api/kits?site=office')
    kits = list_res.json()
    found = next(k for k in kits if k['id'] == kit['id'])
    assert found['brand'] == '大金'
    assert found['code'] == 'FXSQ50'
