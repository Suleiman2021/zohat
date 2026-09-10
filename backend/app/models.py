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
    # صنف من «جدول 10%»: نسبة رسم الإنفاق الاستهلاكي ثابتة من الإعدادات،
    # ولا تُؤخذ من شرائح الرسم السوري إطلاقاً
    special_consumption: bool = False
    # تجاوز نسب هذا الصنف — None يعني «استعمل الافتراضي من الطباعة والمعادلات»
    tax_advance_rate: Optional[float] = None      # نسبة السلفة الضريبية
    consumption_rate: Optional[float] = None      # نسبة رسم الإنفاق الاستهلاكي


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
    # مصروف طرفين: المبلغ اليدوي لكامل الشحنة، و two_party_auto=True يعني الحقل فارغ
    # فيُحسب تلقائياً من ثابت مصروف الطرفين للطن.
    two_party_expense: float = 0.0
    two_party_auto: bool = True
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
    # يُجمَّد عند التسجيل من وسم الصنف وقتها — فنقل صنف لاحقاً بين جدولي الأصناف
    # لا يغيّر أرقام الشحنات المسجَّلة قبله (يتغيّر فقط إن بُدِّل صنف الشحنة نفسه)
    special_consumption: bool = False
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

    # النسبتان مجمَّدتان وقت التسجيل (None في الشحنات القديمة = تُقرأ من نسخة المعادلات
    # المثبَّتة عليها كما كان، فلا تتغيّر أرقامها إطلاقاً)
    tax_advance_rate: Optional[float] = None
    consumption_rate: Optional[float] = None

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


# ================== حسابات محمود (نظام محاسبي منفصل تماماً) ==================
# نظام يدوي بالكامل لا يتأثر بالشحنات ولا يؤثر عليها — عدا شاشة مقارنة الجمارك
# التي تعرض الأرقام الأصلية بجانب اليدوية للمراجعة فقط.

BOX_OFFICE = "مكتب"
BOX_CUSTOMER = "زبون"
BOX_BROKER_SY = "مخلص سوري"
BOX_BROKER_IQ = "مخلص عراقي"
BOX_OTHER = "أخرى"
BOX_TYPES = (BOX_OFFICE, BOX_CUSTOMER, BOX_BROKER_SY, BOX_BROKER_IQ, BOX_OTHER)


class MBox(SQLModel, table=True):
    """جهة محاسبية: صندوق مكتب أو زبون أو مخلّص (سوري/عراقي).
    لا تحمل رصيداً مخزَّناً — الرصيد يُحسب دائماً من قيود دفتر الأستاذ."""
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(index=True)
    box_type: str = BOX_OFFICE
    opening_balance: float = 0.0    # (مهجور) رُحِّل إلى قيد افتتاحي في الدفتر
    notes: str = ""
    is_active: bool = True
    allow_credit: bool = False      # السماح برصيد دائن (دفعات تتجاوز المستحق)
    created_at: datetime = Field(default_factory=datetime.utcnow)


class MEntry(SQLModel, table=True):
    """(مهجور) حركات النظام القديم — يُحتفظ بها للترحيل فقط، ولا تُستخدم في الحساب."""
    id: Optional[int] = Field(default=None, primary_key=True)
    box_id: int = Field(index=True)
    entry_date: date
    kind: str = "مصروف"
    category: str = ""
    description: str = ""
    amount: float = 0.0
    counterparty: str = ""
    payment_method: str = ""
    ref_no: str = ""
    notes: str = ""
    created_by: str = ""
    created_at: datetime = Field(default_factory=datetime.utcnow)
    migrated: bool = False          # رُحِّلت إلى دفتر الأستاذ الجديد؟

    @field_validator("entry_date", mode="before")
    @classmethod
    def _v_date(cls, v): return _as_date(v)


# ---- دفتر الأستاذ: المصدر الوحيد للأرصدة (لا يُعدَّل رصيد يدوياً إطلاقاً) ----
# الرصيد المستحق = الاستحقاقات − (الدفعات + المصاريف + بدل التاجر)
TXN_CHARGE = "استحقاق"    # يزيد الرصيد المستحق على الجهة
TXN_PAYMENT = "دفعة"      # يُنقصه (نقد استلمه المحاسب)
TXN_EXPENSE = "مصروف"     # يُنقصه (أنفقته الجهة نيابةً عن الشركة)
# يُنقصه: ثمن بضاعة دفعه مكتب الإرسال للتاجر نيابةً عن الزبون. مستقل عن «مصروف»
# كي يُتتبَّع وحده — فمجموعه يطابق مشتريات الشركة نيابةً عن الزبائن.
TXN_MERCHANT = "بدل تاجر"
TXN_TYPES = (TXN_CHARGE, TXN_PAYMENT, TXN_EXPENSE, TXN_MERCHANT)

# سعر صرف الدينار العراقي: كم ديناراً مقابل دولار واحد
CUR_IQD = "دينار"

