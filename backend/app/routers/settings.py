import base64
import json

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlmodel import Session, select

from ..core.database import get_session
from ..core.security import admin_only, any_role
from ..models import User, ListItem, Setting
from ..calc import (FORMULA_SPECS, VARIABLE_DOCS, DEFAULT_FORMULAS,
                    SUMMARY_FORMULA_SPECS, SUMMARY_VARIABLE_DOCS, DEFAULT_SUMMARY_FORMULAS,
                    calc_cfg, save_version,
                    validate_formula, validate_summary_formula)

router = APIRouter(prefix="/api/settings", tags=["settings"])

# القوائم الافتراضية عند أول تشغيل — نفس نطاقات الإكسل المسمّاة.
# القيم المحمية (protected) تُستخدم كنصوص ثابتة داخل calc.py وقد تُضاف لها قيم لكن لا تُحذف/تُعدّل.
DEFAULT_LISTS = {
    "cities": [("دمشق", False), ("ريف دمشق", False), ("حلب", False), ("حمص", False), ("حماة", False),
               ("اللاذقية", False), ("طرطوس", False), ("إدلب", False), ("درعا", False), ("السويداء", False),
               ("دير الزور", False), ("الحسكة", False), ("الرقة", False), ("بغداد", False), ("البصرة", False),
               ("أربيل", False), ("الموصل", False), ("السليمانية", False), ("كركوك", False),
               ("النجف", False), ("كربلاء", False)],
    "parcel_types": [("كرتون", False), ("كيس", False), ("صندوق", False), ("طرد", False),
                      ("لفة", False), ("برميل", False), ("خشبة", False), ("أخرى", False)],
    "expense_categories": [("إيجار مكتب", False), ("رواتب", False), ("محروقات", False), ("نقل داخلي", False),
                            ("كهرباء وماء", False), ("اتصالات وإنترنت", False), ("صيانة", False),
                            ("قرطاسية", False), ("ضيافة", False), ("رسوم حكومية", False),
                            ("عمولات", False), ("مصاريف بنكية", False), ("أخرى", False)],
    "financing_types": [("الزبون اشترى بنفسه", True), ("الشركة اشترت نيابةً عنه", True)],
    "payment_methods": [("واصل نقداً", True), ("ضد الدفع", True), ("آجل", True)],
    "delivery_statuses": [("قيد التسليم", True), ("تم التسليم", True)],
    "collection_statuses": [("لم يُحصَّل", True), ("تم التحصيل", True), ("آجل", True)],
    "export_statuses": [("قيد التصدير", True), ("تم التصدير", True)],
}


def seed_lists(db: Session):
    """يزرع أي قائمة غائبة، ويضيف أي قيمة محميّة مستجدّة إلى القوائم الموجودة
    (مثل «آجل») — دون المساس بالقيم التي أضافها المستخدم."""
    rows = db.exec(select(ListItem)).all()
    existing_keys = {r.list_key for r in rows}
    existing_pairs = {(r.list_key, r.value) for r in rows}
    max_order = {}
    for r in rows:
        max_order[r.list_key] = max(max_order.get(r.list_key, -1), r.sort_order)
    added = False
    for key, values in DEFAULT_LISTS.items():
        if key not in existing_keys:
            for i, (val, protected) in enumerate(values):
                db.add(ListItem(list_key=key, value=val, protected=protected, sort_order=i))
            added = True
            continue
        # قائمة موجودة: أضِف فقط القيم المحميّة الجديدة التي يعتمد عليها منطق الحسابات
        for val, protected in values:
            if protected and (key, val) not in existing_pairs:
                max_order[key] = max_order.get(key, -1) + 1
                db.add(ListItem(list_key=key, value=val, protected=True,
                                sort_order=max_order[key]))
                added = True
    if added:
        db.commit()


# ---- بيانات الشركة (رقم الهاتف يظهر في ترويسات الفواتير والتقارير — خلية رقم_الشركة في الإكسل) ----
COMPANY_KEYS = ("company_phone", "company_name")


@router.get("/company")
def get_company(db: Session = Depends(get_session), user: User = Depends(any_role)):
    rows = {s.key: s.value for s in db.exec(select(Setting)).all()}
    return {"phone": rows.get("company_phone", ""), "name": rows.get("company_name", ""),
            "logo": rows.get("company_logo", "")}


@router.put("/company")
def set_company(payload: dict, db: Session = Depends(get_session), user: User = Depends(admin_only)):
    values = {"company_phone": (payload.get("phone") or "").strip(),
              "company_name": (payload.get("name") or "").strip()}
    for key, val in values.items():
        _set(db, key, val)
    db.commit()
    logo = db.get(Setting, "company_logo")
    return {"phone": values["company_phone"], "name": values["company_name"],
            "logo": logo.value if logo else ""}


