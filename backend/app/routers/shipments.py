from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select
from typing import Optional

from ..core.database import get_session
from ..core.security import (any_role, admin_or_accountant,
                             admin_or_supervisor, can_register)
from ..models import (User, Shipment, Item, ROLE_BRANCH, ROLE_BROKER,
                      ROLE_COLLECTOR, ROLE_ACCOUNTANT, ROLE_ADMIN,
                      ROLE_SUPERVISOR, _as_date)
from ..calc import compute, calc_cfg, cfg_resolver, COMPANY, CUSTOMER

router = APIRouter(prefix="/api/shipments", tags=["shipments"])

# حقول تخصّ خطوة «حساب الجمارك» فقط — لا يجوز لدور الفرع تعديلها
# (الأجور الإضافية خرجت منها: صارت حقلاً عادياً في نموذج الشحنة)
CUSTOMS_FIELDS = {"iraqi_per_ton", "two_party_expense",
                  "manual_tax_advance", "manual_consumption_fee",
                  "commission_rate", "customs_computed"}

# ما يجوز لفرع الوجهة (المستلِم فقط، وليس المُنشِئ) تعديله
DEST_FIELDS = {"delivery_status", "delivery_date", "collection_status", "fees_payment"}

# ما يجوز للمخلص الكمركي تعديله — يُكتب على سجل الشحنة الأصلي
BROKER_FIELDS = {"item_name", "item_code", "brand", "origin_country",
                 "weight_kg", "goods_value", "syrian_per_ton"}

# ما يجوز للمحاسب تعديله (التسليم/التحصيل والحالات المالية)
ACCOUNTANT_FIELDS = DEST_FIELDS | {"export_status", "export_date", "financing",
                                   "goods_price", "bought_by"}

# حقول التصدير — ممنوعة على مسؤول التجميع (لا يصدّر ولا يغيّر تاريخ الإصدار)
EXPORT_FIELDS = {"export_status", "export_date"}

EXPORTED = "تم التصدير"


def _item_rates(db: Session, item_name: str) -> tuple[float, float, bool]:
    """(الرسم السوري للطن، الرسم العراقي للطن، أهو من «جدول 10%»؟) من قاعدة الأصناف."""
    it = db.exec(select(Item).where(Item.name == item_name)).first()
    return ((it.syrian_per_ton, it.iraqi_per_ton, bool(it.special_consumption))
            if it else (0.0, 0.0, False))


def _apply_two_party(patch: dict) -> dict:
    """يحوّل مصروف الطرفين إلى (مبلغ + علم تلقائي):
    فارغ/None → تلقائي من ثابت الطن، وأي رقم (حتى 0) → يدوي يُعتمد كما هو."""
    if "two_party_expense" not in patch:
        return patch
    patch = dict(patch)
    val = patch.pop("two_party_expense")
    if val is None or val == "":
        patch["two_party_expense"] = 0.0
        patch["two_party_auto"] = True
    else:
        patch["two_party_expense"] = float(val)
        patch["two_party_auto"] = False
    return patch


def _sync_financing(sh: Shipment):
    """تمويل البضاعة يُشتق تلقائياً من ثمن البضاعة:
    ثمن > 0 ← «الشركة اشترت نيابةً عنه»، وإلا ← «الزبون اشترى بنفسه»."""
    sh.financing = COMPANY if (sh.goods_price or 0) > 0 else CUSTOMER


def _fill_item_code(db: Session, sh: Shipment):
    """يملأ الكود الجمركي من قاعدة الأصناف إن كان فارغاً (يبقى قابلاً لتعديل المخلص)."""
    if not sh.item_code and sh.item_name:
        it = db.exec(select(Item).where(Item.name == sh.item_name)).first()
        if it:
            sh.item_code = it.code or ""


def _freeze_special(db: Session, sh: Shipment):
    """يثبّت وسم «جدول 10%» على الشحنة من حالة الصنف الآن.
    يُستدعى عند التسجيل وعند تبديل صنف الشحنة فقط — فنقل صنف بين الجدولين
    لاحقاً لا يمسّ أرقام الشحنات المسجَّلة قبل النقل."""
    sh.special_consumption = _item_rates(db, sh.item_name)[2]


