"""حسابات محمود — نظام محاسبي مستقل قائم على دفتر أستاذ (Ledger).

المبدأ الأساسي: **لا يُعدَّل رصيد يدوياً إطلاقاً.** كل رصيد يُحسب من القيود:

    الرصيد المستحق = إجمالي الاستحقاقات − (إجمالي الدفعات + إجمالي المصاريف)

• استحقاق: يزيد المطلوب من الجهة (شحنة/عمولة/إيراد/تسوية/أي سبب).
• دفعة:    نقد استلمه المحاسب من الجهة → يُنقص المستحق.
• مصروف:   أنفقته الجهة نيابةً عن الشركة → يُنقص المستحق (سداد غير نقدي).

القيود لا تُحذف — تُلغى ويبقى أثرها، وكل تعديل/إلغاء يُسجَّل في جدول تدقيق.
النظام يدوي بالكامل ومنفصل عن الشحنات (عدا شاشة مقارنة الجمارك — للعرض فقط)."""
import json
import math
from datetime import date, datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from ..core.database import get_session
from ..core.security import admin_or_accountant
from ..models import (User, MBox, MEntry, MTxn, MTxnAudit, MCustomsCheck, MExportRevenue,
                      Shipment, Item,
                      BOX_TYPES, BOX_OFFICE, BOX_CUSTOMER,
                      TXN_TYPES, TXN_CHARGE, TXN_PAYMENT, TXN_EXPENSE,
                      CHARGE_REASONS, CURRENCIES, CUR_USD, _as_date)
from ..calc import compute, cfg_resolver, COD, DEFERRED

EXPORTED = "تم التصدير"
NOT_COLLECTED = "لم يُحصَّل"
AUTO_REF = "تصدير:"      # بادئة المرجع للاستحقاقات المجلوبة تلقائياً (لمنع التكرار)

router = APIRouter(prefix="/api/mahmoud", tags=["mahmoud"])

# إشارة كل نوع في معادلة الرصيد
SIGN = {TXN_CHARGE: +1, TXN_PAYMENT: -1, TXN_EXPENSE: -1}


# ============================ أدوات داخلية ============================
def _live(db: Session, party_id: int | None = None, date_from=None, date_to=None) -> list[MTxn]:
    """القيود السارية (غير الملغاة) — أساس كل حساب رصيد."""
    q = select(MTxn).where(MTxn.is_void == False)          # noqa: E712
    if party_id: q = q.where(MTxn.party_id == party_id)
    if date_from: q = q.where(MTxn.txn_date >= date_from)
    if date_to: q = q.where(MTxn.txn_date <= date_to)
    return db.exec(q).all()


def _order(rows: list[MTxn]):
    """ترتيب زمني ثابت: بالتاريخ ثم برقم العملية (لضمان رصيد جارٍ متسق)."""
    return sorted(rows, key=lambda t: (t.txn_date, t.id or 0))


def _cur(t: MTxn) -> str:
    """عملة القيد — القيود القديمة بلا عملة تُعتبر بالدولار."""
    return (t.currency or CUR_USD).strip() or CUR_USD


def _totals(rows: list[MTxn], currency: str | None = None) -> dict:
    """مجاميع عملة واحدة. currency=None ← كل القيود (للتوافق مع الاستدعاءات القديمة)."""
    if currency is not None:
        rows = [t for t in rows if _cur(t) == currency]
    charges = sum(t.amount for t in rows if t.txn_type == TXN_CHARGE)
    payments = sum(t.amount for t in rows if t.txn_type == TXN_PAYMENT)
    expenses = sum(t.amount for t in rows if t.txn_type == TXN_EXPENSE)
    return {"charges": round(charges, 2), "payments": round(payments, 2),
            "expenses": round(expenses, 2),
            "settled": round(payments + expenses, 2),
            "balance": round(charges - payments - expenses, 2)}


def _by_currency(rows: list[MTxn]) -> list[dict]:
    """مجاميع كل عملة على حدة — لا تُجمع عملة مع أخرى إطلاقاً.
    تُعرض كل العملات المعروفة (ولو بصفر) ليبقى ترتيب الأعمدة ثابتاً في الواجهة."""
    seen = list(CURRENCIES) + [c for c in {_cur(t) for t in rows} if c not in CURRENCIES]
    return [{"currency": c, **_totals(rows, c)} for c in seen]


def _balances(db: Session, party_id: int) -> dict:
    """رصيد الجهة لكل عملة {العملة: الرصيد} — كل الفترات."""
    rows = _live(db, party_id)
    return {c["currency"]: c["balance"] for c in _by_currency(rows)}


def _audit(db: Session, txn_id: int, action: str, changes: dict, user: User):
    db.add(MTxnAudit(txn_id=txn_id, action=action, by_user=user.full_name or user.username,
                     changes=json.dumps(changes, ensure_ascii=False, default=str)))


def _txn_out(t: MTxn, party_name: str = "", before: float | None = None,
             after: float | None = None) -> dict:
    d = t.dict()
    d["party_name"] = party_name
    d["signed_amount"] = round(SIGN.get(t.txn_type, 0) * t.amount, 2)
    if before is not None:
        d["balance_before"] = round(before, 2)
        d["balance_after"] = round(after, 2)
    d["created_at_time"] = t.created_at.strftime("%H:%M") if t.created_at else ""
    return d


