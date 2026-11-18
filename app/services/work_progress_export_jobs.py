# -*- coding: utf-8 -*-
"""工作進度「搜尋條件匯出」背景工作：產生 xlsx 時回報進度、可取消、下載後即刪。

- 進度存在本行程記憶體（正式站單一 uvicorn worker）；伺服器重啟會中斷進行中的匯出。
- 每位使用者同時只能有一個進行中的匯出。
- 暫存檔寫在系統暫存目錄；下載後刪除，未下載的工作超過 JOB_TTL_SECONDS 後清除。
"""
from __future__ import annotations

import shutil
import tempfile
import threading
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Sequence

JOB_TTL_SECONDS = 30 * 60


class ExportCancelled(Exception):
    """使用者取消匯出（由進度回呼丟出，中止產生工作簿）。"""


class ExportJobBusy(Exception):
    """同一使用者已有進行中的匯出。"""


@dataclass
class ExportJob:
    id: str
    user_id: int
    filename: str
    total_reports: int
    total_photos: int
    done_reports: int = 0
    done_photos: int = 0
    status: str = "running"          # running / done / error / cancelled
    error: str = ""
    path: Path | None = None
    created: float = field(default_factory=time.monotonic)
    cancel_event: threading.Event = field(default_factory=threading.Event)

    def to_dict(self) -> dict:
        """前端輪詢用的進度摘要。"""
        return {
            "job_id": self.id,
            "status": self.status,
            "filename": self.filename,
            "total_reports": self.total_reports,
            "done_reports": self.done_reports,
            "total_photos": self.total_photos,
            "done_photos": self.done_photos,
            "error": self.error,
        }


_jobs: dict[str, ExportJob] = {}
_lock = threading.Lock()


def _remove_file(job: ExportJob) -> None:
    if job.path is not None:
        shutil.rmtree(job.path.parent, ignore_errors=True)
        job.path = None


def purge_expired(now: float | None = None) -> None:
    """清掉超過保留時間的工作（進行中的先要求取消，檔案一律刪除）。"""
    now = time.monotonic() if now is None else now
    with _lock:
        expired = [j for j in _jobs.values() if now - j.created > JOB_TTL_SECONDS]
        for job in expired:
            job.cancel_event.set()
            _jobs.pop(job.id, None)
    for job in expired:
        _remove_file(job)


def start_job(user_id: int, filename: str, reports: Sequence[dict],
              build: Callable[..., object]) -> ExportJob:
    """建立並在背景執行匯出。build 與 build_work_progress_workbook 同介面（compact/on_report/on_photo）。"""
    purge_expired()
    total_photos = sum(len(r.get("photo_paths") or []) for r in reports)
    job = ExportJob(id=uuid.uuid4().hex, user_id=user_id, filename=filename,
                    total_reports=len(reports), total_photos=total_photos)
    with _lock:
        if any(j.user_id == user_id and j.status == "running" for j in _jobs.values()):
            raise ExportJobBusy()
        _jobs[job.id] = job

    def on_report() -> None:
        job.done_reports += 1
        if job.cancel_event.is_set():
            raise ExportCancelled()

    def on_photo() -> None:
        job.done_photos += 1
        if job.cancel_event.is_set():
            raise ExportCancelled()

    def run() -> None:
        try:
            buf = build(reports, compact=True, on_report=on_report, on_photo=on_photo)
            if job.cancel_event.is_set():
                raise ExportCancelled()
            out = Path(tempfile.mkdtemp(prefix="wpr-export-")) / "export.xlsx"
            out.write_bytes(buf.getvalue())
            job.path = out
            job.status = "done"
            if job.cancel_event.is_set():  # 寫檔期間被取消／清除
                job.status = "cancelled"
                _remove_file(job)
        except ExportCancelled:
            job.status = "cancelled"
        except Exception as exc:  # noqa: BLE001 — 背景執行緒：錯誤轉成狀態讓前端顯示
            job.status = "error"
            job.error = f"匯出失敗：{exc}"

    threading.Thread(target=run, name=f"wpr-export-{job.id[:8]}", daemon=True).start()
    return job


def get_job(job_id: str, user_id: int) -> ExportJob | None:
    """只回傳本人的工作；別人的或不存在／已過期 → None。"""
    purge_expired()
    with _lock:
        job = _jobs.get(job_id)
    return job if job is not None and job.user_id == user_id else None


def cancel_job(job: ExportJob) -> None:
    """取消並移除工作（已完成的直接刪暫存檔）。"""
    job.cancel_event.set()
    with _lock:
        _jobs.pop(job.id, None)
    if job.status != "running":
        _remove_file(job)


def finish_download(job: ExportJob) -> None:
    """下載回應送完後呼叫：移除工作與暫存檔。"""
    with _lock:
        _jobs.pop(job.id, None)
    _remove_file(job)
