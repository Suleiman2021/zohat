"""مسارات النسخ الاحتياطي وتنزيل البيانات."""
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
import io

from ..core.security import admin_or_accountant
from ..core import config
from ..models import User
from ..backup import run_backup, shipments_xlsx

router = APIRouter(prefix="/api/backup", tags=["backup"])
XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


@router.get("/status")
def status(user: User = Depends(admin_or_accountant)):
    """هل إعدادات تلغرام مضبوطة؟ (لعرض الحالة في الواجهة)."""
    return {"telegram_ready": bool(config.TELEGRAM_BOT_TOKEN and config.TELEGRAM_CHAT_ID),
            "interval_hours": config.BACKUP_INTERVAL_HOURS}


@router.post("/now")
def backup_now(user: User = Depends(admin_or_accountant)):
    """تشغيل نسخة احتياطية فورية → تلغرام (يدوي)."""
    try:
        return run_backup()
    except Exception as e:
        raise HTTPException(400, str(e))


@router.get("/run")
def backup_cron(token: str = Query("")):
    """نقطة للجدولة الخارجية (cron-job.org): تُستدعى برمز سرّي بدل تسجيل الدخول."""
    if not config.BACKUP_TOKEN or token != config.BACKUP_TOKEN:
        raise HTTPException(403, "رمز غير صحيح")
    try:
        return run_backup()
    except Exception as e:
        raise HTTPException(400, str(e))


@router.post("/download")
def download_xlsx(user: User = Depends(admin_or_accountant)):
    """تنزيل ملف Excel لكل سجلات الشحنات مباشرة إلى الجهاز."""
    import datetime as dt, urllib.parse
    data = shipments_xlsx()
    name = urllib.parse.quote(f"zohat_shipments_{dt.date.today()}.xlsx")
    return StreamingResponse(io.BytesIO(data), media_type=XLSX_MIME, headers={
        "Content-Disposition": f"attachment; filename=shipments.xlsx; filename*=UTF-8''{name}"})
