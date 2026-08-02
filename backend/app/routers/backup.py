"""مسارات النسخ الاحتياطي وتنزيل البيانات والاسترجاع."""
from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from fastapi.responses import StreamingResponse
import io
import os
import sqlite3
import tempfile
import datetime as dt
import urllib.parse

from ..core.security import admin_or_accountant, admin_only
from ..core import config
from ..core.database import engine, db_file_path, init_db
from ..models import User
from ..backup import run_backup, shipments_xlsx, db_snapshot

router = APIRouter(prefix="/api/backup", tags=["backup"])
XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def _attachment(data: bytes, name: str, mime: str) -> StreamingResponse:
    quoted = urllib.parse.quote(name)
    return StreamingResponse(io.BytesIO(data), media_type=mime, headers={
        "Content-Disposition": f"attachment; filename=backup; filename*=UTF-8''{quoted}"})


@router.get("/status")
def status(user: User = Depends(admin_or_accountant)):
    """هل إعدادات تلغرام مضبوطة؟ (لعرض الحالة في الواجهة)."""
    return {"telegram_ready": bool(config.TELEGRAM_BOT_TOKEN and config.TELEGRAM_CHAT_ID),
            "interval_hours": config.BACKUP_INTERVAL_HOURS,
            "sqlite": db_file_path() is not None}


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
    return _attachment(shipments_xlsx(), f"zohat_shipments_{dt.date.today()}.xlsx", XLSX_MIME)


@router.post("/db")
def download_db(user: User = Depends(admin_or_accountant)):
    """تنزيل نسخة كاملة متسقة من قاعدة البيانات (SQLite) إلى الجهاز."""
    data = db_snapshot()
    if data is None:
        raise HTTPException(400, "القاعدة ليست ملف SQLite — انسخ قاعدة Postgres من لوحة المزوّد مباشرة")
    return _attachment(data, f"zohat_db_{dt.date.today()}.sqlite", "application/octet-stream")


# الجداول التي لا بد أن تحويها أي نسخة صالحة للاسترجاع
_REQUIRED_TABLES = {"user", "shipment"}


@router.post("/restore")
async def restore_db(file: UploadFile = File(...), user: User = Depends(admin_only)):
    """استرجاع قاعدة البيانات من نسخة .sqlite/.db مرفوعة (للمدير فقط).

    خطوات الأمان: فحص ترويسة SQLite ← فحص سلامة الملف ← التحقق من الجداول الأساسية
    ← نسخة أمان من القاعدة الحالية بجانبها ← الاستبدال ← إعادة تهيئة وترحيل تلقائي."""
    path = db_file_path()
    if not path:
        raise HTTPException(400, "الاسترجاع متاح فقط عندما تكون القاعدة SQLite")
    content = await file.read()
    if not content or content[:16] != b"SQLite format 3\x00":
        raise HTTPException(400, "الملف المرفوع ليس قاعدة بيانات SQLite صالحة")

    # فحص السلامة والجداول على نسخة مؤقتة قبل لمس القاعدة الحالية.
    # الملف المؤقت يُنشأ في مجلد القاعدة نفسه كي يبقى الاستبدال ذرّياً على نفس القرص
    fd, tmp = tempfile.mkstemp(suffix=".sqlite", dir=os.path.dirname(path) or ".")
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(content)
        con = sqlite3.connect(tmp)
        try:
            ok = con.execute("PRAGMA integrity_check").fetchone()[0]
            if ok != "ok":
                raise HTTPException(400, f"النسخة تالفة — فحص السلامة أعاد: {ok}")
            tables = {r[0] for r in con.execute(
                "SELECT name FROM sqlite_master WHERE type='table'")}
            missing = _REQUIRED_TABLES - tables
            if missing:
                raise HTTPException(400, "الملف ليس نسخة من قاعدة زوهات — جداول ناقصة: "
                                         + "، ".join(sorted(missing)))
            shipments = con.execute("SELECT COUNT(*) FROM shipment").fetchone()[0]
            users = con.execute("SELECT COUNT(*) FROM user").fetchone()[0]
        except sqlite3.DatabaseError as e:
            raise HTTPException(400, f"تعذّرت قراءة النسخة: {e}")
        finally:
            con.close()

        # نسخة أمان من القاعدة الحالية قبل الاستبدال (تُحفظ بجانبها على القرص الدائم)
        stamp = dt.datetime.now().strftime("%Y%m%d_%H%M%S")
        safety = ""
        current = db_snapshot()
        if current:
            safety = f"{path}.pre_restore_{stamp}"
            with open(safety, "wb") as f:
                f.write(current)

        # الاستبدال عبر واجهة النسخ الرسمية في SQLite: تنسخ كل الصفحات داخل أقفالها
        # فتنجح حتى لو بقي اتصال ممسكاً بالملف (استبدال الملف نفسه يفشل على ويندوز)
        engine.dispose()                # إغلاق اتصالات المحرك المتجمّعة
        src = sqlite3.connect(tmp)
        dst = sqlite3.connect(path)
        try:
            src.backup(dst)
        finally:
            src.close(); dst.close()
        init_db()                       # إنشاء الجداول الجديدة وترحيل الأعمدة إن كانت النسخة قديمة
        return {"ok": True, "shipments": shipments, "users": users,
                "safety_copy": os.path.basename(safety) if safety else ""}
    finally:
        if tmp and os.path.exists(tmp):
            os.remove(tmp)