def _freeze_item_rates(db: Session, sh: Shipment):
    """ينسخ رسوم الصنف (السوري والعراقي للطن) إلى الشحنة إن كانت فارغة.

    بهذا تحمل كل شحنة رسومها الخاصة وقت تسجيلها، فتعديل رسم صنف لاحقاً
    لا يغيّر أرقام أي شحنة مسجَّلة — يسري على الجديدة فقط. وتجاوز المخلص
    الكمركي اليدوي يبقى كما هو لأنه يُكتب في نفس الحقلين."""
    syr, irq, _ = _item_rates(db, sh.item_name)
    if sh.syrian_per_ton is None:
        sh.syrian_per_ton = syr
    if sh.iraqi_per_ton is None:
        sh.iraqi_per_ton = irq


def _visible(user: User, q):
    """عزل البيانات: الفرع يرى ما أرسله (from_city) أو ما يصله (to_city).
    ومسؤول التجميع المرتبط بمدينة يرى شحنات مدينته فقط (جهة الإرسال).
    مبني على المدينة لا على مالك السجل — فيراها أي مستخدم جديد في نفس المدينة
    حتى لو أُنشئت الشحنة قبل إنشاء حسابه. ومَن بلا مدينة يرى الكل (كما كان)."""
    if user.role == ROLE_BRANCH:
        return q.where((Shipment.from_city == user.branch) |
                       (Shipment.to_city == user.branch))
    if user.role == ROLE_COLLECTOR and (user.branch or "").strip():
        return q.where(Shipment.from_city == user.branch)
    return q


def _sync_mahmoud(db: Session, sh: Shipment, before: dict, user: User) -> list:
    """يوائم استحقاقات «حسابات محمود» بعد تبدّل مسؤولية شحنة صادرة.
    الاستيراد داخل الدالة تفادياً لدورة استيراد بين الموجّهين."""
    try:
        from .mahmoud import sync_after_shipment_edit
        return sync_after_shipment_edit(db, sh, before, user)
    except Exception as e:      # المحاسبة اليدوية لا يجوز أن تُفشل تعديل الشحنة
        print(f"[!] تعذّرت مواءمة حسابات محمود للقيد {sh.ref_no}: {e}")
        return []


def _assert_collector_city(user: User, sh: Shipment):
    """عزل مسؤول التجميع لا يكفي إخفاءً في القوائم — يجب منع الوصول بالمعرِّف أيضاً،
    وإلا عدّل شحنة مدينة أخرى لو عرف رقمها."""
    if user.role == ROLE_COLLECTOR and (user.branch or "").strip() \
            and sh.from_city != user.branch:
        raise HTTPException(403, f"هذه الشحنة ليست من {user.branch} — خارج نطاق صلاحيتك")


def _enrich(db, sh: Shipment, resolve=None) -> dict:
    """يحسب الشحنة بمعادلات النسخة المثبَّتة عليها وقت تسجيلها (لا بالنسخة الحالية)."""
    resolve = resolve or cfg_resolver(db)
    d = sh.dict()
    syr, irq, _ = _item_rates(db, sh.item_name)
    # الوسم يُقرأ من الشحنة نفسها (مجمَّد وقت تسجيلها) لا من حالة الصنف الآن
    d.update(compute(sh, syr, irq, resolve(sh.calc_version_id),
                     bool(sh.special_consumption)))
    return d


@router.get("")
def list_shipments(db: Session = Depends(get_session), user: User = Depends(any_role),
                   date_from: Optional[str] = None, date_to: Optional[str] = None,
                   to_city: Optional[str] = None, from_city: Optional[str] = None,
                   sender: Optional[str] = None, receiver: Optional[str] = None,
                   item: Optional[str] = None,
                   fees_payment: Optional[str] = None,
                   financing: Optional[str] = None,
                   export_status: Optional[str] = None,
                   delivery_status: Optional[str] = None,
                   collection_status: Optional[str] = None,
                   customs_status: Optional[str] = None):
    q = select(Shipment)
    q = _visible(user, q)
    if date_from: q = q.where(Shipment.ship_date >= date_from)
    if date_to: q = q.where(Shipment.ship_date <= date_to)
    if to_city: q = q.where(Shipment.to_city == to_city)
    if from_city: q = q.where(Shipment.from_city == from_city)
    if sender: q = q.where(Shipment.sender_name.contains(sender))
    if receiver: q = q.where(Shipment.receiver_name.contains(receiver))
    # الصنف: بحث جزئي بالاسم أو بالكود الجمركي
    if item:
        q = q.where(Shipment.item_name.contains(item) | Shipment.item_code.contains(item))
    if fees_payment: q = q.where(Shipment.fees_payment == fees_payment)
    if financing: q = q.where(Shipment.financing == financing)
    if export_status: q = q.where(Shipment.export_status == export_status)
    if delivery_status: q = q.where(Shipment.delivery_status == delivery_status)
    if collection_status: q = q.where(Shipment.collection_status == collection_status)
    resolve = cfg_resolver(db)
    rows = [_enrich(db, s, resolve) for s in db.exec(q).all()]
    # حالة الجمركة مشتقّة (customs_status)، تُطبَّق بعد الحساب
    if customs_status:
        rows = [r for r in rows if r["customs_status"] == customs_status]
    rows.sort(key=lambda r: r["ref_no"], reverse=True)
    return rows