# ============================ الجهات (الصناديق) ============================
@router.get("/parties")
@router.get("/boxes")   # اسم قديم — مُبقى للتوافق
def list_parties(db: Session = Depends(get_session), user: User = Depends(admin_or_accountant),
                 date_from: Optional[str] = None, date_to: Optional[str] = None):
    """كل الجهات مع لوحة أرقامها: المطلوب، المدفوع، المصاريف، المتبقي، آخر دفعة."""
    parties = db.exec(select(MBox).order_by(MBox.box_type, MBox.name)).all()
    rows = _live(db, date_from=date_from, date_to=date_to)
    by_party: dict[int, list[MTxn]] = {}
    for t in rows:
        by_party.setdefault(t.party_id, []).append(t)

    out = []
    for p in parties:
        mine = by_party.get(p.id, [])
        tot = _totals(mine)                       # مجموع كل العملات (للفرز والعدّ فقط)
        cur_rows = _by_currency(mine)             # ولكل عملة أرقامها المستقلة
        pays = _order([t for t in mine if t.txn_type == TXN_PAYMENT])
        last = pays[-1] if pays else None
        out.append({**p.dict(), **tot,
                    "by_currency": cur_rows,
                    "txn_count": len(mine),
                    "payments_count": len(pays),
                    "last_payment": round(last.amount, 2) if last else 0.0,
                    "last_payment_currency": _cur(last) if last else CUR_USD,
                    "last_payment_date": str(last.txn_date) if last else "",
                    # التسوية والدائن يُقاسان لكل عملة على حدة
                    "is_settled": all(abs(c["balance"]) < 0.01 for c in cur_rows),
                    "is_credit": any(c["balance"] < -0.01 for c in cur_rows)})
    return out


@router.post("/parties")
@router.post("/boxes")
def add_party(box: MBox, db: Session = Depends(get_session), user: User = Depends(admin_or_accountant)):
    name = (box.name or "").strip()
    if not name:
        raise HTTPException(400, "اسم الجهة مطلوب")
    if box.box_type not in BOX_TYPES:
        raise HTTPException(400, "نوع غير معروف")
    if db.exec(select(MBox).where(MBox.name == name, MBox.box_type == box.box_type)).first():
        raise HTTPException(400, "توجد جهة بهذا الاسم والنوع")
    opening = float(box.opening_balance or 0)
    box.name = name
    box.opening_balance = 0.0          # الرصيد لا يُخزَّن — يتحول إلى قيد افتتاحي
    db.add(box); db.commit(); db.refresh(box)
    if abs(opening) > 0.001:           # رصيد افتتاحي → قيد شفّاف في الدفتر
        db.add(MTxn(party_id=box.id, txn_date=date.today(),
                    txn_type=TXN_CHARGE if opening > 0 else TXN_PAYMENT,
                    amount=abs(opening), reason="رصيد افتتاحي",
                    description="رصيد افتتاحي عند إنشاء الجهة",
                    created_by=user.full_name or user.username))
        db.commit()
    return box


@router.put("/parties/{pid}")
@router.put("/boxes/{pid}")
def edit_party(pid: int, patch: dict, db: Session = Depends(get_session),
               user: User = Depends(admin_or_accountant)):
    p = db.get(MBox, pid)
    if not p:
        raise HTTPException(404, "الجهة غير موجودة")
    if "box_type" in patch and patch["box_type"] not in BOX_TYPES:
        raise HTTPException(400, "نوع غير معروف")
    # الرصيد لا يُعدَّل يدوياً — يُحسب من القيود فقط
    for k in ("id", "created_at", "opening_balance"):
        patch.pop(k, None)
    for k, v in patch.items():
        if hasattr(p, k):
            setattr(p, k, v)
    db.add(p); db.commit(); db.refresh(p)
    return p


@router.delete("/parties/{pid}")
@router.delete("/boxes/{pid}")
def delete_party(pid: int, db: Session = Depends(get_session),
                 user: User = Depends(admin_or_accountant)):
    p = db.get(MBox, pid)
    if not p:
        return {"ok": True}
    n = len(db.exec(select(MTxn).where(MTxn.party_id == pid)).all())
    if n:
        raise HTTPException(400, f"لا يمكن الحذف — للجهة {n} قيد في دفتر الأستاذ. أوقفها بدل حذفها.")
    db.delete(p); db.commit()
    return {"ok": True}


@router.get("/parties/{pid}/statement")
def statement(pid: int, db: Session = Depends(get_session), user: User = Depends(admin_or_accountant),
              date_from: Optional[str] = None, date_to: Optional[str] = None,
              include_void: bool = True):
    """كشف حساب كامل مرتّب بالتاريخ مع الرصيد قبل وبعد كل حركة."""
    p = db.get(MBox, pid)
    if not p:
        raise HTTPException(404, "الجهة غير موجودة")

    # الرصيد الجاري يُبنى من كل القيود السارية منذ البداية لضمان صحة «الرصيد قبل»،
    # ولكل عملة رصيدها الجاري المستقل فلا تتداخل حركة اليورو مع رصيد الدولار
    all_live = _order(_live(db, pid))
    running: dict[str, float] = {}
    ledger = []
    for t in all_live:
        c = _cur(t)
        before = running.get(c, 0.0)
        running[c] = before + SIGN.get(t.txn_type, 0) * t.amount
        if date_from and str(t.txn_date) < date_from: continue
        if date_to and str(t.txn_date) > date_to: continue
        ledger.append(_txn_out(t, p.name, before, running[c]))

    if include_void:   # القيود الملغاة تظهر للمراجعة بلا أثر على الرصيد
        q = select(MTxn).where(MTxn.party_id == pid, MTxn.is_void == True)   # noqa: E712
        for t in _order(db.exec(q).all()):
            if date_from and str(t.txn_date) < date_from: continue
            if date_to and str(t.txn_date) > date_to: continue
            ledger.append(_txn_out(t, p.name))
        ledger.sort(key=lambda r: (r["txn_date"], r["id"]))

    scoped = _live(db, pid, date_from, date_to)
    pays = _order([t for t in scoped if t.txn_type == TXN_PAYMENT])
    last = pays[-1] if pays else None
    return {
        "party": p.dict(),
        "totals": {**_totals(scoped),
                   "payments_count": len(pays),
                   "last_payment": round(last.amount, 2) if last else 0.0,
                   "last_payment_currency": _cur(last) if last else CUR_USD,
                   "last_payment_date": str(last.txn_date) if last else ""},
        # أرقام كل عملة على حدة ضمن الفترة، وأرصدتها الكلية
        "by_currency": [{**c,
                         "payments_count": len([t for t in pays if _cur(t) == c["currency"]]),
                         "balance_all_time": round(running.get(c["currency"], 0.0), 2)}
                        for c in _by_currency(scoped)],
        "balance_all_time": round(sum(running.values()), 2),
        "ledger": ledger,
    }


