"""حسابات محمود — نظام محاسبي مستقل قائم على دفتر أستاذ (Ledger).

المبدأ الأساسي: **لا يُعدَّل رصيد يدوياً إطلاقاً.** كل رصيد يُحسب من القيود:

    الرصيد المستحق = إجمالي الاستحقاقات − (إجمالي الدفعات + إجمالي المصاريف)

• استحقاق: يزيد المطلوب من الجهة (شحنة/عمولة/إيراد/تسوية/أي سبب).
• دفعة:    نقد استلمه المحاسب من الجهة → يُنقص المستحق.
• مصروف:   أنفقته الجهة نيابةً عن الشركة → يُنقص المستحق (سداد غير نقدي).

القيود لا تُحذف — تُلغى ويبقى أثرها، وكل تعديل/إلغاء يُسجَّل في جدول تدقيق.
النظام يدوي بالكامل ومنفصل عن الشحنات (عدا شاشة مقارنة الجمارك — للعرض فقط)."""
import json
from datetime import date, datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from ..core.database import get_session
from ..core.security import admin_or_accountant
from ..models import (User, MBox, MEntry, MTxn, MTxnAudit, MCustomsCheck, Shipment, Item,
                      BOX_TYPES, TXN_TYPES, TXN_CHARGE, TXN_PAYMENT, TXN_EXPENSE,
                      CHARGE_REASONS, _as_date)
from ..calc import compute, cfg_resolver

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


def _totals(rows: list[MTxn]) -> dict:
    charges = sum(t.amount for t in rows if t.txn_type == TXN_CHARGE)
    payments = sum(t.amount for t in rows if t.txn_type == TXN_PAYMENT)
    expenses = sum(t.amount for t in rows if t.txn_type == TXN_EXPENSE)
    return {"charges": round(charges, 2), "payments": round(payments, 2),
            "expenses": round(expenses, 2),
            "settled": round(payments + expenses, 2),
            "balance": round(charges - payments - expenses, 2)}


def _balance(db: Session, party_id: int) -> float:
    """الرصيد الحالي للجهة (كل الفترات) — يُستخدم للتحقق قبل قبول قيد جديد."""
    return _totals(_live(db, party_id))["balance"]


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
        tot = _totals(mine)
        pays = _order([t for t in mine if t.txn_type == TXN_PAYMENT])
        last = pays[-1] if pays else None
        out.append({**p.dict(), **tot,
                    "txn_count": len(mine),
                    "payments_count": len(pays),
                    "last_payment": round(last.amount, 2) if last else 0.0,
                    "last_payment_date": str(last.txn_date) if last else "",
                    "is_settled": abs(tot["balance"]) < 0.01,
                    "is_credit": tot["balance"] < -0.01})
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

    # الرصيد الجاري يُبنى من كل القيود السارية منذ البداية لضمان صحة «الرصيد قبل»
    all_live = _order(_live(db, pid))
    running = 0.0
    ledger = []
    for t in all_live:
        before = running
        running += SIGN.get(t.txn_type, 0) * t.amount
        if date_from and str(t.txn_date) < date_from: continue
        if date_to and str(t.txn_date) > date_to: continue
        ledger.append(_txn_out(t, p.name, before, running))

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
                   "last_payment_date": str(last.txn_date) if last else ""},
        "balance_all_time": round(running, 2),
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

    # لا يُسمح بتجاوز المستحق إلا إذا كانت الجهة تدعم الرصيد الدائن
    if ttype in (TXN_PAYMENT, TXN_EXPENSE) and not party.allow_credit:
        current = _balance(db, party.id)
        if amount > current + 0.01:
            raise HTTPException(400,
                f"المبلغ ({amount:.2f}) يتجاوز الرصيد المستحق ({current:.2f}). "
                f"فعّل «السماح برصيد دائن» لهذه الجهة إن كان ذلك مقصوداً.")

    t = MTxn(party_id=party.id,
             txn_date=_as_date(payload.get("txn_date")) or date.today(),
             txn_type=ttype, amount=amount,
             reason=(payload.get("reason") or "").strip(),
             description=(payload.get("description") or "").strip(),
             payment_method=(payload.get("payment_method") or "").strip(),
             ref_no=(payload.get("ref_no") or "").strip(),
             notes=(payload.get("notes") or "").strip(),
             created_by=user.full_name or user.username)
    db.add(t); db.commit(); db.refresh(t)
    return {**_txn_out(t, party.name), "party_balance": _balance(db, party.id)}


