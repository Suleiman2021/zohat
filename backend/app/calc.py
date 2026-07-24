"""محرّك الحسابات — نفس معادلات ملف الإكسل، لكن قابلة للتعديل من صفحة «الطباعة والمعادلات».
مصدر الحقيقة الوحيد للأرقام: المعادلات تُقرأ من قاعدة البيانات (مع افتراضيات مطابقة للإكسل)
وتُنفَّذ هنا بمُقيِّم آمن — الواجهة تعرض فقط، ولا تحسب."""
import ast
import json
from sqlmodel import select

from .core.config import (DEFAULT_TAX_ADVANCE, DEFAULT_BUY_COMMISSION,
                          CONSUMPTION_TIERS)

CASH = "واصل نقداً"
COD = "ضد الدفع"
COMPANY = "الشركة اشترت نيابةً عنه"
COLLECTED = "تم التحصيل"
DELIVERED = "تم التسليم"

# ---------------------------------------------------------------------------
# المُقيِّم الآمن: عمليات حسابية ومقارنات وشرط (قيمة إذا شرط وإلا قيمة) فقط —
# لا وصول لأي دوال أو خصائص بايثون، فلا يمكن تنفيذ كود ضار عبر معادلة معدّلة.
# ---------------------------------------------------------------------------
_ALLOWED_NODES = (ast.Expression, ast.BinOp, ast.UnaryOp, ast.Constant, ast.Name, ast.Load,
                  ast.IfExp, ast.Compare, ast.BoolOp, ast.And, ast.Or, ast.Not,
                  ast.Add, ast.Sub, ast.Mult, ast.Div, ast.USub, ast.UAdd,
                  ast.Eq, ast.NotEq, ast.Gt, ast.GtE, ast.Lt, ast.LtE, ast.Call)
_ALLOWED_FUNCS = {"min": min, "max": max, "round": round, "abs": abs}


def safe_eval(expr: str, variables: dict):
    tree = ast.parse(expr, mode="eval")
    for node in ast.walk(tree):
        if not isinstance(node, _ALLOWED_NODES):
            raise ValueError(f"صيغة غير مسموحة: {type(node).__name__}")
        if isinstance(node, ast.Call):
            if not isinstance(node.func, ast.Name) or node.func.id not in _ALLOWED_FUNCS:
                raise ValueError("الدوال المسموحة فقط: min, max, round, abs")
        if isinstance(node, ast.Name) and node.id not in variables and node.id not in _ALLOWED_FUNCS:
            raise ValueError(f"متغير غير معروف: {node.id}")
    return eval(compile(tree, "<formula>", "eval"),
                {"__builtins__": {}, **_ALLOWED_FUNCS}, variables)