# ============================ القيود ============================
@router.post("/txn")
def add_txn(payload: dict, db: Session = Depends(get_session),
            user: User = Depends(admin_or_accountant)):
    """إضافة قيد: استحقاق (يزيد) أو دفعة/مصروف (يُنقص)."""
    party = db.get(MBox, int(payload.get("party_id") or 0))
    if not party:
        raise HTTPException(400, "اختر جهة صحيحة")
    ttype = payload.get("txn_type")
    if ttype not in TXN_TYPES:
        raise HTTPException(400, "نوع العملية غير معروف")
    try:
        amount = round(float(payload.get("amount") or 0), 2)
    except (TypeError, ValueError):
        raise HTTPException(400, "المبلغ غير صحيح")
    if amount <= 0:
        raise HTTPException(400, "المبلغ يجب أن يكون أكبر من صفر")
    currency = (payload.get("currency") or CUR_USD).strip() or CUR_USD
    if currency not in CURRENCIES:
        raise HTTPException(400, "عملة غير معروفة")

    # الرصيد الدائن مسموح دائماً: الدفعة قد تتجاوز المستحق فيصبح للجهة رصيد لها
    t = MTxn(party_id=party.id,
             txn_date=_as_date(payload.get("txn_date")) or date.today(),
             txn_type=ttype, amount=amount, currency=currency,
             reason=(payload.get("reason") or "").strip(),
             description=(payload.get("description") or "").strip(),
             payment_method=(payload.get("payment_method") or "").strip(),
             ref_no=(payload.get("ref_no") or "").strip(),
             notes=(payload.get("notes") or "").strip(),
             created_by=user.full_name or user.username)
    db.add(t); db.commit(); db.refresh(t)
    return {**_txn_out(t, party.name), "party_balances": _balances(db, party.id),
            "party_balance": _balances(db, party.id).get(currency, 0.0)}


@router.put("/txn/{tid}")
def edit_txn(tid: int, patch: dict, db: Session = Depends(get_session),
             user: User = Depends(admin_or_accountant)):
    """تعديل قيد مع حفظ القيم القديمة في سجل التدقيق."""
    t = db.get(MTxn, tid)
    if not t:
        raise HTTPException(404, "القيد غير موجود")
    if t.is_void:
        raise HTTPException(400, "القيد ملغى — لا يمكن تعديله")

    editable = {"txn_date", "amount", "currency", "reason", "description",
                "payment_method", "ref_no", "notes"}
    before = {k: getattr(t, k) for k in editable}
    for k, v in patch.items():
        if k not in editable:
            continue
        if k == "amount":
            v = round(float(v or 0), 2)
            if v <= 0:
                raise HTTPException(400, "المبلغ يجب أن يكون أكبر من صفر")
        if k == "txn_date":
            v = _as_date(v) or t.txn_date
        setattr(t, k, v)
    after = {k: getattr(t, k) for k in editable}
    changed = {k: {"قبل": before[k], "بعد": after[k]} for k in editable if before[k] != after[k]}
    if not changed:
        return _txn_out(t, "")
    t.edited_count += 1
    t.edited_by = user.full_name or user.username
    t.edited_at = datetime.utcnow()
    _audit(db, t.id, "تعديل", changed, user)
    db.add(t); db.commit(); db.refresh(t)
    party = db.get(MBox, t.party_id)
    return {**_txn_out(t, party.name if party else ""), "party_balance": _balances(db, t.party_id).get(_cur(t), 0.0),
            "party_balances": _balances(db, t.party_id)}


@router.post("/txn/{tid}/void")
def void_txn(tid: int, payload: dict | None = None, db: Session = Depends(get_session),
             user: User = Depends(admin_or_accountant)):
    """إلغاء قيد — يبقى في الكشف للمراجعة ولا يؤثر على الرصيد."""
    t = db.get(MTxn, tid)
    if not t:
        raise HTTPException(404, "القيد غير موجود")
    if t.is_void:
        return _txn_out(t, "")
    t.is_void = True
    t.void_reason = ((payload or {}).get("reason") or "").strip()
    t.voided_by = user.full_name or user.username
    t.voided_at = datetime.utcnow()
    _audit(db, t.id, "إلغاء", {"سبب الإلغاء": t.void_reason,
                                "النوع": t.txn_type, "المبلغ": t.amount}, user)
    db.add(t); db.commit(); db.refresh(t)
    return {**_txn_out(t, ""), "party_balance": _balances(db, t.party_id).get(_cur(t), 0.0),
            "party_balances": _balances(db, t.party_id)}