@router.get("/invoice")
def customer_invoice(db: Session = Depends(get_session), user: User = Depends(any_role),
                     receiver: Optional[str] = None, sender: Optional[str] = None,
                     date_from: Optional[str] = None, date_to: Optional[str] = None):
    """فاتورة الزبون — بالمستلِم أو بالمرسِل (يُحدَّد بحسب ما بحث به المستخدم)."""
    receiver = (receiver or "").strip()
    sender = (sender or "").strip()
    if not receiver and not sender:
        raise HTTPException(400, "حدّد اسم المستلِم أو اسم المرسِل")
    q = select(Shipment)
    if receiver:
        q = q.where(Shipment.receiver_name == receiver)
    if sender:
        q = q.where(Shipment.sender_name == sender)
    q = _visible(user, q)
    if date_from: q = q.where(Shipment.ship_date >= date_from)
    if date_to: q = q.where(Shipment.ship_date <= date_to)
    resolve = cfg_resolver(db)
    rows = [_enrich(db, s, resolve) for s in db.exec(q).all()]
    rows.sort(key=lambda r: r["ship_date"])
    summary = {
        "cash_in": round(sum(r["cash_in"] for r in rows), 2),
        "cod_due": round(sum(r["cod_due"] for r in rows), 2),
        "grand_total": round(sum(r["grand_total"] for r in rows), 2),
    }
    return {"rows": rows, "summary": summary}


@router.post("")
def create_shipment(sh: Shipment, db: Session = Depends(get_session),
                    user: User = Depends(can_register)):
    # رقم القيد التالي
    last = db.exec(select(Shipment).order_by(Shipment.ref_no.desc())).first()
    sh.ref_no = (last.ref_no + 1) if last else 1001
    sh.ship_date = _as_date(sh.ship_date)
    sh.delivery_date = _as_date(sh.delivery_date)
    sh.export_date = _as_date(sh.export_date)
    # حقول الجمارك لا تُدخَل عند الاستلام — تُملأ لاحقاً عبر /customs فقط
    sh.customs_computed = False
    sh.iraqi_per_ton = None
    sh.two_party_expense = 0.0
    sh.two_party_auto = True      # فارغ → يُحسب تلقائياً حتى تُدخل قيمة يدوية في الجمارك
    # الأجور الإضافية تُدخَل من نموذج الشحنة نفسه (لا تُصفَّر هنا)
    sh.manual_tax_advance = None
    sh.manual_consumption_fee = None
    # الشحنة الجديدة تبدأ دائماً قيد التصدير بلا تاريخ إصدار — حتى لو نُسخت
    # حقولها عن شحنة مُصدَّرة عبر «حفظ وإضافة صنف آخر»
    sh.export_status = "قيد التصدير"
    sh.export_date = None
    # الفرع — ومسؤول التجميع المرتبط بمدينة — يُدخل باسم مدينته فقط،
    # وإلا سجّل شحنة بجهة إرسال أخرى فاختفت عنه فوراً بحكم عزل الرؤية
    if user.role == ROLE_BRANCH or (user.role == ROLE_COLLECTOR and (user.branch or "").strip()):
        sh.from_city = user.branch
    # الفرع المُنشِئ = جهة الإرسال (ثابت لعزل الصلاحيات بصرف النظر عن الدور)
    sh.branch = sh.from_city
    sh.created_by = user.username
    sh.created_by_name = user.full_name or user.username
    _fill_item_code(db, sh)
    _freeze_special(db, sh)     # وسم «جدول 10%» يُثبَّت بحالة الصنف الآن
    _freeze_item_rates(db, sh)  # ورسوم الصنف تُنسخ عليها فلا يمسّها تعديل لاحق
    _sync_financing(sh)   # التمويل مشتق من ثمن البضاعة
    # تثبيت نسخة المعادلات السارية الآن — أي تعديل لاحق عليها لن يمسّ هذه الشحنة
    resolve = cfg_resolver(db)
    sh.calc_version_id = resolve.current_id
    db.add(sh); db.commit(); db.refresh(sh)
    return _enrich(db, sh, resolve)