# ---------------------------------------------------------------------------
# مواصفات المعادلات — بترتيب التنفيذ (كل معادلة ترى نتائج ما قبلها كمتغيرات).
# كل عنصر: (المفتاح، الاسم بالعربية، مرجع خلية الإكسل، شرح، المعادلة الافتراضية)
# ---------------------------------------------------------------------------
FORMULA_SPECS = [
    ("syrian_actual", "الرسم السوري الفعلي", "حساب الجمارك!E5",
     "الوزن بالطن × الرسم السوري للطن (الأصل من قاعدة البيانات)",
     "(weight_kg / 1000) * syrian_per_ton"),
    ("tax_advance", "السلفة الضريبية", "حساب الجمارك!H5",
     "قيمة البضاعة × نسبة السلفة — الإدخال اليدوي في نموذج الجمارك له الأولوية",
     "goods_value * tax_advance_rate"),
    ("consumption_fee", "رسم الإنفاق الاستهلاكي", "حساب الجمارك!J5",
     "(قيمة البضاعة + الرسم السوري الفعلي) × نسبة الشريحة — الإدخال اليدوي له الأولوية",
     "(goods_value + syrian_actual) * consumption_rate"),
    ("iraqi_actual", "الرسم العراقي الفعلي", "حساب الجمارك!F5",
     "الوزن بالطن × الرسم العراقي للطن (من الصنف أو تجاوز يدوي في نموذج الجمارك)",
     "(weight_kg / 1000) * iraqi_per_ton"),
    ("two_party_expense", "مصروف طرفين", "حساب الجمارك!K5",
     "إن أُدخلت قيمة يدوية في نموذج الجمارك تُعتمد كما هي لكامل الشحنة، "
     "وإن تُرك الحقل فارغاً يُحسب تلقائياً = (الوزن ÷ 1000) × مصروف الطرفين للطن",
     "two_party_expense_input if two_party_manual else (weight_kg / 1000) * two_party_per_ton"),
    ("duties_only", "الرسوم (بند الفاتورة)", "صفحة الزبون",
     "الرسم السوري الفعلي + الرسم العراقي الفعلي + مصروف طرفين",
     "syrian_actual + iraqi_actual + two_party_expense"),
    ("fees_total", "أجور الشحن والجمركة (المجموع النهائي)", "حساب الجمارك!M5",
     "الرسوم + السلفة + رسم الإنفاق + الأجور الإضافية",
     "duties_only + tax_advance + consumption_fee + extra_fees"),
    ("commission", "عمولة الشراء", "سجل الشحنات!AC5",
     "ثمن البضاعة × نسبة العمولة — فقط عندما تشتري الشركة نيابةً عن الزبون",
     "goods_price * commission_rate if is_company else 0"),
    ("invested_capital", "رأس مال مستثمر (على الشركة)", "سجل الشحنات!AD5",
     "ثمن البضاعة المدفوع من الشركة عند الشراء نيابةً عن الزبون",
     "goods_price if is_company else 0"),
    ("cash_in", "المحصّل نقداً", "سجل الشحنات!R5",
     "الأجور تُحصَّل فوراً إذا كان الدفع «واصل نقداً»",
     'fees_total if fees_payment == "واصل نقداً" else 0'),
    ("cod_due", "المستحق ضد الدفع", "سجل الشحنات!S5",
     "الأجور إن كانت «ضد الدفع» + (قيمة البضاعة + العمولة) إن اشترت الشركة",
     '(fees_total if fees_payment == "ضد الدفع" else 0)'
     ' + ((invested_capital + commission) if is_company else 0)'),
    ("collected_actual", "المحصَّل فعلياً", "سجل الشحنات!AH5",
     "كامل المستحق عند تعليم الشحنة «تم التحصيل»",
     'cod_due if collection_status == "تم التحصيل" else 0'),
    ("remaining", "المتبقي في الذمة", "سجل الشحنات!AI5",
     "المستحق ضد الدفع − المحصَّل فعلياً",
     "cod_due - collected_actual"),
    ("grand_total", "إجمالي المبلغ", "سجل الشحنات!T5",
     "الأجور + رأس المال المستثمر + العمولة",
     "fees_total + invested_capital + commission"),
]

# شرح المتغيرات المتاحة داخل المعادلات (يظهر في صفحة المعادلات)
VARIABLE_DOCS = [
    ("weight_kg", "الوزن (كغ) — من سجل الشحنات"),
    ("syrian_per_ton", "الرسم السوري للطن (الأصل) — من قاعدة الأصناف"),
    ("iraqi_per_ton", "الرسم العراقي للطن — من قاعدة الأصناف أو تجاوز يدوي في الجمارك"),
    ("goods_value", "قيمة الفاتورة (دولار) — تدخل في السلفة الضريبية ورسم الإنفاق فقط"),
    ("goods_price", "ثمن البضاعة (دولار) — يدخل في العمولة ورأس المال عند الشراء نيابةً عن الزبون"),
    ("two_party_per_ton", "مصروف الطرفين للطن الواحد (من الإعدادات)"),
    ("two_party_expense_input", "مصروف الطرفين المُدخل يدوياً في نموذج الجمارك"),
    ("two_party_manual", "هل أُدخل مصروف الطرفين يدوياً؟ (True/False) — False يعني الحقل فارغ"),
    ("extra_fees", "أجور إضافية (دولار)"),
    ("tax_advance_rate", "نسبة السلفة الضريبية (افتراضي 0.02)"),
    ("commission_rate", "نسبة العمولة (يدوية للشحنة أو الافتراضية 0.05)"),
    ("consumption_rate", "نسبة الإنفاق من جدول الشرائح"),
    ("is_company", "هل الشركة اشترت نيابةً عن الزبون؟ (True/False)"),
    ("fees_payment", 'طريقة دفع الأجور — نص: "واصل نقداً" أو "ضد الدفع"'),
    ("financing", "تمويل البضاعة — نص"),
    ("collection_status", 'حالة التحصيل — نص: "لم يُحصَّل" أو "تم التحصيل"'),
    ("delivery_status", "حالة التسليم — نص"),
    ("+ كل نتيجة معادلة سابقة", "syrian_actual, tax_advance, consumption_fee, duties_only, fees_total, ..."),
]

