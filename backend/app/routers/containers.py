"""سجل الحاويات — سجل يدوي مستقل تماماً عن سجل الشحنات.

على صورة وصل التخليص الورقي: ترويسة تحمل طرفَي الرحلة (سائق وسيارة وهاتف
لكلٍّ من الجانب العراقي والسوري) واسم التاجر وجهتي الإرسال والوجهة وبيانات
الحمولة (الوزن والعدد والأصناف)، ثم بنود المصاريف الثابتة، لكل بند مبلغه
بعملته (دولار أو دينار).

لا يمسّ هذا السجل الشحنات ولا حسابات محمود ولا أي رصيد — إدخالٌ وعرضٌ وطباعة.
العملتان لا تُجمعان أبداً: لكلٍّ مجموعها المستقل، كبقية النظام.
"""
from typing import Optional

from fastapi import APIRouter, Body, Depends, HTTPException
from sqlmodel import Session, String, select

from ..core.database import get_session
from ..core.security import admin_or_supervisor
from ..models import (User, Container, ContainerLine, CONTAINER_ITEMS,
                      CONTAINER_CURRENCIES, CUR_USD, utcnow, _as_date)

router = APIRouter(prefix="/api/containers", tags=["containers"])

# حقول الترويسة النصّية التي يقبلها الإنشاء والتعديل. رقم الوصل وبيانات
# الإنشاء يديرها النظام وحده — بدون هذا الفصل يستطيع طلبٌ عادي تزوير الرقم.
_TEXT_FIELDS = ("trader_name", "iraqi_driver", "syrian_driver", "iraqi_plate",
                "syrian_plate", "iraqi_phone", "syrian_phone", "from_city",
                "to_city", "items_desc", "notes")


def _amount(raw, label: str) -> float:
    """يرفض النص غير الرقمي برسالة واضحة بدل خطأ خادم غامض، ويرفض السالب."""
    if raw in (None, ""):
        return 0.0
    try:
        v = round(float(raw), 2)
    except (TypeError, ValueError):
        raise HTTPException(400, f"قيمة «{label}» غير صحيحة")
    if v != v or v < 0:                      # v != v يلتقط NaN
        raise HTTPException(400, f"قيمة «{label}» لا تكون سالبة")
    return v


def _count(raw, label: str) -> int:
    """العدد صحيح موجب — الكسر فيه لا معنى له."""
    if raw in (None, ""):
        return 0
    try:
        v = int(float(raw))
    except (TypeError, ValueError):
        raise HTTPException(400, f"قيمة «{label}» غير صحيحة")
    if v < 0:
        raise HTTPException(400, f"قيمة «{label}» لا تكون سالبة")
    return v


def _lines_of(db: Session, cid: int) -> list[ContainerLine]:
    return db.exec(select(ContainerLine)
                   .where(ContainerLine.container_id == cid)
                   .order_by(ContainerLine.sort_order, ContainerLine.id)).all()


def _totals(lines) -> list[dict]:
    """مجموع كل عملة على حدة — الدولار حاضر دائماً ليثبت ترتيب الأعمدة."""
    acc = {c: 0.0 for c in CONTAINER_CURRENCIES}
    for ln in lines:
        acc[ln.currency] = round(acc.get(ln.currency, 0.0) + (ln.amount or 0.0), 2)
    return [{"currency": c, "total": round(acc.get(c, 0.0), 2)} for c in acc]


def _out(c: Container, lines) -> dict:
    return {**c.dict(),
            "rec_date": str(c.rec_date) if c.rec_date else "",
            "lines": [{"label": ln.label, "amount": ln.amount,
                       "currency": ln.currency,
                       "sort_order": ln.sort_order} for ln in lines],
            "totals": _totals(lines)}


def _parse_lines(payload_lines) -> list[dict]:
    """يتحقّق من كل البنود **قبل** أي كتابة في القاعدة.

    الفصل مقصود: لو تحقّقنا أثناء الحفظ لكان طلبٌ فيه مبلغ خاطئ قد أنشأ ترويسة
    الوصل ثم فشل، فيبقى وصل يتيم بلا بنود ويُستهلك رقم وصل بلا سبب."""
    rows = payload_lines if isinstance(payload_lines, list) else []
    out = []
    for i, raw in enumerate(rows):
        if not isinstance(raw, dict):
            continue
        label = str(raw.get("label") or "").strip()
        if not label:
            continue
        cur = str(raw.get("currency") or CUR_USD).strip()
        if cur not in CONTAINER_CURRENCIES:
            raise HTTPException(400, f"عملة غير معروفة: {cur}")
        amount = _amount(raw.get("amount"), label)
        if not amount:      # بند بلا مبلغ لا يُحفظ — سطوره تُترك فارغة في الورقة
            continue
        out.append({"label": label, "amount": amount, "currency": cur,
                    "sort_order": i})
    return out


def _replace_lines(db: Session, cid: int, parsed: list[dict]):
    """يستبدل بنود الوصل كاملةً — أبسط من مطابقة سطر بسطر وأضمن لعدم بقاء بند يتيم."""
    for old in _lines_of(db, cid):
        db.delete(old)
    for row in parsed:
        db.add(ContainerLine(container_id=cid, **row))


@router.get("/meta")
def meta(user: User = Depends(admin_or_supervisor)):
    """بنود الوصل الثابتة وعملتاه — الواجهة تبني النموذج منها لا من نسخة مكرّرة."""
    return {"items": CONTAINER_ITEMS, "currencies": list(CONTAINER_CURRENCIES)}