@router.post("/export")
def export_shipments(payload: dict, db: Session = Depends(get_session),
                     user: User = Depends(any_role)):
    """تصدير/إرسال دفعة شحنات إلى الوجهة مع تاريخ الإصدار.
    الفرع يصدّر ما أنشأه فقط؛ المدير/المحاسب أي شحنة. يقبل status لإرجاع الحالة."""
    if user.role == ROLE_BROKER:
        raise HTTPException(403, "المخلص الكمركي لا يصدّر الشحنات")
    if user.role == ROLE_COLLECTOR:
        raise HTTPException(403, "مسؤول التجميع لا يصدّر الشحنات — التصدير من صلاحية الإدارة")
    ids = payload.get("ids") or []
    export_date = _as_date(payload.get("export_date"))
    status = payload.get("status", EXPORTED)
    done = 0
    for sid in ids:
        sh = db.get(Shipment, sid)
        if not sh:
            continue
        if user.role == ROLE_BRANCH and sh.from_city != user.branch:
            continue  # الفرع لا يصدّر إلا شحنات مصدره
        sh.export_status = status
        sh.export_date = export_date if status == EXPORTED else None
        db.add(sh); done += 1
    db.commit()
    return {"updated": done}


# الحقول القابلة للتعميم على شحنات نفس المستلِم: (المفتاح، الاسم المعروض)
PROPAGATE_FIELDS = {"to_city": "جهة الاستلام",
                    "fees_payment": "دفع أجور الشحن والجمركة",
                    "collection_status": "حالة التحصيل"}


@router.post("/{sid}/propagate-destination")
def propagate_destination(sid: int, db: Session = Depends(get_session),
                          user: User = Depends(any_role)):
    """(مسار قديم) تعميم جهة الاستلام — يوجّه إلى التعميم العام."""
    return propagate_field(sid, {"field": "to_city"}, db, user)


@router.post("/{sid}/propagate")
def propagate_field(sid: int, payload: dict, db: Session = Depends(get_session),
                    user: User = Depends(any_role)):
    """تعميم حقل على بقية شحنات نفس المستلِم ضمن نفس الدفعة:
    • الشحنة قيد التصدير ← كل شحنات المستلِم التي ما زالت قيد التصدير.
    • الشحنة مُصدَّرة     ← شحنات المستلِم المصدَّرة **بنفس تاريخ التصدير فقط**،
      فلا يمتدّ التعديل إلى دفعات أخرى للزبون نفسه.
    وتعديل حالات الدفع/التحصيل على شحنات صادرة يُوائم استحقاقات حسابات محمود."""
    field = str(payload.get("field") or "to_city")
    if field not in PROPAGATE_FIELDS:
        raise HTTPException(400, "حقل غير قابل للتعميم")
    sh = db.get(Shipment, sid)
    if not sh:
        raise HTTPException(404, "الشحنة غير موجودة")
    _assert_collector_city(user, sh)
    if user.role in (ROLE_BROKER, ROLE_COLLECTOR) and sh.export_status == EXPORTED:
        raise HTTPException(403, "لا تملك صلاحية تعديل الشحنات المُصدَّرة")
    # التعميم لا يمنح صلاحية لا يملكها المستخدم على الحقل نفسه
    if user.role == ROLE_BROKER and field not in BROKER_FIELDS:
        raise HTTPException(403, "لا تملك صلاحية تعديل هذا الحقل")
    if user.role == ROLE_ACCOUNTANT and field not in ACCOUNTANT_FIELDS:
        raise HTTPException(403, "لا تملك صلاحية تعديل هذا الحقل")
    name = (sh.receiver_name or "").strip()
    if not name:
        raise HTTPException(400, "الشحنة بلا اسم مستلِم — لا يمكن التعميم")

    q = select(Shipment).where(Shipment.receiver_name == name,
                               Shipment.export_status == sh.export_status)
    if sh.export_status == EXPORTED:
        if not sh.export_date:
            raise HTTPException(400, "الشحنة مُصدَّرة بلا تاريخ تصدير — لا يمكن تحديد الدفعة")
        q = q.where(Shipment.export_date == sh.export_date)
    q = _visible(user, q)

    value = getattr(sh, field)
    updated, skipped, synced = 0, 0, []
    for other in db.exec(q).all():
        if other.id == sh.id or getattr(other, field) == value:
            continue
        # الفرع لا يعدّل إلا شحنات أنشأها مصدره
        if user.role == ROLE_BRANCH and other.from_city != user.branch:
            skipped += 1
            continue
        before = {"fees_payment": other.fees_payment,
                  "collection_status": other.collection_status}
        setattr(other, field, value)
        db.add(other); updated += 1
        if field != "to_city":
            synced.append((other, before))
    db.commit()
    # مواءمة استحقاقات حسابات محمود لكل شحنة تبدّلت مسؤوليتها
    changes = []
    for other, before in synced:
        db.refresh(other)
        changes += _sync_mahmoud(db, other, before, user)
    scope = (f"المُصدَّرة بتاريخ {sh.export_date}" if sh.export_status == EXPORTED
             else "قيد التصدير")
    return {"updated": updated, "skipped": skipped, "field": field,
            "field_label": PROPAGATE_FIELDS[field], "value": value,
            "to_city": sh.to_city, "receiver": name, "scope": scope,
            "mahmoud_changes": changes}


