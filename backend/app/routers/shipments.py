from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select
from typing import Optional

from ..core.database import get_session
from ..core.security import (current_user, any_role, admin_or_accountant,
                             admin_or_supervisor, can_register)
from ..models import (User, Shipment, Item, ROLE_BRANCH, ROLE_ADMIN, ROLE_BROKER,
                      ROLE_COLLECTOR, ROLE_ACCOUNTANT, _as_date)
from ..calc import compute, calc_cfg, cfg_resolver

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

EXPORTED = "تم التصدير"


def _item_rates(db: Session, item_name: str) -> tuple[float, float]:
    """يعيد (الرسم السوري للطن، الرسم العراقي للطن) للصنف من قاعدة الأصناف."""
    it = db.exec(select(Item).where(Item.name == item_name)).first()
    return (it.syrian_per_ton, it.iraqi_per_ton) if it else (0.0, 0.0)


def _fill_item_code(db: Session, sh: Shipment):
    """يملأ الكود الجمركي من قاعدة الأصناف إن كان فارغاً (يبقى قابلاً لتعديل المخلص)."""
    if not sh.item_code and sh.item_name:
        it = db.exec(select(Item).where(Item.name == sh.item_name)).first()
        if it:
            sh.item_code = it.code or ""


def _visible(user: User, q):
    """عزل البيانات: الفرع يرى ما أرسله (from_city) أو ما يصله (to_city).
    مبني على المدينة لا على مالك السجل — فيراها أي مستخدم جديد في نفس الفرع
    حتى لو أُنشئت الشحنة قبل إنشاء حسابه."""
    if user.role == ROLE_BRANCH:
        return q.where((Shipment.from_city == user.branch) |
                       (Shipment.to_city == user.branch))
    return q


def _enrich(db, sh: Shipment, resolve=None) -> dict:
    """يحسب الشحنة بمعادلات النسخة المثبَّتة عليها وقت تسجيلها (لا بالنسخة الحالية)."""
    resolve = resolve or cfg_resolver(db)
    d = sh.dict()
    syr, irq = _item_rates(db, sh.item_name)
    d.update(compute(sh, syr, irq, resolve(sh.calc_version_id)))
    return d


@router.get("")
def list_shipments(db: Session = Depends(get_session), user: User = Depends(any_role),
                   date_from: Optional[str] = None, date_to: Optional[str] = None,
                   to_city: Optional[str] = None, from_city: Optional[str] = None,
                   sender: Optional[str] = None, receiver: Optional[str] = None,
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
def customer_invoice(receiver: str, db: Session = Depends(get_session),
                     user: User = Depends(any_role),
                     date_from: Optional[str] = None, date_to: Optional[str] = None):
    """فاتورة الزبون: كل شحنات مستلِم واحد + ملخص الدفع (المستحق يُحصَّل من المستلِم عند التسليم)."""
    q = select(Shipment).where(Shipment.receiver_name == receiver)
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
    # الأجور الإضافية تُدخَل من نموذج الشحنة نفسه (لا تُصفَّر هنا)
    sh.manual_tax_advance = None
    sh.manual_consumption_fee = None
    sh.export_status = "قيد التصدير"
    # الفرع يُدخل باسم فرعه فقط
    if user.role == ROLE_BRANCH:
        sh.from_city = user.branch
    # الفرع المُنشِئ = جهة الإرسال (ثابت لعزل الصلاحيات بصرف النظر عن الدور)
    sh.branch = sh.from_city
    sh.created_by = user.username
    sh.created_by_name = user.full_name or user.username
    _fill_item_code(db, sh)
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


@router.post("/{sid}/customs/preview")
def preview_customs(sid: int, patch: dict, db: Session = Depends(get_session),
                    user: User = Depends(admin_or_accountant)):
    """معاينة حيّة أثناء الكتابة في نموذج حساب الجمارك — لا تُحفظ في قاعدة البيانات.
    الباكند يبقى مصدر الحقيقة الوحيد للمعادلات؛ الواجهة لا تُعيد تطبيقها."""
    sh = db.get(Shipment, sid)
    if not sh:
        raise HTTPException(404, "الشحنة غير موجودة")
    patch = {k: v for k, v in patch.items() if k in (CUSTOMS_FIELDS - {"customs_computed"})}
    temp = sh.model_copy(update=patch)
    syr, irq = _item_rates(db, temp.item_name)
    return compute(temp, syr, irq, calc_cfg(db))


@router.post("/{sid}/customs")
def compute_customs(sid: int, patch: dict, db: Session = Depends(get_session),
                    user: User = Depends(admin_or_accountant)):
    """خطوة «حساب الجمارك» المنفصلة — تقفل احتساب الرسوم لهذا القيد."""
    sh = db.get(Shipment, sid)
    if not sh:
        raise HTTPException(404, "الشحنة غير موجودة")
    for k in CUSTOMS_FIELDS - {"customs_computed"}:
        if k in patch:
            setattr(sh, k, patch[k])
    sh.customs_computed = True
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
        # مسؤول التجميع: بيانات التسجيل والتصدير، دون حقول الجمارك
        allowed -= CUSTOMS_FIELDS
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
    db.add(sh); db.commit(); db.refresh(sh)
    return _enrich(db, sh)


@router.delete("/{sid}")
def delete_shipment(sid: int, db: Session = Depends(get_session),
                    user: User = Depends(admin_or_supervisor)):
    sh = db.get(Shipment, sid)
    if sh:
        db.delete(sh); db.commit()
    return {"ok": True}