@router.get("")
def list_containers(db: Session = Depends(get_session),
                    user: User = Depends(admin_or_supervisor),
                    date_from: Optional[str] = None, date_to: Optional[str] = None,
                    trader: Optional[str] = None, driver: Optional[str] = None,
                    plate: Optional[str] = None, phone: Optional[str] = None,
                    from_city: Optional[str] = None, to_city: Optional[str] = None,
                    ref: Optional[str] = None):
    q = select(Container)
    if date_from: q = q.where(Container.rec_date >= date_from)
    if date_to: q = q.where(Container.rec_date <= date_to)
    if trader: q = q.where(Container.trader_name.contains(trader))
    if from_city: q = q.where(Container.from_city == from_city)
    if to_city: q = q.where(Container.to_city == to_city)
    if ref and str(ref).strip():
        q = q.where(Container.ref_no.cast(String).contains(str(ref).strip()))
    # السائق/السيارة/الهاتف: يكفي تطابق أحد الطرفين العراقي أو السوري
    if driver:
        q = q.where(Container.iraqi_driver.contains(driver)
                    | Container.syrian_driver.contains(driver))
    if plate:
        q = q.where(Container.iraqi_plate.contains(plate)
                    | Container.syrian_plate.contains(plate))
    if phone:
        q = q.where(Container.iraqi_phone.contains(phone)
                    | Container.syrian_phone.contains(phone))
    rows = db.exec(q).all()
    out = [_out(c, _lines_of(db, c.id)) for c in rows]
    out.sort(key=lambda r: r["ref_no"], reverse=True)
    return out


@router.get("/{cid}")
def get_container(cid: int, db: Session = Depends(get_session),
                  user: User = Depends(admin_or_supervisor)):
    c = db.get(Container, cid)
    if not c:
        raise HTTPException(404, "الحاوية غير موجودة")
    return _out(c, _lines_of(db, c.id))


@router.post("")
def create_container(payload: dict = Body(...), db: Session = Depends(get_session),
                     user: User = Depends(admin_or_supervisor)):
    lines = _parse_lines(payload.get("lines"))     # يرفض قبل أن يُكتب أي شيء
    last = db.exec(select(Container).order_by(Container.ref_no.desc())).first()
    c = Container(ref_no=(last.ref_no + 1) if last else 1,
                  rec_date=_as_date(payload.get("rec_date")),
                  created_by=user.full_name or user.username)
    for f in _TEXT_FIELDS:
        setattr(c, f, str(payload.get(f) or "").strip())
    c.weight_kg = _amount(payload.get("weight_kg"), "الوزن")
    c.pieces = _count(payload.get("pieces"), "العدد")
    db.add(c); db.commit(); db.refresh(c)
    _dedupe_ref_no(db, c)
    _replace_lines(db, c.id, lines)
    db.commit()
    return _out(c, _lines_of(db, c.id))


def _dedupe_ref_no(db: Session, c: Container):
    """رقم الوصل يُحسب من أكبر رقم موجود، فتسجيلان متزامنان قد يأخذان الرقم نفسه.
    الأقدم (المعرّف الأصغر) يحتفظ برقمه دائماً فلا يتبدّل رقم سبق عرضه أو طُبع."""
    for _ in range(5):
        dup = db.exec(select(Container).where(Container.ref_no == c.ref_no,
                                              Container.id < c.id)).first()
        if not dup:
            return
        last = db.exec(select(Container).order_by(Container.ref_no.desc())).first()
        c.ref_no = last.ref_no + 1
        db.add(c); db.commit(); db.refresh(c)


@router.put("/{cid}")
def update_container(cid: int, payload: dict = Body(...),
                     db: Session = Depends(get_session),
                     user: User = Depends(admin_or_supervisor)):
    c = db.get(Container, cid)
    if not c:
        raise HTTPException(404, "الحاوية غير موجودة")
    # التحقّق أولاً: بند خاطئ يجب ألّا يغيّر الترويسة ثم يفشل، فيبقى الوصل نصف معدَّل
    lines = _parse_lines(payload.get("lines")) if "lines" in payload else None
    weight = _amount(payload.get("weight_kg"), "الوزن") if "weight_kg" in payload else None
    pieces = _count(payload.get("pieces"), "العدد") if "pieces" in payload else None
    if "rec_date" in payload:
        c.rec_date = _as_date(payload.get("rec_date"))
    for f in _TEXT_FIELDS:
        if f in payload:
            setattr(c, f, str(payload.get(f) or "").strip())
    if weight is not None: c.weight_kg = weight
    if pieces is not None: c.pieces = pieces
    c.updated_by = user.full_name or user.username
    c.updated_at = utcnow()
    db.add(c)
    if lines is not None:
        _replace_lines(db, c.id, lines)
    db.commit(); db.refresh(c)
    return _out(c, _lines_of(db, c.id))


@router.delete("/{cid}")
def delete_container(cid: int, db: Session = Depends(get_session),
                     user: User = Depends(admin_or_supervisor)):
    c = db.get(Container, cid)
    if not c:
        raise HTTPException(404, "الحاوية غير موجودة")
    for ln in _lines_of(db, cid):      # لا تُترك بنود يتيمة في الجدول
        db.delete(ln)
    db.delete(c); db.commit()
    return {"ok": True}
