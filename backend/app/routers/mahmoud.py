"""حسابات محمود — نظام محاسبي منفصل تماماً عن النظام الأساسي.

يدوي بالكامل: صناديق (مكاتب/زبائن/مخلّصين) وحركات إيراد ومصروف يُدخلها المحاسب.
لا يقرأ من الشحنات ولا يكتب فيها — الاستثناء الوحيد شاشة مقارنة الجمارك التي
تعرض المجاميع الأصلية بجانب اليدوية للمراجعة فقط (بلا أي تعديل على البيانات)."""
from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from ..core.database import get_session
from ..core.security import admin_or_accountant
from ..models import (User, MBox, MEntry, MCustomsCheck, Shipment, Item,
                      BOX_TYPES, BOX_OFFICE, _as_date)
from ..calc import compute, cfg_resolver

router = APIRouter(prefix="/api/mahmoud", tags=["mahmoud"])

INCOME = "إيراد"


# ---------------------------------------------------------------- الصناديق
@router.get("/boxes")
def list_boxes(db: Session = Depends(get_session), user: User = Depends(admin_or_accountant),
               date_from: Optional[str] = None, date_to: Optional[str] = None):
    """كل الصناديق مع أرصدتها المحسوبة ضمن الفترة (الرصيد الافتتاحي + إيرادات − مصاريف)."""
    boxes = db.exec(select(MBox).order_by(MBox.box_type, MBox.name)).all()
    entries = _entries_in_range(db, date_from, date_to)
    agg: dict[int, dict] = {}
    for e in entries:
        a = agg.setdefault(e.box_id, {"income": 0.0, "expense": 0.0, "count": 0})
        a["income" if e.kind == INCOME else "expense"] += e.amount
        a["count"] += 1
    out = []
    for b in boxes:
        a = agg.get(b.id, {"income": 0.0, "expense": 0.0, "count": 0})
        balance = b.opening_balance + a["income"] - a["expense"]
        out.append({**b.dict(),
                    "income": round(a["income"], 2), "expense": round(a["expense"], 2),
                    "entries_count": a["count"], "balance": round(balance, 2)})
    return out


@router.post("/boxes")
def add_box(box: MBox, db: Session = Depends(get_session), user: User = Depends(admin_or_accountant)):
    name = (box.name or "").strip()
    if not name:
        raise HTTPException(400, "اسم الصندوق مطلوب")
    if box.box_type not in BOX_TYPES:
        raise HTTPException(400, "نوع صندوق غير معروف")
    if db.exec(select(MBox).where(MBox.name == name, MBox.box_type == box.box_type)).first():
        raise HTTPException(400, "يوجد صندوق بهذا الاسم والنوع")
    box.name = name
    db.add(box); db.commit(); db.refresh(box)
    return box


@router.put("/boxes/{bid}")
def edit_box(bid: int, patch: dict, db: Session = Depends(get_session),
             user: User = Depends(admin_or_accountant)):
    b = db.get(MBox, bid)
    if not b:
        raise HTTPException(404, "الصندوق غير موجود")
    if "box_type" in patch and patch["box_type"] not in BOX_TYPES:
        raise HTTPException(400, "نوع صندوق غير معروف")
    for k, v in patch.items():
        if hasattr(b, k) and k not in ("id", "created_at"):
            setattr(b, k, v)
    db.add(b); db.commit(); db.refresh(b)
    return b


@router.delete("/boxes/{bid}")
def delete_box(bid: int, db: Session = Depends(get_session), user: User = Depends(admin_or_accountant)):
    b = db.get(MBox, bid)
    if not b:
        return {"ok": True}
    n = len(db.exec(select(MEntry).where(MEntry.box_id == bid)).all())
    if n:
        raise HTTPException(400, f"لا يمكن حذف الصندوق — يحوي {n} حركة. احذف حركاته أولاً أو أوقفه.")
    db.delete(b); db.commit()
    return {"ok": True}


