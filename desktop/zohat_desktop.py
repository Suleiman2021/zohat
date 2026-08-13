"""زوهات — تطبيق سطح المكتب لويندوز.
نافذة أصلية تفتح النظام المستضاف (Railway) مباشرةً بلا شريط متصفح ولا أي سؤال.
البيانات تبقى مركزية على الخادم، فيرى كل الموظفين نفس الشحنات لحظياً."""
import base64
import json
import os
import sys
import urllib.request
from pathlib import Path

import webview

APP_TITLE = "زوهات — نظام الشحن والتخليص"

# رابط النظام — يفتحه البرنامج مباشرةً عند التشغيل.
# يُترك فارغاً في المستودع عمداً كي لا يُنشر عنوان نظام إنتاجي.
# اضبطه قبل البناء بأحد الطرق (بالأولوية): متغيّر البيئة ZOHAT_URL،
# أو ملف zohat_url.txt بجانب البرنامج، أو عدّل القيمة هنا في نسختك الخاصة.
DEFAULT_URL = os.getenv("ZOHAT_BUILD_URL", "")


def _app_dir() -> Path:
    """مجلد البرنامج (يعمل سواء كان .exe مبنيّاً أو سكربت بايثون)."""
    if getattr(sys, "frozen", False):
        return Path(sys.executable).parent
    return Path(__file__).parent


def normalize(url: str) -> str:
    url = (url or "").strip().rstrip("/")
    if url and not url.startswith(("http://", "https://")):
        url = "https://" + url
    return url


def load_url() -> str:
    """رابط الخادم: متغيّر بيئة ← ملف بجانب البرنامج ← الافتراضي المدمج.
    أي مصدر فارغ يُتجاوَز، فلا يظهر أي سؤال للمستخدم أبداً."""
    for candidate in (
        os.getenv("ZOHAT_URL"),
        _read_side_file(),
        _read_saved(),
        DEFAULT_URL,
    ):
        url = normalize(candidate)
        if url:
            return url
    return ""


def _read_side_file() -> str:
    """zohat_url.txt بجانب الـ exe — لتغيير الرابط دون إعادة بناء."""
    try:
        f = _app_dir() / "zohat_url.txt"
        return f.read_text(encoding="utf-8") if f.exists() else ""
    except OSError:
        return ""


def _read_saved() -> str:
    """إعداد محفوظ سابقاً (من نسخة قديمة من البرنامج) — يُتجاهل إن كان فارغاً."""
    try:
        f = Path(os.getenv("APPDATA") or Path.home()) / "Zohat" / "config.json"
        if f.exists():
            return json.loads(f.read_text(encoding="utf-8")).get("url") or ""
    except (OSError, json.JSONDecodeError):
        pass
    return ""


def server_alive(url: str, timeout: int = 6) -> bool:
    try:
        with urllib.request.urlopen(url + "/healthz", timeout=timeout) as r:
            return r.status == 200
    except Exception:
        return False


# ---------- صفحة تظهر فقط عند انقطاع الاتصال ----------
OFFLINE_HTML = """<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8">
<style>
*{box-sizing:border-box;font-family:'Segoe UI',Tahoma,Arial,sans-serif}
body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;
 background:linear-gradient(135deg,#183C60,#006C84)}
.box{background:#fff;border-radius:18px;padding:36px;width:min(100%,430px);
 box-shadow:0 18px 50px rgba(0,0,0,.3);text-align:center}
h1{color:#183C60;font-size:22px;margin:0 0 8px}
p{color:#5b7186;font-size:14px;margin:0 0 20px;line-height:1.7}
button{width:100%;background:#009CB4;color:#fff;border:0;padding:13px;border-radius:10px;
 font-size:15px;font-weight:700;cursor:pointer}
button:hover{background:#006C84}
.ico{font-size:44px;margin-bottom:6px}
</style></head><body><div class="box">
<div class="ico">📡</div>
<h1>تعذّر الاتصال بالخادم</h1>
<p>تأكّد من اتصالك بالإنترنت ثم اضغط إعادة المحاولة.</p>
<button onclick="this.textContent='جارٍ المحاولة...';window.pywebview.api.retry()">إعادة المحاولة</button>
</div></body></html>"""


