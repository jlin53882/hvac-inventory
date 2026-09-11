# -*- coding: utf-8 -*-
"""
零用金月報路由
==============
- GET    /api/petty-cash-reports                  列表（期間交集 + 上傳人 + 狀態 + 關鍵字 + 分頁，後端過濾）
- GET    /api/petty-cash/kpi                      KPI（同篩選全量：總數/已完成/草稿，不受分頁影響）
- GET    /api/petty-cash-reports/previous-balance 上期餘額（同上傳人、end_date < before 的最近 completed）
- POST   /api/petty-cash-reports                  建立（含 entries/items，單一 transaction）
- GET    /api/petty-cash-reports/{id}             明細（含計算 totals + 明細合計警示）
- PUT    /api/petty-cash-reports/{id}             全量替換（仿 quotations._write_quote）
- DELETE /api/petty-cash-reports/{id}             刪除（CASCADE；本人或 petty-cash-delete-all）
- GET    /api/petty-cash-reports/{id}/export.xlsx 範本填值匯出（不輸出上傳人；更新 last_exported_at）

權限沿用每日簽名日報表模式：登入可查/建；編輯/刪除限本人或全域刪除權限者。
上傳人（upload_person）是報表主體，可與登入者不同，不綁死。
"""
import datetime
import io
import os
import re
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response

from app.database import get_db
from app.models import PettyCashReportIn
from app.services.auth import get_user_permissions, require_login
from app.services.petty_cash_report import build_petty_cash_report, download_filename

router = APIRouter()

XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def _safe(value):
    """公式注入防護：= + - @ 開頭的字串加撇號（沿用 quotations.py）。"""
    if isinstance(value, str) and value.startswith(("=", "+", "-", "@")):
        return "'" + value
    return value


def _safe_filename(name: str) -> str:
    """下載檔名清理（沿用 signed_reports._safe_name：去路徑、限字元、防前綴）。"""
    name = os.path.basename((name or "file").strip()) or "file"
    name = re.sub(r"[^0-9A-Za-z\u4e00-\u9fa5._-]", "_", name)
    if name[:1] in (".", "-", "=", "+", "@"):
        name = "_" + name[1:]
    return name[:120] or "file"


def _parse_date(value: str, label: str = "日期") -> str:
    try:
        return datetime.date.fromisoformat(value).isoformat()
    except (TypeError, ValueError):
        raise HTTPException(400, f"{label}格式需 YYYY-MM-DD")


def _can_delete_all(conn, user: dict) -> bool:
    perms = get_user_permissions(conn, user["id"])
    return bool(perms.get("petty-cash-delete-all"))


def _totals(opening: float, entries: list) -> dict:
    income = round(sum(float(e["amount"]) for e in entries if e["entry_type"] == "income"), 2)
    expense = round(sum(float(e["amount"]) for e in entries if e["entry_type"] != "income"), 2)
    opening = round(float(opening or 0), 2)
    return {
        "opening_balance": opening,
        "income": income,
        "expense": expense,
        "closing_balance": round(opening + income - expense, 2),
    }


def _entry_dict(entry_row, items: list) -> dict:
    item_total = round(sum(float(i["amount"]) for i in items), 2) if items else None
    amount = round(float(entry_row["amount"]), 2)
    warning = None
    if item_total is not None and abs(item_total - amount) > 0.005:
        warning = f"明細合計 ${item_total:g} 與支出總額 ${amount:g} 不一致，請確認。"
    return {
        "id": entry_row["id"],
        "entry_date": entry_row["entry_date"],
        "entry_type": entry_row["entry_type"],
        "description": entry_row["description"] or "",
        "amount": amount,
        "category": entry_row["category"] or "",
        "sort_order": entry_row["sort_order"],
        "items": [
            {
                "id": i["id"],
                "item_name": i["item_name"],
                "qty": i["qty"],
                "unit": i["unit"] or "",
                "amount": round(float(i["amount"]), 2),
                "sort_order": i["sort_order"],
            }
            for i in items
        ],
        "amount_warning": warning,
    }