@router.post("/logo")
async def upload_logo(file: UploadFile = File(...), db: Session = Depends(get_session),
                      user: User = Depends(admin_only)):
    """رفع صورة لوغو الشركة — تُخزَّن كـ data URL وتظهر في كل الفواتير والتقارير."""
    data = await file.read()
    if len(data) > 2 * 1024 * 1024:
        raise HTTPException(400, "حجم الصورة كبير — الحد الأقصى 2 ميغابايت")
    ctype = file.content_type or "image/png"
    if not ctype.startswith("image/"):
        raise HTTPException(400, "الملف يجب أن يكون صورة")
    data_url = f"data:{ctype};base64," + base64.b64encode(data).decode()
    _set(db, "company_logo", data_url)
    db.commit()
    return {"logo": data_url}


@router.delete("/logo")
def clear_logo(db: Session = Depends(get_session), user: User = Depends(admin_only)):
    """إزالة اللوغو المرفوع والعودة للوغو الافتراضي."""
    _set(db, "company_logo", "")
    db.commit()
    return {"logo": ""}


def _set(db: Session, key: str, value: str):
    s = db.get(Setting, key)
    if s:
        s.value = value
    else:
        s = Setting(key=key, value=value)
    db.add(s)


# ---- أعمدة الطباعة (فاتورة الزبون + لوحة التقارير + كشف الجمارك) — [] تعني كل الأعمدة ----
PRINT_VIEWS = ("invoice", "reports", "customs")


@router.get("/print")
def get_print_columns(db: Session = Depends(get_session), user: User = Depends(any_role)):
    rows = {s.key: s.value for s in db.exec(select(Setting)).all()}
    def parse(key):
        try:
            v = json.loads(rows.get(key) or "[]")
            return v if isinstance(v, list) else []
        except json.JSONDecodeError:
            return []
    return {view: parse(f"print_columns_{view}") for view in PRINT_VIEWS}


@router.put("/print")
def set_print_columns(payload: dict, db: Session = Depends(get_session),
                      user: User = Depends(admin_only)):
    for view in PRINT_VIEWS:
        cols = payload.get(view)
        if cols is None:
            continue
        if not isinstance(cols, list) or not all(isinstance(c, str) for c in cols):
            raise HTTPException(400, "صيغة الأعمدة غير صحيحة")
        _set(db, f"print_columns_{view}", json.dumps(cols, ensure_ascii=False))
    db.commit()
    return get_print_columns(db, user)


# ---- المعادلات والثوابت الحسابية (تقابل إعدادات ورقة «قاعدة البيانات» في الإكسل) ----
@router.get("/calc")
def get_calc_settings(db: Session = Depends(get_session), user: User = Depends(admin_only)):
    cfg = calc_cfg(db)
    return {
        "tax_advance_rate": cfg["tax_advance_rate"],
        "default_commission": cfg["default_commission"],
        "two_party_per_ton": cfg["two_party_per_ton"],
        "tiers": cfg["tiers"],
        "formulas": [{"key": key, "label": label, "excel": excel, "doc": doc,
                      "default": default, "expr": cfg["formulas"][key]}
                     for key, label, excel, doc, default in FORMULA_SPECS],
        "summary_formulas": [{"key": key, "label": label, "excel": excel, "doc": doc,
                              "default": default, "expr": cfg["summary_formulas"][key]}
                             for key, label, excel, doc, default in SUMMARY_FORMULA_SPECS],
        "variables": [{"name": n, "doc": d} for n, d in VARIABLE_DOCS],
        "summary_variables": [{"name": n, "doc": d} for n, d in SUMMARY_VARIABLE_DOCS],
    }