@router.delete("/txn/{tid}")
def delete_txn(tid: int, db: Session = Depends(get_session),
               user: User = Depends(admin_or_accountant)):
    """حذف نهائي لقيد — يختفي من الكشف تماماً (بخلاف الإلغاء الذي يُبقي أثره).
    يُسجَّل الحذف في سجل التدقيق بقيم القيد المحذوف للمراجعة."""
    t = db.get(MTxn, tid)
    if not t:
        return {"ok": True}
    _audit(db, tid, "حذف نهائي",
           {"النوع": t.txn_type, "المبلغ": t.amount, "التاريخ": str(t.txn_date),
            "السبب": t.reason, "التفاصيل": t.description, "الجهة": t.party_id}, user)
    party_id = t.party_id
    db.delete(t); db.commit()
    return {"ok": True, "party_balances": _balances(db, party_id)}


@router.get("/txn/{tid}/audit")
def txn_audit(tid: int, db: Session = Depends(get_session),
              user: User = Depends(admin_or_accountant)):
    rows = db.exec(select(MTxnAudit).where(MTxnAudit.txn_id == tid)
                   .order_by(MTxnAudit.at)).all()
    out = []
    for a in rows:
        try:
            ch = json.loads(a.changes or "{}")
        except json.JSONDecodeError:
            ch = {}
        out.append({"id": a.id, "action": a.action, "by_user": a.by_user,
                    "at": a.at.strftime("%Y-%m-%d %H:%M") if a.at else "", "changes": ch})
    return out


# ============================ سجل العمليات العام ============================
@router.get("/ledger")
def ledger(db: Session = Depends(get_session), user: User = Depends(admin_or_accountant),
           date_from: Optional[str] = None, date_to: Optional[str] = None,
           party_id: Optional[int] = None, txn_type: Optional[str] = None,
           by_user: Optional[str] = None, q: Optional[str] = None,
           currency: Optional[str] = None, include_void: bool = True):
    """كشف حساب عام قابل للبحث والتصفية، مع الرصيد قبل/بعد لكل جهة."""
    names = {p.id: p.name for p in db.exec(select(MBox)).all()}

    # الرصيد الجاري يُحسب لكل جهة **ولكل عملة** على حدة من بداية تاريخها
    running: dict[tuple, float] = {}
    snapshots: dict[int, tuple] = {}
    for t in _order(_live(db)):
        k = (t.party_id, _cur(t))
        before = running.get(k, 0.0)
        after = before + SIGN.get(t.txn_type, 0) * t.amount
        running[k] = after
        snapshots[t.id] = (before, after)

    qy = select(MTxn)
    if not include_void:
        qy = qy.where(MTxn.is_void == False)                  # noqa: E712
    if date_from: qy = qy.where(MTxn.txn_date >= date_from)
    if date_to: qy = qy.where(MTxn.txn_date <= date_to)
    if party_id: qy = qy.where(MTxn.party_id == party_id)
    if txn_type: qy = qy.where(MTxn.txn_type == txn_type)
    rows = db.exec(qy).all()
    if currency:
        rows = [t for t in rows if _cur(t) == currency]
    if by_user:
        rows = [t for t in rows if by_user.strip() in (t.created_by or "")]
    if q:
        n = q.strip()
        rows = [t for t in rows if n in (t.reason or "") or n in (t.description or "")
                or n in (t.ref_no or "") or n in (t.notes or "")
                or n in names.get(t.party_id, "")]

    out = []
    for t in sorted(rows, key=lambda x: (x.txn_date, x.id or 0), reverse=True):
        snap = snapshots.get(t.id)
        out.append(_txn_out(t, names.get(t.party_id, "—"),
                            snap[0] if snap else None, snap[1] if snap else None))
    live_rows = [t for t in rows if not t.is_void]
    return {"rows": out, "totals": _totals(live_rows),
            "by_currency": _by_currency(live_rows), "count": len(out)}