@router.post("/{sid}/customs/preview")
def preview_customs(sid: int, patch: dict, db: Session = Depends(get_session),
                    user: User = Depends(admin_or_accountant)):
    """معاينة حيّة أثناء الكتابة في نموذج حساب الجمارك — لا تُحفظ في قاعدة البيانات.
    الباكند يبقى مصدر الحقيقة الوحيد للمعادلات؛ الواجهة لا تُعيد تطبيقها."""
    sh = db.get(Shipment, sid)
    if not sh:
        raise HTTPException(404, "الشحنة غير موجودة")
    patch = _apply_two_party(patch)
    allowed = (CUSTOMS_FIELDS - {"customs_computed"}) | {"two_party_auto"}
    patch = {k: v for k, v in patch.items() if k in allowed}
    temp = sh.model_copy(update=patch)
    syr, irq, _ = _item_rates(db, temp.item_name)
    # المعاينة تعكس ما هو مُثبَّت على الشحنة (لا حالة الصنف الحالية)
    special = bool(temp.special_consumption)
    return {**compute(temp, syr, irq, calc_cfg(db), special),
            "special_consumption": special}


@router.post("/{sid}/customs")
def compute_customs(sid: int, patch: dict, db: Session = Depends(get_session),
                    user: User = Depends(admin_or_accountant)):
    """خطوة «حساب الجمارك» المنفصلة — تقفل احتساب الرسوم لهذا القيد."""
    sh = db.get(Shipment, sid)
    if not sh:
        raise HTTPException(404, "الشحنة غير موجودة")
    patch = _apply_two_party(patch)
    for k in (CUSTOMS_FIELDS - {"customs_computed"}) | {"two_party_auto"}:
        if k in patch:
            setattr(sh, k, patch[k])
    sh.customs_computed = True
    # ترك حقل الرسم فارغاً يعني «خذ رسم الصنف» — فيُثبَّت عليها الآن ولا يبقى معلّقاً
    _freeze_item_rates(db, sh)
    db.add(sh); db.commit(); db.refresh(sh)
    return _enrich(db, sh)


