"""نماذج قاعدة البيانات — تقابل أوراق الإكسل."""
from datetime import date, datetime
from typing import Optional
from sqlmodel import SQLModel, Field
from pydantic import field_validator


def _as_date(v):
    if v in (None, "", "null"):
        return None
    if isinstance(v, str):
        return date.fromisoformat(v[:10])
    return v

# ---- الأدوار ----
ROLE_ADMIN = "admin"            # الإدارة الشاملة (مدير النظام)
ROLE_SUPERVISOR = "supervisor"  # المشرف الإداري (صاحب الشركة) — حساب الجمارك والفواتير
ROLE_ACCOUNTANT = "accountant"  # المحاسب — الحسابات والتقارير والتسليم/التحصيل
ROLE_COLLECTOR = "collector"    # مسؤول التجميع — تسجيل الشحنات وتصديرها
ROLE_BROKER = "broker"          # المخلص الكمركي — بيانات التخليص الجمركي
ROLE_BRANCH = "branch"          # مكتب فرع (مُبقى كما هو)

ALL_ROLES = (ROLE_ADMIN, ROLE_SUPERVISOR, ROLE_ACCOUNTANT,
             ROLE_COLLECTOR, ROLE_BROKER, ROLE_BRANCH)


class User(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    username: str = Field(index=True, unique=True)
    full_name: str = ""
    hashed_password: str
    role: str = ROLE_BRANCH
    branch: str = ""          # المدينة/الفرع (للدور branch)
    is_active: bool = True


class Item(SQLModel, table=True):
    """قاعدة البيانات: الأصناف + الرسم السوري والعراقي للطن."""
    id: Optional[int] = Field(default=None, primary_key=True)
    code: str = ""
    name: str = Field(index=True)
    syrian_per_ton: float = 0.0   # الرسم الجمركي السوري للطن (الأصل)
    iraqi_per_ton: float = 0.0    # الرسم الجمركي العراقي للطن


class Shipment(SQLModel, table=True):
    """سجل الشحنات + الجمركة + التسليم/التحصيل (كلها في كيان واحد)."""
    id: Optional[int] = Field(default=None, primary_key=True)
    ref_no: int = Field(index=True)                 # رقم القيد
    created_at: datetime = Field(default_factory=datetime.utcnow)
    ship_date: date

    # الطرفان
    sender_name: str = ""
    sender_phone: str = ""
    receiver_name: str = ""
    receiver_phone: str = ""

    count: int = 0
    parcel_type: str = ""
    driver_name: str = ""           # السائق

    # البضاعة
    item_name: str = ""
    item_code: str = ""             # الكود الجمركي (يُجلب من الصنف ويمكن تعديله للشحنة)
    brand: str = ""                 # الماركة
    origin_country: str = ""        # بلد المنشأ
    weight_kg: float = 0.0
    # قيمة الفاتورة (دولار) — تدخل في السلفة الضريبية ورسم الإنفاق فقط
    goods_value: float = 0.0
    # ثمن البضاعة (دولار) — يدخل في حسابات الشراء نيابةً عن الزبون (العمولة ورأس المال)
    goods_price: float = 0.0
    # تجاوز اختياري للرسم السوري للطن (يعدّله المخلص الكمركي لهذه الشحنة فقط)
    syrian_per_ton: Optional[float] = None

    # مدخلات الجمركة (يدوية) — تُملأ فقط عبر خطوة «حساب الجمارك» المنفصلة
    customs_computed: bool = False  # يقابل ISNUMBER($M5) في الإكسل: تمّت الجمركة أم لا
    # الرسم العراقي للطن (تجاوز اختياري لقيمة الصنف) — الرسم الفعلي يُحسب = الوزن/1000 × هذا
    iraqi_per_ton: Optional[float] = None
    two_party_expense: float = 0.0  # مصروف طرفين
    extra_fees: float = 0.0         # أجور إضافية
    manual_tax_advance: Optional[float] = None   # تجاوز السلفة
    manual_consumption_fee: Optional[float] = None  # تجاوز رسم الإنفاق

    # التمويل (شراء نيابةً عن الزبون)
    financing: str = "الزبون اشترى بنفسه"  # أو "الشركة اشترت نيابةً عنه"
    bought_by: str = ""             # من قام بالشراء
    commission_rate: Optional[float] = None

    # المسار والدفع
    from_city: str = ""             # جهة الإرسال (الفرع المُرسِل)
    to_city: str = ""               # جهة الاستلام (الفرع المستلِم)
    fees_payment: str = "ضد الدفع"  # دفع أجور الشحن والجمركة

    # التصدير (إرسال من فرع المصدر إلى فرع الوجهة)
    export_status: str = "قيد التصدير"      # قيد التصدير / تم التصدير
    export_date: Optional[date] = None      # تاريخ إصدار/إرسال الشحنة

    # التسليم/التحصيل (في فرع الوجهة)
    delivery_status: str = "قيد التسليم"
    delivery_date: Optional[date] = None
    collection_status: str = "لم يُحصَّل"

    # نسخة المعادلات السارية وقت التسجيل — تُجمّد أرقام هذه الشحنة ضد أي تعديل لاحق
    calc_version_id: Optional[int] = None

    branch: str = ""                # الفرع المُنشِئ للسجل = جهة الإرسال (عزل الصلاحيات)
    created_by: str = ""            # اسم مستخدم من سجّل الشحنة
    created_by_name: str = ""       # الاسم الكامل لمن سجّل الشحنة (للعرض)

    @field_validator("ship_date", "delivery_date", "export_date", mode="before")
    @classmethod
    def _v_dates(cls, v): return _as_date(v)


class CalcVersion(SQLModel, table=True):
    """نسخة مجمّدة من الثوابت والمعادلات.
    كل شحنة تُثبَّت على النسخة السارية وقت تسجيلها، فتعديل أي معادلة لاحقاً
    لا يغيّر أرقام الشحنات السابقة — يسري على الشحنات الجديدة فقط."""
    id: Optional[int] = Field(default=None, primary_key=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    created_by: str = ""
    payload: str = ""     # JSON: الثوابت + الشرائح + المعادلات


class Setting(SQLModel, table=True):
    """إعدادات مفردة (مفتاح/قيمة) — تقابل خلايا الإعدادات في ورقة «قاعدة البيانات» مثل رقم_الشركة."""
    key: str = Field(primary_key=True)
    value: str = ""


class ListItem(SQLModel, table=True):
    """قوائم الخيارات القابلة للإدارة (مدن/فروع، أنواع طرود، بنود مصاريف...)
    تقابل النطاقات المسمّاة في ورقة «قاعدة البيانات» بالإكسل. القيم المحمية (protected)
    تُستخدم كنصوص ثابتة في منطق الحسابات (calc.py) ولا يجوز حذفها أو تعديلها."""
    id: Optional[int] = Field(default=None, primary_key=True)
    list_key: str = Field(index=True)   # cities / parcel_types / expense_categories / ...
    value: str
    protected: bool = False
    sort_order: int = 0


class JournalEntry(SQLModel, table=True):
    """دفتر القيود المحاسبية (إيراد/مصروف يدوي)."""
    id: Optional[int] = Field(default=None, primary_key=True)
    entry_date: date
    branch: str = ""
    kind: str = "مصروف"        # إيراد / مصروف
    category: str = ""          # البند
    description: str = ""
    amount: float = 0.0
    payment_method: str = ""
    responsible: str = ""
    notes: str = ""

    @field_validator("entry_date", mode="before")
    @classmethod
    def _v_date(cls, v): return _as_date(v)