@router.get("/summary")
def summary(db: Session = Depends(get_session), user: User = Depends(admin_or_accountant),
            date_from: Optional[str] = None, date_to: Optional[str] = None):
    """ملخّص عام + تفصيل حسب نوع الجهة وحسب سبب الاستحقاق."""
    parties = {p.id: p for p in db.exec(select(MBox)).all()}
    rows = _live(db, date_from=date_from, date_to=date_to)
    tot = _totals(rows)

    KIND = {TXN_CHARGE: "charges", TXN_PAYMENT: "payments", TXN_EXPENSE: "expenses"}

    # التجميعات مفتاحها (المجموعة، العملة) فلا تُخلط عملة بأخرى في أي سطر
    def _group(key_of, label):
        acc: dict[tuple, dict] = {}
        for t in rows:
            k = key_of(t)
            if k is None:
                continue
            c = _cur(t)
            d = acc.setdefault((k, c), {label: k, "currency": c, "charges": 0.0,
                                        "payments": 0.0, "expenses": 0.0, "count": 0})
            d[KIND[t.txn_type]] += t.amount
            d["count"] += 1
        out = []
        for d in acc.values():
            if not any(abs(d[x]) > 0.001 for x in ("charges", "payments", "expenses")):
                continue
            out.append({**d, "charges": round(d["charges"], 2),
                        "payments": round(d["payments"], 2),
                        "expenses": round(d["expenses"], 2),
                        "balance": round(d["charges"] - d["payments"] - d["expenses"], 2)})
        return out

    by_type = sorted(_group(lambda t: (parties[t.party_id].box_type
                                       if t.party_id in parties else "—"), "type"),
                     key=lambda x: (x["type"], x["currency"]))
    by_reason = sorted(_group(lambda t: t.reason or "بلا سبب", "reason"),
                       key=lambda x: -(x["charges"] + x["payments"] + x["expenses"]))

    # الجهات ذات الرصيد الأعلى (كل الفترات) — سطر لكل جهة وعملة
    all_rows = _live(db)
    per: dict[int, list] = {}
    for t in all_rows:
        per.setdefault(t.party_id, []).append(t)
    top = []
    for pid, lst in per.items():
        p = parties.get(pid)
        if not p:
            continue
        for c in _by_currency(lst):
            if abs(c["balance"]) > 0.01:
                top.append({"id": pid, "name": p.name, "type": p.box_type,
                            "currency": c["currency"], "balance": c["balance"]})
    top.sort(key=lambda x: -x["balance"])

    cur_rows = _by_currency(rows)
    return {
        **tot,
        "by_currency": cur_rows,
        "txn_count": len(rows), "parties_count": len(parties),
        "by_type": by_type,
        "by_reason": by_reason,
        "outstanding": top,
        # الإجماليات لكل عملة على حدة (المستحق للتحصيل والرصيد الدائن)
        "totals_by_currency": [
            {"currency": c["currency"],
             "outstanding": round(sum(x["balance"] for x in top
                                      if x["currency"] == c["currency"] and x["balance"] > 0), 2),
             "credit": round(-sum(x["balance"] for x in top
                                  if x["currency"] == c["currency"] and x["balance"] < 0), 2)}
            for c in cur_rows],
        "outstanding_total": round(sum(x["balance"] for x in top if x["balance"] > 0), 2),
        "credit_total": round(-sum(x["balance"] for x in top if x["balance"] < 0), 2),
    }


@router.get("/meta")
def meta(user: User = Depends(admin_or_accountant)):
    """ثوابت النظام للواجهة."""
    return {"txn_types": list(TXN_TYPES), "box_types": list(BOX_TYPES),
            "charge_reasons": list(CHARGE_REASONS), "currencies": list(CURRENCIES)}


# ========== الاستحقاقات التلقائية من الشحنات الصادرة ==========
def _rint(x: float) -> int:
    """تقريب نصفي لأعلى (7.5←8 و7.4←7) — يطابق تقريب الطباعة في الواجهة.
    round() في بايثون تقرّب الأنصاف للزوجي فلا تصلح هنا."""
    return int(math.floor((x or 0) + 0.5))


def _computed_exported(db: Session):
    """كل الشحنات الصادرة (لها تاريخ تصدير) مع أرقامها المحسوبة بنسخة معادلاتها."""
    items = {i.name: (i.syrian_per_ton, i.iraqi_per_ton, bool(i.special_consumption))
             for i in db.exec(select(Item)).all()}
    resolve = cfg_resolver(db)
    q = select(Shipment).where(Shipment.export_status == EXPORTED,
                               Shipment.export_date != None)          # noqa: E711
    for s in db.exec(q).all():
        syr, irq, _ = items.get(s.item_name, (0.0, 0.0, False))
        c = compute(s, syr, irq, resolve(s.calc_version_id), bool(s.special_consumption))
        yield s, c, (s.goods_price or 0.0) + c.get("commission", 0.0)


def _auto_rows(db: Session, p: MBox) -> list[dict]:
    """استحقاقات الجهة حسب كل شحنة صادرة (مجمّعة بتاريخ التصدير):
    • مكتب: ضد الدفع للأجور + ثمن البضاعة والعمولة غير المحصَّلة (شحنات وجهتها = اسم المكتب).
    • زبون: الآجل للأجور + ثمن البضاعة والعمولة الآجلة (شحنات مرسِلها = اسم الزبون)."""
    name = (p.name or "").strip()
    by_date: dict[str, dict] = {}
    for s, c, gwc in _computed_exported(db):
        if p.box_type == BOX_OFFICE:
            if (s.to_city or "").strip() != name:
                continue
            amt = (c.get("fees_total", 0.0) if s.fees_payment == COD else 0.0) \
                + (gwc if s.collection_status == NOT_COLLECTED else 0.0)
        else:   # زبون — الذمم الآجلة على المرسِل
            if (s.sender_name or "").strip() != name:
                continue
            amt = (c.get("fees_total", 0.0) if s.fees_payment == DEFERRED else 0.0) \
                + (gwc if s.collection_status == DEFERRED else 0.0)
        # قيمة كل شحنة تُقرَّب لعدد صحيح أولاً ثم تُجمع (نفس منطق تقريب الطباعة)
        amt = _rint(amt)
        if amt <= 0:
            continue
        d = by_date.setdefault(str(s.export_date),
                               {"export_date": str(s.export_date), "amount": 0,
                                "count": 0, "refs": []})
        d["amount"] += amt
        d["count"] += 1
        d["refs"].append(s.ref_no)

    # ما سُجِّل سابقاً لنفس الجهة ونفس تاريخ التصدير لا يُعرض كجديد (منع التكرار)
    booked = {t.ref_no: t for t in _live(db, p.id)
              if t.txn_type == TXN_CHARGE and (t.ref_no or "").startswith(AUTO_REF)}
    out = []
    seen = set()
    for d in sorted(by_date.values(), key=lambda x: x["export_date"], reverse=True):
        ref = AUTO_REF + d["export_date"]
        seen.add(ref)
        old = booked.get(ref)
        amount = round(d["amount"], 2)
        out.append({**d, "amount": amount, "ref_no": ref,
                    "refs": "، ".join(str(r) for r in sorted(d["refs"])),
                    "registered": old is not None,
                    "booked_amount": round(old.amount, 2) if old else 0.0,
                    # مسجَّل بمبلغ يخالف المحسوب الآن (تعديل لاحق على شحنة)
                    "stale": bool(old and abs(old.amount - amount) > 0.01)})
    # استحقاق مسجَّل لم يعد له مقابل محسوب (صفر الآن) — يجب أن يظهر كي يُصحَّح
    for ref, old in booked.items():
        if ref in seen:
            continue
        out.append({"export_date": ref[len(AUTO_REF):], "amount": 0.0, "count": 0,
                    "refs": "", "ref_no": ref, "registered": True,
                    "booked_amount": round(old.amount, 2), "stale": True})
    out.sort(key=lambda r: r["export_date"], reverse=True)
    return out


