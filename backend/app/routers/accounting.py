from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select
from typing import Optional

from ..core.database import get_session
from ..core.security import admin_or_accountant
from ..models import User, Shipment, Item, JournalEntry, _as_date
from ..calc import compute, calc_cfg, cfg_resolver, compute_summary, COMPANY, COLLECTED

router = APIRouter(prefix="/api/accounting", tags=["accounting"])


def _rows(db, date_from, date_to, branch):
    """كل شحنة تُحسب بمعادلات النسخة المثبَّتة عليها وقت تسجيلها."""
    items = {i.name: (i.syrian_per_ton, i.iraqi_per_ton, bool(i.special_consumption))
             for i in db.exec(select(Item)).all()}
    resolve = cfg_resolver(db)
    out = []
    q = select(Shipment)
    if date_from: q = q.where(Shipment.ship_date >= date_from)
    if date_to: q = q.where(Shipment.ship_date <= date_to)
    for s in db.exec(q).all():
        if branch and branch not in (s.from_city, s.to_city, s.branch):
            continue
        syr, irq, special = items.get(s.item_name, (0.0, 0.0, False))
        out.append((s, compute(s, syr, irq, resolve(s.calc_version_id), special)))
    return out


@router.get("/summary")
def summary(db: Session = Depends(get_session), user: User = Depends(admin_or_accountant),
            date_from: Optional[str] = None, date_to: Optional[str] = None,
            branch: Optional[str] = None):
    rows = _rows(db, date_from, date_to, branch)
    fees = sum(c["fees_total"] for _, c in rows)
    commission = sum(c["commission"] for _, c in rows)
    invested = sum(c["invested_capital"] for _, c in rows)
    recovered = sum(c["invested_capital"] for s, c in rows if s.collection_status == COLLECTED)
    cash_collected = sum(c["collected_actual"] for _, c in rows)
    receivables = sum(c["remaining"] for _, c in rows)
    sender_debt = sum(c.get("sender_debt", 0.0) for _, c in rows)   # ذمم آجلة على المرسلين

    # القيود اليدوية
    jq = select(JournalEntry)
    if date_from: jq = jq.where(JournalEntry.entry_date >= date_from)
    if date_to: jq = jq.where(JournalEntry.entry_date <= date_to)
    journal = [j for j in db.exec(jq).all() if not branch or j.branch == branch]
    other_income = sum(j.amount for j in journal if j.kind == "إيراد")
    opex = sum(j.amount for j in journal if j.kind == "مصروف")

    # مؤشرات الملخّص تُحسب بمعادلات قابلة للتعديل من صفحة «الطباعة والمعادلات»
    totals = {"fees": fees, "commission": commission, "other_income": other_income,
              "opex": opex, "invested": invested, "recovered": recovered,
              "cash_collected": cash_collected,
              "cash_in": sum(c["cash_in"] for _, c in rows),
              "receivables": receivables, "sender_debt": sender_debt,
              "goods_total": sum(c.get("goods_value", 0) or 0 for s, c in rows) or
                             sum(s.goods_value or 0 for s, _ in rows),
              "count": len(rows)}
    kpi = compute_summary(totals, calc_cfg(db))
    revenue = kpi["revenue"]
    operating_net = kpi["operating_net"]
    cash_net = kpi["cash_net"]

    by_cat = {}
    for j in journal:
        if j.kind == "مصروف":
            by_cat[j.category] = by_cat.get(j.category, 0) + j.amount
    by_cat["شراء بضاعة نيابةً عن الزبائن (تلقائي)"] = invested

    # مشتريات نيابةً عن الزبائن — تفصيلي وحسب الموظف
    purchases_detail = []
    by_employee = {}
    for s, c in rows:
        if s.financing != COMPANY:
            continue
        purchases_detail.append({
            # الزبون = صاحب الشحنة = المستلِم، والمرسِل هو من تُطالَب به الذمة عند «آجل»
            "ref_no": s.ref_no, "ship_date": str(s.ship_date), "customer": s.receiver_name,
            "sender": s.sender_name, "bought_by": s.bought_by,
            "amount": c["invested_capital"], "commission": c["commission"],
            "collection_status": s.collection_status,
            "sender_debt": c.get("sender_debt", 0.0),
            "destination": s.to_city,
        })
        emp = s.bought_by or "—"
        e = by_employee.setdefault(emp, {"bought_by": emp, "count": 0, "amount": 0.0, "commission": 0.0})
        e["count"] += 1
        e["amount"] += c["invested_capital"]
        e["commission"] += c["commission"]

    # مقارنة الفروع — الوارد من جهة الإرسال، المصاريف من دفتر القيود حسب المكتب/الفرع
    cities = sorted({s.from_city for s, _ in rows if s.from_city} |
                     {j.branch for j in journal if j.branch})
    branch_comparison = []
    for city in cities:
        rev = sum(c["fees_total"] for s, c in rows if s.from_city == city)
        exp = sum(j.amount for j in journal if j.branch == city and j.kind == "مصروف")
        branch_comparison.append({"city": city, "revenue": round(rev, 2),
                                   "expenses": round(exp, 2), "net": round(rev - exp, 2)})

    # الذمم حسب مكتب الاستلام (لا تشمل «آجل» لأنها ليست على المكتب)
    to_cities = sorted({s.to_city for s, _ in rows if s.to_city})
    receivables_by_office = []
    for city in to_cities:
        due = sum(c["cod_due"] for s, c in rows if s.to_city == city)
        got = sum(c["collected_actual"] for s, c in rows if s.to_city == city)
        if due or got:
            receivables_by_office.append({"city": city, "cod_due": round(due, 2),
                                          "collected": round(got, 2), "remaining": round(due - got, 2)})

    # الذمم الآجلة — على المرسِل نفسه لا على مكتب الوجهة
    by_sender: dict[str, dict] = {}
    for s, c in rows:
        amount = c.get("sender_debt", 0.0)
        if not amount:
            continue
        name = s.sender_name or "— بلا اسم مرسِل —"
        e = by_sender.setdefault(name, {"sender": name, "count": 0, "amount": 0.0, "refs": []})
        e["count"] += 1
        e["amount"] += amount
        e["refs"].append(s.ref_no)
    deferred_by_sender = [{"sender": v["sender"], "count": v["count"],
                           "amount": round(v["amount"], 2),
                           "refs": ", ".join(str(r) for r in sorted(v["refs"]))}
                          for v in sorted(by_sender.values(), key=lambda x: -x["amount"])]
    deferred_total = round(sum(v["amount"] for v in by_sender.values()), 2)

    alerts = [{"ref_no": s.ref_no, "customer": s.receiver_name, "message": c["alert"]}
              for s, c in rows if c["alert"]]

    return {
        "revenue": round(revenue, 2), "fees": round(fees, 2),
        "commission": round(commission, 2), "other_income": round(other_income, 2),
        "opex": round(opex, 2), "invested": round(invested, 2),
        "recovered": round(recovered, 2), "not_recovered": kpi["not_recovered"],
        "total_payments": kpi["total_payments"],
        "cash_collected": round(cash_collected, 2),
        "receivables": round(receivables, 2),
        "sender_debt": round(sender_debt, 2),
        "total_receivables": round(receivables + sender_debt, 2),
        "operating_net": round(operating_net, 2),
        "cash_net": round(cash_net, 2),
        "expenses_by_category": {k: round(v, 2) for k, v in by_cat.items()},
        "count": len(rows),
        "purchases_detail": purchases_detail,
        "purchases_by_employee": [
            {"bought_by": v["bought_by"], "count": v["count"],
             "amount": round(v["amount"], 2), "commission": round(v["commission"], 2)}
            for v in by_employee.values()],
        "branch_comparison": branch_comparison,
        "receivables_by_office": receivables_by_office,
        "deferred_by_sender": deferred_by_sender,
        "deferred_total": deferred_total,
        "alerts": alerts,
    }


@router.get("/journal")
def list_journal(db: Session = Depends(get_session), user: User = Depends(admin_or_accountant)):
    return db.exec(select(JournalEntry)).all()


@router.post("/journal")
def add_journal(e: JournalEntry, db: Session = Depends(get_session),
                user: User = Depends(admin_or_accountant)):
    e.entry_date = _as_date(e.entry_date)
    db.add(e); db.commit(); db.refresh(e)
    return e


@router.put("/journal/{jid}")
def edit_journal(jid: int, patch: dict, db: Session = Depends(get_session),
                 user: User = Depends(admin_or_accountant)):
    e = db.get(JournalEntry, jid)
    if not e:
        raise HTTPException(404, "القيد غير موجود")
    for k, v in patch.items():
        if hasattr(e, k):
            setattr(e, k, _as_date(v) if k == "entry_date" else v)
    db.add(e); db.commit(); db.refresh(e)
    return e


@router.delete("/journal/{jid}")
def delete_journal(jid: int, db: Session = Depends(get_session),
                   user: User = Depends(admin_or_accountant)):
    e = db.get(JournalEntry, jid)
    if e:
        db.delete(e); db.commit()
    return {"ok": True}