# ---------------------------------------------------------------- الحركات
def _entries_in_range(db: Session, date_from, date_to, box_id=None):
    q = select(MEntry)
    if date_from: q = q.where(MEntry.entry_date >= date_from)
    if date_to: q = q.where(MEntry.entry_date <= date_to)
    if box_id: q = q.where(MEntry.box_id == box_id)
    return db.exec(q).all()


@router.get("/entries")
def list_entries(db: Session = Depends(get_session), user: User = Depends(admin_or_accountant),
                 box_id: Optional[int] = None, date_from: Optional[str] = None,
                 date_to: Optional[str] = None, kind: Optional[str] = None,
                 q: Optional[str] = None):
    rows = _entries_in_range(db, date_from, date_to, box_id)
    if kind:
        rows = [e for e in rows if e.kind == kind]
    if q:
        needle = q.strip()
        rows = [e for e in rows if needle in (e.description or "") or needle in (e.category or "")
                or needle in (e.counterparty or "") or needle in (e.ref_no or "")]
    names = {b.id: b.name for b in db.exec(select(MBox)).all()}
    rows.sort(key=lambda e: (e.entry_date, e.id or 0), reverse=True)
    return [{**e.dict(), "box_name": names.get(e.box_id, "—")} for e in rows]


@router.post("/entries")
def add_entry(entry: MEntry, db: Session = Depends(get_session),
              user: User = Depends(admin_or_accountant)):
    if not db.get(MBox, entry.box_id):
        raise HTTPException(400, "اختر صندوقاً صحيحاً")
    if not entry.amount or entry.amount <= 0:
        raise HTTPException(400, "المبلغ يجب أن يكون أكبر من صفر")
    entry.entry_date = _as_date(entry.entry_date) or date.today()
    entry.created_by = user.full_name or user.username
    db.add(entry); db.commit(); db.refresh(entry)
    return entry


@router.put("/entries/{eid}")
def edit_entry(eid: int, patch: dict, db: Session = Depends(get_session),
               user: User = Depends(admin_or_accountant)):
    e = db.get(MEntry, eid)
    if not e:
        raise HTTPException(404, "الحركة غير موجودة")
    for k, v in patch.items():
        if hasattr(e, k) and k not in ("id", "created_at", "created_by"):
            setattr(e, k, _as_date(v) if k == "entry_date" else v)
    db.add(e); db.commit(); db.refresh(e)
    return e


@router.delete("/entries/{eid}")
def delete_entry(eid: int, db: Session = Depends(get_session),
                 user: User = Depends(admin_or_accountant)):
    e = db.get(MEntry, eid)
    if e:
        db.delete(e); db.commit()
    return {"ok": True}


# ---------------------------------------------------------------- الملخّص
@router.get("/summary")
def summary(db: Session = Depends(get_session), user: User = Depends(admin_or_accountant),
            date_from: Optional[str] = None, date_to: Optional[str] = None):
    """ملخّص عام + تفصيل حسب نوع الصندوق وحسب البند."""
    boxes = {b.id: b for b in db.exec(select(MBox)).all()}
    entries = _entries_in_range(db, date_from, date_to)
    income = sum(e.amount for e in entries if e.kind == INCOME)
    expense = sum(e.amount for e in entries if e.kind != INCOME)
    opening = sum(b.opening_balance for b in boxes.values())

    by_type: dict[str, dict] = {}
    for e in entries:
        b = boxes.get(e.box_id)
        t = b.box_type if b else "—"
        d = by_type.setdefault(t, {"type": t, "income": 0.0, "expense": 0.0})
        d["income" if e.kind == INCOME else "expense"] += e.amount
    for b in boxes.values():   # الرصيد الافتتاحي يدخل في صافي كل نوع
        d = by_type.setdefault(b.box_type, {"type": b.box_type, "income": 0.0, "expense": 0.0})
        d.setdefault("opening", 0.0)
        d["opening"] = d.get("opening", 0.0) + b.opening_balance

    by_category: dict[str, dict] = {}
    for e in entries:
        c = e.category or "بلا بند"
        d = by_category.setdefault(c, {"category": c, "income": 0.0, "expense": 0.0, "count": 0})
        d["income" if e.kind == INCOME else "expense"] += e.amount
        d["count"] += 1

    return {
        "opening": round(opening, 2),
        "income": round(income, 2),
        "expense": round(expense, 2),
        "net": round(income - expense, 2),
        "balance": round(opening + income - expense, 2),
        "entries_count": len(entries),
        "boxes_count": len(boxes),
        "by_type": [{"type": d["type"], "income": round(d["income"], 2),
                     "expense": round(d["expense"], 2),
                     "opening": round(d.get("opening", 0.0), 2),
                     "net": round(d.get("opening", 0.0) + d["income"] - d["expense"], 2)}
                    for d in sorted(by_type.values(), key=lambda x: x["type"])],
        "by_category": [{**d, "income": round(d["income"], 2), "expense": round(d["expense"], 2)}
                        for d in sorted(by_category.values(),
                                        key=lambda x: -(x["income"] + x["expense"]))],
    }