def _row_for(db: Session, p: MBox, export_date) -> dict | None:
    return next((r for r in _auto_rows(db, p)
                 if r["export_date"] == str(export_date)), None)


def _party_by(db: Session, name: str, box_type: str) -> MBox | None:
    name = (name or "").strip()
    if not name:
        return None
    return db.exec(select(MBox).where(MBox.name == name,
                                      MBox.box_type == box_type)).first()


def resync_auto_charge(db: Session, party: MBox, export_date, user, why: str) -> dict | None:
    """يوائم استحقاقاً تلقائياً **مسجَّلاً** مع القيمة المحسوبة الآن.

    لا يُنشئ استحقاقاً لم يُسجَّل أصلاً — فذلك قرار المحاسب، ويظهر له في قائمة
    «المتاح للتسجيل». والتصحيح يتم بإلغاء القيد القديم (يبقى أثره) وتسجيل بديل
    بالمبلغ الصحيح، حفاظاً على سلسلة التدقيق."""
    ref = AUTO_REF + str(export_date)
    old = next((t for t in _live(db, party.id)
                if t.txn_type == TXN_CHARGE and t.ref_no == ref), None)
    if not old:
        return None
    row = _row_for(db, party, export_date)
    new_amount = float(row["amount"]) if row else 0.0
    if abs(new_amount - old.amount) < 0.01:
        return None

    who = user.full_name or user.username if user else "النظام"
    old_amount = old.amount
    old.is_void = True
    old.void_reason = f"تعديل شحنة صادرة — {why}"
    old.voided_by = who
    old.voided_at = datetime.utcnow()
    _audit(db, old.id, "إلغاء", {"السبب": old.void_reason,
                                 "المبلغ السابق": old_amount,
                                 "المبلغ المحسوب الآن": new_amount}, user)
    db.add(old)

    created = None
    if new_amount > 0:
        created = MTxn(party_id=party.id, txn_date=_as_date(str(export_date)) or date.today(),
                       txn_type=TXN_CHARGE, amount=new_amount, reason="شحنة",
                       description=f"استحقاق تلقائي مُصحَّح عن الشحنة الصادرة بتاريخ {export_date}"
                                   f" ({row['count']} شحنة — قيود: {row['refs'][:200]})",
                       ref_no=ref,
                       notes=f"تصحيح آلي بعد {why} — كان {old_amount:g}",
                       created_by=who)
        db.add(created)
    db.commit()
    return {"party": party.name, "party_id": party.id, "export_date": str(export_date),
            "old_amount": old_amount, "new_amount": new_amount,
            "voided_txn": old.id, "reason": why}


# انتقال المسؤولية يقع بين هاتين القيمتين فقط؛ التحوّل إلى «واصل نقداً» أو
# «تم التحصيل» لا يُحرّك القيود تلقائياً (قرار المستخدم) بل يُعلَّم كفارق للمراجعة.
_FEES_SWAP = {COD, DEFERRED}
_COLL_SWAP = {NOT_COLLECTED, DEFERRED}


def sync_after_shipment_edit(db: Session, sh: Shipment, before: dict, user) -> list[dict]:
    """يُستدعى بعد تعديل شحنة **صادرة**: إن تبدّلت المسؤولية بين مكتب الوجهة
    (ضد الدفع / لم يُحصَّل) والمرسِل (آجل)، تُصحَّح الاستحقاقات المسجَّلة للجهتين."""
    if sh.export_status != EXPORTED or not sh.export_date:
        return []
    reasons = []
    f_old, f_new = before.get("fees_payment"), sh.fees_payment
    if f_old != f_new and {f_old, f_new} <= _FEES_SWAP:
        reasons.append(f"دفع الأجور: {f_old} ← {f_new}")
    c_old, c_new = before.get("collection_status"), sh.collection_status
    if c_old != c_new and {c_old, c_new} <= _COLL_SWAP:
        reasons.append(f"حالة التحصيل: {c_old} ← {c_new}")
    if not reasons:
        return []

    why = "، ".join(reasons) + f" (القيد {sh.ref_no})"
    out = []
    for name, box_type in ((sh.to_city, BOX_OFFICE), (sh.sender_name, BOX_CUSTOMER)):
        party = _party_by(db, name, box_type)
        if not party:
            continue
        r = resync_auto_charge(db, party, sh.export_date, user, why)
        if r:
            out.append(r)
    return out