@router.put("/{sid}")
def update_shipment(sid: int, patch: dict, db: Session = Depends(get_session),
                    user: User = Depends(any_role)):
    sh = db.get(Shipment, sid)
    if not sh:
        raise HTTPException(404, "الشحنة غير موجودة")
    allowed = set(patch.keys())
    if user.role == ROLE_BRANCH:
        is_origin = sh.from_city == user.branch
        is_dest = sh.to_city == user.branch
        if not (is_origin or is_dest):
            raise HTTPException(403, "لا تملك صلاحية على هذه الشحنة")
        allowed -= CUSTOMS_FIELDS  # الفرع لا يعدّل حقول الجمارك مطلقاً
        if not is_origin:          # فرع الوجهة فقط: التسليم/التحصيل/دفع الأجور
            allowed &= DEST_FIELDS
    elif user.role == ROLE_BROKER:
        # المخلص الكمركي: بيانات التخليص فقط — تُكتب على سجل الشحنة الأصلي
        allowed &= BROKER_FIELDS
    elif user.role == ROLE_ACCOUNTANT:
        allowed &= ACCOUNTANT_FIELDS
    elif user.role == ROLE_COLLECTOR:
        # مسؤول التجميع: بيانات التسجيل فقط — لا جمارك ولا تصدير،
        # والشحنة بعد تصديرها تخرج من يده تماماً
        _assert_collector_city(user, sh)
        if sh.export_status == EXPORTED:
            raise HTTPException(403, "الشحنة مُصدَّرة — لا يمكن لمسؤول التجميع تعديلها")
        allowed -= CUSTOMS_FIELDS | EXPORT_FIELDS
    # الحالتان اللتان تحدّدان مَن عليه الاستحقاق في حسابات محمود — نلتقطهما قبل التعديل
    before = {"fees_payment": sh.fees_payment,
              "collection_status": sh.collection_status}
    for k in allowed:
        if hasattr(sh, k):
            val = patch[k]
            if k in ("ship_date", "delivery_date", "export_date"):
                val = _as_date(val)
            setattr(sh, k, val)
    # لو أُنشئت الشحنة بجهة إرسال جديدة أبقِ حقل الفرع متسقاً معها
    if "from_city" in allowed:
        sh.branch = sh.from_city
    if "item_name" in allowed:
        _fill_item_code(db, sh)   # صنف جديد بلا كود → اجلب كوده من قاعدة الأصناف
        _freeze_special(db, sh)   # وتبديل الصنف يعيد تثبيت وسم «جدول 10%» عليه
        # وتبديل الصنف يجلب رسوم الصنف الجديد (ما لم يكن هناك تجاوز يدوي مُرسَل)
        if "syrian_per_ton" not in allowed:
            sh.syrian_per_ton = None
        if "iraqi_per_ton" not in allowed:
            sh.iraqi_per_ton = None
    if "goods_price" in allowed:
        _sync_financing(sh)       # التمويل يتبع ثمن البضاعة دائماً
    # الشحنة تحمل رسومها دائماً — وإفراغ حقل يدوياً يُعيد تثبيت رسم الصنف الحالي
    _freeze_item_rates(db, sh)
    db.add(sh); db.commit(); db.refresh(sh)
    # تبدّل المسؤولية (ضد الدفع ↔ آجل، لم يُحصَّل ↔ آجل) يصحّح استحقاقات محمود
    changes = _sync_mahmoud(db, sh, before, user)
    out = _enrich(db, sh)
    if changes:
        out["mahmoud_changes"] = changes
    return out


@router.post("/bulk-delete")
def bulk_delete(payload: dict, db: Session = Depends(get_session),
                user: User = Depends(admin_or_supervisor)):
    """حذف دفعة شحنات محدَّدة (مع حساب جمركتها — كيان واحد)."""
    ids = payload.get("ids") or []
    if not ids:
        raise HTTPException(400, "لم تُحدَّد أي شحنة")
    done = 0
    for sid in ids:
        sh = db.get(Shipment, sid)
        if sh:
            db.delete(sh); done += 1
    db.commit()
    return {"deleted": done}


@router.delete("/{sid}")
def delete_shipment(sid: int, db: Session = Depends(get_session),
                    user: User = Depends(any_role)):
    """حذف شحنة (ومعها حساب جمركتها — كيان واحد).

    الإدارة والمشرف الإداري: أي شحنة.
    مسؤول التجميع: شحناته هو فقط، وما دامت **قيد التصدير** — فلا يحذف
    ما سجّله غيره ولا ما خرج إلى الوجهة. وبقية الأدوار لا تحذف إطلاقاً."""
    sh = db.get(Shipment, sid)
    if not sh:
        return {"ok": True}                      # محذوفة سلفاً — لا شيء يُفعل
    if user.role in (ROLE_ADMIN, ROLE_SUPERVISOR):
        pass
    elif user.role == ROLE_COLLECTOR:
        _assert_collector_city(user, sh)
        if sh.export_status == EXPORTED:
            raise HTTPException(403, "الشحنة مُصدَّرة — لا يمكن حذفها")
        if (sh.created_by or "") != user.username:
            raise HTTPException(403, "لا يمكنك حذف إلا الشحنات التي سجّلتها بنفسك")
    else:
        raise HTTPException(403, "لا تملك صلاحية حذف الشحنات")
    db.delete(sh); db.commit()
    return {"ok": True}