NOT_CONFIGURED_HTML = """<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8">
<style>
*{box-sizing:border-box;font-family:'Segoe UI',Tahoma,Arial,sans-serif}
body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;
 background:linear-gradient(135deg,#183C60,#006C84)}
.box{background:#fff;border-radius:18px;padding:34px;width:min(100%,560px);
 box-shadow:0 18px 50px rgba(0,0,0,.3)}
h1{color:#183C60;font-size:21px;margin:0 0 10px;text-align:center}
p{color:#5b7186;font-size:14px;line-height:1.8;margin:0 0 14px}
code{background:#f1f5f9;padding:2px 7px;border-radius:5px;color:#183C60;
 font-family:Consolas,monospace;direction:ltr;display:inline-block}
ol{color:#5b7186;font-size:14px;line-height:2;padding-inline-start:22px;margin:0}
.ico{font-size:42px;text-align:center;margin-bottom:4px}
</style></head><body><div class="box">
<div class="ico">⚙️</div>
<h1>لم يُضبط رابط الخادم بعد</h1>
<p>هذه نسخة من المستودع بلا عنوان خادم مدمج (عمداً — كي لا يُنشر عنوان نظام إنتاجي).
 اضبط الرابط بإحدى الطرق التالية ثم أعد التشغيل:</p>
<ol>
<li>متغيّر البيئة <code>ZOHAT_URL</code></li>
<li>ملف <code>zohat_url.txt</code> بجانب البرنامج يحوي العنوان</li>
<li>أو <code>ZOHAT_BUILD_URL</code> قبل البناء لتضمينه في الـexe</li>
</ol>
</div></body></html>"""


class Api:
    def save_file(self, filename, b64):
        """يحفظ ملفاً أرسلته الواجهة (تصدير Excel) عبر نافذة «حفظ باسم» الأصلية.
        ضروري لأن WebView2 لا ينزّل روابط blob المؤقتة كما يفعل المتصفح."""
        try:
            data = base64.b64decode(b64)
        except Exception:
            return False
        window = webview.windows[0]
        downloads = Path.home() / "Downloads"
        target = window.create_file_dialog(
            webview.SAVE_DIALOG,
            directory=str(downloads if downloads.exists() else Path.home()),
            save_filename=filename,
        )
        if not target:
            return False                      # ألغى المستخدم الحفظ
        if isinstance(target, (list, tuple)):
            target = target[0]
        try:
            Path(target).write_bytes(data)
        except OSError:
            return False
        return str(target)

    def retry(self):
        """يعيد تحميل النظام إن عاد الاتصال، وإلا يبقى على صفحة الانقطاع."""
        url = load_url()
        if url and server_alive(url):
            webview.windows[0].load_url(url)
        else:
            webview.windows[0].load_html(OFFLINE_HTML)
        return True


def main():
    url = load_url()
    if not url:
        # لا رابط مضبوط (نسخة من المستودع) — رسالة واضحة بدل صفحة فارغة محيّرة
        webview.create_window(APP_TITLE, html=NOT_CONFIGURED_HTML,
                              width=760, height=560, js_api=Api())
        webview.start()
        return
    # النافذة تفتح على الرابط مباشرةً — بلا فحص مسبق يؤخّر الإقلاع ولا أي سؤال
    webview.create_window(APP_TITLE, url, width=1280, height=820,
                          min_size=(820, 600), js_api=Api())

    def _after_start():
        # إن كان الخادم غير متاح نستبدل صفحة الخطأ الافتراضية بصفحة عربية واضحة
        if not server_alive(url):
            webview.windows[0].load_html(OFFLINE_HTML)

    webview.start(_after_start)


if __name__ == "__main__":
    main()