def _report_dict(conn, report_id: int) -> dict:
    row = conn.execute("SELECT * FROM petty_cash_reports WHERE id=?", (report_id,)).fetchone()
    if row is None:
        raise HTTPException(404, "零用金月報不存在")
    entry_rows = conn.execute(
        "SELECT * FROM petty_cash_entries WHERE report_id=? ORDER BY entry_date, sort_order, id",
        (report_id,),
    ).fetchall()
    entries = []
    for er in entry_rows:
        items = conn.execute(
            "SELECT * FROM petty_cash_entry_items WHERE entry_id=? ORDER BY sort_order, id",
            (er["id"],),
        ).fetchall()
        entries.append(_entry_dict(er, [dict(i) for i in items]))
    totals = _totals(row["opening_balance"], entries)
    return {
        "id": row["id"],
        "start_date": row["start_date"],
        "end_date": row["end_date"],
        "filename_text": row["filename_text"],
        "upload_person": row["upload_person"],
        "uploader_user_id": row["uploader_user_id"],
        "prepared_by": row["prepared_by"],
        "opening_balance": round(float(row["opening_balance"] or 0), 2),
        "opening_balance_source": row["opening_balance_source"] or "manual",
        "status": row["status"],
        "last_exported_at": row["last_exported_at"] or "",
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
        "entries": entries,
        "totals": totals,
    }


