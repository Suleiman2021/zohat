// Service Worker — الشبكة أولاً لملفات الواجهة (تصل التحديثات فوراً)، والكاش احتياطي دون إنترنت
const CACHE = "zohat-v25";
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
  // ملفات الواجهة: الشبكة أولاً (كي لا تعلق نسخة قديمة)، ثم الكاش عند انقطاع الإنترنت
  e.respondWith(
    fetch(e.request).then(res=>{
      const copy=res.clone();
      caches.open(CACHE).then(c=>c.put(e.request,copy)).catch(()=>{});
      return res;
    }).catch(()=>caches.match(e.request, {ignoreSearch:true}))
  );
});