DEFAULT_FORMULAS = {key: default for key, _, _, _, default in FORMULA_SPECS}

# ---------------------------------------------------------------------------
# معادلات المؤشرات (لوحة المؤشرات + ملخّص الحسابات) — تعمل على المجاميع لا على
# شحنة مفردة، وهي قابلة للتعديل مثل معادلات الأعمدة.
# ---------------------------------------------------------------------------
SUMMARY_FORMULA_SPECS = [
    ("revenue", "الإيرادات", "الحسابات — رابعاً",
     "أجور الشحن والجمركة + عمولة الشراء + الإيرادات اليدوية",
     "fees + commission + other_income"),
    ("total_payments", "إجمالي المدفوعات", "الحسابات — رابعاً",
     "المصاريف التشغيلية + المشتريات نيابةً عن الزبائن",
     "opex + invested"),
    ("operating_net", "صافي الربح التشغيلي", "الحسابات — رابعاً",
     "الإيرادات − المصاريف التشغيلية (لا تُخصم المشتريات لأنها تُسترد)",
     "revenue - opex"),
    ("cash_net", "صافي التدفق النقدي", "الحسابات — رابعاً",
     "النقد المحصَّل فعلياً − (المصاريف التشغيلية + المشتريات)",
     "cash_collected - (opex + invested)"),
    ("not_recovered", "رأس مال لم يُسترد بعد", "الحسابات — ثالثاً",
     "إجمالي المشتريات − المسترد منها",
     "invested - recovered"),
]
DEFAULT_SUMMARY_FORMULAS = {k: d for k, _, _, _, d in SUMMARY_FORMULA_SPECS}

SUMMARY_VARIABLE_DOCS = [
    ("fees", "مجموع أجور الشحن والجمركة للشحنات المطابقة للفلتر"),
    ("commission", "مجموع عمولة الشراء"),
    ("other_income", "الإيرادات اليدوية من دفتر القيود"),
    ("opex", "المصاريف التشغيلية من دفتر القيود"),
    ("invested", "مجموع رأس المال المستثمر (المشتريات نيابةً عن الزبائن)"),
    ("recovered", "المسترد من المشتريات (الشحنات التي تم تحصيلها)"),
    ("cash_collected", "مجموع المحصَّل فعلياً"),
    ("cash_in", "مجموع المحصّل نقداً"),
    ("receivables", "مجموع المتبقي في الذمة"),
    ("goods_total", "مجموع قيمة الفواتير"),
    ("count", "عدد الشحنات المطابقة"),
    ("+ كل نتيجة معادلة مؤشر سابقة", "revenue, total_payments, operating_net, ..."),
]


def default_calc_cfg() -> dict:
    return {"tax_advance_rate": DEFAULT_TAX_ADVANCE,
            "default_commission": DEFAULT_BUY_COMMISSION,
            "two_party_per_ton": 0.0,
            "tiers": [list(t) for t in CONSUMPTION_TIERS],
            "formulas": dict(DEFAULT_FORMULAS),
            "summary_formulas": dict(DEFAULT_SUMMARY_FORMULAS)}


