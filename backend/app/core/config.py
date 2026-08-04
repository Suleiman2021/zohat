"""إعدادات المشروع (zohat) — تُقرأ من متغيّرات البيئة للإنتاج."""
import os
import secrets
from datetime import timedelta

# مفتاح توقيع الجلسات — في الإنتاج ضع SECRET_KEY في متغيّرات بيئة Railway.
# إن لم يُضبط يُولَّد عشوائياً (تنتهي الجلسات عند كل إعادة تشغيل — اضبطه دائماً في الإنتاج).
SECRET_KEY = os.getenv("SECRET_KEY") or secrets.token_urlsafe(48)
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE = timedelta(hours=int(os.getenv("TOKEN_HOURS", "12")))

# قاعدة البيانات: SQLite افتراضياً (محلياً)، وعلى Railway اضبط DATABASE_URL
# إلى ملف على «Volume» دائم مثل: sqlite:////data/zohat.db
# أو إلى Postgres: postgresql://...  (كلاهما مدعوم).
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./zohat.db")
# توافق: Railway/Heroku قد يعطون postgres:// بدل postgresql://
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

# نطاقات CORS المسموحة (افصل بينها بفاصلة). * يعني الكل — حدّد نطاقك في الإنتاج.
CORS_ORIGINS = [o.strip() for o in os.getenv("CORS_ORIGINS", "*").split(",") if o.strip()]

# --- إعدادات النسخ الاحتياطي (تلغرام) — اختيارية ---
TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")
TELEGRAM_CHAT_ID = os.getenv("TELEGRAM_CHAT_ID", "")
# عنوان واجهة تلغرام — يُغيَّر في الاختبار فقط، وفي الإنتاج يبقى الافتراضي
TELEGRAM_API_BASE = os.getenv("TELEGRAM_API_BASE", "https://api.telegram.org")
BACKUP_TOKEN = os.getenv("BACKUP_TOKEN", "")          # رمز سرّي لتشغيل النسخ عبر رابط cron
# كل كم ساعة تُرسل نسخة — المواعيد مثبَّتة على الساعة (0،3،6... بتوقيت دمشق). 0 = تعطيل
BACKUP_INTERVAL_HOURS = int(os.getenv("BACKUP_INTERVAL_HOURS", "3"))
# فرق توقيت دمشق عن UTC. سوريا ألغت التوقيت الصيفي منذ 2022 فهي دائماً +3
BACKUP_TZ_OFFSET = float(os.getenv("BACKUP_TZ_OFFSET", "3"))

# القيم الافتراضية (نفس منطق ملف الإكسل)
DEFAULT_TAX_ADVANCE = 0.02      # السلفة الضريبية
DEFAULT_BUY_COMMISSION = 0.05   # عمولة الشراء نيابةً عن الزبون

# شرائح رسم الإنفاق الاستهلاكي: (الحد الأدنى للرسم السوري للطن, النسبة)
CONSUMPTION_TIERS = [(0, 0.0), (101, 0.01), (201, 0.02), (401, 0.03), (601, 0.05)]
