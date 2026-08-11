// Service Worker — الشبكة أولاً لملفات الواجهة (تصل التحديثات فوراً)، والكاش احتياطي دون إنترنت
const CACHE = "zohat-v57";
const SHELL = ["./","index.html","css/style.css","js/api.js","js/app.js","manifest.json",
               "icons/logo.svg","icons/logo-white.svg"];

self.addEventListener("install", e =>
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(()=>self.skipWaiting())));

self.addEventListener("activate", e =>
  e.waitUntil(caches.keys().then(ks =>
    Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));

self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  // طلبات الـAPI: الشبكة فقط (بيانات حيّة)، دون تخزين
  if (url.pathname.startsWith("/api/")) {
    e.respondWith(fetch(e.request).catch(()=>new Response(
      JSON.stringify({detail:"لا يوجد اتصال بالإنترنت"}),{status:503,headers:{"Content-Type":"application/json"}})));
    return;
  }
  // صفحة التطبيق وعامل الخدمة: تجاوز كاش المتصفح تماماً كي لا تعلق نسخة HTML قديمة
  // (fetch العادي يحترم كاش المتصفح فقد يعيد نسخة قديمة دون لمس الشبكة)
  const isShell = e.request.mode === "navigate" ||
                  ["/", "/index.html", "/sw.js", "/manifest.json"].includes(url.pathname);
  const req = isShell ? new Request(e.request, {cache: "reload"}) : e.request;
  // الشبكة أولاً، ثم الكاش عند انقطاع الإنترنت
  e.respondWith(
    fetch(req).then(res=>{
      const copy=res.clone();
      caches.open(CACHE).then(c=>c.put(e.request,copy)).catch(()=>{});
      return res;
    }).catch(()=>caches.match(e.request, {ignoreSearch:true}))
  );
});