def _cfg_from_settings(db) -> dict:
    """يقرأ الثوابت والمعادلات من جدول الإعدادات فوق الافتراضيات (المصدر القديم)."""
    from .models import Setting
    rows = {s.key: s.value for s in db.exec(select(Setting)).all()}
    cfg = default_calc_cfg()
    try:
        if rows.get("calc_tax_advance_rate"):
            cfg["tax_advance_rate"] = float(rows["calc_tax_advance_rate"])
        if rows.get("calc_default_commission"):
            cfg["default_commission"] = float(rows["calc_default_commission"])
        if rows.get("calc_two_party_per_ton"):
            cfg["two_party_per_ton"] = float(rows["calc_two_party_per_ton"])
        if rows.get("calc_tiers"):
            tiers = json.loads(rows["calc_tiers"])
            if isinstance(tiers, list) and tiers:
                cfg["tiers"] = sorted([[float(a), float(b)] for a, b in tiers])
    except (ValueError, TypeError, json.JSONDecodeError):
        pass  # قيمة تالفة → نبقى على الافتراضي بدل تعطيل الحسابات
    for key in DEFAULT_FORMULAS:
        expr = rows.get("formula_" + key)
        if expr and expr.strip():
            cfg["formulas"][key] = expr.strip()
    for key in DEFAULT_SUMMARY_FORMULAS:
        expr = rows.get("sformula_" + key)
        if expr and expr.strip():
            cfg["summary_formulas"][key] = expr.strip()
    return cfg


def _normalize(payload: dict) -> dict:
    """يكمل أي مفاتيح ناقصة من الافتراضيات (توافق أمامي مع نسخ قديمة)."""
    cfg = default_calc_cfg()
    for k in ("tax_advance_rate", "default_commission", "two_party_per_ton"):
        if isinstance(payload.get(k), (int, float)):
            cfg[k] = float(payload[k])
    if isinstance(payload.get("tiers"), list) and payload["tiers"]:
        try:
            cfg["tiers"] = sorted([[float(a), float(b)] for a, b in payload["tiers"]])
        except (ValueError, TypeError):
            pass
    for group in ("formulas", "summary_formulas"):
        src = payload.get(group) or {}
        if isinstance(src, dict):
            for k, expr in src.items():
                if k in cfg[group] and isinstance(expr, str) and expr.strip():
                    cfg[group][k] = expr.strip()
    return cfg


# ---- نسخ المعادلات: تجميد أرقام الشحنات السابقة ضد أي تعديل لاحق ----
def current_version(db) -> tuple[int, dict]:
    """(معرّف أحدث نسخة، إعداداتها). تُنشأ النسخة الأولى من الإعدادات الحالية."""
    from .models import CalcVersion
    row = db.exec(select(CalcVersion).order_by(CalcVersion.id.desc())).first()
    if row:
        try:
            return row.id, _normalize(json.loads(row.payload))
        except (json.JSONDecodeError, TypeError):
            pass
    cfg = _cfg_from_settings(db)
    row = CalcVersion(payload=json.dumps(cfg, ensure_ascii=False), created_by="system")
    db.add(row); db.commit(); db.refresh(row)
    return row.id, cfg


# معادلات قديمة استُبدلت بقرار تشغيلي — تُرقَّى تلقائياً إلى الافتراضي الجديد
_SUPERSEDED = {
    "two_party_expense": [
        "(weight_kg / 1000) * two_party_per_ton if two_party_per_ton > 0 else two_party_expense_input",
        "two_party_expense_input",
    ],
}


# رقم دفعة الترقية — زِدْه عند إضافة معادلات جديدة إلى _SUPERSEDED
_UPGRADE_MARK = "calc_upgrade_applied_v2"


def upgrade_superseded_formulas(db) -> bool:
    """يستبدل المعادلات المُلغاة في النسخة السارية بالافتراضي الجديد (نسخة جديدة).
    يعمل **مرة واحدة فقط** (يُعلَّم في الإعدادات) حتى لا يطغى على اختيار المستخدم
    إن أعاد ضبط المعادلة يدوياً إلى صيغة قديمة عن قصد."""
    from .models import Setting
    if db.get(Setting, _UPGRADE_MARK):
        return False
    ver_id, cfg = current_version(db)
    changed = False
    for key, old_exprs in _SUPERSEDED.items():
        if cfg["formulas"].get(key) in old_exprs:
            cfg["formulas"][key] = DEFAULT_FORMULAS[key]
            changed = True
    if changed:
        save_version(db, cfg, "system-upgrade")
    db.add(Setting(key=_UPGRADE_MARK, value="1"))
    db.commit()
    return changed


