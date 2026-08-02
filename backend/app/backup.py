"""نظام النسخ الاحتياطي — يرسل نسخة من قاعدة البيانات + ملف Excel لسجلات الشحنات
إلى تلغرام (أبسط طريقة مجانية موثوقة، بلا OAuth). يُشغَّل يدوياً أو بجدولة يومية."""
import io
import os
import sqlite3
import tempfile
import datetime as dt

import requests
from sqlmodel import Session, select
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment
from openpyxl.utils import get_column_letter

from .core import config
from .core.database import engine, db_file_path
from .models import Shipment

TG_API = "https://api.telegram.org/bot{token}/{method}"

# أعمدة تصدير سجل الشحنات (المفتاح، العنوان العربي)
_SHIP_COLS = [
    ("ref_no", "رقم القيد"), ("ship_date", "التاريخ"), ("created_by_name", "المسجِّل"),
    ("sender_name", "المرسِل"), ("receiver_name", "المستلِم"), ("driver_name", "السائق"),
    ("from_city", "جهة الإرسال"), ("to_city", "جهة الاستلام"),
    ("item_name", "الصنف"), ("item_code", "الكود"), ("brand", "الماركة"),
    ("origin_country", "المنشأ"), ("count", "العدد"), ("weight_kg", "الوزن (كغ)"),
    ("goods_value", "قيمة الفاتورة"), ("goods_price", "ثمن البضاعة"),
    ("financing", "التمويل"), ("bought_by", "من قام بالشراء"),
    ("fees_payment", "دفع الأجور"), ("export_status", "حالة التصدير"),
    ("export_date", "تاريخ التصدير"), ("delivery_status", "حالة التسليم"),
    ("collection_status", "حالة التحصيل"),
]


def shipments_xlsx() -> bytes:
    """يبني ملف Excel بكل سجلات الشحنات (بيانات خام من القاعدة)."""
    wb = Workbook()
    ws = wb.active
    ws.title = "سجل الشحنات"
    ws.sheet_view.rightToLeft = True
    ws.append([label for _, label in _SHIP_COLS])
    fill = PatternFill("solid", fgColor="183C60")
    for c in ws[1]:
        c.font = Font(bold=True, color="FFFFFF")
        c.fill = fill
        c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
    with Session(engine) as db:
        for s in db.exec(select(Shipment).order_by(Shipment.ref_no)).all():
            ws.append([_fmt(getattr(s, k, "")) for k, _ in _SHIP_COLS])
    for i, (_, label) in enumerate(_SHIP_COLS, 1):
        ws.column_dimensions[get_column_letter(i)].width = max(len(label) + 3, 12)
    ws.freeze_panes = "A2"
    ws.auto_filter.ref = ws.dimensions
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def _fmt(v):
    if v is None:
        return ""
    if isinstance(v, (dt.date, dt.datetime)):
        return v.isoformat()[:10]
    return v


def db_snapshot() -> bytes | None:
    """لقطة متسقة من قاعدة SQLite عبر VACUUM INTO — آمنة حتى أثناء كتابة جارية،
    بخلاف قراءة الملف مباشرة التي قد تلتقط نسخة ناقصة. تعيد None إن لم تكن القاعدة SQLite."""
    path = db_file_path()
    if not path or not os.path.exists(path):
        return None
    fd, tmp = tempfile.mkstemp(suffix=".sqlite")
    os.close(fd)
    os.remove(tmp)                       # VACUUM INTO يرفض الكتابة فوق ملف موجود
    try:
        con = sqlite3.connect(path)
        try:
            con.execute("VACUUM INTO ?", (tmp,))
        finally:
            con.close()
        with open(tmp, "rb") as f:
            return f.read()
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)


def _send_document(content: bytes, filename: str, caption: str = ""):
    url = TG_API.format(token=config.TELEGRAM_BOT_TOKEN, method="sendDocument")
    r = requests.post(url, timeout=60,
                      data={"chat_id": config.TELEGRAM_CHAT_ID, "caption": caption},
                      files={"document": (filename, content)})
    r.raise_for_status()
    return r.json()


def run_backup() -> dict:
    """ينفّذ نسخة احتياطية كاملة → تلغرام. يرمي استثناءً عند الفشل."""
    if not (config.TELEGRAM_BOT_TOKEN and config.TELEGRAM_CHAT_ID):
        raise RuntimeError("لم تُضبط إعدادات تلغرام (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID)")
    stamp = dt.datetime.now().strftime("%Y-%m-%d_%H%M")
    sent = []

    # 1) ملف Excel لسجلات الشحنات
    xlsx = shipments_xlsx()
    _send_document(xlsx, f"zohat_shipments_{stamp}.xlsx",
                   caption=f"📊 سجل الشحنات — {stamp}")
    sent.append("xlsx")

    # 2) نسخة من قاعدة البيانات — لقطة متسقة عبر VACUUM INTO
    #    (SQLite فقط؛ Postgres يُنسخ من Railway مباشرة)
    data = db_snapshot()
    if data:
        _send_document(data, f"zohat_db_{stamp}.sqlite",
                       caption=f"💾 نسخة قاعدة البيانات — {stamp}")
        sent.append("db")

    return {"ok": True, "sent": sent, "time": stamp}