@router.put("/calc")
def set_calc_settings(payload: dict, db: Session = Depends(get_session),
                      user: User = Depends(admin_only)):
    """يحفظ الإعدادات كـ«نسخة جديدة» — تسري على الشحنات الجديدة فقط،
    بينما تحتفظ الشحنات المسجَّلة سابقاً بأرقامها كما هي."""
    cfg = calc_cfg(db)                      # ننطلق من النسخة السارية
    new_cfg = {k: (dict(v) if isinstance(v, dict) else
                   [list(x) for x in v] if isinstance(v, list) else v)
               for k, v in cfg.items()}

    # الثوابت
    for field in ("tax_advance_rate", "default_commission", "two_party_per_ton"):
        if field in payload:
            try:
                new_cfg[field] = float(payload[field])
            except (TypeError, ValueError):
                raise HTTPException(400, f"قيمة غير رقمية في {field}")
    # شرائح الإنفاق
    if "tiers" in payload:
        try:
            tiers = sorted([[float(a), float(b)] for a, b in payload["tiers"]])
        except (TypeError, ValueError):
            raise HTTPException(400, "شرائح الإنفاق يجب أن تكون أزواجاً رقمية (الحد الأدنى، النسبة)")
        if not tiers:
            raise HTTPException(400, "يجب إبقاء شريحة واحدة على الأقل")
        new_cfg["tiers"] = tiers

    # معادلات الأعمدة — تُفحص واحدة واحدة قبل الحفظ
    labels = {key: label for key, label, _, _, _ in FORMULA_SPECS}
    for key, expr in (payload.get("formulas") or {}).items():
        if key not in DEFAULT_FORMULAS:
            raise HTTPException(400, f"عمود غير معروف: {key}")
        expr = (expr or "").strip()
        if not expr:
            new_cfg["formulas"][key] = DEFAULT_FORMULAS[key]
            continue
        try:
            validate_formula(key, expr)
        except (ValueError, SyntaxError) as e:
            raise HTTPException(400, f"معادلة «{labels[key]}» غير صالحة: {e}")
        new_cfg["formulas"][key] = expr

    # معادلات المؤشرات
    slabels = {key: label for key, label, _, _, _ in SUMMARY_FORMULA_SPECS}
    for key, expr in (payload.get("summary_formulas") or {}).items():
        if key not in DEFAULT_SUMMARY_FORMULAS:
            raise HTTPException(400, f"مؤشر غير معروف: {key}")
        expr = (expr or "").strip()
        if not expr:
            new_cfg["summary_formulas"][key] = DEFAULT_SUMMARY_FORMULAS[key]
            continue
        try:
            validate_summary_formula(key, expr)
        except (ValueError, SyntaxError) as e:
            raise HTTPException(400, f"معادلة المؤشر «{slabels[key]}» غير صالحة: {e}")
        new_cfg["summary_formulas"][key] = expr

    if new_cfg == cfg:
        return {"ok": True, "version": None, "changed": False}
    version = save_version(db, new_cfg, user.username)
    return {"ok": True, "version": version, "changed": True}


@router.get("/lists")
def all_lists(db: Session = Depends(get_session), user: User = Depends(any_role)):
    """قوائم مبسّطة {key: [قيم]} — لتعبئة القوائم المنسدلة في كل الواجهة."""
    rows = db.exec(select(ListItem).order_by(ListItem.list_key, ListItem.sort_order)).all()
    out: dict[str, list[str]] = {}
    for r in rows:
        out.setdefault(r.list_key, []).append(r.value)
    return out


@router.get("/lists/full")
def all_lists_full(db: Session = Depends(get_session), user: User = Depends(admin_only)):
    """تفاصيل كاملة (id + محمي؟) لصفحة إدارة القوائم."""
    rows = db.exec(select(ListItem).order_by(ListItem.list_key, ListItem.sort_order)).all()
    out: dict[str, list[dict]] = {}
    for r in rows:
        out.setdefault(r.list_key, []).append({"id": r.id, "value": r.value, "protected": r.protected})
    return out


@router.post("/lists/{key}")
def add_value(key: str, payload: dict, db: Session = Depends(get_session),
              user: User = Depends(admin_only)):
    value = (payload.get("value") or "").strip()
    if not value:
        raise HTTPException(400, "القيمة مطلوبة")
    exists = db.exec(select(ListItem).where(ListItem.list_key == key, ListItem.value == value)).first()
    if exists:
        raise HTTPException(400, "هذه القيمة موجودة أصلاً في القائمة")
    last = db.exec(select(ListItem).where(ListItem.list_key == key)
                   .order_by(ListItem.sort_order.desc())).first()
    item = ListItem(list_key=key, value=value, protected=False,
                    sort_order=(last.sort_order + 1) if last else 0)
    db.add(item); db.commit(); db.refresh(item)
    return item


@router.put("/lists/item/{item_id}")
def rename_value(item_id: int, payload: dict, db: Session = Depends(get_session),
                 user: User = Depends(admin_only)):
    item = db.get(ListItem, item_id)
    if not item:
        raise HTTPException(404, "القيمة غير موجودة")
    if item.protected:
        raise HTTPException(400, "لا يمكن تعديل هذه القيمة — مستخدمة في منطق الحسابات")
    value = (payload.get("value") or "").strip()
    if not value:
        raise HTTPException(400, "القيمة مطلوبة")
    item.value = value
    db.add(item); db.commit(); db.refresh(item)
    return item


@router.delete("/lists/item/{item_id}")
def delete_value(item_id: int, db: Session = Depends(get_session), user: User = Depends(admin_only)):
    item = db.get(ListItem, item_id)
    if not item:
        return {"ok": True}
    if item.protected:
        raise HTTPException(400, "لا يمكن حذف هذه القيمة — مستخدمة في منطق الحسابات")
    db.delete(item); db.commit()
    return {"ok": True}