@router.post("/auto-charges/resync")
def resync_endpoint(payload: dict, db: Session = Depends(get_session),
                    user: User = Depends(admin_or_accountant)):
    """مزامنة يدوية لاستحقاق مسجَّل خالف قيمته المحسوبة (زر «مزامنة»)."""
    p = db.get(MBox, int(payload.get("party_id") or 0))
    if not p:
        raise HTTPException(404, "الجهة غير موجودة")
    export_date = str(payload.get("export_date") or "").strip()
    if not export_date:
        raise HTTPException(400, "حدّد تاريخ التصدير")
    r = resync_auto_charge(db, p, export_date, user, "مزامنة يدوية")
    if not r:
        return {"changed": False, "message": "الاستحقاق مطابق للقيمة المحسوبة — لا تغيير"}
    return {"changed": True, **r, "party_balances": _balances(db, p.id)}


@router.get("/auto-charges")
def auto_charges(party_id: int, db: Session = Depends(get_session),
                 user: User = Depends(admin_or_accountant)):
    p = db.get(MBox, party_id)
    if not p:
        raise HTTPException(404, "الجهة غير موجودة")
    if p.box_type not in (BOX_OFFICE, BOX_CUSTOMER):
        raise HTTPException(400, "الجلب التلقائي متاح لجهات «مكتب» و«زبون» فقط")
    rule = (("مكتب: ضد الدفع للأجور + ثمن البضاعة والعمولة غير المحصَّلة — لشحنات وجهتها اسم المكتب"
             if p.box_type == BOX_OFFICE else
             "زبون: الآجل للأجور + ثمن البضاعة والعمولة الآجلة — لشحنات مرسِلها اسم الزبون")
            + ". القيم مقرَّبة لأعداد صحيحة: كل شحنة تُقرَّب (النصف فأعلى للأعلى) ثم تُجمع.")
    return {"party": p.dict(), "rule": rule, "rows": _auto_rows(db, p)}


@router.post("/auto-charges")
def register_auto_charge(payload: dict, db: Session = Depends(get_session),
                         user: User = Depends(admin_or_accountant)):
    """تسجيل استحقاق تلقائي كقيد في دفتر الأستاذ — المبلغ يُعاد حسابه من الخادم."""
    p = db.get(MBox, int(payload.get("party_id") or 0))
    if not p:
        raise HTTPException(404, "الجهة غير موجودة")
    export_date = str(payload.get("export_date") or "").strip()
    row = next((r for r in _auto_rows(db, p) if r["export_date"] == export_date), None)
    if not row:
        raise HTTPException(400, "لا يوجد استحقاق محسوب لهذه الجهة بهذا التاريخ")
    if row["registered"]:
        raise HTTPException(400, "هذا الاستحقاق مسجَّل مسبقاً — لن يُكرَّر")
    t = MTxn(party_id=p.id, txn_date=_as_date(export_date) or date.today(),
             txn_type=TXN_CHARGE, amount=row["amount"], reason="شحنة",
             description=f"استحقاق تلقائي عن الشحنة الصادرة بتاريخ {export_date} "
                         f"({row['count']} شحنة — قيود: {row['refs'][:200]})",
             ref_no=row["ref_no"],
             notes="جُلب تلقائياً من النظام الأساسي",
             created_by=user.full_name or user.username)
    db.add(t); db.commit(); db.refresh(t)
    return {**_txn_out(t, p.name), "party_balances": _balances(db, p.id),
            "party_balance": _balances(db, p.id).get(_cur(t), 0.0)}


# ========== إيرادات الشحنات الصادرة (الإجمالي − مصرف حمزة − مصرف ماجد) ==========
@router.get("/export-revenues")
def export_revenues(db: Session = Depends(get_session), user: User = Depends(admin_or_accountant),
                    date_from: Optional[str] = None, date_to: Optional[str] = None):
    """لكل شحنة صادرة (بتاريخ تصديرها): الإجمالي = أجور الشحن والجمركة + ثمن البضاعة والعمولة،
    والإيراد = الإجمالي − مصرف حمزة − مصرف ماجد (يدويان)."""
    by_date: dict[str, dict] = {}
    for s, c, gwc in _computed_exported(db):
        k = str(s.export_date)
        if date_from and k < date_from: continue
        if date_to and k > date_to: continue
        d = by_date.setdefault(k, {"export_date": k, "count": 0,
                                   "fees_total": 0.0, "goods_with_comm": 0.0})
        d["count"] += 1
        d["fees_total"] += c.get("fees_total", 0.0)
        d["goods_with_comm"] += gwc
    saved = {str(r.export_date): r for r in db.exec(select(MExportRevenue)).all()}
    out = []
    for k in sorted(by_date, reverse=True):
        d = by_date[k]
        r = saved.get(k)
        hamza = round(r.hamza_expense, 2) if r else 0.0
        majed = round(r.majed_expense, 2) if r else 0.0
        total = round(d["fees_total"] + d["goods_with_comm"], 2)
        out.append({**d, "fees_total": round(d["fees_total"], 2),
                    "goods_with_comm": round(d["goods_with_comm"], 2),
                    "total": total, "hamza_expense": hamza, "majed_expense": majed,
                    "notes": r.notes if r else "",
                    "revenue": round(total - hamza - majed, 2),
                    "saved": r is not None})
    return {"rows": out,
            "totals": {"total": round(sum(x["total"] for x in out), 2),
                       "hamza": round(sum(x["hamza_expense"] for x in out), 2),
                       "majed": round(sum(x["majed_expense"] for x in out), 2),
                       "revenue": round(sum(x["revenue"] for x in out), 2)}}


