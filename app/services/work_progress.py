"""Work Progress domain helpers shared by appointment mutations."""
from __future__ import annotations


def sync_work_progress_snapshot_for_appointment(conn, appointment_id: int) -> None:
    """Sync calendar-owned report snapshots while the appointment still exists.

    The caller owns the transaction.  This helper deliberately leaves
    work-progress-owned fields and ``updated_at`` untouched; appointment
    deletion later freezes the last synced snapshot through ON DELETE SET NULL.
    """
    appointment = conn.execute(
        """SELECT a.date, a.client_name, a.address, a.start_time, a.end_time,
                  a.note, s.name AS service_name
           FROM appointments a
           LEFT JOIN service_types s ON s.id=a.service_type_id
           WHERE a.id=?""",
        (appointment_id,),
    ).fetchone()
    if appointment is None:
        return

    conn.execute(
        """UPDATE daily_work_progress_reports
           SET report_date=?,
               client_name_snapshot=?,
               address_snapshot=?,
               service_name_snapshot=?,
               start_time_snapshot=?,
               end_time_snapshot=?,
               appointment_note_snapshot=?
           WHERE appointment_id=?""",
        (
            appointment["date"],
            appointment["client_name"],
            appointment["address"] or "",
            appointment["service_name"] or "",
            appointment["start_time"] or "",
            appointment["end_time"] or "",
            appointment["note"] or "",
            appointment_id,
        ),
    )