def save_version(db, cfg: dict, username: str = "") -> int:
    """يحفظ نسخة جديدة — تسري على الشحنات الجديدة فقط."""
    from .models import CalcVersion
    row = CalcVersion(payload=json.dumps(cfg, ensure_ascii=False), created_by=username)
    db.add(row); db.commit(); db.refresh(row)
    return row.id


def calc_cfg(db) -> dict:
    """إعدادات النسخة السارية حالياً (للشحنات الجديدة والمعاينات)."""
    return current_version(db)[1]


def cfg_resolver(db):
    """يعيد دالة (calc_version_id) → إعدادات تلك النسخة، مع تخزين مؤقت لكل طلب.
    الشحنات القديمة (بلا نسخة) تُحسب بالنسخة الأولى المجمّدة."""
    from .models import CalcVersion
    cur_id, cur_cfg = current_version(db)
    cache: dict = {None: cur_cfg, cur_id: cur_cfg}

    def resolve(version_id):
        if version_id in cache:
            return cache[version_id]
        row = db.get(CalcVersion, version_id)
        try:
            cache[version_id] = _normalize(json.loads(row.payload)) if row else cur_cfg
        except (json.JSONDecodeError, TypeError):
            cache[version_id] = cur_cfg
        return cache[version_id]

    resolve.current_id = cur_id
    resolve.current_cfg = cur_cfg
    return resolve


def _sample_vars() -> dict:
    return {"weight_kg": 100.0, "syrian_per_ton": 300.0, "iraqi_per_ton": 120.0,
            "goods_value": 1000.0, "goods_price": 800.0,
            "two_party_per_ton": 10.0, "two_party_expense_input": 10.0,
            "two_party_manual": True, "extra_fees": 5.0,
            "tax_advance_rate": 0.02, "commission_rate": 0.05, "consumption_rate": 0.02,
            "is_company": True, "fees_payment": COD, "financing": COMPANY,
            "collection_status": COLLECTED, "delivery_status": DELIVERED}


def validate_formula(key: str, expr: str):
    """يتحقق من صلاحية معادلة عمود قبل حفظها — يرمي ValueError برسالة عربية."""
    sample = _sample_vars()
    for k, _, _, _, _ in FORMULA_SPECS:
        sample[k] = 1.0
        if k == key:
            break
    result = safe_eval(expr, sample)
    if not isinstance(result, (int, float, bool)):
        raise ValueError("يجب أن تُنتج المعادلة رقماً")


def validate_summary_formula(key: str, expr: str):
    """يتحقق من صلاحية معادلة مؤشر قبل حفظها."""
    sample = {n: 100.0 for n, _ in SUMMARY_VARIABLE_DOCS if not n.startswith("+")}
    for k, _, _, _, _ in SUMMARY_FORMULA_SPECS:
        sample[k] = 1.0
        if k == key:
            break
    result = safe_eval(expr, sample)
    if not isinstance(result, (int, float, bool)):
        raise ValueError("يجب أن تُنتج المعادلة رقماً")


def compute_summary(totals: dict, cfg: dict | None = None) -> dict:
    """يحسب مؤشرات الملخّص من المجاميع بالمعادلات القابلة للتعديل."""
    cfg = cfg or default_calc_cfg()
    v = dict(totals)
    out = {}
    for key, _, _, _, default_expr in SUMMARY_FORMULA_SPECS:
        try:
            val = safe_eval(cfg["summary_formulas"].get(key, default_expr), v)
        except Exception:
            val = safe_eval(default_expr, v)
        v[key] = float(val or 0)
        out[key] = round(v[key], 2)
    return out


