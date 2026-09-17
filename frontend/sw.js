// Service Worker â€” ط§ظ„ط´ط¨ظƒط© ط£ظˆظ„ط§ظ‹ ظ„ظ…ظ„ظپط§طھ ط§ظ„ظˆط§ط¬ظ‡ط© (طھطµظ„ ط§ظ„طھط­ط¯ظٹط«ط§طھ ظپظˆط±ط§ظ‹)طŒ ظˆط§ظ„ظƒط§ط´ ط§ط­طھظٹط§ط·ظٹ ط¯ظˆظ† ط¥ظ†طھط±ظ†طھ
const CACHE = "zohat-v64";
const SHELL = ["./","index.html","css/style.css","js/api.js","js/app.js","manifest.json",
               "icons/logo.svg","icons/logo-white.svg"];

self.addEventListener("install", e =>
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(()=>self.skipWaiting())));

self.addEventListener("activate", e =>
  e.waitUntil(caches.keys().then(ks =>
    Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));

self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  // ط·ظ„ط¨ط§طھ ط§ظ„ظ€API: ط§ظ„ط´ط¨ظƒط© ظپظ‚ط· (ط¨ظٹط§ظ†ط§طھ ط­ظٹظ‘ط©)طŒ ط¯ظˆظ† طھط®ط²ظٹظ†
  if (url.pathname.startsWith("/api/")) {
    e.respondWith(fetch(e.request).catch(()=>new Response(
      JSON.stringify({detail:"ظ„ط§ ظٹظˆط¬ط¯ ط§طھطµط§ظ„ ط¨ط§ظ„ط¥ظ†طھط±ظ†طھ"}),{status:503,headers:{"Content-Type":"application/json"}})));
    return;
  }
  // طµظپط­ط© ط§ظ„طھط·ط¨ظٹظ‚ ظˆط¹ط§ظ…ظ„ ط§ظ„ط®ط¯ظ…ط©: طھط¬ط§ظˆط² ظƒط§ط´ ط§ظ„ظ…طھطµظپط­ طھظ…ط§ظ…ط§ظ‹ ظƒظٹ ظ„ط§ طھط¹ظ„ظ‚ ظ†ط³ط®ط© HTML ظ‚ط¯ظٹظ…ط©
  // (fetch ط§ظ„ط¹ط§ط¯ظٹ ظٹط­طھط±ظ… ظƒط§ط´ ط§ظ„ظ…طھطµظپط­ ظپظ‚ط¯ ظٹط¹ظٹط¯ ظ†ط³ط®ط© ظ‚ط¯ظٹظ…ط© ط¯ظˆظ† ظ„ظ…ط³ ط§ظ„ط´ط¨ظƒط©)
  const isShell = e.request.mode === "navigate" ||
                  ["/", "/index.html", "/sw.js", "/manifest.json"].includes(url.pathname);
  const req = isShell ? new Request(e.request, {cache: "reload"}) : e.request;
  // ط§ظ„ط´ط¨ظƒط© ط£ظˆظ„ط§ظ‹طŒ ط«ظ… ط§ظ„ظƒط§ط´ ط¹ظ†ط¯ ط§ظ†ظ‚ط·ط§ط¹ ط§ظ„ط¥ظ†طھط±ظ†طھ
  e.respondWith(
    fetch(req).then(res=>{
      const copy=res.clone();
      caches.open(CACHE).then(c=>c.put(e.request,copy)).catch(()=>{});
      return res;
    }).catch(()=>caches.match(e.request, {ignoreSearch:true}))
  );
});
