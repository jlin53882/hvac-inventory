import sys
from pathlib import Path
from urllib.parse import unquote
sys.path.insert(0, str(Path(__file__).parents[1]))

import pytest
import app.database as app_db
import main as app_main
from app.services.auth import SESSION_COOKIE, create_session, init_admin_if_missing
from fastapi.testclient import TestClient
from openpyxl import load_workbook


@pytest.fixture()
def eng_client(tmp_path, monkeypatch):
    monkeypatch.setattr(app_db, 'DB_PATH', str(tmp_path / 'engineering.db'))
    app_db.init_db()
    conn = app_db.get_db()
    init_admin_if_missing(conn)
    uid = conn.execute("SELECT id FROM users WHERE username='admin'").fetchone()['id']
    token = create_session(conn, uid)
    conn.close()
    c = TestClient(app_main.app)
    c.cookies.set(SESSION_COOKIE, token)
    return c


def payload():
    return {
        'report_type': 'engineering', 'start_date': '2026-09-01', 'end_date': '2026-09-04',
        'upload_person': '藍先生', 'prepared_by': '王小明', 'filename_text': '發票',
        'status': 'completed', 'categories': [{
            'name': '交通費', 'groups': [{'name': '油資', 'receipts': [
                {'tax_id_mark': 'V', 'receipt_number': 'DH-98939443', 'amount': 100, 'details': ['九二無鉛']},
                {'tax_id_mark': '12345678', 'receipt_number': 'DH-98728718', 'amount': 725, 'details': ['九二無鉛']},
            ]}]
        }, {
            'name': '工程材料費', 'groups': [{'name': '五金 / 工具', 'receipts': [{
                'tax_id_mark': 'V', 'receipt_number': 'CB 20011829', 'amount': 1004,
                'details': ['ABS塑鋼管 ×2', 'ABS等徑三通 ×2', 'ABS閥接頭 ×2', 'ABS90度彎頭 ×16', 'ABS等徑接頭 ×4', 'ABS專用接著劑 ×1']
            }]}]
        }]
    }


def test_engineering_create_calculates_hierarchy_and_preserves_owner_separation(eng_client):
    r = eng_client.post('/api/petty-cash-reports', json=payload())
    assert r.status_code == 201, r.text
    data = r.json()
    assert data['report_type'] == 'engineering'
    assert data['upload_person'] != data['prepared_by']
    assert data['total_amount'] == 1829
    assert data['categories'][0]['subtotal'] == 825
    assert data['categories'][1]['groups'][0]['receipts'][0]['amount'] == 1004


def test_engineering_filter_and_update_are_shared_shell(eng_client):
    created = eng_client.post('/api/petty-cash-reports', json=payload()).json()
    listed = eng_client.get('/api/petty-cash-reports?report_type=engineering')
    assert listed.status_code == 200
    assert listed.json()['items'][0]['report_type'] == 'engineering'
    body = payload(); body['prepared_by'] = '李主任'; body['categories'][0]['groups'][0]['receipts'][0]['amount'] = 200
    updated = eng_client.put(f"/api/petty-cash-reports/{created['id']}", json=body)
    assert updated.status_code == 200, updated.text
    assert updated.json()['prepared_by'] == '李主任'
    assert updated.json()['total_amount'] == 1929


def test_engineering_export_tax_values_merges_and_filename(eng_client, tmp_path):
    created = eng_client.post('/api/petty-cash-reports', json=payload()).json()
    response = eng_client.get(f"/api/petty-cash-reports/{created['id']}/export.xlsx")
    assert response.status_code == 200
    assert '(0901-0904 發票)藍先生 工程零用金.xlsx' in unquote(response.headers['content-disposition'])
    path = tmp_path / 'out.xlsx'; path.write_bytes(response.content)
    ws = load_workbook(path).active
    assert ws['C2'].value == 'V'; assert ws['C3'].value == '12345678'
    assert ws['C2'].number_format == '@'; assert ws['C3'].font.name == 'Calibri'
    assert 'C5:C10' in [str(x) for x in ws.merged_cells.ranges]
    assert ws['F13'].value == 1829
    assert ws['F5'].value == 1004 or ws['F5'].value == 1004.0


def test_engineering_frontend_contract():
    render = Path(__file__).parents[1] / 'static/js/render/petty-cash.js'
    modal = Path(__file__).parents[1] / 'static/js/modals/engineering-petty-cash.js'
    index = Path(__file__).parents[1] / 'static/index.html'
    render_text = render.read_text(encoding='utf-8')
    modal_text = modal.read_text(encoding='utf-8')
    index_text = index.read_text(encoding='utf-8')
    assert "report_type" in render_text and "engineering" in render_text
    assert "pcChooseReportType" in render_text and "engRenderDetail" in render_text
    assert "engAddCategory" in modal_text and "tax_id_mark" in modal_text
    assert "engineering-petty-cash.js" in index_text




def test_petty_cash_options_are_separate_and_configured(eng_client):
    engineering = {'report_type': 'engineering', 'option_type': 'category', 'name': '交通費', 'sort_order': 0}
    general = {'report_type': 'general', 'option_type': 'category', 'name': '交通費', 'sort_order': 0}
    assert eng_client.post('/api/petty-cash-options', json=engineering).status_code == 201
    assert eng_client.post('/api/petty-cash-options', json=general).status_code == 201
    assert eng_client.post('/api/petty-cash-options', json=engineering).status_code == 409
    eng = eng_client.get('/api/petty-cash-options?report_type=engineering&option_type=category')
    gen = eng_client.get('/api/petty-cash-options?report_type=general&option_type=category')
    assert [x['name'] for x in eng.json()['items']] == ['交通費']
    assert [x['name'] for x in gen.json()['items']] == ['交通費']
    option_id = eng.json()['items'][0]['id']
    assert eng_client.put(f'/api/petty-cash-options/{option_id}', json={'name': '燃料費'}).status_code == 200
    assert eng_client.delete(f'/api/petty-cash-options/{option_id}').status_code == 200


def test_petty_cash_options_reject_invalid_scope(eng_client):
    assert eng_client.get('/api/petty-cash-options?report_type=other&option_type=category').status_code == 400
    assert eng_client.get('/api/petty-cash-options?report_type=general&option_type=other').status_code == 400


def test_engineering_transaction_rolls_back_and_leaves_no_orphans(eng_client):
    body = payload(); body['categories'][0]['groups'][0]['receipts'][0]['details'] = ['']
    response = eng_client.post('/api/petty-cash-reports', json=body)
    assert response.status_code == 422
    conn = app_db.get_db()
    try:
        assert conn.execute("SELECT COUNT(*) FROM petty_cash_reports").fetchone()[0] == 0
        assert conn.execute("SELECT COUNT(*) FROM engineering_expense_details").fetchone()[0] == 0
    finally:
        conn.close()