# ---------------------------------------------------- مقارنة الجمارك (عرض فقط)
def _actual_customs(db: Session, date_from, date_to) -> dict:
    """مجاميع الرسوم الجمركية الأصلية المحسوبة من الشحنات — للقراءة فقط."""
    items = {i.name: (i.syrian_per_ton, i.iraqi_per_ton) for i in db.exec(select(Item)).all()}
    resolve = cfg_resolver(db)
    q = select(Shipment)
    if date_from: q = q.where(Shipment.ship_date >= date_from)
    if date_to: q = q.where(Shipment.ship_date <= date_to)
    syrian = iraqi = 0.0
    count = 0
    for s in db.exec(q).all():
        syr, irq = items.get(s.item_name, (0.0, 0.0))
        c = compute(s, syr, irq, resolve(s.calc_version_id))
        syrian += c["syrian_actual"]
        iraqi += c["iraqi_actual"]
        count += 1
    return {"syrian": round(syrian, 2), "iraqi": round(iraqi, 2), "count": count}


@router.get("/customs/actual")
def customs_actual(date_from: Optional[str] = None, date_to: Optional[str] = None,
                   db: Session = Depends(get_session), user: User = Depends(admin_or_accountant)):
    """المجاميع الأصلية لفترة — تُستخدم لملء شاشة المقارنة قبل الحفظ."""
    return _actual_customs(db, date_from, date_to)


def _with_diff(db: Session, c: MCustomsCheck) -> dict:
    actual = _actual_customs(db, c.date_from, c.date_to)
    d_syr = round(c.manual_syrian - actual["syrian"], 2)
    d_irq = round(c.manual_iraqi - actual["iraqi"], 2)
    return {**c.dict(),
            "actual_syrian": actual["syrian"], "actual_iraqi": actual["iraqi"],
            "shipments": actual["count"],
            "diff_syrian": d_syr, "diff_iraqi": d_irq,
            "diff_total": round(d_syr + d_irq, 2),
            "matched": abs(d_syr) < 0.01 and abs(d_irq) < 0.01}


@router.get("/customs")
def list_customs_checks(db: Session = Depends(get_session), user: User = Depends(admin_or_accountant)):
    rows = db.exec(select(MCustomsCheck).order_by(MCustomsCheck.date_from.desc())).all()
    return [_with_diff(db, c) for c in rows]


@router.post("/customs")
def add_customs_check(c: MCustomsCheck, db: Session = Depends(get_session),
                      user: User = Depends(admin_or_accountant)):
    c.date_from = _as_date(c.date_from)
    c.date_to = _as_date(c.date_to)
    if not c.date_from or not c.date_to:
        raise HTTPException(400, "حدّد فترة المقارنة (من تاريخ / إلى تاريخ)")
    if c.date_to < c.date_from:
        raise HTTPException(400, "تاريخ النهاية قبل تاريخ البداية")
    c.created_by = user.full_name or user.username
    db.add(c); db.commit(); db.refresh(c)
    return _with_diff(db, c)


@router.delete("/customs/{cid}")
def delete_customs_check(cid: int, db: Session = Depends(get_session),
                         user: User = Depends(admin_or_accountant)):
    c = db.get(MCustomsCheck, cid)
    if c:
        db.delete(c); db.commit()
    return {"ok": True}