@router.put("/txn/{tid}")
def edit_txn(tid: int, patch: dict, db: Session = Depends(get_session),
             user: User = Depends(admin_or_accountant)):
    """تعديل قيد مع حفظ القيم القديمة في سجل التدقيق."""
    t = db.get(MTxn, tid)
    if not t:
        raise HTTPException(404, "القيد غير موجود")
    if t.is_void:
        raise HTTPException(400, "القيد ملغى — لا يمكن تعديله")

    editable = {"txn_date", "amount", "reason", "description",
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
    return {**_txn_out(t, party.name if party else ""), "party_balance": _balance(db, t.party_id)}


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
    return {**_txn_out(t, ""), "party_balance": _balance(db, t.party_id)}


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
           include_void: bool = True):
    """كشف حساب عام قابل للبحث والتصفية، مع الرصيد قبل/بعد لكل جهة."""
    names = {p.id: p.name for p in db.exec(select(MBox)).all()}

    # الرصيد الجاري يُحسب لكل جهة على حدة من بداية تاريخها
    running: dict[int, float] = {}
    snapshots: dict[int, tuple] = {}
    for t in _order(_live(db)):
        before = running.get(t.party_id, 0.0)
        after = before + SIGN.get(t.txn_type, 0) * t.amount
        running[t.party_id] = after
        snapshots[t.id] = (before, after)

    qy = select(MTxn)
    if not include_void:
        qy = qy.where(MTxn.is_void == False)                  # noqa: E712
    if date_from: qy = qy.where(MTxn.txn_date >= date_from)
    if date_to: qy = qy.where(MTxn.txn_date <= date_to)
    if party_id: qy = qy.where(MTxn.party_id == party_id)
    if txn_type: qy = qy.where(MTxn.txn_type == txn_type)
    rows = db.exec(qy).all()
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
    return {"rows": out, "totals": _totals([t for t in rows if not t.is_void]),
            "count": len(out)}


@router.get("/summary")
def summary(db: Session = Depends(get_session), user: User = Depends(admin_or_accountant),
            date_from: Optional[str] = None, date_to: Optional[str] = None):
    """ملخّص عام + تفصيل حسب نوع الجهة وحسب سبب الاستحقاق."""
    parties = {p.id: p for p in db.exec(select(MBox)).all()}
    rows = _live(db, date_from=date_from, date_to=date_to)
    tot = _totals(rows)

    by_type: dict[str, dict] = {}
    for t in rows:
        p = parties.get(t.party_id)
        key = p.box_type if p else "—"
        d = by_type.setdefault(key, {"type": key, "charges": 0.0, "payments": 0.0, "expenses": 0.0})
        d[{TXN_CHARGE: "charges", TXN_PAYMENT: "payments", TXN_EXPENSE: "expenses"}[t.txn_type]] += t.amount

    by_reason: dict[str, dict] = {}
    for t in rows:
        key = t.reason or "بلا سبب"
        d = by_reason.setdefault(key, {"reason": key, "charges": 0.0,
                                       "payments": 0.0, "expenses": 0.0, "count": 0})
        d[{TXN_CHARGE: "charges", TXN_PAYMENT: "payments", TXN_EXPENSE: "expenses"}[t.txn_type]] += t.amount
        d["count"] += 1

    # الجهات ذات الرصيد الأعلى (كل الفترات) — لمتابعة التحصيل
    all_rows = _live(db)
    per: dict[int, list] = {}
    for t in all_rows:
        per.setdefault(t.party_id, []).append(t)
    top = []
    for pid, lst in per.items():
        p = parties.get(pid)
        if not p: continue
        b = _totals(lst)["balance"]
        if abs(b) > 0.01:
            top.append({"id": pid, "name": p.name, "type": p.box_type, "balance": b})
    top.sort(key=lambda x: -x["balance"])

    return {
        **tot,
        "txn_count": len(rows), "parties_count": len(parties),
        "by_type": [{**d, "charges": round(d["charges"], 2), "payments": round(d["payments"], 2),
                     "expenses": round(d["expenses"], 2),
                     "balance": round(d["charges"] - d["payments"] - d["expenses"], 2)}
                    for d in sorted(by_type.values(), key=lambda x: x["type"])],
        "by_reason": [{**d, "charges": round(d["charges"], 2), "payments": round(d["payments"], 2),
                       "expenses": round(d["expenses"], 2)}
                      for d in sorted(by_reason.values(),
                                      key=lambda x: -(x["charges"] + x["payments"] + x["expenses"]))],
        "outstanding": top,
        "outstanding_total": round(sum(x["balance"] for x in top if x["balance"] > 0), 2),
        "credit_total": round(-sum(x["balance"] for x in top if x["balance"] < 0), 2),
    }


@router.get("/meta")
def meta(user: User = Depends(admin_or_accountant)):
    """ثوابت النظام للواجهة."""
    return {"txn_types": list(TXN_TYPES), "box_types": list(BOX_TYPES),
            "charge_reasons": list(CHARGE_REASONS)}


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