# أسباب الاستحقاق (مرنة — يمكن للمحاسب كتابة سبب آخر)
CHARGE_REASONS = ("شحنة", "عمولة", "إيراد", "تسوية", "أخرى")

# العملات — كل عملة محاسبة مستقلة تماماً: أرصدتها ومجاميعها لا تُخلط بغيرها
CUR_USD = "دولار"
CUR_EUR = "يورو"
CURRENCIES = (CUR_USD, CUR_EUR)


class MTxn(SQLModel, table=True):
    """قيد في دفتر أستاذ الجهة. المبلغ دائماً موجب، والاتجاه يحدّده النوع.
    القيود لا تُحذف — تُلغى (is_void) ويبقى أثرها في الكشف."""
    id: Optional[int] = Field(default=None, primary_key=True)
    party_id: int = Field(index=True)          # الجهة (صندوق/مكتب/زبون/مخلّص)
    txn_date: date = Field(index=True)         # تاريخ العملية (يحدّده المحاسب)
    txn_type: str = TXN_CHARGE
    amount: float = 0.0                        # موجب دائماً
    currency: str = CUR_USD                    # عملة القيد — لا تُخلط بغيرها أبداً
    reason: str = ""                           # سبب الاستحقاق أو بند المصروف
    description: str = ""
    payment_method: str = ""
    ref_no: str = ""                           # رقم وصل/مرجع خارجي
    notes: str = ""

    created_by: str = ""
    created_at: datetime = Field(default_factory=datetime.utcnow)   # التاريخ والوقت

    is_void: bool = False                      # ملغاة؟ تُستثنى من الرصيد ويبقى سجلها
    void_reason: str = ""
    voided_by: str = ""
    voided_at: Optional[datetime] = None

    edited_count: int = 0
    edited_by: str = ""
    edited_at: Optional[datetime] = None

    # إدخال بعملة غير عملة القيد (الدينار) — يُحفظ الأصل وسعر الصرف المستعمل،
    # فتغيير سعر الصرف لاحقاً لا يمسّ هذا القيد، ويبقى التحويل قابلاً للتدقيق
    orig_amount: Optional[float] = None
    orig_currency: str = ""
    fx_rate: Optional[float] = None

    @field_validator("txn_date", mode="before")
    @classmethod
    def _v_date(cls, v): return _as_date(v)


class MFxRate(SQLModel, table=True):
    """سجل أسعار صرف الدينار مقابل الدولار — الساري هو الأحدث.
    يُحفظ كل تغيير (من غيّره ومتى) بدل الكتابة فوق قيمة واحدة."""
    id: Optional[int] = Field(default=None, primary_key=True)
    iqd_per_usd: float                         # كم ديناراً = 1 دولار
    notes: str = ""
    set_by: str = ""
    set_at: datetime = Field(default_factory=datetime.utcnow)


class MTxnAudit(SQLModel, table=True):
    """سجل تدقيق: كل تعديل أو إلغاء لقيد يُحفظ هنا بقيمه القديمة."""
    id: Optional[int] = Field(default=None, primary_key=True)
    txn_id: int = Field(index=True)
    action: str = "تعديل"                      # تعديل / إلغاء
    changes: str = ""                          # JSON بالقيم قبل وبعد
    by_user: str = ""
    at: datetime = Field(default_factory=datetime.utcnow)


class MExportRevenue(SQLModel, table=True):
    """إيراد شحنة صادرة (بتاريخ تصدير): الإجمالي يُجلب من النظام الأساسي،
    ويُطرح منه مصرفا حمزة وماجد (يدويان) للوصول إلى الإيراد الصافي."""
    id: Optional[int] = Field(default=None, primary_key=True)
    export_date: date = Field(index=True, unique=True)
    hamza_expense: float = 0.0      # مصرف حمزة (يدوي)
    majed_expense: float = 0.0      # مصرف ماجد (يدوي)
    notes: str = ""
    updated_by: str = ""
    updated_at: Optional[datetime] = None

    @field_validator("export_date", mode="before")
    @classmethod
    def _v_date(cls, v): return _as_date(v)


class MCustomsCheck(SQLModel, table=True):
    """مقارنة الجمارك: مجاميع يدوية يُدخلها المحاسب لفترة، تُقارَن بالأصلية المحسوبة."""
    id: Optional[int] = Field(default=None, primary_key=True)
    date_from: date
    date_to: date
    manual_syrian: float = 0.0      # مجموع الرسم الجمركي السوري (يدوي)
    manual_iraqi: float = 0.0       # مجموع الرسم الجمركي العراقي (يدوي)
    notes: str = ""
    created_by: str = ""
    created_at: datetime = Field(default_factory=datetime.utcnow)

    @field_validator("date_from", "date_to", mode="before")
    @classmethod
    def _v_dates(cls, v): return _as_date(v)


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
