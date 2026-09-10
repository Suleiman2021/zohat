"""محرّك قاعدة البيانات وجلساتها."""
import os
from sqlmodel import SQLModel, create_engine, Session
from sqlalchemy import inspect, text
from .config import DATABASE_URL

_is_sqlite = DATABASE_URL.startswith("sqlite")

# لملفات SQLite على مسار Volume دائم: تأكّد من وجود المجلد
if _is_sqlite and DATABASE_URL.startswith("sqlite:////"):
    _path = DATABASE_URL.replace("sqlite:////", "/", 1)
    os.makedirs(os.path.dirname(_path) or "/", exist_ok=True)

# connect_args={"check_same_thread": False} خاص بـ SQLite فقط؛ pool_pre_ping لثبات Postgres
_connect_args = {"check_same_thread": False} if _is_sqlite else {}
engine = create_engine(
    DATABASE_URL, echo=False, pool_pre_ping=not _is_sqlite,
    connect_args=_connect_args,
)


def db_file_path() -> str | None:
    """مسار ملف SQLite على القرص (للنسخ الاحتياطي) — None إن كانت القاعدة ليست SQLite."""
    if not _is_sqlite:
        return None
    url = DATABASE_URL.replace("sqlite:///", "", 1)
    if url.startswith("/"):        # مسار مطلق (sqlite:////data/zohat.db)
        return url
    return os.path.abspath(url)   # مسار نسبي (sqlite:///./zohat.db)


# ترحيل خفيف: أعمدة أُضيفت لاحقاً على جداول موجودة مسبقاً (SQLite لا يضيفها تلقائياً)
# (اسم العمود، تعريف SQL) — يُضاف فقط إن كان غائباً حتى لا نفقد بيانات المستخدم.
_MIGRATIONS = {
    # «item» أولاً: ترحيل الشحنات يقرأ عمود الصنف الجديد، فيجب أن يكون موجوداً
    "item": [
        ("iraqi_per_ton", "FLOAT DEFAULT 0"),
        ("special_consumption", "INTEGER DEFAULT 0"),
        ("tax_advance_rate", "FLOAT"),
        ("consumption_rate", "FLOAT"),
    ],
    "shipment": [
        ("export_status", "TEXT DEFAULT 'قيد التصدير'"),
        ("export_date", "DATE"),
        ("created_by", "TEXT DEFAULT ''"),
        ("created_by_name", "TEXT DEFAULT ''"),
        ("iraqi_per_ton", "FLOAT"),
        ("syrian_per_ton", "FLOAT"),
        ("item_code", "TEXT DEFAULT ''"),
        ("brand", "TEXT DEFAULT ''"),
        ("origin_country", "TEXT DEFAULT ''"),
        ("goods_price", "FLOAT DEFAULT 0"),
        ("driver_name", "TEXT DEFAULT ''"),
        ("calc_version_id", "INTEGER"),
        ("two_party_auto", "INTEGER DEFAULT 1"),
        ("tax_advance_rate", "FLOAT"),
        ("consumption_rate", "FLOAT"),
        ("special_consumption", "INTEGER DEFAULT 0"),
    ],
    "mbox": [
        ("allow_credit", "INTEGER DEFAULT 0"),
    ],
    "mtxn": [
        ("currency", "TEXT DEFAULT 'دولار'"),
        ("orig_amount", "FLOAT"),
        ("orig_currency", "TEXT DEFAULT ''"),
        ("fx_rate", "FLOAT"),
    ],
    "mentry": [
        ("migrated", "INTEGER DEFAULT 0"),
    ],
}

# أعمدة قديمة تُحذف (استُبدلت بأخرى) — تجاهل الخطأ إن كانت محذوفة أصلاً
_DROP_COLUMNS = {
    "shipment": ["iraqi_duty"],   # استُبدل بـ iraqi_per_ton (يُحسب الفعلي تلقائياً)
}


def _run_migrations():
    insp = inspect(engine)
    tables = insp.get_table_names()
    with engine.begin() as conn:
        for table, cols in _MIGRATIONS.items():
            if table not in tables:
                continue  # جدول جديد → create_all يتكفّل به
            existing = {c["name"] for c in insp.get_columns(table)}
            for name, ddl in cols:
                if name not in existing:
                    conn.execute(text(f'ALTER TABLE {table} ADD COLUMN {name} {ddl}'))
                    # الشحنات القديمة التي فيها مصروف طرفين مُدخل تُعتبر «يدوية» لا تلقائية
                    if table == "shipment" and name == "two_party_auto":
                        conn.execute(text("UPDATE shipment SET two_party_auto = 0 "
                                          "WHERE two_party_expense IS NOT NULL AND two_party_expense <> 0"))
                    # تجميد وسم «جدول 10%» على الشحنات القائمة بحالته الحالية،
                    # فلا تتغيّر أرقام أي شحنة لحظة الترقية — ومن بعدها لا يمسّها نقل الأصناف
                    if table == "shipment" and name == "special_consumption":
                        conn.execute(text(
                            "UPDATE shipment SET special_consumption = 1 WHERE item_name IN "
                            "(SELECT name FROM item WHERE special_consumption = 1)"))
        for table, drops in _DROP_COLUMNS.items():
            if table not in tables:
                continue
            existing = {c["name"] for c in insp.get_columns(table)}
            for name in drops:
                if name in existing:
                    try:
                        conn.execute(text(f'ALTER TABLE {table} DROP COLUMN {name}'))
                    except Exception:
                        pass  # نسخة SQLite قديمة لا تدعم DROP COLUMN — تُترك بلا ضرر إن كانت nullable


# تجميد رسوم الصنف على الشحنات القائمة — يُنفَّذ مرة واحدة ويُعلَّم في جدول الإعدادات
_FREEZE_RATES_MARK = "freeze_item_rates_v1"


def _freeze_existing_item_rates():
    """ينسخ رسوم الصنف الحالية إلى كل شحنة قديمة لم تحمل رسمها بعد.

    قبل هذا كانت الشحنة تقرأ رسم صنفها **حياً**، فتعديل رسم صنف يغيّر أرقام
    شحنات مسجَّلة منذ شهور. بعد النسخ تبقى أرقام كل شحنة كما هي اليوم بالضبط،
    ولا يمسّها أي تعديل لاحق على الأصناف — يسري على الجديدة وحدها."""
    insp = inspect(engine)
    tables = insp.get_table_names()
    if not {"shipment", "item", "setting"} <= set(tables):
        return
    with engine.begin() as conn:
        done = conn.execute(text("SELECT value FROM setting WHERE key = :k"),
                            {"k": _FREEZE_RATES_MARK}).first()
        if done:
            return
        for col in ("syrian_per_ton", "iraqi_per_ton"):
            conn.execute(text(
                f"UPDATE shipment SET {col} = COALESCE("
                f"  (SELECT i.{col} FROM item i WHERE i.name = shipment.item_name), 0) "
                f"WHERE {col} IS NULL"))
        conn.execute(text("INSERT INTO setting (key, value) VALUES (:k, '1')"),
                     {"k": _FREEZE_RATES_MARK})
        print("[ok] جُمِّدت رسوم الأصناف على الشحنات القائمة — تعديل الأصناف لن يمسّها")


def init_db():
    SQLModel.metadata.create_all(engine)
    _run_migrations()
    _freeze_existing_item_rates()

def get_session():
    with Session(engine) as session:
        yield session
