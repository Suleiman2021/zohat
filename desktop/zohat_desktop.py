"""زوهات — تطبيق سطح المكتب لويندوز.
نافذة أصلية تفتح النظام المستضاف (Railway) بلا شريط متصفح ولا رابط ظاهر.
البيانات تبقى مركزية على الخادم، فيرى كل الموظفين نفس الشحنات لحظياً."""
import json
import os
import sys
import urllib.request
from pathlib import Path

import webview

APP_TITLE = "زوهات — نظام الشحن والتخليص"

# ضع رابط Railway هنا قبل البناء ليصل البرنامج جاهزاً للموظفين (اختياري).
# إن تُرك فارغاً سيطلبه البرنامج من المستخدم عند أول تشغيل ويحفظه.
DEFAULT_URL = ""


def _app_dir() -> Path:
    """مجلد البرنامج (يعمل سواء كان .exe مبنيّاً أو سكربت بايثون)."""
    if getattr(sys, "frozen", False):
        return Path(sys.executable).parent
    return Path(__file__).parent


def _config_file() -> Path:
    base = Path(os.getenv("APPDATA") or Path.home()) / "Zohat"
    base.mkdir(parents=True, exist_ok=True)
    return base / "config.json"


def load_url() -> str:
    """يقرأ رابط الخادم بالترتيب: متغيّر بيئة ← ملف بجانب البرنامج ← الإعداد المحفوظ ← الافتراضي."""
    if os.getenv("ZOHAT_URL"):
        return os.getenv("ZOHAT_URL").strip()
    side = _app_dir() / "zohat_url.txt"      # يسمح بتغيير الرابط دون إعادة بناء
    if side.exists():
        url = side.read_text(encoding="utf-8").strip()
        if url:
            return url
    cfg = _config_file()
    if cfg.exists():
        try:
            return (json.loads(cfg.read_text(encoding="utf-8")).get("url") or "").strip()
        except (json.JSONDecodeError, OSError):
            pass
    return DEFAULT_URL


def save_url(url: str):
    _config_file().write_text(json.dumps({"url": url}, ensure_ascii=False), encoding="utf-8")


def normalize(url: str) -> str:
    url = (url or "").strip().rstrip("/")
    if url and not url.startswith(("http://", "https://")):
        url = "https://" + url
    return url


def server_alive(url: str, timeout: int = 8) -> bool:
    """يتحقق من أن الخادم يستجيب قبل فتح النافذة عليه."""
    try:
        with urllib.request.urlopen(url + "/healthz", timeout=timeout) as r:
            return r.status == 200
    except Exception:
        return False


# ---------- صفحات داخلية (إعداد الرابط / تعذّر الاتصال) ----------
_PAGE_CSS = """
*{box-sizing:border-box;font-family:'Segoe UI',Tahoma,Arial,sans-serif}
body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;
 background:linear-gradient(135deg,#183C60,#006C84);color:#1c2b3a}
.box{background:#fff;border-radius:18px;padding:32px;width:min(100%,430px);
 box-shadow:0 18px 50px rgba(0,0,0,.3);text-align:center}
h1{color:#183C60;font-size:22px;margin:0 0 6px}
p{color:#5b7186;font-size:14px;margin:0 0 18px;line-height:1.6}
input{width:100%;padding:12px;border:1px solid #D8E0EA;border-radius:10px;font-size:15px;
 direction:ltr;text-align:left;margin-bottom:12px}
button{width:100%;background:#009CB4;color:#fff;border:0;padding:12px;border-radius:10px;
 font-size:15px;font-weight:700;cursor:pointer}
button:hover{background:#006C84}
.err{color:#C0392B;font-size:13px;min-height:18px;margin-top:10px}
"""

SETUP_HTML = f"""<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8">
<style>{_PAGE_CSS}</style></head><body><div class="box">
<h1>مرحباً بك في زوهات</h1>
<p>أدخل رابط النظام الخاص بشركتك (يُطلب مرة واحدة فقط ثم يُحفظ).</p>
<input id="u" placeholder="https://xxxx.up.railway.app" autofocus>
<button onclick="go()">اتصال</button>
<div class="err" id="e"></div></div>
<script>
async function go(){{
  const v=document.getElementById('u').value;
  document.getElementById('e').textContent='جارٍ التحقق من الاتصال...';
  const ok=await window.pywebview.api.connect(v);
  if(!ok) document.getElementById('e').textContent='تعذّر الوصول إلى هذا الرابط — تحقّق منه ومن الإنترنت.';
}}
document.getElementById('u').addEventListener('keydown',e=>{{if(e.key==='Enter')go();}});
</script></body></html>"""

OFFLINE_HTML = f"""<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8">
<style>{_PAGE_CSS}</style></head><body><div class="box">
<h1>تعذّر الاتصال بالخادم</h1>
<p>تأكّد من اتصالك بالإنترنت ثم أعد المحاولة.<br>إن تغيّر رابط النظام يمكنك تعديله.</p>
<button onclick="window.pywebview.api.retry()">إعادة المحاولة</button>
<div style="height:10px"></div>
<button style="background:#5b7186" onclick="window.pywebview.api.reset()">تغيير الرابط</button>
</div></body></html>"""


class Api:
    """جسر بين صفحات الإعداد الداخلية وبايثون."""

    def connect(self, url):
        url = normalize(url)
        if not url or not server_alive(url):
            return False
        save_url(url)
        webview.windows[0].load_url(url)
        return True

    def retry(self):
        url = normalize(load_url())
        if url and server_alive(url):
            webview.windows[0].load_url(url)
        return True

    def reset(self):
        save_url("")
        webview.windows[0].load_html(SETUP_HTML)
        return True


def main():
    url = normalize(load_url())
    api = Api()
    if url and server_alive(url):
        window = webview.create_window(APP_TITLE, url, width=1280, height=820,
                                       min_size=(820, 600), js_api=api)
    else:
        # لا رابط محفوظ (أول تشغيل) أو الخادم غير متاح
        html = SETUP_HTML if not url else OFFLINE_HTML
        window = webview.create_window(APP_TITLE, html=html, width=560, height=520,
                                       min_size=(460, 460), js_api=api)
    webview.start()


if __name__ == "__main__":
    main()