@router.put("/export-revenues/{export_date}")
def save_export_revenue(export_date: str, payload: dict,
                        db: Session = Depends(get_session),
                        user: User = Depends(admin_or_accountant)):
    d = _as_date(export_date)
    if not d:
        raise HTTPException(400, "تاريخ تصدير غير صحيح")
    try:
        hamza = round(float(payload.get("hamza_expense") or 0), 2)
        majed = round(float(payload.get("majed_expense") or 0), 2)
    except (TypeError, ValueError):
        raise HTTPException(400, "قيمة المصرف غير صحيحة")
    if hamza < 0 or majed < 0:
        raise HTTPException(400, "قيمة المصرف لا تكون سالبة")
    r = db.exec(select(MExportRevenue).where(MExportRevenue.export_date == d)).first()
    if not r:
        r = MExportRevenue(export_date=d)
    r.hamza_expense = hamza
    r.majed_expense = majed
    r.notes = (payload.get("notes") or "").strip()
    r.updated_by = user.full_name or user.username
    r.updated_at = datetime.utcnow()
    db.add(r); db.commit(); db.refresh(r)
    return r


# ============ ترحيل بيانات النظام القديم (يُنفَّذ مرة واحدة) ============
def migrate_legacy(db: Session) -> int:
    """يحوّل حركات النظام القديم إلى قيود دفتر الأستاذ:
    «إيراد» ← استحقاق (فالإيراد مبلغ يجب أن تحوّله الجهة)، و«مصروف» ← مصروف.
    والرصيد الافتتاحي المخزَّن يصبح قيداً افتتاحياً شفّافاً."""
    moved = 0
    for e in db.exec(select(MEntry).where(MEntry.migrated == False)).all():   # noqa: E712
        if not db.get(MBox, e.box_id):
            e.migrated = True; db.add(e); continue
        db.add(MTxn(party_id=e.box_id, txn_date=e.entry_date,
                    txn_type=TXN_CHARGE if e.kind == "إيراد" else TXN_EXPENSE,
                    amount=abs(e.amount or 0),
                    reason=e.category or ("إيراد" if e.kind == "إيراد" else "مصروف"),
                    description=e.description or "", payment_method=e.payment_method or "",
                    ref_no=e.ref_no or "", notes=("مُرحَّل من النظام القديم. " + (e.notes or "")).strip(),
                    created_by=e.created_by or "ترحيل", created_at=e.created_at))
        e.migrated = True; db.add(e); moved += 1
    for p in db.exec(select(MBox).where(MBox.opening_balance != 0)).all():
        ob = p.opening_balance
        db.add(MTxn(party_id=p.id, txn_date=(p.created_at.date() if p.created_at else date.today()),
                    txn_type=TXN_CHARGE if ob > 0 else TXN_PAYMENT, amount=abs(ob),
                    reason="رصيد افتتاحي", description="رصيد افتتاحي مُرحَّل",
                    created_by="ترحيل"))
        p.opening_balance = 0.0
        db.add(p); moved += 1
    if moved:
        db.commit()
    return moved


# ============ مقارنة الجمارك (كما هي — عرض فقط، بلا تعديل) ============
def _actual_customs(db: Session, date_from, date_to) -> dict:
    items = {i.name: (i.syrian_per_ton, i.iraqi_per_ton, bool(i.special_consumption))
             for i in db.exec(select(Item)).all()}
    resolve = cfg_resolver(db)
    q = select(Shipment)
    if date_from: q = q.where(Shipment.ship_date >= date_from)
    if date_to: q = q.where(Shipment.ship_date <= date_to)
    syrian = iraqi = 0.0
    count = 0
    for s in db.exec(q).all():
        syr, irq, _ = items.get(s.item_name, (0.0, 0.0, False))
        c = compute(s, syr, irq, resolve(s.calc_version_id), bool(s.special_consumption))
        syrian += c["syrian_actual"]; iraqi += c["iraqi_actual"]; count += 1
    return {"syrian": round(syrian, 2), "iraqi": round(iraqi, 2), "count": count}


@router.get("/customs/actual")
def customs_actual(date_from: Optional[str] = None, date_to: Optional[str] = None,
                   db: Session = Depends(get_session), user: User = Depends(admin_or_accountant)):
    return _actual_customs(db, date_from, date_to)


def _with_diff(db: Session, c: MCustomsCheck) -> dict:
    actual = _actual_customs(db, c.date_from, c.date_to)
    d_syr = round(c.manual_syrian - actual["syrian"], 2)
    d_irq = round(c.manual_iraqi - actual["iraqi"], 2)
    return {**c.dict(), "actual_syrian": actual["syrian"], "actual_iraqi": actual["iraqi"],
            "shipments": actual["count"], "diff_syrian": d_syr, "diff_iraqi": d_irq,
            "diff_total": round(d_syr + d_irq, 2),
            "matched": abs(d_syr) < 0.01 and abs(d_irq) < 0.01}


@router.get("/customs")
def list_customs_checks(db: Session = Depends(get_session), user: User = Depends(admin_or_accountant)):
    rows = db.exec(select(MCustomsCheck).order_by(MCustomsCheck.date_from.desc())).all()
    return [_with_diff(db, c) for c in rows]


@router.post("/customs")
def add_customs_check(c: MCustomsCheck, db: Session = Depends(get_session),
                      user: User = Depends(admin_or_accountant)):
    c.date_from = _as_date(c.date_from); c.date_to = _as_date(c.date_to)
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