def tier_rate(syrian_per_ton: float, tiers) -> float:
    """النسبة حسب الرسم السوري للطن (الأصل) — بحث شرائحي تصاعدي كما في الإكسل."""
    rate = 0.0
    for lower, r in tiers:
        if syrian_per_ton >= lower:
            rate = r
        else:
            break
    return rate


def compute(sh, syrian_per_ton: float, iraqi_per_ton: float = 0.0,
            cfg: dict | None = None) -> dict:
    """يستقبل شحنة + الرسم السوري والعراقي للطن (+ إعدادات المعادلات)، ويعيد كل الأرقام المشتقّة.
    الرسم العراقي للطن الفعّال = تجاوز الشحنة اليدوي إن وُجد، وإلا رسم الصنف من قاعدة الأصناف."""
    cfg = cfg or default_calc_cfg()
    crate = sh.commission_rate if sh.commission_rate is not None else cfg["default_commission"]
    eff_iraqi_per_ton = sh.iraqi_per_ton if sh.iraqi_per_ton is not None else (iraqi_per_ton or 0.0)
    # تجاوز المخلص الكمركي للرسم السوري لهذه الشحنة، وإلا رسم الصنف من قاعدة الأصناف
    eff_syrian_per_ton = sh.syrian_per_ton if sh.syrian_per_ton is not None else (syrian_per_ton or 0.0)
    v = {
        "weight_kg": sh.weight_kg or 0.0,
        "syrian_per_ton": eff_syrian_per_ton,
        "iraqi_per_ton": eff_iraqi_per_ton,
        "goods_value": sh.goods_value or 0.0,
        "goods_price": sh.goods_price or 0.0,
        # مصروف الطرفين: المُدخل اليدوي له الأولوية، وإن تُرك فارغاً (None) يُحسب من ثابت الطن
        "two_party_per_ton": cfg.get("two_party_per_ton", 0.0),
        "two_party_expense_input": sh.two_party_expense or 0.0,
        "two_party_manual": not getattr(sh, "two_party_auto", True),
        "extra_fees": sh.extra_fees or 0.0,
        "tax_advance_rate": cfg["tax_advance_rate"],
        "commission_rate": crate,
        "consumption_rate": tier_rate(eff_syrian_per_ton, cfg["tiers"]),
        "is_company": sh.financing == COMPANY,
        "fees_payment": sh.fees_payment or "",
        "financing": sh.financing or "",
        "collection_status": sh.collection_status or "",
        "delivery_status": sh.delivery_status or "",
    }

    for key, _, _, _, default_expr in FORMULA_SPECS:
        try:
            val = safe_eval(cfg["formulas"][key], v)
        except Exception:
            val = safe_eval(default_expr, v)  # معادلة معدّلة تالفة → نرجع للافتراضي بدل الانهيار
        # التجاوزات اليدوية من نموذج حساب الجمارك لها الأولوية دائماً (كما في الإكسل N5/O5)
        if key == "tax_advance" and sh.manual_tax_advance is not None:
            val = sh.manual_tax_advance
        if key == "consumption_fee" and sh.manual_consumption_fee is not None:
            val = sh.manual_consumption_fee
            base = v["goods_value"] + v["syrian_actual"]
            v["consumption_rate"] = (val / base) if base else 0.0
        v[key] = float(val or 0)

    customs_status = "تمّت الجمركة" if sh.customs_computed else "قيد الجمركة"
    alert = ""
    if sh.collection_status == COLLECTED and sh.delivery_status != DELIVERED:
        alert = "⚠ حُصِّل دون تسليم"
    elif sh.delivery_status == DELIVERED and sh.collection_status != COLLECTED and v["cod_due"] > 0:
        alert = "⚠ سُلِّم دون تحصيل"

    out = {key: round(v[key], 2) for key, _, _, _, _ in FORMULA_SPECS}
    out.update({
        "syrian_per_ton": round(eff_syrian_per_ton, 2),
        "iraqi_per_ton": round(eff_iraqi_per_ton, 2),
        "extra_fees": round(v["extra_fees"], 2),   # مُدخل لا معادلة — يُعاد للمعاينة
        "consumption_rate": v["consumption_rate"],
        "customs_status": customs_status,
        "alert": alert,
    })
    return out