def _summary_dict(conn, row) -> dict:
    sums = conn.execute(
        """SELECT
               COALESCE(SUM(CASE WHEN entry_type='income' THEN amount ELSE 0 END), 0) AS income,
               COALESCE(SUM(CASE WHEN entry_type!='income' THEN amount ELSE 0 END), 0) AS expense
           FROM petty_cash_entries WHERE report_id=?""",
        (row["id"],),
    ).fetchone()
    totals = _totals(row["opening_balance"], [
        {"entry_type": "income", "amount": sums["income"]},
        {"entry_type": "expense", "amount": sums["expense"]},
    ])
    return {
        "id": row["id"],
        "start_date": row["start_date"],
        "end_date": row["end_date"],
        "filename_text": row["filename_text"],
        "upload_person": row["upload_person"],
        "prepared_by": row["prepared_by"],
        "opening_balance": totals["opening_balance"],
        "income": totals["income"],
        "expense": totals["expense"],
        "closing_balance": totals["closing_balance"],
        "status": row["status"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def _check_duplicate(conn, body: PettyCashReportIn, exclude_id: int | None = None) -> None:
    sql = """SELECT id FROM petty_cash_reports
             WHERE upload_person=? AND start_date=? AND end_date=? AND filename_text=?"""
    params: list = [body.upload_person, body.start_date, body.end_date, body.filename_text]
    if exclude_id is not None:
        sql += " AND id!=?"
        params.append(exclude_id)
    dup = conn.execute(sql, params).fetchone()
    if dup is not None:
        raise HTTPException(
            409,
            f"已存在相同期間與類型的零用金月報（id={dup['id']}），請開啟既有報表。",
        )


def _validate_body(body: PettyCashReportIn) -> None:
    start = _parse_date(body.start_date, "開始日期")
    end = _parse_date(body.end_date, "結束日期")
    if start > end:
        raise HTTPException(400, "開始日期不可晚於結束日期")
    body.start_date = start
    body.end_date = end
    for entry in body.entries:
        entry_date = _parse_date(entry.entry_date, "收支日期")
        if not (start <= entry_date <= end):
            raise HTTPException(400, f"收支日期 {entry_date} 必須落在報表期間內")
        entry.entry_date = entry_date
        if entry.entry_type == "income" and entry.items:
            raise HTTPException(400, "收入紀錄不可帶商品明細")


def _write_report(conn, body: PettyCashReportIn, user_id: int, report_id: int | None = None) -> int:
    _validate_body(body)
    _check_duplicate(conn, body, exclude_id=report_id)
    now = datetime.datetime.now().isoformat()
    if report_id is None:
        cur = conn.execute(
            """INSERT INTO petty_cash_reports
               (start_date, end_date, filename_text, upload_person, uploader_user_id,
                prepared_by, opening_balance, opening_balance_source, status,
                created_by, updated_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
            (body.start_date, body.end_date, body.filename_text, body.upload_person, user_id,
             body.prepared_by, body.opening_balance, body.opening_balance_source,
             body.status, user_id, now),
        )
        report_id = cur.lastrowid
    else:
        existing = conn.execute(
            "SELECT id FROM petty_cash_reports WHERE id=?", (report_id,)
        ).fetchone()
        if existing is None:
            raise HTTPException(404, "零用金月報不存在")
        conn.execute(
            """UPDATE petty_cash_reports SET start_date=?, end_date=?, filename_text=?,
               upload_person=?, prepared_by=?, opening_balance=?, opening_balance_source=?,
               status=?, updated_at=? WHERE id=?""",
            (body.start_date, body.end_date, body.filename_text, body.upload_person,
             body.prepared_by, body.opening_balance, body.opening_balance_source,
             body.status, now, report_id),
        )
        conn.execute("DELETE FROM petty_cash_entries WHERE report_id=?", (report_id,))
    for order, entry in enumerate(
        sorted(body.entries, key=lambda e: (e.entry_date, e.sort_order))
    ):
        cur = conn.execute(
            """INSERT INTO petty_cash_entries
               (report_id, entry_date, entry_type, description, amount, category, sort_order)
               VALUES (?,?,?,?,?,?,?)""",
            (report_id, entry.entry_date, entry.entry_type, entry.description,
             entry.amount, entry.category.strip(), order),
        )
        entry_id = cur.lastrowid
        for item_order, item in enumerate(entry.items):
            conn.execute(
                """INSERT INTO petty_cash_entry_items
                   (entry_id, item_name, qty, unit, amount, sort_order)
                   VALUES (?,?,?,?,?,?)""",
                (entry_id, item.item_name, item.qty, item.unit.strip(),
                 item.amount, item_order),
            )
    return report_id


def _filters(
    start_date: str = Query("", description="報表期間起（與報表期間交集）"),
    end_date: str = Query("", description="報表期間迄（與報表期間交集）"),
    upload_person: str = Query("", description="上傳人（完全比對）"),
    status: str = Query("", description="draft / completed"),
    search: str = Query("", description="關鍵字：檔名文字/上傳人/製表人"),
):
    if start_date:
        _parse_date(start_date, "開始日期")
    if end_date:
        _parse_date(end_date, "結束日期")
    if status and status not in ("draft", "completed"):
        raise HTTPException(400, "狀態僅允許 draft / completed")
    where, params = [], []
    if start_date and end_date:
        where.append("NOT (end_date < ? OR start_date > ?)")
        params.extend([start_date, end_date])
    elif start_date:
        where.append("end_date >= ?")
        params.append(start_date)
    elif end_date:
        where.append("start_date <= ?")
        params.append(end_date)
    if upload_person:
        where.append("upload_person = ?")
        params.append(upload_person.strip())
    if status:
        where.append("status = ?")
        params.append(status)
    search = (search or "").strip()
    if search:
        where.append("(filename_text LIKE ? OR upload_person LIKE ? OR prepared_by LIKE ?)")
        like = f"%{search}%"
        params.extend([like, like, like])
    return ("WHERE " + " AND ".join(where)) if where else "", params


@router.get("/api/petty-cash/kpi")
def petty_cash_kpi(
    filters=Depends(_filters),
    user: dict = Depends(require_login),
):
    """同篩選全量 KPI（總數/已完成/草稿），不受分頁影響。"""
    if user is None:
        raise HTTPException(401, "未登入")
    sql_where, params = filters
    conn = get_db()
    try:
        row = conn.execute(
            f"""SELECT COUNT(*) AS total,
                        COALESCE(SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END), 0) AS completed,
                        COALESCE(SUM(CASE WHEN status='draft' THEN 1 ELSE 0 END), 0) AS draft
                 FROM petty_cash_reports {sql_where}""",
            params,
        ).fetchone()
        return {"total": row["total"], "completed": row["completed"], "draft": row["draft"]}
    finally:
        conn.close()


@router.get("/api/petty-cash-persons")
def petty_cash_persons(user: dict = Depends(require_login)):
    """上傳人候選：歷史報表上傳人 + 啟用中使用者顯示名（供篩選下拉與新增報表選擇既有人員）。"""
    if user is None:
        raise HTTPException(401, "未登入")
    conn = get_db()
    try:
        names = set()
        for r in conn.execute("SELECT DISTINCT upload_person FROM petty_cash_reports").fetchall():
            if (r["upload_person"] or "").strip():
                names.add(r["upload_person"].strip())
        for r in conn.execute("SELECT display_name FROM users WHERE is_active=1").fetchall():
            if (r["display_name"] or "").strip():
                names.add(r["display_name"].strip())
        return {"persons": sorted(names)}
    finally:
        conn.close()


@router.get("/api/petty-cash-reports/previous-balance")
def previous_balance(
    upload_person: str = Query(..., min_length=1, max_length=50),
    before: str = Query(..., description="新報表開始日期 YYYY-MM-DD"),
    user: dict = Depends(require_login),
):
    """同一上傳人、end_date < before 的最近 completed 報表本期餘額 → 新報表上期餘額。"""
    if user is None:
        raise HTTPException(401, "未登入")
    before = _parse_date(before, "開始日期")
    conn = get_db()
    try:
        income_expr = "COALESCE((SELECT SUM(amount) FROM petty_cash_entries WHERE report_id=r.id AND entry_type='income'), 0)"
        expense_expr = "COALESCE((SELECT SUM(amount) FROM petty_cash_entries WHERE report_id=r.id AND entry_type!='income'), 0)"
        prev = conn.execute(
            f"""SELECT r.id, r.start_date, r.end_date, r.opening_balance,
                       ({income_expr}) AS income, ({expense_expr}) AS expense
                FROM petty_cash_reports r
                WHERE r.upload_person=? AND r.end_date < ? AND r.status='completed'
                ORDER BY r.end_date DESC, r.id DESC LIMIT 1""",
            (upload_person.strip(), before),
        ).fetchone()
        if prev is None:
            return {"found": False, "message": "未找到上一期資料，請手動輸入上期餘額"}
        closing = round(
            float(prev["opening_balance"] or 0) + float(prev["income"]) - float(prev["expense"]), 2
        )
        return {
            "found": True,
            "opening_balance": closing,
            "previous_id": prev["id"],
            "previous_period": f"{prev['start_date']}～{prev['end_date']}",
        }
    finally:
        conn.close()


@router.get("/api/petty-cash-reports")
def list_petty_cash_reports(
    filters=Depends(_filters),
    page: int = Query(1, ge=1, le=1000),
    page_size: int = Query(20, ge=1, le=50),
    user: dict = Depends(require_login),
):
    if user is None:
        raise HTTPException(401, "未登入")
    sql_where, params = filters
    conn = get_db()
    try:
        total = conn.execute(
            f"SELECT COUNT(*) FROM petty_cash_reports {sql_where}", params
        ).fetchone()[0]
        rows = conn.execute(
            f"""SELECT * FROM petty_cash_reports {sql_where}
                ORDER BY start_date DESC, id DESC LIMIT ? OFFSET ?""",
            (*params, page_size, (page - 1) * page_size),
        ).fetchall()
        can_all = _can_delete_all(conn, user)
        items = []
        for r in rows:
            summary = _summary_dict(conn, r)
            summary["can_edit"] = bool(
                can_all or r["uploader_user_id"] == user["id"] or r["created_by"] == user["id"]
            )
            items.append(summary)
        return {"items": items, "total": total, "page": page, "page_size": page_size}
    finally:
        conn.close()


@router.post("/api/petty-cash-reports", status_code=201)
def create_petty_cash_report(body: PettyCashReportIn, user: dict = Depends(require_login)):
    if user is None:
        raise HTTPException(401, "未登入")
    conn = get_db()
    try:
        report_id = _write_report(conn, body, user["id"])
        conn.commit()
        return _report_dict(conn, report_id)
    except HTTPException:
        conn.rollback()
        raise
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


@router.get("/api/petty-cash-reports/{report_id}")
def get_petty_cash_report(report_id: int, user: dict = Depends(require_login)):
    if user is None:
        raise HTTPException(401, "未登入")
    conn = get_db()
    try:
        data = _report_dict(conn, report_id)
        row = conn.execute(
            "SELECT uploader_user_id, created_by FROM petty_cash_reports WHERE id=?",
            (report_id,),
        ).fetchone()
        can_all = _can_delete_all(conn, user)
        data["can_edit"] = bool(
            can_all or row["uploader_user_id"] == user["id"] or row["created_by"] == user["id"]
        )
        return data
    finally:
        conn.close()


@router.put("/api/petty-cash-reports/{report_id}")
def update_petty_cash_report(
    report_id: int, body: PettyCashReportIn, user: dict = Depends(require_login)
):
    if user is None:
        raise HTTPException(401, "未登入")
    conn = get_db()
    try:
        row = conn.execute(
            "SELECT uploader_user_id, created_by FROM petty_cash_reports WHERE id=?",
            (report_id,),
        ).fetchone()
        if row is None:
            raise HTTPException(404, "零用金月報不存在")
        can_all = _can_delete_all(conn, user)
        if not (
            can_all or row["uploader_user_id"] == user["id"] or row["created_by"] == user["id"]
        ):
            raise HTTPException(403, "僅建立者或具全域刪除權限者可編輯")
        _write_report(conn, body, user["id"], report_id)
        conn.commit()
        return _report_dict(conn, report_id)
    except HTTPException:
        conn.rollback()
        raise
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


@router.delete("/api/petty-cash-reports/{report_id}")
def delete_petty_cash_report(report_id: int, user: dict = Depends(require_login)):
    if user is None:
        raise HTTPException(401, "未登入")
    conn = get_db()
    try:
        row = conn.execute(
            "SELECT uploader_user_id, created_by FROM petty_cash_reports WHERE id=?",
            (report_id,),
        ).fetchone()
        if row is None:
            raise HTTPException(404, "零用金月報不存在")
        can_all = _can_delete_all(conn, user)
        if not (
            can_all or row["uploader_user_id"] == user["id"] or row["created_by"] == user["id"]
        ):
            raise HTTPException(403, "僅建立者或具全域刪除權限者可刪除")
        conn.execute("DELETE FROM petty_cash_reports WHERE id=?", (report_id,))
        conn.commit()
        return {"ok": True, "deleted": report_id}
    except HTTPException:
        conn.rollback()
        raise
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


@router.get("/api/petty-cash-reports/{report_id}/export.xlsx")
def export_petty_cash_report(report_id: int, user: dict = Depends(require_login)):
    if user is None:
        raise HTTPException(401, "未登入")
    conn = get_db()
    try:
        data = _report_dict(conn, report_id)
        buf = build_petty_cash_report(data)
        conn.execute(
            "UPDATE petty_cash_reports SET last_exported_at=? WHERE id=?",
            (datetime.datetime.now().isoformat(), report_id),
        )
        conn.commit()
    finally:
        conn.close()
    raw_name = download_filename(data["filename_text"], data["start_date"], data["end_date"])
    filename = _safe_filename(_safe(raw_name))
    return Response(
        buf.getvalue(),
        media_type=XLSX_MIME,
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename)}"},
    )
