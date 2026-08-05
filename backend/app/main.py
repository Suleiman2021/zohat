"""نقطة التشغيل: uvicorn app.main:app --reload
في الإنتاج (Railway): uvicorn app.main:app --host 0.0.0.0 --port $PORT"""
import os
import sys
import threading
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.staticfiles import StaticFiles
from sqlmodel import Session, select

from .core.database import init_db, engine
from .core.security import hash_pw
from .core import config
from .models import User, ROLE_ADMIN
from .routers import auth, shipments, accounting, admin, settings, backup, mahmoud

# رسائل الإقلاع عربية — على ويندوز قد تكون الطرفية بترميز لا يدعم العربية (cp1256)
# فتُسقط print الخادمَ كلياً عند البدء. نجعل المخرجات UTF-8 مع استبدال ما يتعذّر عرضه.
for _stream in (sys.stdout, sys.stderr):
    if _stream and hasattr(_stream, "reconfigure"):
        try:
            _stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass

app = FastAPI(title="ZOHAT — نظام الشحن والتخليص")

# ضغط الردود (يسرّع التحميل على شبكات سوريا/العراق ذات النطاق المحدود)
app.add_middleware(GZipMiddleware, minimum_size=600)
app.add_middleware(
    CORSMiddleware, allow_origins=config.CORS_ORIGINS,
    allow_methods=["*"], allow_headers=["*"],
)


@app.middleware("http")
async def _no_cache_shell(request, call_next):
    """يمنع المتصفح من تخزين صفحة التطبيق وعامل الخدمة.
    بدونها يبقى المستخدم على نسخة HTML قديمة بعد كل تحديث، لأن الصفحة
    نفسها لا تحمل باصمة نسخة (بعكس ملفات CSS/JS التي تُطلب بـ ?v=)."""
    response = await call_next(request)
    path = request.url.path
    if path in ("/", "/index.html", "/sw.js", "/manifest.json"):
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    return response

app.include_router(auth.router)
app.include_router(shipments.router)
app.include_router(accounting.router)
app.include_router(admin.router)
app.include_router(settings.router)
app.include_router(backup.router)
app.include_router(mahmoud.router)


@app.get("/healthz")
def healthz():
    return {"status": "ok"}


def seed():
    init_db()
    with Session(engine) as db:
        # مستخدم إدارة افتراضي أول مرة (يمكن تغيير كلمته من متغيّر البيئة ADMIN_PASSWORD)
        if not db.exec(select(User)).first():
            db.add(User(username="admin", full_name="المدير العام",
                        role=ROLE_ADMIN, branch="",
                        hashed_password=hash_pw(os.getenv("ADMIN_PASSWORD", "admin123"))))
            db.commit()
        settings.seed_lists(db)
        # ترقية المعادلات المُلغاة (مثل احتساب مصروف الطرفين من الطن) إلى الافتراضي الجديد
        from .calc import upgrade_superseded_formulas
        if upgrade_superseded_formulas(db):
            print("[ok] تمت ترقية معادلة مصروف الطرفين إلى الإدخال اليدوي")
        # ترحيل حسابات محمود إلى دفتر الأستاذ الجديد (مرة واحدة)
        moved = mahmoud.migrate_legacy(db)
        if moved:
            print(f"[ok] رُحِّل {moved} قيداً في حسابات محمود إلى دفتر الأستاذ")


def _backup_scheduler():
    """جدولة النسخ الاحتياطي — المواعيد مثبَّتة بالساعة ومحفوظة في القاعدة،
    فلا تُفقد بإعادة النشر ويُستدرك الموعد الفائت. (التفاصيل في backup.py)"""
    from .backup import scheduler_loop
    scheduler_loop()


@app.on_event("startup")
def _startup():
    seed()
    # تحذير مهم: بدون SECRET_KEY ثابت يتغيّر المفتاح عند كل إعادة تشغيل،
    # فتنتهي جلسات كل المستخدمين فجأة ويُطلب منهم تسجيل الدخول من جديد.
    if not os.getenv("SECRET_KEY"):
        print("[!] تحذير: SECRET_KEY غير مضبوط — ستنتهي جلسات المستخدمين عند كل إعادة تشغيل. "
              "اضبطه في متغيّرات البيئة (Railway → Variables).")
    else:
        print(f"[ok] SECRET_KEY مضبوط — مدة الجلسة {config.ACCESS_TOKEN_EXPIRE}")
    t = threading.Thread(target=_backup_scheduler, daemon=True)
    t.start()

# ملاحظة: لا تستدعِ seed() هنا (عند استيراد الملف). التهيئة تتم في حدث الإقلاع
# أعلاه، فيبقى مجرد استيراد التطبيق — لفحص أو اختبار — بلا أي كتابة في قاعدة البيانات.

# خدمة الواجهة (PWA) من نفس الخادم — ضعها آخر شيء كي لا تلتقط مسارات /api
_frontend = os.path.join(os.path.dirname(__file__), "..", "..", "frontend")
if os.path.isdir(_frontend):
    app.mount("/", StaticFiles(directory=_frontend, html=True), name="frontend")
