// ===== واجهة قائمة على الأدوار =====
const $ = s => document.querySelector(s);
const money = n => (Number(n)||0).toLocaleString("en",{minimumFractionDigits:2})+" $";
const el = (t,c,h)=>{const e=document.createElement(t);if(c)e.className=c;if(h!=null)e.innerHTML=h;return e;};

// قوائم الأدوار: أي صفحة يراها كل دور
const MENUS = {
  admin:      ["dashboard","shipments","customs","broker","invoice","reports","accounting","mahmoud","items","lists","printfx","users"],
  supervisor: ["dashboard","shipments","customs","invoice","reports","accounting","mahmoud"],
  accountant: ["dashboard","shipments","reports","accounting","mahmoud","invoice"],
  collector:  ["shipments","invoice"],
  broker:     ["broker"],
  branch:     ["shipments","deliver","invoice"],
};
const TITLES = {dashboard:"لوحة المؤشرات",shipments:"سجل الشحنات",customs:"حساب الجمارك",
  broker:"التخليص الجمركي",invoice:"فاتورة الزبون",reports:"لوحة التقارير",accounting:"الحسابات",mahmoud:"حسابات محمود",
  items:"الأصناف",lists:"القوائم والإعدادات",printfx:"الطباعة والمعادلات",users:"المستخدمون",deliver:"التسليم والتحصيل"};
const ROLE_LABEL = {admin:"الإدارة الشاملة", supervisor:"المشرف الإداري (صاحب الشركة)",
  accountant:"المحاسب", collector:"مسؤول التجميع", broker:"المخلص الكمركي", branch:"مكتب فرع"};

// القوائم القابلة للإدارة — تُحمَّل من الباكند (GET /api/settings/lists) عند الدخول
// وتُدار من صفحة «القوائم والإعدادات». القيم هنا افتراضية فقط قبل اكتمال أول تحميل.
let CITIES=[], PTYPES=[], FINANCE=[], PAY=[], DELIVERY=[], COLLECTION=[], EXPORT_ST=[], EXPENSE_CATS=[];
let COMPANY={phone:"",name:"",logo:""};   // بيانات الشركة (اسم/هاتف/لوغو) — تظهر في الترويسات
// أعمدة الطباعة المختارة من لوحة الإدارة ([] = كل الأعمدة) — تُطبَّق على كل المستخدمين
let PRINT_COLS={invoice:[], reports:[], customs:[]};
const CUSTOMS_ST=["قيد الجمركة","تمّت الجمركة"];   // حالة محسوبة تلقائياً، ليست قائمة قابلة للتعديل
const EXPORTED="تم التصدير";
const DEFERRED="آجل";                    // ذمة على المرسِل بدل التحصيل في مكتب الوجهة
const FIN_COMPANY="الشركة اشترت نيابةً عنه";
const FIN_CUSTOMER="الزبون اشترى بنفسه";

// يحمّل القوائم والإعدادات. مُحصَّن ضد فشل الشبكة: إن تعذّر أي نداء (خادم نائم مثلاً)
// نُبقي القيم السابقة بدل إفراغ الواجهة، ونعيد المحاولة مرة واحدة تلقائياً.
async function loadLists(retry=true){
  const [L, C, P] = await Promise.all([
    API.get("/api/settings/lists").catch(()=>null),
    API.get("/api/settings/company").catch(()=>null),
    API.get("/api/settings/print").catch(()=>null),
  ]);
  if(!L || !L.cities){                       // فشل تحميل القوائم الأساسية
    if(retry){                                // محاولة ثانية بعد ثانيتين (إيقاظ الخادم)
      await new Promise(r=>setTimeout(r,2000));
      return loadLists(false);
    }
    if(!CITIES.length) toast("تعذّر تحميل القوائم — تحقّق من الاتصال ثم حدّث الصفحة", true);
    return false;                             // نُبقي القيم الحالية كما هي
  }
  if(C) COMPANY=C;
  if(P) PRINT_COLS=P;
  CITIES=L.cities||[]; PTYPES=L.parcel_types||[]; FINANCE=L.financing_types||[];
  PAY=L.payment_methods||[]; DELIVERY=L.delivery_statuses||[]; COLLECTION=L.collection_statuses||[];
  EXPORT_ST=L.export_statuses||["قيد التصدير","تم التصدير"]; EXPENSE_CATS=L.expense_categories||[];
  return true;
}

// ---- سجلّا أعمدة الفاتورة والتقارير: [المفتاح، العنوان، دالة القيمة] ----
const badge=(txt,ok)=>`<span class="badge ${ok?'done':'pend'}">${txt}</span>`;
// ثمن البضاعة مجموعاً مع عمولة الشراء — ما يدفعه الزبون مقابل بضاعته.
// يجب تعريفها قبل INVOICE_COLS لأن المصفوفة تشير إليها مباشرةً عند إنشائها.
const goodsWithCommission = r => (Number(r.goods_price)||0) + (Number(r.commission)||0);
const INVOICE_COLS=[
  ["ship_date","التاريخ",r=>r.ship_date],
  ["ref_no","رقم القيد",r=>r.ref_no],
  ["receiver_name","المستلِم (صاحب الشحنة)",r=>r.receiver_name],
  ["item_name","الصنف",r=>r.item_name],
  ["brand","الماركة",r=>r.brand||"-"],
  ["origin_country","المنشأ",r=>r.origin_country||"-"],
  ["count","العدد",r=>r.count],
  ["weight_kg","الوزن",r=>r.weight_kg+" كغ"],
  ["goods_value","قيمة الفاتورة",r=>money(r.goods_value)],
  // ثمن البضاعة شاملاً عمولة الشراء (عند الشراء نيابةً عن الزبون)
  ["goods_price","ثمن البضاعة + العمولة",r=>money(goodsWithCommission(r)), goodsWithCommission],
  ["duties_only","الرسوم",r=>money(r.duties_only)],
  ["tax_advance","السلفة الضريبية",r=>money(r.tax_advance)],
  ["consumption_fee","رسم الإنفاق",r=>money(r.consumption_fee)],
  ["extra_fees","الأجور الإضافية",r=>money(r.extra_fees)],
  ["grand_total","المجموع",r=>money(r.grand_total)],
];
const REPORT_COLS=[
  ["ref_no","القيد",r=>r.ref_no],
  ["ship_date","التاريخ",r=>r.ship_date],
  ["created_by_name","المسجِّل",r=>r.created_by_name||r.created_by||"-"],
  ["sender_name","المرسِل",r=>r.sender_name],
  ["sender_phone","رقم المرسِل",r=>r.sender_phone||"-"],
  ["receiver_name","المستلِم",r=>r.receiver_name],
  ["receiver_phone","رقم المستلِم",r=>r.receiver_phone||"-"],
  ["from_city","جهة الإرسال",r=>r.from_city],
  ["to_city","جهة الاستلام",r=>r.to_city],
  ["driver_name","السائق",r=>r.driver_name||"-"],
  ["item_name","الصنف",r=>r.item_name||"-"],
  ["brand","الماركة",r=>r.brand||"-"],
  ["origin_country","المنشأ",r=>r.origin_country||"-"],
  ["count","العدد",r=>r.count],
  ["weight_kg","الوزن",r=>r.weight_kg+" كغ"],
  ["goods_value","قيمة الفاتورة",r=>money(r.goods_value)],
  ["goods_price","ثمن البضاعة",r=>money(r.goods_price)],
  ["financing","تمويل البضاعة",r=>r.financing],
  ["fees_total","أجور الشحن والجمركة",r=>money(r.fees_total)],
  ["fees_payment","دفع الأجور",r=>r.fees_payment],
  ["cash_in","المحصّل نقداً",r=>money(r.cash_in)],
  ["cod_due","المستحق ضد الدفع",r=>money(r.cod_due)],
  ["sender_debt","ذمة على المرسِل (آجل)",r=>money(r.sender_debt)],
  ["customs_status","حالة الجمركة",r=>badge(r.customs_status,r.customs_computed)],
  ["export_status","حالة التصدير",r=>badge(r.export_status,r.export_status==='تم التصدير')],
  ["delivery_status","حالة التسليم",r=>badge(r.delivery_status,r.delivery_status==='تم التسليم')],
  ["collection_status","حالة التحصيل",r=>r.collection_status],
];

// جدول مبني من سجل أعمدة: الشاشة تعرض الكل، والطباعة تُخفي غير المختار (صنف np)
function colsTable(cols, rows, selectedKeys){
  const sel=(selectedKeys&&selectedKeys.length)?new Set(selectedKeys):null;
  const np=k=>(sel&&!sel.has(k))?' class="np"':'';
  return wrapTable(`<table class="compact-print"><thead><tr>${
    cols.map(([k,l])=>`<th${np(k)}>${l}</th>`).join("")}</tr></thead><tbody>${
    rows.map(r=>`<tr>${cols.map(([k,,f])=>`<td${np(k)}>${f(r)}</td>`).join("")}</tr>`).join("")}</tbody></table>`);
}

// نص خالص من ناتج دالة العمود (يزيل وسوم HTML مثل شارات الحالة)
const plainText = html => {
  const d=document.createElement("div"); d.innerHTML=String(html??"");
  return (d.textContent||"").trim();
};
// تصدير Excel (.xlsx) بنفس أعمدة الطباعة التي حدّدها المدير — الأرقام تُصدَّر كأرقام حقيقية.
// view: مفتاح الأعمدة (invoice/reports/customs) — تُقرأ طازجة من الخادم كي يسري
// أي تعديل يجريه المدير فوراً على بقية المستخدمين دون إعادة تسجيل دخول.
async function exportXlsx(cols, rows, view, title){
  if(!rows || !rows.length){ toast("لا توجد بيانات للتصدير", true); return; }
  try{
    const fresh=await API.get("/api/settings/print");
    if(fresh) PRINT_COLS=fresh;
  }catch(e){/* تعذّر التحديث → نستخدم المحفوظ حالياً */}
  const selectedKeys=PRINT_COLS[view]||[];
  const sel=(selectedKeys&&selectedKeys.length)?new Set(selectedKeys):null;
  const use=cols.filter(([k])=>!sel||sel.has(k));
  const headers=use.map(([,label])=>label);
  // العنصر الرابع (اختياري) دالة تُعطي القيمة الرقمية للأعمدة المحسوبة،
  // وإلا نأخذ الحقل الخام إن كان رقماً، وإلا نصّاً خالصاً من دالة العرض.
  const body=rows.map(r=>use.map(([k,,fn,num])=>{
    if(typeof num==="function") return num(r);
    const raw=r[k];
    return typeof raw==="number" ? raw : plainText(fn(r));
  }));
  try{
    await API.download("/api/export/xlsx",{title,headers,rows:body},`${title}.xlsx`);
    toast("تم تصدير ملف Excel");
  }catch(err){ toast(err.message, true); }
}

// طباعة باتجاه صفحة محدد: التقارير عرضية (أعمدة كثيرة) والفاتورة طولية
function printDoc(orientation){
  const st=document.createElement("style");
  // margin:0 يمنع المتصفح من طباعة ترويسة/تذييل تحوي رابط الموقع والتاريخ،
  // والهوامش تُعوَّض بحشوة داخلية على المحتوى (.view) في تنسيق الطباعة.
  st.textContent=`@page{size:A4 ${orientation||"portrait"};margin:0}`;
  document.head.appendChild(st);
  window.print();
  setTimeout(()=>st.remove(),1000);
}

// ترويسة اللوغو + رقم الشركة (للفواتير والتقارير المطبوعة)
function brandHead(){
  const logo = COMPANY.logo || "icons/logo.svg";
  return `<div class="brand-head">
    <img src="${logo}" alt="لوغو الشركة">
    <div class="bh-info">
      ${COMPANY.name?`<div class="bh-name">${COMPANY.name}</div>`:""}
      ${COMPANY.phone?`<div class="bh-phone">هاتف: ${COMPANY.phone}</div>`
        :`<div class="hint">— أدخل رقم الشركة من صفحة القوائم والإعدادات —</div>`}
    </div></div>`;
}

const opts = (arr, cur) => arr.map(o=>`<option ${o===cur?'selected':''}>${o}</option>`).join("");
const optsWithAll = (arr, cur) => `<option value="">الكل</option>`+opts(arr, cur);
// يلفّ أي جدول بحاوية قابلة للتمرير أفقياً وعمودياً مع رأس ثابت — يمنع اختفاء الجداول الطويلة
const wrapTable = html => `<div class="table-scroll">${html}</div>`;
const empty = txt => `<div class="empty"><span>📭</span><p>${txt}</p></div>`;

// فلترة فورية: تشغّل fn عند أي تغيير في حقول الفلاتر دون الحاجة لزر «بحث».
// الكتابة النصية بمهلة قصيرة (debounce) كي لا نغرق الخادم بطلب لكل حرف،
// والقوائم والتواريخ ومربعات الاختيار فوراً عند التغيير.
function liveFilters(ids, fn, delay=350){
  let timer=null;
  const debounced=()=>{ clearTimeout(timer); timer=setTimeout(fn, delay); };
  ids.forEach(id=>{
    const el=$("#"+id); if(!el) return;
    const isTyping = el.tagName==="INPUT" && !["checkbox","date"].includes(el.type);
    el.addEventListener(isTyping?"input":"change", isTyping?debounced:fn);
  });
}

// إشعار مؤقت أسفل الشاشة (بديل عن الصمت بعد الحفظ/الحذف)
function toast(msg, isErr){
  const box=$("#toasts"); if(!box) return;
  const t=el("div","toast"+(isErr?" err":""), msg);
  box.appendChild(t);
  requestAnimationFrame(()=>t.classList.add("show"));
  setTimeout(()=>{ t.classList.remove("show"); setTimeout(()=>t.remove(),300); }, 2600);
}

function boot(){
  if(API.token){ showApp(); } else { $("#login").classList.remove("hidden"); }
}
$("#loginForm").addEventListener("submit",async e=>{
  e.preventDefault(); const f=e.target;
  try{ await API.login(f.username.value,f.password.value); location.reload(); }
  catch(err){ $("#loginErr").textContent=err.message; }
});
$("#logout").addEventListener("click",()=>{API.clear();location.reload();});


async function showApp(){
  $("#login").classList.add("hidden"); $("#app").classList.remove("hidden");
  $("#userName").textContent=API.name||"مستخدم";
  $("#userRole").textContent = API.role==="branch"
    ? "مكتب فرع — "+API.branch : (ROLE_LABEL[API.role]||API.role);
  const tgl=$("#navToggle");
  if(tgl) tgl.onclick=()=>$(".sidebar").classList.toggle("open");
  // القائمة تُبنى دائماً حتى لو فشل تحميل القوائم — كي لا تختفي الواجهة أبداً
  try{ await loadLists(); }catch(e){ console.warn("loadLists", e); }
  const nav=$("#nav"); nav.innerHTML="";
  (MENUS[API.role]||[]).forEach(k=>{
    const a=el("a",null,TITLES[k]); a.onclick=()=>route(k,a); nav.appendChild(a);
  });
  route((MENUS[API.role]||["shipments"])[0], nav.firstChild);
}
function route(key,link){
  document.querySelectorAll("#nav a").forEach(a=>a.classList.remove("active"));
  if(link)link.classList.add("active");
  $(".sidebar").classList.remove("open");   // إغلاق قائمة الموبايل بعد الاختيار
  $("#view").innerHTML=`<div class="loading"><div class="spinner"></div></div>`;
  ({dashboard:vDashboard,shipments:vShipments,customs:vCustoms,broker:vBroker,invoice:vInvoice,
    reports:vReports,accounting:vAccounting,mahmoud:vMahmoud,items:vItems,lists:vLists,printfx:vPrintFx,users:vUsers,deliver:vDeliver}[key])();
}

// ---------- لوحة المؤشرات ----------
async function vDashboard(){
  const v=$("#view"); v.innerHTML="<h1>لوحة المؤشرات</h1><div id='k' class='kpis'></div>";
  const s=await API.get("/api/accounting/summary");
  const K=[["الإيرادات",money(s.revenue),""],["صافي الربح التشغيلي",money(s.operating_net),"gold"],
    ["النقد المحصَّل",money(s.cash_collected),"cash"],["الذمم المدينة",money(s.receivables),"cod"],
    ["مشتريات نيابةً عن الزبائن",money(s.invested),"gold"],["لم يُسترد بعد",money(s.not_recovered),"cod"],
    ["صافي التدفق النقدي",money(s.cash_net),""],["عدد الشحنات",s.count,""]];
  $("#k").innerHTML=K.map(([l,val,c])=>`<div class="kpi ${c}"><div class="label">${l}</div><div class="val">${val}</div></div>`).join("");
  if(s.alerts && s.alerts.length){
    v.appendChild(el("div","card warn-card",`<h3>⚠ تنبيهات تناقض (${s.alerts.length})</h3>
      ${wrapTable(`<table><thead><tr><th>القيد</th><th>الزبون (المستلِم)</th><th>التنبيه</th></tr></thead><tbody>${
      s.alerts.map(a=>`<tr><td>${a.ref_no}</td><td>${a.customer}</td><td>${a.message}</td></tr>`).join("")}</tbody></table>`)}`));
  }
}

// ---------- سجل الشحنات (استلام الفرع + تصدير للوجهة) ----------
const today = () => new Date().toISOString().slice(0,10);
async function vShipments(){
  const isBranch = API.role==="branch";
  const v=$("#view");
  v.innerHTML=`<h1>سجل الشحنات</h1>
   <div class="card">
     <div class="seg" id="seg">
       <button class="seg-btn active" data-tab="قيد التصدير">قيد التصدير</button>
       <button class="seg-btn" data-tab="تم التصدير">مصدّرة</button>
       <button class="seg-btn" data-tab="">الكل</button>
     </div>
     <div class="filters">
       <label>من تاريخ<input type="date" id="df"></label>
       <label>إلى تاريخ<input type="date" id="dt"></label>
       <label>جهة الاستلام<select id="tc">${optsWithAll(CITIES)}</select></label>
       <label>صاحب الشحنة (المستلِم)<input id="snd" placeholder="اسم جزئي"></label>
       <label>المرسِل<input id="sfrom" placeholder="اسم جزئي"></label>
       <button class="sm" id="clr">مسح الفلاتر</button>
       ${API.role!=="accountant"?'<button class="primary gold" id="add">＋ شحنة جديدة</button>':''}
     </div>
     <div id="drill"></div>
     <div id="exportbar"></div>
     <div id="tbl"></div>
   </div>`;
  let tab="قيد التصدير";
  let drill={y:null, m:null, d:null};      // تنقّل المصدَّرة: سنة ← شهر ← يوم

  const anyFilter=()=>[$("#df").value,$("#dt").value,$("#tc").value,
                       $("#snd").value.trim(),$("#sfrom").value.trim()].some(Boolean);
  const load=async(fromSearch)=>{
    const params={date_from:$("#df").value,date_to:$("#dt").value,
      to_city:$("#tc").value,receiver:$("#snd").value,sender:$("#sfrom").value};
    if(tab) params.export_status=tab;
    if(isBranch) params.from_city=API.branch;   // صفحة الاستلام تعرض ما أنشأه الفرع فقط
    const rows=await API.get("/api/shipments", params);
    // تبويب «مصدّرة» يُعرض كمجلدات (سنة/شهر/يوم) — إلا عند البحث فيظهر الجدول مباشرةً
    if(tab===EXPORTED && !(fromSearch && anyFilter())){
      renderExportedDrill(rows, drill, load);
    }else{
      $("#drill").innerHTML="";
      renderShip(rows, tab, ()=>load(fromSearch));
    }
  };
  $("#seg").querySelectorAll(".seg-btn").forEach(b=>b.onclick=()=>{
    tab=b.dataset.tab;
    drill={y:null, m:null, d:null};           // ابدأ من مستوى السنوات عند تبديل التبويب
    $("#seg").querySelectorAll(".seg-btn").forEach(x=>x.classList.toggle("active",x===b));
    load();
  });
  const SIDS=["df","dt","tc","snd","sfrom"];
  liveFilters(SIDS, ()=>load(true));        // فلترة فورية بلا زر بحث
  $("#clr").onclick=()=>{ SIDS.forEach(id=>{const e=$("#"+id); if(e) e.value="";});
    drill={y:null,m:null,d:null}; load(); };
  if($("#add")) $("#add").onclick=()=>shipForm(vShipments);
  load();
}

// تاريخ التصنيف: تاريخ التصدير، وإن غاب فتاريخ الشحنة
const expDate = r => (r.export_date || r.ship_date || "");
const MONTH_AR=["يناير","فبراير","مارس","أبريل","مايو","يونيو",
                "يوليو","أغسطس","سبتمبر","أكتوبر","نوفمبر","ديسمبر"];

// ===== تصفّح هرمي عام بالمجلدات (سنة ← شهر ← يوم) =====
// box: حاوية المجلدات، drill: {y,m,d} حالة التنقّل، onLeaf(dayRows): ماذا يُعرض عند اختيار يوم
function renderDrill(box, rows, drill, reload, onLeaf, emptyMsg){
  const parts=r=>{ const [y,m,d]=expDate(r).split("-"); return {y,m,d}; };
  const crumb=()=>{
    const items=[`<button class="crumb" data-lvl="root">📁 كل السنوات</button>`];
    if(drill.y) items.push(`<button class="crumb" data-lvl="y">${drill.y}</button>`);
    if(drill.m) items.push(`<button class="crumb" data-lvl="m">${MONTH_AR[+drill.m-1]} ${drill.y}</button>`);
    if(drill.d) items.push(`<span class="crumb cur">${drill.d} ${MONTH_AR[+drill.m-1]} ${drill.y}</span>`);
    return `<div class="crumbs">${items.join('<span class="sep">‹</span>')}</div>`;
  };
  // بطاقات مستوى واحد: [القيمة المعروضة، العدد، مفتاح التنقّل]
  const cards=(list, label)=>`<div class="folders">${list.map(([key,label2,count])=>
      `<button class="folder" data-k="${key}">
        <span class="fi">📁</span><span class="fname">${label2}</span>
        <span class="fcount">${count} شحنة</span></button>`).join("")}</div>
    <p class="hint">${label}</p>`;

  const group=(arr, keyFn)=>{
    const m={}; arr.forEach(r=>{ const k=keyFn(r); if(k) (m[k]=m[k]||[]).push(r); });
    return m;
  };

  // شريط التنقّل يظهر دائماً — حتى حين تُخفي الفلاتر كل النتائج — كي يبقى الرجوع ممكناً
  let html=crumb(), level;
  const noMatch=`<div class="card">${empty(emptyMsg||"لا توجد بيانات مطابقة للفلاتر")}</div>`;
  if(!rows.length){
    html+=noMatch;
  }else if(!drill.y){
    const g=group(rows, r=>parts(r).y);
    level=Object.keys(g).sort().reverse().map(y=>[y, y, g[y].length]);
    html+=level.length?cards(level, "اختر السنة لعرض شهورها"):noMatch;
  }else if(!drill.m){
    const g=group(rows.filter(r=>parts(r).y===drill.y), r=>parts(r).m);
    level=Object.keys(g).sort().reverse().map(m=>[m, MONTH_AR[+m-1], g[m].length]);
    html+=level.length?cards(level, `شهور سنة ${drill.y} — اختر شهراً لعرض أيامه`):noMatch;
  }else if(!drill.d){
    const g=group(rows.filter(r=>{const p=parts(r); return p.y===drill.y && p.m===drill.m;}),
                  r=>parts(r).d);
    level=Object.keys(g).sort().reverse().map(d=>[d, `يوم ${d}`, g[d].length]);
    html+=level.length?cards(level, `أيام ${MONTH_AR[+drill.m-1]} ${drill.y} — اختر يوماً لعرض شحناته`):noMatch;
  }
  box.innerHTML=html;

  // النقر على مجلد ينزل مستوى واحداً
  box.querySelectorAll(".folder").forEach(b=>b.onclick=()=>{
    if(!drill.y) drill.y=b.dataset.k;
    else if(!drill.m) drill.m=b.dataset.k;
    else drill.d=b.dataset.k;
    reload();
  });
  // فتات الخبز للرجوع لأي مستوى
  box.querySelectorAll(".crumb[data-lvl]").forEach(b=>b.onclick=()=>{
    const l=b.dataset.lvl;
    if(l==="root") { drill.y=drill.m=drill.d=null; }
    else if(l==="y") { drill.m=drill.d=null; }
    else { drill.d=null; }
    reload();
  });

  // وصلنا مستوى اليوم → سلّم صفوف ذلك اليوم لمن يعرضها (قد تكون فارغة بعد تضييق الفلاتر)
  if(drill.d) onLeaf(rows.filter(r=>{const p=parts(r);
    return p.y===drill.y && p.m===drill.m && p.d===drill.d;}));
}

// غلاف خاص بسجل الشحنات: المجلدات ثم جدول الشحنات
function renderExportedDrill(rows, drill, reload){
  $("#exportbar").innerHTML=""; $("#tbl").innerHTML="";
  renderDrill($("#drill"), rows, drill, reload,
    day=>renderShip(day, EXPORTED, reload), "لا توجد شحنات مصدَّرة");
}
function renderShip(rows, tab, load){
  const bar=$("#exportbar"); bar.innerHTML="";
  if(!rows.length){ $("#tbl").innerHTML=empty("لا توجد شحنات مطابقة"); return; }
  const pending = tab==="قيد التصدير";
  const selectable = pending;   // التصدير الجماعي من تبويب «قيد التصدير»
  const h=[];
  if(selectable) h.push(`<th class="chk-col"><input type="checkbox" id="selAll"></th>`);
  h.push(...["القيد","التاريخ","المسجِّل","المرسِل","المستلِم","من→إلى","الصنف","الوزن",
    "أجور الشحن","حالة الجمركة","حالة التصدير","حالة التسليم","إجراءات"].map(x=>`<th>${x}</th>`));
  const canDel = API.role==="admin" || API.role==="supervisor";   // الحذف للإدارة والمشرف فقط
  $("#tbl").innerHTML=wrapTable(`<table><thead><tr>${h.join("")}</tr></thead><tbody>${
    rows.map(r=>`<tr>
      ${selectable?`<td class="chk-col"><input type="checkbox" class="rsel" value="${r.id}"></td>`:''}
      <td>${r.ref_no}</td><td>${r.ship_date}</td>
      <td>${r.created_by_name||r.created_by||"-"}</td>
      <td>${r.sender_name||"-"}</td><td>${r.receiver_name||"-"}</td>
      <td class="nowrap">${r.from_city} ← ${r.to_city}</td>
      <td>${r.item_name||"-"}</td><td>${r.weight_kg} كغ</td>
      <td>${money(r.fees_total)}</td>
      <td>${statusBadge(r.customs_status, r.customs_computed)}</td>
      <td>${statusBadge(r.export_status, r.export_status===EXPORTED)}${r.export_date?`<div class="mini">${r.export_date}</div>`:''}</td>
      <td>${statusBadge(r.delivery_status, r.delivery_status==='تم التسليم')}</td>
      <td class="nowrap">
        <button class="sm" data-edit="${r.id}">تعديل</button>
        ${r.export_status===EXPORTED?`<button class="sm" data-unexp="${r.id}">↩ إرجاع</button>`:''}
        ${canDel?`<button class="sm danger" data-del="${r.id}">حذف</button>`:''}
      </td>
    </tr>`).join("")}</tbody></table>`);

  // شريط التصدير الجماعي
  if(selectable){
    bar.innerHTML=`<div class="action-bar" id="ab" hidden>
      <span id="selCount">0 محدَّدة</span>
      <label>تاريخ الإصدار<input type="date" id="expDate" value="${today()}"></label>
      <button class="primary" id="doExport">🚚 تصدير المحدَّد إلى الوجهة</button>
    </div>`;
    const boxes=()=>[...$("#tbl").querySelectorAll(".rsel")];
    const sync=()=>{
      const sel=boxes().filter(b=>b.checked);
      $("#ab").hidden = sel.length===0;
      if(sel.length) $("#selCount").textContent=`${sel.length} محدَّدة`;
    };
    const selAll=$("#selAll");
    if(selAll) selAll.onchange=()=>{ boxes().forEach(b=>b.checked=selAll.checked); sync(); };
    boxes().forEach(b=>b.onchange=sync);
    $("#doExport").onclick=async()=>{
      const ids=boxes().filter(b=>b.checked).map(b=>Number(b.value));
      if(!ids.length){ toast("حدّد شحنة واحدة على الأقل", true); return; }
      try{
        const r=await API.post("/api/shipments/export",{ids, export_date:$("#expDate").value, status:EXPORTED});
        toast(`تم تصدير ${r.updated} شحنة إلى الوجهة`); load();
      }catch(err){ toast(err.message, true); }
    };
  }

  $("#tbl").querySelectorAll("[data-edit]").forEach(b=>b.onclick=()=>{
    const sh=rows.find(r=>String(r.id)===b.dataset.edit); shipForm(vShipments, sh);
  });
  $("#tbl").querySelectorAll("[data-unexp]").forEach(b=>b.onclick=async()=>{
    if(!confirm("إرجاع الشحنة إلى «قيد التصدير»؟")) return;
    try{ await API.post("/api/shipments/export",{ids:[Number(b.dataset.unexp)],status:"قيد التصدير"});
      toast("رجعت الشحنة لقيد التصدير"); load();
    }catch(err){ toast(err.message, true); }
  });
  $("#tbl").querySelectorAll("[data-del]").forEach(b=>b.onclick=async()=>{
    if(!confirm("حذف هذه الشحنة نهائياً؟ سيُحذف معها حساب جمركتها أيضاً (كيان واحد).")) return;
    try{ await API.del("/api/shipments/"+b.dataset.del); toast("تم حذف الشحنة"); load(); }
    catch(err){ toast(err.message, true); }
  });
}
function statusBadge(txt, ok){
  return `<span class="badge ${ok?'done':'pend'}">${txt}</span>`;
}
function reportsTable(rows){
  if(!rows.length) return empty("لا توجد شحنات مطابقة");
  return colsTable(REPORT_COLS, rows, PRINT_COLS.reports);
}
// prefill: قيم مبدئية لشحنة جديدة (تُستخدم في «حفظ وإضافة صنف آخر لنفس الزبون»)
function shipForm(done, sh, prefill){
  const v=$("#view"); const isEdit=!!sh; const d=sh||prefill||{};
  v.innerHTML=`<h1>${isEdit?`تعديل الشحنة — القيد ${sh.ref_no}`:'شحنة جديدة — استلام'}</h1>
  <div class="card"><form class="grid" id="f">
    <label>التاريخ<input type="date" name="ship_date" value="${d.ship_date||''}" required></label>
    <label>اسم المرسِل<input name="sender_name" value="${d.sender_name||''}"></label>
    <label>رقم المرسِل<input name="sender_phone" value="${d.sender_phone||''}"></label>
    <label>اسم المستلِم<input name="receiver_name" value="${d.receiver_name||''}"></label>
    <label>رقم المستلِم<input name="receiver_phone" value="${d.receiver_phone||''}"></label>
    <label>العدد<input type="number" name="count" value="${d.count||1}"></label>
    <label>نوع الطرد<select name="parcel_type">${opts(PTYPES, d.parcel_type)}</select></label>
    <label>السائق<input name="driver_name" value="${d.driver_name||''}" placeholder="اسم السائق"></label>
    <label>الصنف<input name="item_name" value="${d.item_name||''}" list="items" id="itemin"></label>
    <datalist id="items"></datalist>
    <label>الماركة<input name="brand" value="${d.brand||''}"></label>
    <label>بلد المنشأ<input name="origin_country" value="${d.origin_country||''}"></label>
    <label>الوزن (كغ)<input type="number" step="0.01" name="weight_kg" value="${d.weight_kg??''}"></label>
    <label>قيمة الفاتورة ($)<input type="number" step="0.01" name="goods_value" value="${d.goods_value??''}"></label>
    <label>ثمن البضاعة ($)<input type="number" step="0.01" name="goods_price" id="gprice" value="${d.goods_price??''}"
      placeholder="اتركه فارغاً إن اشترى الزبون بنفسه"></label>
    <label>الأجور الإضافية ($)<input type="number" step="0.01" name="extra_fees" value="${d.extra_fees??''}"></label>
    <label>تمويل البضاعة (تلقائي)<input id="fin" readonly class="derived" value="${d.financing||FIN_CUSTOMER}">
      <small class="hint">يُحدَّد تلقائياً من ثمن البضاعة</small></label>
    <label>من قام بالشراء<input name="bought_by" value="${d.bought_by||''}" placeholder="عند شراء الشركة"></label>
    <label>جهة الإرسال<select name="from_city">${opts(CITIES, d.from_city||API.branch)}</select></label>
    <label>جهة الاستلام<select name="to_city">${opts(CITIES, d.to_city)}</select></label>
    <label>دفع أجور الشحن والجمركة<select name="fees_payment">${opts(PAY, d.fees_payment)}</select></label>
    ${isEdit?`
    <label>حالة التصدير<select name="export_status">${opts(EXPORT_ST, d.export_status)}</select></label>
    <label>تاريخ الإصدار<input type="date" name="export_date" value="${d.export_date||''}"></label>
    <label>حالة التسليم<select name="delivery_status">${opts(DELIVERY, d.delivery_status)}</select></label>
    <label>تاريخ التسليم<input type="date" name="delivery_date" value="${d.delivery_date||''}"></label>
    <label>حالة التحصيل<select name="collection_status">${opts(COLLECTION, d.collection_status)}</select></label>
    `:''}
    <div style="grid-column:1/-1" class="btn-row">
      <button class="primary" type="submit">${isEdit?'حفظ التعديلات':'حفظ'}</button>
      ${isEdit?'':'<button class="primary gold" type="button" id="saveMore">حفظ وإضافة صنف آخر لنفس الزبون</button>'}
      <button class="sm" type="button" id="cancel">إلغاء</button></div>
  </form></div>
  ${isEdit?'':'<p class="hint">ملاحظة: حساب الرسوم الجمركية يتم لاحقاً من صفحة «حساب الجمارك».</p>'}`;
  // autocomplete للأصناف
  $("#itemin").addEventListener("input",async e=>{
    if(e.target.value.length<1)return;
    const its=await API.get("/api/items",{q:e.target.value});
    $("#items").innerHTML=its.map(i=>`<option value="${i.name}">`).join("");
  });
  // تمويل البضاعة مشتق من ثمن البضاعة (نفس قاعدة الباكند)
  const syncFin=()=>{ $("#fin").value = Number($("#gprice").value||0)>0 ? FIN_COMPANY : FIN_CUSTOMER; };
  $("#gprice").addEventListener("input", syncFin); syncFin();
  $("#cancel").onclick=done;

  const save=async()=>{
    const fd=Object.fromEntries(new FormData($("#f")));
    ["count","weight_kg","goods_value","goods_price","extra_fees"].forEach(k=>fd[k]=Number(fd[k]||0));
    if(isEdit) await API.put(`/api/shipments/${sh.id}`, fd);
    else await API.post("/api/shipments",fd);
    return fd;
  };
  $("#f").addEventListener("submit",async e=>{
    e.preventDefault();
    try{ await save(); toast(isEdit?"تم حفظ التعديلات":"تم تسجيل الشحنة"); done(); }
    catch(err){ toast(err.message, true); }
  });
  // حفظ ثم إعادة فتح النموذج ببيانات الزبون نفسها (صنف آخر لنفس الشحنة/الزبون)
  if($("#saveMore")) $("#saveMore").onclick=async()=>{
    try{
      const fd=await save();
      toast("تم الحفظ — أدخل الصنف التالي لنفس الزبون");
      const keep={};
      ["ship_date","sender_name","sender_phone","receiver_name","receiver_phone",
       "from_city","to_city","fees_payment","driver_name"].forEach(k=>keep[k]=fd[k]);
      shipForm(done, null, keep);
    }catch(err){ toast(err.message, true); }
  };
}

// ---------- حساب الجمارك (خطوة منفصلة) ----------
async function vCustoms(){
  const v=$("#view"); v.innerHTML=`<h1>حساب الجمارك</h1>
    <div class="card"><div class="filters">
      <label>من تاريخ<input type="date" id="cdf"></label>
      <label>إلى تاريخ<input type="date" id="cdt"></label>
      <label>رقم القيد<input id="cref" placeholder="مثال 1005"></label>
      <label>المستلِم<input id="crecv" placeholder="اسم جزئي"></label>
      <label>المرسِل<input id="csnd" placeholder="اسم جزئي"></label>
      <label>الصنف<input id="citem" placeholder="اسم جزئي"></label>
      <label>جهة الإرسال<select id="cfc">${optsWithAll(CITIES)}</select></label>
      <label>جهة الاستلام<select id="ctc">${optsWithAll(CITIES)}</select></label>
      <label>حالة التصدير<select id="cexp">${optsWithAll(EXPORT_ST)}</select></label>
      <button class="sm" id="cclr">مسح الفلاتر</button>
    </div></div>
    <div class="card"><h3>بانتظار الجمركة <span class="count-badge" id="np"></span></h3><div id="pending"></div></div>
    <div class="card"><h3>مكتملة (قابلة للتصحيح) <span class="count-badge" id="nd"></span></h3><div id="done"></div></div>`;

  const load=async()=>{
    const base={date_from:$("#cdf").value, date_to:$("#cdt").value,
      receiver:$("#crecv").value, sender:$("#csnd").value,
      from_city:$("#cfc").value, to_city:$("#ctc").value,
      export_status:$("#cexp").value};
    const [pending, done] = await Promise.all([
      API.get("/api/shipments",{...base, customs_status:"قيد الجمركة"}),
      API.get("/api/shipments",{...base, customs_status:"تمّت الجمركة"}),
    ]);
    // فلاتر تُطبَّق محلياً (رقم القيد والصنف)
    const ref=$("#cref").value.trim(), item=$("#citem").value.trim();
    const local=rows=>rows.filter(r=>
      (!ref || String(r.ref_no).includes(ref)) &&
      (!item || (r.item_name||"").includes(item)));
    const P=local(pending), D=local(done);

    const rowHtml=(r,label)=>`<tr>
      <td>${r.ref_no}</td><td>${r.ship_date}</td><td>${r.receiver_name||"-"}</td>
      <td>${r.item_name||"-"}</td><td>${r.weight_kg} كغ</td>
      <td>${money(r.goods_value)}</td><td>${money(r.fees_total)}</td>
      <td><button class="sm primary" data-id="${r.id}">${label}</button></td></tr>`;
    const head=last=>`<tr><th>القيد</th><th>التاريخ</th><th>الزبون (المستلِم)</th><th>الصنف</th>
      <th>الوزن</th><th>القيمة</th><th>${last}</th><th></th></tr>`;
    $("#np").textContent=P.length; $("#nd").textContent=D.length;
    $("#pending").innerHTML = P.length ? wrapTable(
      `<table><thead>${head("معاينة الرسوم")}</thead><tbody>${P.map(r=>rowHtml(r,"احتساب")).join("")}</tbody></table>`)
      : empty("لا توجد شحنات بانتظار الجمركة");
    $("#done").innerHTML = D.length ? wrapTable(
      `<table><thead>${head("المجموع النهائي")}</thead><tbody>${D.map(r=>rowHtml(r,"تعديل")).join("")}</tbody></table>`)
      : empty("لا توجد شحنات محتسبة بعد");
    const all=[...P,...D];
    v.querySelectorAll("button[data-id]").forEach(b=>b.onclick=()=>{
      customsForm(all.find(r=>String(r.id)===b.dataset.id), vCustoms);
    });
  };
  liveFilters(["cdf","cdt","cref","crecv","csnd","citem","cfc","ctc","cexp"], load);
  $("#cclr").onclick=()=>{
    ["cdf","cdt","cref","crecv","csnd","citem"].forEach(id=>$("#"+id).value="");
    ["cfc","ctc","cexp"].forEach(id=>$("#"+id).value="");
    load();
  };
  ["cref","crecv","csnd","citem"].forEach(id=>
    $("#"+id).addEventListener("keydown",e=>{ if(e.key==="Enter") load(); }));
  load();
}
// خلايا معاينة حساب الجمارك — نفس أعمدة ورقة «حساب الجمارك» في الإكسل بالضبط (D..M)
function breakdownCells(c){
  const cell=(k,v)=>`<div class="cell"><div class="k">${k}</div><div class="v">${v}</div></div>`;
  let html = cell("الرسم السوري للطن (الأصل) D", money(c.syrian_per_ton))
    + cell("الرسم الجمركي السوري الفعلي E", money(c.syrian_actual))
    + cell("الرسم العراقي للطن", money(c.iraqi_per_ton))
    + cell("الرسم العراقي الفعلي F", money(c.iraqi_actual))
    + cell("قيمة البضاعة G", money(c.goods_value ?? 0))
    + cell("السلفة الضريبية H", money(c.tax_advance))
    + cell("نسبة الإنفاق الاستهلاكي I", (c.consumption_rate*100).toFixed(0)+"%")
    + cell("رسم الإنفاق الاستهلاكي J", money(c.consumption_fee))
    + cell("مصروف طرفين K (للشحنة كاملة)", money(c.two_party_expense))
    + cell("الأجور الإضافية L", money(c.extra_fees));
  if(c.commission || c.invested_capital){
    html += cell("عمولة الشراء", money(c.commission)) + cell("رأس مال مستثمر", money(c.invested_capital));
  }
  // المجموع النهائي دائماً آخر كرت
  html += cell("المجموع النهائي M (أجور الشحن والجمركة)", money(c.fees_total));
  return html;
}
function customsForm(sh, done){
  const v=$("#view"); const isCompany = sh.financing==="الشركة اشترت نيابةً عنه";
  v.innerHTML=`<h1>حساب الجمارك — القيد ${sh.ref_no}</h1>
    <div class="card">
      <p><b>الزبون (المستلِم):</b> ${sh.receiver_name} — <b>الصنف:</b> ${sh.item_name} —
         <b>الوزن:</b> ${sh.weight_kg} كغ — <b>قيمة البضاعة G:</b> ${money(sh.goods_value)}</p>
    <form class="grid" id="f">
      <label>مصروف طرفين K ($)<input type="number" step="0.01" name="two_party_expense"
          value="${sh.two_party_auto ? '' : (sh.two_party_expense ?? '')}" placeholder="اتركه فارغاً للحساب التلقائي">
        <small class="hint">قيمة يدوية لكامل وزن الشحنة — إن تُرك فارغاً يُحسب تلقائياً من مصروف الطرفين للطن</small></label>
      <label>سلفة ضريبية يدوية N (تجاوز اختياري)<input type="number" step="0.01" name="manual_tax_advance" value="${sh.manual_tax_advance??''}"></label>
      <label>رسم إنفاق يدوي O (تجاوز اختياري)<input type="number" step="0.01" name="manual_consumption_fee" value="${sh.manual_consumption_fee??''}"></label>
      ${isCompany?`<label>نسبة العمولة (تجاوز اختياري)<input type="number" step="0.001" name="commission_rate" value="${sh.commission_rate??''}"></label>`:''}
      <div style="grid-column:1/-1"><button class="primary" type="submit">احتساب وقفل</button>
        <button class="sm" type="button" id="cancel">رجوع</button></div>
    </form></div>
    <div class="card"><h3>معاينة حية (تُحدَّث فور الكتابة — المصدر: الباكند)</h3>
      <div class="breakdown" id="bd">${breakdownCells(sh)}</div></div>`;
  $("#cancel").onclick=done;
  let timer=null;
  const preview=async()=>{
    const fd=Object.fromEntries(new FormData($("#f")));
    // فارغ = null → يُحسب تلقائياً من ثابت الطن. الأجور الإضافية تُدار من نموذج الشحنة
    ["two_party_expense","iraqi_per_ton","manual_tax_advance","manual_consumption_fee","commission_rate"].forEach(k=>{
      fd[k]=(fd[k]===""||fd[k]==null)?null:Number(fd[k]);
    });
    try{
      const c=await API.post(`/api/shipments/${sh.id}/customs/preview`, fd);
      $("#bd").innerHTML=breakdownCells({...c, goods_value:sh.goods_value});
    }catch(err){/* تجاهل أخطاء المعاينة المؤقتة أثناء الكتابة */}
  };
  $("#f").addEventListener("input",()=>{ clearTimeout(timer); timer=setTimeout(preview,350); });
  $("#f").addEventListener("submit",async e=>{
    e.preventDefault(); const fd=Object.fromEntries(new FormData(e.target));
    // فارغ = null → يُحسب تلقائياً من ثابت الطن. الأجور الإضافية تُدار من نموذج الشحنة
    ["two_party_expense","iraqi_per_ton","manual_tax_advance","manual_consumption_fee","commission_rate"].forEach(k=>{
      fd[k]=(fd[k]===""||fd[k]==null)?null:Number(fd[k]);
    });
    try{
      await API.post(`/api/shipments/${sh.id}/customs`, fd);
      toast(`تم احتساب جمارك القيد ${sh.ref_no}`); done();
    }catch(err){ toast(err.message, true); }
  });
}

// ---------- التخليص الجمركي (المخلص الكمركي) ----------
// أعمدة التخليص فقط، مرتّبة منطقياً: هوية الشحنة ← وصف البضاعة ← أرقام التعرفة.
// التعديل يُكتب مباشرةً على سجل الشحنة الأصلي عبر PUT /api/shipments/{id}.
// [المفتاح، العنوان، دالة العرض، قابل للتعديل؟، نوع الحقل]
const BROKER_COLS=[
  ["ref_no","رقم القيد",r=>r.ref_no,false],
  ["item_code","الكود",r=>r.item_code||"-",true,"text"],
  ["item_name","الصنف",r=>r.item_name||"-",true,"text"],
  ["brand","الماركة",r=>r.brand||"-",true,"text"],
  ["origin_country","المنشأ",r=>r.origin_country||"-",true,"text"],
  ["weight_kg","الوزن (كغ)",r=>(r.weight_kg??0)+" كغ",true,"number"],
  ["goods_value","قيمة الفاتورة",r=>money(r.goods_value),true,"number"],
  ["syrian_per_ton","الرسم الجمركي السوري للطن",r=>money(r.syrian_per_ton),true,"number"],
  ["export_status","حالة التصدير",r=>badge(r.export_status,r.export_status==='تم التصدير'),false],
];
async function vBroker(){
  const v=$("#view");
  v.innerHTML=`<h1>التخليص الجمركي</h1>
    <div class="card no-print">
      <div class="seg" id="bseg">
        <button class="seg-btn active" data-tab="exported">المصدَّرة</button>
        <button class="seg-btn" data-tab="recent">المصدَّرة حديثاً</button>
        <button class="seg-btn" data-tab="pending">قيد التصدير</button>
        <button class="seg-btn" data-tab="">الكل</button>
      </div>
      <div class="filters">
        <label>من تاريخ<input type="date" id="bdf"></label>
        <label>إلى تاريخ<input type="date" id="bdt"></label>
        <label>جهة الاستلام<select id="btc">${optsWithAll(CITIES)}</select></label>
        <button class="sm" id="bpr">🖨 طباعة كشف الجمارك</button>
        <button class="sm" id="bxl">⬇ تصدير Excel</button>
      </div>
    </div>
    <div class="only-print">${brandHead()}</div>
    <div id="bdrill" class="no-print"></div>
    <div class="card"><div id="btbl"></div></div>`;
  let tab="exported", lastRows=[],
      drill={y:null,m:null,d:null},   // تنقّل مجلدات «المصدَّرة»
      recentDay=null;                 // اليوم المفتوح في «المصدَّرة حديثاً»

  // «المصدَّرة حديثاً»: مجلد لكل يوم تصدير خلال آخر ٧ أيام — دخول مباشر بلا سنة/شهر
  const renderRecent=rows=>{
    const box=$("#bdrill"); $("#btbl").innerHTML="";
    const cutoff=new Date(Date.now()-7*864e5).toISOString().slice(0,10);
    const g={};
    rows.forEach(r=>{ const k=expDate(r); if(k && k>=cutoff) (g[k]=g[k]||[]).push(r); });
    const days=Object.keys(g).sort().reverse();
    if(recentDay && !g[recentDay]) recentDay=null;   // اليوم المفتوح خرج من النطاق/الفلاتر
    if(!recentDay){
      lastRows=[];
      box.innerHTML = days.length ? `<div class="folders">${days.map(d=>{
          const [y,m,dd]=d.split("-");
          return `<button class="folder" data-k="${d}"><span class="fi">📁</span>
            <span class="fname">${dd} ${MONTH_AR[+m-1]} ${y}</span>
            <span class="fcount">${g[d].length} شحنة</span></button>`;}).join("")}</div>
        <p class="hint">الشحنات المصدَّرة خلال آخر ٧ أيام — اختر يوماً لعرض كشفه</p>`
        : `<div class="card">${empty("لا توجد شحنات مصدَّرة خلال آخر ٧ أيام")}</div>`;
      box.querySelectorAll(".folder").forEach(b=>b.onclick=()=>{ recentDay=b.dataset.k; load(); });
    }else{
      const [y,m,dd]=recentDay.split("-");
      box.innerHTML=`<div class="crumbs"><button class="crumb" data-lvl="root">📁 الأيام الحديثة</button>
        <span class="sep">‹</span><span class="crumb cur">${dd} ${MONTH_AR[+m-1]} ${y}</span></div>`;
      box.querySelector('.crumb[data-lvl]').onclick=()=>{ recentDay=null; load(); };
      lastRows=g[recentDay]; renderBroker(g[recentDay], load);
    }
  };

  const load=async()=>{
    const params={date_from:$("#bdf").value,date_to:$("#bdt").value,to_city:$("#btc").value};
    if(tab==="exported"||tab==="recent") params.export_status=EXPORTED;
    else if(tab==="pending") params.export_status="قيد التصدير";
    const rows=await API.get("/api/shipments", params);
    if(tab==="exported"){
      // نظام المجلدات نفسه المستخدم في سجل الشحنات والتقارير: سنة ← شهر ← يوم
      $("#btbl").innerHTML=""; if(!drill.d) lastRows=[];
      renderDrill($("#bdrill"), rows, drill, load,
        day=>{ lastRows=day; renderBroker(day, load); }, "لا توجد شحنات مصدَّرة");
    }else if(tab==="recent"){
      renderRecent(rows);
    }else{
      $("#bdrill").innerHTML=""; lastRows=rows; renderBroker(rows, load);
    }
  };
  $("#bxl").onclick=()=>exportXlsx(BROKER_COLS, lastRows, "customs", "كشف الجمارك");
  $("#bseg").querySelectorAll(".seg-btn").forEach(b=>b.onclick=()=>{
    tab=b.dataset.tab;
    drill={y:null,m:null,d:null}; recentDay=null;   // كل تبويب يبدأ من جذر مجلداته
    $("#bseg").querySelectorAll(".seg-btn").forEach(x=>x.classList.toggle("active",x===b));
    load();
  });
  liveFilters(["bdf","bdt","btc"], load);
  $("#bpr").onclick=()=>printDoc("landscape");
  load();
}
function renderBroker(rows, load){
  if(!rows.length){ $("#btbl").innerHTML=empty("لا توجد شحنات مطابقة"); return; }
  // الشاشة تعرض كل الأعمدة؛ الطباعة تُخفي ما لم يحدّده المدير (صنف np)
  const sel=(PRINT_COLS.customs&&PRINT_COLS.customs.length)?new Set(PRINT_COLS.customs):null;
  const np=k=>(sel&&!sel.has(k))?' class="np"':'';
  const head=BROKER_COLS.map(([k,l])=>`<th${np(k)}>${l}</th>`).join("")
    +`<th class="no-print">إجراءات</th>`;
  $("#btbl").innerHTML=wrapTable(`<table class="compact-print"><thead><tr>${head}</tr></thead><tbody>${
    rows.map(r=>`<tr data-row="${r.id}">
      ${BROKER_COLS.map(([k,,fn])=>`<td${np(k)}>${fn(r)}</td>`).join("")}
      <td class="no-print"><button class="sm" data-edit="${r.id}">تعديل</button></td>
    </tr>`).join("")}</tbody></table>`);
  $("#btbl").querySelectorAll("[data-edit]").forEach(b=>b.onclick=()=>{
    const r=rows.find(x=>String(x.id)===b.dataset.edit); if(!r) return;
    const tr=$("#btbl").querySelector(`tr[data-row="${r.id}"]`);
    tr.innerHTML=BROKER_COLS.map(([k,,fn,editable,type])=>editable
      ? `<td${np(k)}><input class="cell-in" data-f="${k}" ${type==="number"?'type="number" step="0.01"':''}
           value="${escAttr(r[k]??"")}"></td>`
      : `<td${np(k)}>${fn(r)}</td>`).join("")
      +`<td class="no-print nowrap"><button class="sm primary" data-save>حفظ</button>
          <button class="sm" data-cancel>إلغاء</button></td>`;
    tr.querySelector("[data-cancel]").onclick=load;
    tr.querySelector("[data-save]").onclick=async()=>{
      const patch={};
      tr.querySelectorAll(".cell-in").forEach(inp=>{
        patch[inp.dataset.f] = inp.type==="number" ? Number(inp.value||0) : inp.value;
      });
      try{ await API.put("/api/shipments/"+r.id, patch); toast("تم حفظ بيانات التخليص"); load(); }
      catch(err){ toast(err.message, true); }
    };
  });
}

// ---------- فرع الوجهة: الشحنات المُصدَّرة الواصلة — تسليم/تحصيل/دفع الأجور ----------
async function vDeliver(){
  const v=$("#view");
  v.innerHTML=`<h1>الشحنات الواصلة لمكتبك</h1>
    <p class="hint">هذه الشحنات صُدِّرت إليك من فرع المصدر. حدِّث دفع الأجور، والتسليم، والتحصيل (عند الدفع نيابةً عن الزبون).</p>
    <div id='t' class='card'></div>`;
  const rows=await API.get("/api/shipments",{to_city:API.branch, export_status:EXPORTED});
  if(!rows.length){ $("#t").innerHTML=empty("لا توجد شحنات مُصدَّرة واصلة لمكتبك حالياً"); return; }
  $("#t").innerHTML=wrapTable(`<table><thead><tr>
    <th>القيد</th><th>المرسِل</th><th>المستلِم (صاحب الشحنة)</th><th>الصنف</th><th>أجور الشحن</th>
    <th>المستحق</th><th>دفع الأجور</th><th>التسليم</th><th>التحصيل</th><th></th></tr></thead>
    <tbody>${rows.map(r=>`<tr>
      <td>${r.ref_no}</td><td>${r.sender_name||"-"}</td><td>${r.receiver_name||"-"}</td>
      <td>${r.item_name||"-"}</td><td>${money(r.fees_total)}</td><td>${money(r.cod_due)}</td>
      <td><select data-id="${r.id}" data-f="fees_payment">${opts(PAY,r.fees_payment)}</select></td>
      <td><select data-id="${r.id}" data-f="delivery_status">${opts(DELIVERY,r.delivery_status)}</select></td>
      <td><select data-id="${r.id}" data-f="collection_status">${opts(COLLECTION,r.collection_status)}</select></td>
      <td><button class="sm primary" data-save="${r.id}">حفظ</button></td>
    </tr>`).join("")}</tbody></table>`);
  $("#t").querySelectorAll("[data-save]").forEach(b=>b.onclick=async()=>{
    const id=b.dataset.save, patch={};
    $("#t").querySelectorAll(`[data-id="${id}"]`).forEach(s=>patch[s.dataset.f]=s.value);
    try{ await API.put("/api/shipments/"+id,patch); b.textContent="✓ تم"; toast("تم الحفظ"); }
    catch(err){ toast(err.message, true); }
  });
}

// ---------- فاتورة الزبون (بالمستلِم أو بالمرسِل — العنوان يتبع ما بحث به المستخدم) ----------
async function vInvoice(){
  const v=$("#view"); v.innerHTML=`<h1>فاتورة الزبون</h1>
    <div class="card no-print"><div class="filters">
      <label>اسم المستلِم<input id="recv" list="rcusts" placeholder="اكتب اسم المستلِم"></label>
      <datalist id="rcusts"></datalist>
      <label>اسم المرسِل<input id="sndr" list="scusts" placeholder="اكتب اسم المرسِل"></label>
      <datalist id="scusts"></datalist>
      <label>من تاريخ<input type="date" id="if"></label>
      <label>إلى تاريخ<input type="date" id="it"></label>
      <button class="primary" id="go">عرض الفاتورة</button>
      <button class="sm" id="pr">🖨 طباعة</button>
      <button class="sm" id="ixl">⬇ تصدير Excel</button>
    </div>
    <p class="hint">ابحث باسم المستلِم أو باسم المرسِل — وعنوان الفاتورة يتبع ما بحثت به.</p></div>
    <div id="inv"></div>`;
  let invRows=[], invName="";
  // اقتراحات الأسماء أثناء الكتابة
  const suggest=(inputId, listId, key)=>$("#"+inputId).addEventListener("input",async e=>{
    if(e.target.value.length<1) return;
    const rows=await API.get("/api/shipments",{[key]:e.target.value});
    const names=[...new Set(rows.map(r=>r[key+"_name"]))].filter(Boolean);
    $("#"+listId).innerHTML=names.map(n=>`<option value="${n}">`).join("");
  });
  suggest("recv","rcusts","receiver"); suggest("sndr","scusts","sender");
  $("#pr").onclick=()=>printDoc("portrait");
  $("#ixl").onclick=()=>exportXlsx(INVOICE_COLS, invRows, "invoice",
    invName?`فاتورة ${invName}`:"فاتورة الزبون");
  const show=async(quiet)=>{
    const receiver=$("#recv").value.trim(), sender=$("#sndr").value.trim();
    if(!receiver && !sender){
      if(!quiet) $("#inv").innerHTML=`<div class="card">${empty("اكتب اسم المستلِم أو اسم المرسِل")}</div>`;
      return;
    }
    const data=await API.get("/api/shipments/invoice",
      {receiver, sender, date_from:$("#if").value, date_to:$("#it").value});
    invRows=data.rows;
    // العنوان يتبع ما بحث به المستخدم؛ وإن بحث بالاثنين يُذكران معاً
    const party = receiver && sender ? `${receiver} / ${sender}` : (receiver || sender);
    const label = receiver && sender ? "المستلِم والمرسِل" : (receiver ? "المستلِم" : "المرسِل");
    invName=party;
    $("#inv").innerHTML=invoiceHtml(party, label, data);
  };
  $("#go").onclick=()=>show(false);
  // الاسم يحتاج تطابقاً تاماً فيبقى بزر، أما التاريخان فيُحدّثان الفاتورة المعروضة فوراً
  liveFilters(["if","it"], ()=>show(true));
}
function invoiceHtml(party, label, data){
  const rows=data.rows;
  const goodsTotal=rows.reduce((a,r)=>a+goodsWithCommission(r),0);
  const table = rows.length ? colsTable(INVOICE_COLS, rows, PRINT_COLS.invoice)
    : empty("لا توجد شحنات مطابقة ضمن الفترة المحددة");
  return `<div class="card invoice-sheet">
    ${brandHead()}
    <h2>فاتورة الزبون (${label}): ${party}</h2>
    ${table}
    <p class="hint no-print">الرسوم = الرسم السوري الفعلي + الرسم العراقي الفعلي + مصروف طرفين.</p>
    <div class="kpis" style="margin-top:14px">
      ${goodsTotal>0?`<div class="kpi gold"><div class="label">ثمن البضاعة + العمولة</div>
        <div class="val">${money(goodsTotal)}</div></div>`:""}
      <div class="kpi cash"><div class="label">الواصل نقداً</div><div class="val">${money(data.summary.cash_in)}</div></div>
      <div class="kpi cod"><div class="label">المستحق ضد الدفع</div><div class="val">${money(data.summary.cod_due)}</div></div>
      <div class="kpi"><div class="label">إجمالي المبلغ</div><div class="val">${money(data.summary.grand_total)}</div></div>
    </div></div>`;
}

// لوحة «تفاصيل أكثر» في التقارير — ستّ مجموعات تفكّك المجاميع الكبرى إلى بنودها
function detailPanels(rows){
  if(!rows || !rows.length) return empty("لا توجد بيانات");
  const sum=(k,filter)=>(filter?rows.filter(filter):rows)
    .reduce((a,r)=>a+(Number(r[k])||0),0);
  // بطاقة: العنوان، القيمة، صنف لوني اختياري
  const card=(l,v,c="")=>`<div class="kpi ${c}"><div class="label">${l}</div>
    <div class="val">${money(v)}</div></div>`;
  const grp=(title,cards,note="")=>`<h3 class="sub">${title}</h3>
    ${note?`<p class="hint">${note}</p>`:""}<div class="kpis">${cards}</div>`;

  const byPay=v=>r=>r.fees_payment===v;         // حسب طريقة دفع الأجور
  const byCol=v=>r=>r.collection_status===v;    // حسب حالة التحصيل
  const CASH="واصل نقداً", COD="ضد الدفع";
  const COLLECTED="تم التحصيل", NOTCOLLECTED="لم يُحصَّل";
  // مجموع (ثمن البضاعة + العمولة) لمجموعة
  const withComm=f=>sum("goods_price",f)+sum("commission",f);

  return `
  ${grp("١) أجور الشحن والجمركة — وتفكيكها",
      card("إجمالي أجور الشحن والجمركة", sum("fees_total"), "gold")
    + card("الرسم الجمركي السوري الفعلي", sum("syrian_actual"))
    + card("الرسم الجمركي العراقي الفعلي", sum("iraqi_actual"))
    + card("مصروف الطرفين", sum("two_party_expense"))
    + card("الأجور الإضافية", sum("extra_fees"))
    + card("السلفة الضريبية", sum("tax_advance"))
    + card("رسم الإنفاق الاستهلاكي", sum("consumption_fee")),
      "الإجمالي = السوري + العراقي + مصروف الطرفين + الأجور الإضافية + السلفة + رسم الإنفاق")}

  ${grp("٢) ثمن البضاعة والعمولة",
      card("ثمن البضاعة (بدون عمولة)", sum("goods_price"))
    + card("عمولة الشراء", sum("commission"))
    + card("ثمن البضاعة + العمولة", sum("goods_price")+sum("commission"), "gold"))}

  ${grp("٣) أجور الشحن والجمركة حسب طريقة الدفع",
      card("واصل نقداً", sum("fees_total", byPay(CASH)), "cash")
    + card("ضد الدفع", sum("fees_total", byPay(COD)), "cod")
    + card("آجل (ذمة على المرسِل)", sum("fees_total", byPay(DEFERRED)), "cod"))}

  ${grp("٤) ثمن البضاعة حسب حالة التحصيل (بدون عمولة)",
      card("تم التحصيل", sum("goods_price", byCol(COLLECTED)), "cash")
    + card("لم يُحصَّل", sum("goods_price", byCol(NOTCOLLECTED)), "cod")
    + card("آجل", sum("goods_price", byCol(DEFERRED)), "cod"))}

  ${grp("٥) ثمن البضاعة + العمولة حسب حالة التحصيل",
      card("تم التحصيل — الإجمالي", withComm(byCol(COLLECTED)), "cash")
    + card("منها عمولة", sum("commission", byCol(COLLECTED)))
    + card("لم يُحصَّل — الإجمالي", withComm(byCol(NOTCOLLECTED)), "cod")
    + card("منها عمولة", sum("commission", byCol(NOTCOLLECTED)))
    + card("آجل — الإجمالي", withComm(byCol(DEFERRED)), "cod")
    + card("منها عمولة", sum("commission", byCol(DEFERRED))),
      "كل حالة تعرض المجموع شاملاً العمولة، ثم مقدار العمولة داخله")}`;
}

// ---------- لوحة التقارير ----------
async function vReports(){
  const v=$("#view"); v.innerHTML=`<h1>لوحة التقارير</h1>
   <div class="card no-print"><div class="filters">
     <label>من تاريخ<input type="date" id="rdf"></label>
     <label>إلى تاريخ<input type="date" id="rdt"></label>
     <label>جهة الإرسال<select id="rfc">${optsWithAll(CITIES)}</select></label>
     <label>جهة الاستلام<select id="rtc">${optsWithAll(CITIES)}</select></label>
     <label>صاحب الشحنة (المستلِم)<input id="rsnd" placeholder="اسم جزئي"></label>
     <label>المرسِل<input id="rsfrom" placeholder="اسم جزئي"></label>
     <label>تمويل البضاعة<select id="rfin">${optsWithAll(FINANCE)}</select></label>
     <label>دفع الأجور<select id="rfp">${optsWithAll(PAY)}</select></label>
     <label>حالة الجمركة<select id="rcs">${optsWithAll(CUSTOMS_ST)}</select></label>
     <label>حالة التسليم<select id="rds">${optsWithAll(DELIVERY)}</select></label>
     <label>حالة التحصيل<select id="rcol">${optsWithAll(COLLECTION)}</select></label>
     <label class="chk-inline"><input type="checkbox" id="ralpha"> ترتيب أبجدي حسب المستلِم</label>
     <button class="sm" id="rfold">📁 عرض بمجلدات الصادرة</button>
     <button class="sm" id="rclr">مسح الفلاتر</button>
     <button class="sm" id="rpr">🖨 طباعة</button>
     <button class="sm" id="exp">⬇ تصدير Excel</button>
   </div>
   <p class="hint" id="rmode"></p></div>
   <div class="only-print">${brandHead()}<h2 class="print-title">تقرير الشحنات</h2></div>
   <div id="rdrill" class="no-print"></div>
   <div id="rk" class="kpis"></div>
   <div class="card" id="rmoreCard" hidden>
     <button class="detail-toggle" id="rmoreBtn" aria-expanded="false">
       <span class="caret">▾</span> تفاصيل أكثر</button>
     <div id="rmore" hidden></div>
   </div>
   <div class="card"><div id="rtbl"></div></div>`;
  $("#rpr").onclick=()=>printDoc("landscape");
  let lastRows=[], folderMode=false, drill={y:null,m:null,d:null}, moreOpen=false;
  $("#rmoreBtn").onclick=()=>{
    moreOpen=!moreOpen;
    $("#rmore").hidden=!moreOpen;
    $("#rmoreBtn").setAttribute("aria-expanded", moreOpen);
    $("#rmoreBtn").classList.toggle("open", moreOpen);
    if(moreOpen) $("#rmore").innerHTML=detailPanels(lastRows);
  };

  const filters=()=>({
    date_from:$("#rdf").value, date_to:$("#rdt").value, from_city:$("#rfc").value,
    to_city:$("#rtc").value, receiver:$("#rsnd").value, sender:$("#rsfrom").value,
    financing:$("#rfin").value, fees_payment:$("#rfp").value,
    customs_status:$("#rcs").value, delivery_status:$("#rds").value,
    collection_status:$("#rcol").value});

  // يعرض المؤشرات والجدول لمجموعة صفوف (مع الترتيب الأبجدي إن كان مفعّلاً)
  const paint=rows=>{
    if($("#ralpha").checked)   // يسري على الشاشة والطباعة وتصدير Excel معاً
      rows=[...rows].sort((a,b)=>(a.receiver_name||"").localeCompare(b.receiver_name||"","ar"));
    lastRows=rows;
    const owners=new Set(rows.map(r=>r.receiver_name));   // صاحب الشحنة = المستلِم
    const sum=(k,f)=>(f?rows.filter(f):rows).reduce((a,r)=>a+(Number(r[k])||0),0);
    // ثمن البضاعة + العمولة لمجموعة صفوف (نفس منطق «تفاصيل أكثر»)
    const gwc=f=>sum("goods_price",f)+sum("commission",f);
    // كل حالة = الأجور بطريقة دفعها + ثمن البضاعة والعمولة بحالة تحصيلها المقابلة
    const K=[
      ["عدد الشحنات",rows.length,""],
      ["عدد الزبائن",owners.size,""],
      ["إجمالي الوزن",sum("weight_kg").toFixed(1)+" كغ",""],
      ["إجمالي أجور الشحن والجمركة",money(sum("fees_total")),""],
      ["إجمالي ثمن البضاعة مع العمولة",money(gwc()),""],
      // إجمالي المبلغ = أجور الشحن والجمركة + ثمن البضاعة مع العمولة
      ["إجمالي المبلغ",money(sum("fees_total")+gwc()),"gold"],
      ["الواصل نقداً",money(sum("fees_total",r=>r.fees_payment==="واصل نقداً")
        +gwc(r=>r.collection_status==="تم التحصيل")),"cash"],
      ["ضد الدفع",money(sum("fees_total",r=>r.fees_payment==="ضد الدفع")
        +gwc(r=>r.collection_status==="لم يُحصَّل")),"cod"],
      ["الآجل",money(sum("fees_total",r=>r.fees_payment===DEFERRED)
        +gwc(r=>r.collection_status===DEFERRED)),"cod"],
      ["إجمالي عمولة ثمن البضاعة",money(sum("commission")),""],
    ];
    $("#rk").innerHTML=K.map(([l,val,c])=>`<div class="kpi ${c}"><div class="label">${l}</div><div class="val">${val}</div></div>`).join("");
    $("#rtbl").innerHTML=reportsTable(rows);
    $("#rmoreCard").hidden = !rows.length;          // لا يظهر الزر بلا بيانات
    if(moreOpen) $("#rmore").innerHTML=detailPanels(rows);   // يتحدّث مع كل فلترة
  };
  const clearOut=()=>{
    $("#rk").innerHTML=""; $("#rtbl").innerHTML=""; lastRows=[];
    $("#rmoreCard").hidden=true; $("#rmore").innerHTML="";
  };

  const load=async()=>{
    const params=filters();
    if(folderMode) params.export_status=EXPORTED;   // المجلدات للشحنات الصادرة
    const rows=await API.get("/api/shipments", params);
    if(!folderMode){
      $("#rdrill").innerHTML=""; $("#rmode").textContent="";
      paint(rows); return;
    }
    // وضع المجلدات: الفلاتر تُطبَّق قبل التجميع، فتعرض المجلدات المطابق فقط
    $("#rmode").innerHTML="📁 <b>وضع المجلدات</b> — الفلاتر أعلاه مُطبَّقة على المجلدات. "+
      "اختر السنة ثم الشهر ثم اليوم لعرض تقرير ذلك اليوم.";
    clearOut();
    renderDrill($("#rdrill"), rows, drill, load, paint,
      "لا توجد شحنات صادرة مطابقة للفلاتر");
  };

  const FIDS=["rdf","rdt","rfc","rtc","rsnd","rsfrom","rfin","rfp","rcs","rds","rcol","ralpha"];
  // الفلترة فورية — وتبقى داخل المجلد المفتوح بدل القفز لمستوى السنوات
  liveFilters(FIDS, load);
  $("#rclr").onclick=()=>{
    FIDS.forEach(id=>{ const e=$("#"+id); if(!e) return;
      if(e.type==="checkbox") e.checked=false; else e.value=""; });
    drill={y:null,m:null,d:null}; load();
  };
  $("#rfold").onclick=()=>{
    folderMode=!folderMode; drill={y:null,m:null,d:null};
    $("#rfold").textContent = folderMode ? "📋 عرض كجدول" : "📁 عرض بمجلدات الصادرة";
    $("#rfold").classList.toggle("primary", folderMode);
    load();
  };
  $("#exp").onclick=()=>exportXlsx(REPORT_COLS, lastRows, "reports", "تقرير الشحنات");
  load();
}

// ---------- الحسابات (تبويبات) ----------
async function vAccounting(){
  const v=$("#view"); v.innerHTML=`<h1>الحسابات</h1>
    <div class="card"><div class="filters">
      <label>من<input type="date" id="af"></label><label>إلى<input type="date" id="at"></label>
      <label>الفرع<select id="ab">${optsWithAll(CITIES)}</select></label>
      <button class="sm" id="aclr">مسح</button></div></div>
    <div class="tabs" id="atabs"></div>
    <div id="atab"></div>`;
  const TABS=[["summary","الملخّص"],["journal","دفتر القيود"],["purchases","مشتريات نيابةً"],
    ["branches","مقارنة الفروع"],["receivables","الذمم (المكاتب والآجل)"],["alerts","التنبيهات"]];
  let cur="summary", data=null;
  const filters=()=>({date_from:$("#af").value,date_to:$("#at").value,branch:$("#ab").value});
  const renderTabs=()=>{
    $("#atabs").innerHTML=TABS.map(([k,l])=>`<button class="tab ${k===cur?'active':''}" data-k="${k}">${l}</button>`).join("");
    $("#atabs").querySelectorAll("button").forEach(b=>b.onclick=()=>{cur=b.dataset.k; renderTabs(); renderBody();});
  };
  const renderBody=()=>{
    const box=$("#atab");
    if(cur==="summary") box.innerHTML=accSummaryHtml(data);
    else if(cur==="journal") return renderJournal(box, filters);
    else if(cur==="purchases") box.innerHTML=accPurchasesHtml(data);
    else if(cur==="branches") box.innerHTML=accTableHtml(
      ["المدينة","الوارد","المصاريف","الصافي"], data.branch_comparison,
      r=>[r.city, money(r.revenue), money(r.expenses), money(r.net)]);
    else if(cur==="receivables") box.innerHTML=accReceivablesHtml(data);
    else if(cur==="alerts") box.innerHTML=accTableHtml(
      ["القيد","الزبون (المستلِم)","التنبيه"], data.alerts, r=>[r.ref_no, r.customer, r.message]);
  };
  const load=async()=>{
    data=await API.get("/api/accounting/summary", filters());
    renderTabs(); renderBody();
  };
  liveFilters(["af","at","ab"], load);
  $("#aclr").onclick=()=>{ ["af","at","ab"].forEach(id=>$("#"+id).value=""); load(); };
  load();
}
function accSummaryHtml(s){
  const K=[["الإيرادات",s.revenue,""],["المصاريف التشغيلية",s.opex,"cod"],
    ["مشتريات (مدفوع)",s.invested,"gold"],["إجمالي المدفوعات",s.total_payments,"cod"],
    ["صافي الربح التشغيلي",s.operating_net,"gold"],["صافي التدفق النقدي",s.cash_net,""],
    ["النقد المحصَّل",s.cash_collected,"cash"],["ذمم مكاتب الوجهة",s.receivables,"cod"],
    ["ذمم آجلة (على المرسلين)",s.sender_debt,"cod"],["إجمالي الذمم المدينة",s.total_receivables,"gold"],
    ["المسترد من المشتريات",s.recovered,""],["لم يُسترد بعد",s.not_recovered,"cod"]];
  const kpis=K.map(([l,val,c])=>`<div class="kpi ${c}"><div class="label">${l}</div><div class="val">${money(val)}</div></div>`).join("");
  const cats=wrapTable(`<table><thead><tr><th>البند</th><th>المبلغ</th></tr></thead><tbody>${
      Object.entries(s.expenses_by_category).map(([k,val])=>`<tr><td>${k}</td><td>${money(val)}</td></tr>`).join("")}</tbody></table>`);
  return `<div class="card"><div class="kpis">${kpis}</div></div><div class="card"><h3>المصاريف حسب البند</h3>${cats}</div>`;
}
function accTableHtml(headers, rows, mapRow){
  if(!rows || !rows.length) return `<div class="card">${empty("لا توجد بيانات ضمن الفلتر الحالي")}</div>`;
  return `<div class="card">${wrapTable(`<table><thead><tr>${headers.map(h=>`<th>${h}</th>`).join("")}</tr></thead>
    <tbody>${rows.map(r=>`<tr>${mapRow(r).map(c=>`<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table>`)}</div>`;
}
// الذمم: على مكاتب الوجهة (ضد الدفع) + على المرسلين (آجل) — جهتان مختلفتان
function accReceivablesHtml(s){
  const office = accTableHtml(
    ["المكتب","المستحق ضد الدفع","المحصَّل فعلياً","المتبقي"], s.receivables_by_office,
    r=>[r.city, money(r.cod_due), money(r.collected), money(r.remaining)]);
  const sender = accTableHtml(
    ["المرسِل (صاحب الذمة)","عدد الشحنات","أرقام القيود","المبلغ الآجل"],
    s.deferred_by_sender,
    r=>[`<b>${r.sender}</b>`, r.count, `<span class="mini">${r.refs}</span>`, money(r.amount)]);
  const totals = `<div class="kpis" style="margin-bottom:14px">
      <div class="kpi cod"><div class="label">ذمم على مكاتب الوجهة</div>
        <div class="val">${money(s.receivables)}</div></div>
      <div class="kpi cod"><div class="label">ذمم آجلة على المرسلين</div>
        <div class="val">${money(s.deferred_total)}</div></div>
      <div class="kpi gold"><div class="label">إجمالي الذمم المدينة</div>
        <div class="val">${money(s.total_receivables)}</div></div>
    </div>`;
  return `${totals}
    <h3 class="sub">أولاً: الذمم حسب مكتب الوجهة (ضد الدفع)</h3>${office}
    <h3 class="sub">ثانياً: الذمم الآجلة — على المرسِل لا على المكتب</h3>
    <p class="hint">شحنات حالتها «آجل»: المبلغ دَين على المرسِل نفسه، ولا يُحمَّل على مكتب الوجهة.</p>
    ${sender}`;
}
function accPurchasesHtml(s){
  // عمود المرسِل يوضّح مَن تُطالَب منه الذمة عندما تكون حالة التحصيل «آجل»
  const detail = accTableHtml(
    ["القيد","التاريخ","الزبون (المستلِم)","المرسِل (المُطالَب عند آجل)","من قام بالشراء",
     "المبلغ","العمولة","حالة التحصيل","ذمة آجلة","الوجهة"],
    s.purchases_detail, r=>[r.ref_no, r.ship_date, r.customer,
                            r.sender||"-", r.bought_by||"-", money(r.amount), money(r.commission),
                            r.collection_status===DEFERRED
                              ? `<span class="badge warn">${r.collection_status}</span>`
                              : r.collection_status,
                            r.sender_debt ? money(r.sender_debt) : "-", r.destination]);
  const byEmp = accTableHtml(
    ["الموظف","عدد العمليات","مبلغ الشراء","العمولة المحقّقة"],
    s.purchases_by_employee, r=>[r.bought_by, r.count, money(r.amount), money(r.commission)]);
  return `<h3 class="sub">حسب الزبون</h3>${detail}<h3 class="sub">حسب الموظف</h3>${byEmp}`;
}
async function renderJournal(box, filters){
  box.innerHTML=`<div class="card"><h3>إضافة قيد يدوي</h3>
    <form class="grid" id="jf">
      <label>التاريخ<input type="date" name="entry_date" required></label>
      <label>الفرع<select name="branch">${opts(CITIES)}</select></label>
      <label>النوع<select name="kind"><option>مصروف</option><option>إيراد</option></select></label>
      <label>البند<select name="category">${opts(EXPENSE_CATS)}</select></label>
      <label>الوصف<input name="description"></label>
      <label>المبلغ ($)<input type="number" step="0.01" name="amount" required></label>
      <label>طريقة الدفع<input name="payment_method"></label>
      <label>المسؤول<input name="responsible"></label>
      <label>ملاحظات<input name="notes"></label>
      <div style="grid-column:1/-1"><button class="primary">إضافة</button></div>
    </form></div>
    <div class="card"><h3>القيود</h3><div id="jl"></div></div>`;
  const load=async()=>{
    const rows=await API.get("/api/accounting/journal");
    $("#jl").innerHTML = rows.length ? wrapTable(`<table><thead><tr>
      <th>التاريخ</th><th>الفرع</th><th>النوع</th><th>البند</th><th>الوصف</th><th>المبلغ</th><th></th>
      </tr></thead><tbody>${rows.map(r=>`<tr>
        <td>${r.entry_date}</td><td>${r.branch||"-"}</td><td>${r.kind}</td><td>${r.category||"-"}</td>
        <td>${r.description||"-"}</td><td>${money(r.amount)}</td>
        <td><button class="sm" data-del="${r.id}">حذف</button></td>
      </tr>`).join("")}</tbody></table>`) : empty("لا توجد قيود بعد");
    $("#jl").querySelectorAll("[data-del]").forEach(b=>b.onclick=async()=>{
      if(!confirm("حذف هذا القيد؟")) return;
      await API.del("/api/accounting/journal/"+b.dataset.del); load();
    });
  };
  $("#jf").addEventListener("submit",async e=>{
    e.preventDefault(); const fd=Object.fromEntries(new FormData(e.target));
    fd.amount=Number(fd.amount||0);
    try{ await API.post("/api/accounting/journal", fd); toast("تمت إضافة القيد"); e.target.reset(); load(); }
    catch(err){ toast(err.message, true); }
  });
  load();
}

// ============ حسابات محمود — نظام محاسبي مستقل قائم على دفتر أستاذ ============
// المبدأ: لا يُعدَّل رصيد يدوياً. الرصيد = الاستحقاقات − (الدفعات + المصاريف).
const BOX_TYPES=["مكتب","زبون","مخلص سوري","مخلص عراقي","أخرى"];
const TXN_CHARGE="استحقاق", TXN_PAYMENT="دفعة", TXN_EXPENSE="مصروف";
const TXN_TYPES=[TXN_CHARGE,TXN_PAYMENT,TXN_EXPENSE];
const CHARGE_REASONS=["شحنة","عمولة","إيراد","تسوية","أخرى"];
const txnBadge=t=>({[TXN_CHARGE]:'<span class="badge pend">استحقاق ▲</span>',
  [TXN_PAYMENT]:'<span class="badge done">دفعة ▼</span>',
  [TXN_EXPENSE]:'<span class="badge info">مصروف ▼</span>'}[t]||t);
// رصيد ملوّن: موجب = مستحق علينا تحصيله، سالب = رصيد دائن
const bal=v=>`<b class="${v>0.01?'neg':(v<-0.01?'pos':'')}">${money(v)}</b>`;

// initialTab: تبويب البداية — يُستخدم عند الرجوع من كشف الحساب أو نموذج العملية
async function vMahmoud(initialTab){
  const v=$("#view");
  v.innerHTML=`<h1>حسابات محمود</h1>
    <p class="hint">نظام محاسبي <b>مستقل ويدوي بالكامل</b>. الرصيد لا يُعدَّل يدوياً —
      يُحسب دائماً: <b>الاستحقاقات − (الدفعات + المصاريف)</b>.
      كل عملية تُسجَّل في دفتر الأستاذ — يمكن إلغاؤها (يبقى أثرها للمراجعة)
      أو حذفها نهائياً من كشف الحساب.</p>
    <div class="card no-print"><div class="filters">
      <label>من تاريخ<input type="date" id="mdf"></label>
      <label>إلى تاريخ<input type="date" id="mdt"></label>
      <button class="sm" id="mclr">كل الفترات</button>
    </div></div>
    <div class="tabs" id="mtabs"></div>
    <div id="mtab"></div>`;
  const TABS=[["summary","الملخّص"],["parties","الجهات والأرصدة"],["entry","تسجيل عملية"],
              ["revenues","إيرادات الشحنات"],["ledger","سجل العمليات"],["customs","مقارنة الجمارك"]];
  let cur=TABS.some(([k])=>k===initialTab) ? initialTab : "summary";
  const period=()=>({date_from:$("#mdf").value, date_to:$("#mdt").value});
  const renderTabs=()=>{
    $("#mtabs").innerHTML=TABS.map(([k,l])=>
      `<button class="tab ${k===cur?'active':''}" data-k="${k}">${l}</button>`).join("");
    $("#mtabs").querySelectorAll("button").forEach(b=>b.onclick=()=>{
      cur=b.dataset.k; renderTabs(); body();
    });
  };
  const go=tab=>{ cur=tab; renderTabs(); body(); };
  const body=async()=>{
    const box=$("#mtab");
    box.innerHTML=`<div class="loading"><div class="spinner"></div></div>`;
    try{
      if(cur==="summary")      await mSummary(box, period(), go);
      else if(cur==="parties") await mParties(box, period(), body, go);
      else if(cur==="entry")   await mEntryForm(box, body, go);
      else if(cur==="revenues")await mRevenues(box, period());
      else if(cur==="ledger")  await mLedger(box, period(), body);
      else                     await mCustoms(box, body);
    }catch(err){ box.innerHTML=`<div class="card">${empty(err.message)}</div>`; }
  };
  liveFilters(["mdf","mdt"], body);
  $("#mclr").onclick=()=>{ $("#mdf").value=""; $("#mdt").value=""; body(); };
  renderTabs(); body();
}

// ----------------------------- الملخّص -----------------------------
async function mSummary(box, period, go){
  const s=await API.get("/api/mahmoud/summary", period);
  const K=[["إجمالي الاستحقاقات",s.charges,""],["إجمالي الدفعات المستلمة",s.payments,"cash"],
    ["إجمالي المصاريف",s.expenses,"cash"],["صافي المسدَّد (دفعات+مصاريف)",s.settled,""],
    ["الرصيد المتبقي",s.balance,"gold"]];
  const kpis=K.map(([l,val,c])=>
    `<div class="kpi ${c}"><div class="label">${l}</div><div class="val">${money(val)}</div></div>`).join("");
  const types=s.by_type.length ? wrapTable(`<table><thead><tr>
      <th>النوع</th><th>استحقاقات</th><th>دفعات</th><th>مصاريف</th><th>المتبقي</th>
    </tr></thead><tbody>${s.by_type.map(t=>`<tr><td><b>${t.type}</b></td>
      <td>${money(t.charges)}</td><td>${money(t.payments)}</td><td>${money(t.expenses)}</td>
      <td>${bal(t.balance)}</td></tr>`).join("")}</tbody></table>`) : empty("لا توجد بيانات");
  const reasons=s.by_reason.length ? wrapTable(`<table><thead><tr>
      <th>السبب / البند</th><th>عدد</th><th>استحقاقات</th><th>دفعات</th><th>مصاريف</th>
    </tr></thead><tbody>${s.by_reason.map(r=>`<tr><td>${r.reason}</td><td>${r.count}</td>
      <td>${money(r.charges)}</td><td>${money(r.payments)}</td><td>${money(r.expenses)}</td>
      </tr>`).join("")}</tbody></table>`) : empty("لا توجد حركات ضمن الفترة");
  const dues=s.outstanding.filter(o=>o.balance>0.01);
  const creds=s.outstanding.filter(o=>o.balance<-0.01);
  const list=(arr,cls)=>arr.length?wrapTable(`<table><thead><tr><th>الجهة</th><th>النوع</th>
      <th>الرصيد</th><th></th></tr></thead><tbody>${arr.map(o=>`<tr>
      <td><b>${o.name}</b></td><td>${o.type}</td><td class="${cls}"><b>${money(Math.abs(o.balance))}</b></td>
      <td><button class="sm" data-open="${o.id}">كشف الحساب</button></td></tr>`).join("")}
      </tbody></table>`):empty("لا يوجد");
  box.innerHTML=`<div class="card"><div class="kpis">${kpis}</div>
      <p class="hint">${s.parties_count} جهة · ${s.txn_count} عملية ضمن الفترة ·
        إجمالي المستحق للتحصيل <b class="neg">${money(s.outstanding_total)}</b>
        ${s.credit_total?` · رصيد دائن <b class="pos">${money(s.credit_total)}</b>`:""}</p></div>
    <div class="card"><h3>💰 جهات عليها مستحقات (بحاجة تحصيل)</h3>${list(dues,"neg")}</div>
    ${creds.length?`<div class="card"><h3>↩ جهات لها رصيد دائن</h3>${list(creds,"pos")}</div>`:""}
    <div class="card"><h3>حسب نوع الجهة</h3>${types}</div>
    <div class="card"><h3>حسب السبب / البند</h3>${reasons}</div>`;
  box.querySelectorAll("[data-open]").forEach(b=>b.onclick=()=>
    mStatement(Number(b.dataset.open), "summary"));
}

// ------------------------ الجهات والأرصدة ------------------------
async function mParties(box, period, reload, go){
  const rows=await API.get("/api/mahmoud/parties", period);
  box.innerHTML=`<div class="card"><h3>إضافة جهة</h3>
      <form class="filters" id="pf">
        <label>الاسم<input name="name" required placeholder="مثال: مكتب بغداد"></label>
        <label>النوع<select name="box_type">${opts(BOX_TYPES)}</select></label>
        <label>رصيد افتتاحي ($)<input type="number" step="0.01" name="opening_balance" value="0"
          placeholder="يُسجَّل كقيد افتتاحي"></label>
        <label>ملاحظات<input name="notes"></label>
        <button class="primary">إضافة</button>
      </form>
      <p class="hint">الرصيد الافتتاحي يتحوّل إلى قيد شفّاف في دفتر الأستاذ — لا يُخزَّن كرقم يدوي.</p></div>
    <div class="card"><h3>الجهات وأرصدتها</h3><div id="pl"></div></div>`;

  const grouped={};
  rows.forEach(r=>(grouped[r.box_type]=grouped[r.box_type]||[]).push(r));
  $("#pl").innerHTML = rows.length ? Object.entries(grouped).map(([type,list])=>`
      <h3 class="sub">${type} <span class="count-badge">${list.length}</span></h3>
      ${wrapTable(`<table><thead><tr>
        <th>الجهة</th><th>المطلوب</th><th>المدفوع</th><th>المصاريف</th><th>المتبقي</th>
        <th>آخر دفعة</th><th>تاريخها</th><th>عدد الدفعات</th><th>الحالة</th><th>إجراءات</th>
      </tr></thead><tbody>${list.map(p=>`<tr data-row="${p.id}">
        <td><b>${p.name}</b>${p.notes?`<div class="mini">${p.notes}</div>`:''}
          ${p.allow_credit?'<div class="mini">يسمح برصيد دائن</div>':''}</td>
        <td>${money(p.charges)}</td><td>${money(p.payments)}</td><td>${money(p.expenses)}</td>
        <td>${bal(p.balance)}</td>
        <td>${p.last_payment?money(p.last_payment):"-"}</td>
        <td class="nowrap">${p.last_payment_date||"-"}</td>
        <td>${p.payments_count}</td>
        <td>${p.is_settled?'<span class="badge done">مسدَّد</span>'
             :(p.is_credit?'<span class="badge info">دائن</span>':'<span class="badge pend">مستحق</span>')}
          ${p.is_active?'':'<div class="mini">موقوفة</div>'}</td>
        <td class="nowrap"><button class="sm primary" data-stmt="${p.id}">كشف الحساب</button>
          <button class="sm" data-edit="${p.id}">تعديل</button>
          <button class="sm danger" data-del="${p.id}">حذف</button></td>
      </tr>`).join("")}</tbody></table>`)}`).join("") : empty("لا توجد جهات — أضف جهة للبدء");

  $("#pf").addEventListener("submit",async e=>{
    e.preventDefault();
    const fd=Object.fromEntries(new FormData(e.target));
    fd.opening_balance=Number(fd.opening_balance||0);
    try{ await API.post("/api/mahmoud/parties",fd); toast("تمت إضافة الجهة"); reload(); }
    catch(err){ toast(err.message, true); }
  });
  $("#pl").querySelectorAll("[data-stmt]").forEach(b=>b.onclick=()=>
    mStatement(Number(b.dataset.stmt), "parties"));
  $("#pl").querySelectorAll("[data-del]").forEach(b=>b.onclick=async()=>{
    if(!confirm("حذف هذه الجهة؟")) return;
    try{ await API.del("/api/mahmoud/parties/"+b.dataset.del); toast("تم الحذف"); reload(); }
    catch(err){ toast(err.message, true); }
  });
  $("#pl").querySelectorAll("[data-edit]").forEach(btn=>btn.onclick=()=>{
    const p=rows.find(x=>String(x.id)===btn.dataset.edit); if(!p) return;
    const tr=$("#pl").querySelector(`tr[data-row="${p.id}"]`);
    tr.innerHTML=`<td><input class="cell-in" data-f="name" value="${escAttr(p.name)}"></td>
      <td colspan="3"><select class="cell-in" data-f="box_type">${opts(BOX_TYPES,p.box_type)}</select></td>
      <td colspan="3"><input class="cell-in" data-f="notes" value="${escAttr(p.notes)}" placeholder="ملاحظات"></td>
      <td><select class="cell-in" data-f="allow_credit">
        <option value="0" ${!p.allow_credit?'selected':''}>لا رصيد دائن</option>
        <option value="1" ${p.allow_credit?'selected':''}>يسمح بدائن</option></select></td>
      <td><select class="cell-in" data-f="is_active">
        <option value="1" ${p.is_active?'selected':''}>نشطة</option>
        <option value="0" ${!p.is_active?'selected':''}>موقوفة</option></select></td>
      <td class="nowrap"><button class="sm primary" data-save>حفظ</button>
        <button class="sm" data-cancel>إلغاء</button></td>`;
    tr.querySelector("[data-cancel]").onclick=reload;
    tr.querySelector("[data-save]").onclick=async()=>{
      const patch={};
      tr.querySelectorAll(".cell-in").forEach(i=>patch[i.dataset.f]=i.value);
      patch.is_active = patch.is_active==="1";
      patch.allow_credit = patch.allow_credit==="1";
      try{ await API.put("/api/mahmoud/parties/"+p.id, patch); toast("تم التعديل"); reload(); }
      catch(err){ toast(err.message, true); }
    };
  });
}

// ------------------- كشف حساب جهة (نافذة كاملة) -------------------
async function mStatement(pid, fromTab){
  const v=$("#view");
  v.innerHTML=`<div class="loading"><div class="spinner"></div></div>`;
  const d=await API.get(`/api/mahmoud/parties/${pid}/statement`);
  const p=d.party, t=d.totals;
  const K=[["إجمالي المطلوب",t.charges,""],["إجمالي المدفوع",t.payments,"cash"],
    ["إجمالي المصاريف",t.expenses,"cash"],["الرصيد المتبقي",t.balance,"gold"]];
  v.innerHTML=`<h1>كشف حساب: ${p.name}</h1>
    <div class="card no-print"><div class="btn-row">
      <button class="sm" id="back">← رجوع</button>
      <button class="sm" id="pr">🖨 طباعة</button>
      <button class="sm" id="xl">⬇ تصدير Excel</button>
      <button class="primary" id="newTxn">＋ تسجيل عملية لهذه الجهة</button>
    </div></div>
    <div class="only-print">${brandHead()}</div>
    <div class="card"><h3>${p.name} <span class="count-badge">${p.box_type}</span></h3>
      <div class="kpis">${K.map(([l,val,c])=>
        `<div class="kpi ${c}"><div class="label">${l}</div><div class="val">${money(val)}</div></div>`).join("")}
        <div class="kpi"><div class="label">عدد الدفعات</div><div class="val">${t.payments_count}</div></div>
        <div class="kpi"><div class="label">آخر دفعة</div><div class="val">${t.last_payment?money(t.last_payment):"—"}</div>
          ${t.last_payment_date?`<div class="mini">${t.last_payment_date}</div>`:""}</div>
      </div>
      <p class="hint">الرصيد = الاستحقاقات (${money(t.charges)}) −
        [الدفعات (${money(t.payments)}) + المصاريف (${money(t.expenses)})] =
        <b>${money(t.balance)}</b></p></div>
    ${["مكتب","زبون"].includes(p.box_type)?`<div class="card no-print">
      <h3>⚡ الاستحقاقات التلقائية من الشحنات الصادرة</h3>
      <div id="ac"><div class="loading"><div class="spinner"></div></div></div></div>`:""}
    <div class="card"><h3>كشف الحساب مرتّباً بالتاريخ</h3><div id="lg"></div></div>`;

  $("#back").onclick=()=>vMahmoud(fromTab||"parties");
  $("#pr").onclick=()=>printDoc("portrait");
  $("#newTxn").onclick=()=>mTxnDialog(pid, p.name, ()=>mStatement(pid, fromTab));
  $("#xl").onclick=()=>exportXlsx([
      ["txn_date","التاريخ",r=>r.txn_date],["created_at_time","الوقت",r=>r.created_at_time],
      ["id","رقم العملية",r=>r.id],["txn_type","نوع الحركة",r=>r.txn_type],
      ["reason","السبب/البند",r=>r.reason||"-"],["description","التفاصيل",r=>r.description||"-"],
      ["amount","القيمة",r=>r.amount],
      ["balance_before","الرصيد قبل",r=>r.balance_before??""],
      ["balance_after","الرصيد بعد",r=>r.balance_after??""],
      ["created_by","المستخدم",r=>r.created_by||"-"],["notes","ملاحظات",r=>r.notes||"-"],
    ], d.ledger, "mstmt", `كشف حساب ${p.name}`);

  $("#lg").innerHTML = d.ledger.length ? wrapTable(`<table><thead><tr>
      <th>التاريخ</th><th>الوقت</th><th>رقم</th><th>نوع الحركة</th><th>السبب/البند</th>
      <th>التفاصيل</th><th>القيمة</th><th>الرصيد قبل</th><th>الرصيد بعد</th>
      <th>المستخدم</th><th>ملاحظات</th><th class="no-print"></th>
    </tr></thead><tbody>${d.ledger.map(r=>`<tr class="${r.is_void?'void-row':''}">
      <td class="nowrap">${r.txn_date}</td><td class="mini">${r.created_at_time}</td>
      <td>${r.id}</td><td class="nowrap">${txnBadge(r.txn_type)}</td>
      <td>${r.reason||"-"}</td><td>${r.description||"-"}</td>
      <td><b>${r.signed_amount>0?"+":""}${money(r.signed_amount)}</b></td>
      <td>${r.is_void?"—":money(r.balance_before)}</td>
      <td>${r.is_void?"—":`<b>${money(r.balance_after)}</b>`}</td>
      <td class="mini">${r.created_by||"-"}</td>
      <td>${r.notes||"-"}${r.is_void?`<div class="mini">ملغاة: ${r.void_reason||"—"} (${r.voided_by||""})</div>`:""}
        ${r.edited_count?`<div class="mini">عُدِّلت ${r.edited_count} مرة</div>`:""}</td>
      <td class="no-print nowrap">${r.is_void
        ?`<span class="badge pend">ملغاة</span>
          <button class="sm danger" data-hdel="${r.id}">🗑 حذف</button>`
        :`<button class="sm" data-edit="${r.id}">تعديل</button>
          <button class="sm danger" data-void="${r.id}">إلغاء</button>
          <button class="sm danger" data-hdel="${r.id}">🗑 حذف</button>`}</td>
    </tr>`).join("")}</tbody></table>`) : empty("لا توجد حركات بعد");

  $("#lg").querySelectorAll("[data-void]").forEach(b=>b.onclick=async()=>{
    const reason=prompt("سبب الإلغاء (اختياري):","");
    if(reason===null) return;
    try{ await API.post(`/api/mahmoud/txn/${b.dataset.void}/void`,{reason});
      toast("أُلغي القيد — بقي في الكشف للمراجعة"); mStatement(pid, fromTab);
    }catch(err){ toast(err.message, true); }
  });
  $("#lg").querySelectorAll("[data-edit]").forEach(b=>b.onclick=()=>{
    const r=d.ledger.find(x=>String(x.id)===b.dataset.edit);
    mTxnDialog(pid, p.name, ()=>mStatement(pid, fromTab), r);
  });
  // حذف نهائي — يختفي القيد من الكشف تماماً (بخلاف الإلغاء الذي يُبقي أثره)
  $("#lg").querySelectorAll("[data-hdel]").forEach(b=>b.onclick=async()=>{
    if(!confirm("حذف نهائي: سيختفي القيد من الكشف تماماً ولا يمكن التراجع. متابعة؟")) return;
    try{ await API.del("/api/mahmoud/txn/"+b.dataset.hdel);
      toast("حُذف القيد نهائياً"); mStatement(pid, fromTab);
    }catch(err){ toast(err.message, true); }
  });
  if(["مكتب","زبون"].includes(p.box_type))
    loadAutoCharges(pid, ()=>mStatement(pid, fromTab));
}

// --------- الاستحقاقات التلقائية من الشحنات الصادرة (داخل كشف الحساب) ---------
// مكتب: ضد الدفع للأجور + ثمن البضاعة والعمولة غير المحصَّلة (شحنات وجهتها اسم المكتب).
// زبون: الآجل للأجور + ثمن البضاعة والعمولة الآجلة (شحنات مرسِلها اسم الزبون).
async function loadAutoCharges(pid, refresh){
  const box=$("#ac"); if(!box) return;
  try{
    const d=await API.get("/api/mahmoud/auto-charges",{party_id:pid});
    if(!d.rows.length){
      box.innerHTML=`<p class="hint">${d.rule}.</p>
        ${empty("لا توجد استحقاقات محسوبة من الشحنات الصادرة لهذه الجهة")}`;
      return;
    }
    box.innerHTML=`<p class="hint">${d.rule}. كل استحقاق منسوب لتاريخ شحنته الصادرة،
        والقيمة تُحسب من النظام الأساسي ولا تُسجَّل مرتين.</p>`
      +wrapTable(`<table><thead><tr>
        <th>تاريخ الشحنة الصادرة</th><th>عدد الشحنات</th><th>أرقام القيود</th>
        <th>قيمة الاستحقاق</th><th>الحالة</th><th></th></tr></thead>
      <tbody>${d.rows.map(r=>`<tr>
        <td class="nowrap"><b>${r.export_date}</b></td><td>${r.count}</td>
        <td class="mini">${r.refs}</td><td><b>${money(r.amount)}</b></td>
        <td>${r.registered?'<span class="badge done">مسجَّل</span>'
                          :'<span class="badge pend">غير مسجَّل</span>'}</td>
        <td>${r.registered?"":`<button class="sm primary" data-reg="${r.export_date}">＋ تسجيل الاستحقاق</button>`}</td>
      </tr>`).join("")}</tbody></table>`);
    box.querySelectorAll("[data-reg]").forEach(b=>b.onclick=async()=>{
      if(!confirm(`تسجيل استحقاق الشحنة الصادرة بتاريخ ${b.dataset.reg}؟`)) return;
      try{
        const r=await API.post("/api/mahmoud/auto-charges",{party_id:pid, export_date:b.dataset.reg});
        toast(`سُجِّل الاستحقاق — الرصيد الجديد ${money(r.party_balance)}`); refresh();
      }catch(err){ toast(err.message, true); }
    });
  }catch(err){ box.innerHTML=empty(err.message); }
}

// ------------- إيرادات الشحنات الصادرة (الإجمالي − حمزة − ماجد) -------------
async function mRevenues(box, period){
  const d=await API.get("/api/mahmoud/export-revenues", period);
  const t=d.totals;
  box.innerHTML=`<div class="card"><h3>إيرادات الشحنات الصادرة</h3>
    <p class="hint">لكل شحنة صادرة (بتاريخ تصديرها): <b>الإجمالي</b> = أجور الشحن والجمركة +
      ثمن البضاعة والعمولة — يُجلب تلقائياً من النظام الأساسي.
      و<b>الإيراد</b> = الإجمالي − مصرف حمزة − مصرف ماجد (حقلان يدويان).</p>
    <div class="kpis" style="margin-bottom:12px">
      <div class="kpi"><div class="label">إجمالي الشحنات الصادرة</div><div class="val">${money(t.total)}</div></div>
      <div class="kpi cash"><div class="label">مجموع مصرف حمزة</div><div class="val">${money(t.hamza)}</div></div>
      <div class="kpi cash"><div class="label">مجموع مصرف ماجد</div><div class="val">${money(t.majed)}</div></div>
      <div class="kpi gold"><div class="label">صافي الإيراد</div><div class="val">${money(t.revenue)}</div></div>
    </div><div id="rv"></div></div>`;
  if(!d.rows.length){
    $("#rv").innerHTML=empty("لا توجد شحنات صادرة ضمن الفترة المحددة"); return;
  }
  $("#rv").innerHTML=wrapTable(`<table><thead><tr>
      <th>تاريخ الشحنة الصادرة</th><th>عدد الشحنات</th><th>أجور الشحن والجمركة</th>
      <th>ثمن البضاعة + العمولة</th><th>الإجمالي</th>
      <th>مصرف حمزة</th><th>مصرف ماجد</th><th>الإيراد</th><th></th></tr></thead>
    <tbody>${d.rows.map(r=>`<tr data-d="${r.export_date}">
      <td class="nowrap"><b>${r.export_date}</b></td><td>${r.count}</td>
      <td>${money(r.fees_total)}</td><td>${money(r.goods_with_comm)}</td>
      <td><b>${money(r.total)}</b></td>
      <td><input class="cell-in" type="number" step="0.01" min="0" data-h
        value="${r.hamza_expense||""}" placeholder="0"></td>
      <td><input class="cell-in" type="number" step="0.01" min="0" data-m
        value="${r.majed_expense||""}" placeholder="0"></td>
      <td data-rev><b class="${r.revenue<0?'neg':''}">${money(r.revenue)}</b></td>
      <td><button class="sm primary" data-save>حفظ</button></td>
    </tr>`).join("")}</tbody></table>`);
  $("#rv").querySelectorAll("tr[data-d]").forEach(tr=>{
    const r=d.rows.find(x=>x.export_date===tr.dataset.d); if(!r) return;
    const h=tr.querySelector("[data-h]"), m=tr.querySelector("[data-m]");
    // الإيراد يتحدّث فوراً أثناء الكتابة قبل الحفظ
    const upd=()=>{
      const rev=r.total-(Number(h.value)||0)-(Number(m.value)||0);
      tr.querySelector("[data-rev]").innerHTML=`<b class="${rev<0?'neg':''}">${money(rev)}</b>`;
    };
    h.oninput=upd; m.oninput=upd;
    tr.querySelector("[data-save]").onclick=async()=>{
      try{
        await API.put("/api/mahmoud/export-revenues/"+r.export_date,
          {hamza_expense:Number(h.value)||0, majed_expense:Number(m.value)||0});
        r.hamza_expense=Number(h.value)||0; r.majed_expense=Number(m.value)||0;
        toast(`تم حفظ مصرفي شحنة ${r.export_date}`);
      }catch(err){ toast(err.message, true); }
    };
  });
}

// --------------- نافذة تسجيل/تعديل عملية (حوار) ---------------
async function mTxnDialog(pid, pname, done, existing){
  const isEdit=!!existing;
  const v=$("#view");
  const parties = pid ? null : await API.get("/api/mahmoud/parties");
  // novalidate: نتحقّق بأنفسنا برسائل عربية واضحة بدل نوافذ المتصفح.
  // المبلغ وحده إلزامي — وبقية الحقول اختيارية تماماً.
  v.innerHTML=`<h1>${isEdit?`تعديل العملية رقم ${existing.id}`:"تسجيل عملية"}</h1>
    <div class="card"><form class="grid" id="tf" novalidate>
      ${pid?`<label>الجهة<input value="${escAttr(pname)}" readonly class="derived"></label>`
           :`<label>الجهة<select name="party_id" id="pp">${
              parties.map(p=>`<option value="${p.id}">${p.name} — ${p.box_type} (متبقٍ ${money(p.balance)})</option>`).join("")
             }</select></label>`}
      <label>نوع العملية<select name="txn_type" id="tt" ${isEdit?'disabled':''}>
        ${opts(TXN_TYPES, existing?existing.txn_type:TXN_CHARGE)}</select></label>
      <label>التاريخ<input type="date" name="txn_date" id="td"
        value="${existing?existing.txn_date:today()}"></label>
      <label>المبلغ ($) <span class="req">*</span><input type="number" step="0.01" name="amount" id="am"
        value="${existing?existing.amount:""}" autofocus></label>
      <label id="reasonWrap">السبب / البند <span class="opt">(اختياري)</span>
        <input name="reason" list="mreasons" value="${existing?escAttr(existing.reason):""}"
          placeholder="شحنة / عمولة / إيراد / تسوية..."></label>
      <datalist id="mreasons">${CHARGE_REASONS.map(r=>`<option value="${r}">`).join("")}</datalist>
      <label>التفاصيل <span class="opt">(اختياري)</span>
        <input name="description" value="${existing?escAttr(existing.description):""}"></label>
      <label>طريقة الدفع <span class="opt">(اختياري)</span>
        <input name="payment_method" value="${existing?escAttr(existing.payment_method):""}"></label>
      <label>رقم مرجعي — وصل <span class="opt">(اختياري)</span>
        <input name="ref_no" value="${existing?escAttr(existing.ref_no):""}"></label>
      <label>ملاحظات <span class="opt">(اختياري)</span>
        <input name="notes" value="${existing?escAttr(existing.notes):""}"></label>
      <div style="grid-column:1/-1" class="btn-row">
        <button class="primary" type="submit">${isEdit?"حفظ التعديل":"حفظ العملية"}</button>
        <button class="sm" type="button" id="cancel">← رجوع</button></div>
    </form>
    <p class="hint">الحقول المعلّمة بـ <span class="req">*</span> إلزامية فقط، والبقية اختيارية.</p>
    <p class="hint" id="effect"></p></div>`;

  const effect=()=>{
    const t=$("#tt").value;
    $("#effect").innerHTML = t===TXN_CHARGE
      ? "▲ <b>استحقاق</b>: يزيد المبلغ المطلوب من هذه الجهة (شحنة، عمولة، إيراد، تسوية...)."
      : (t===TXN_PAYMENT
        ? "▼ <b>دفعة</b>: نقد استلمه المحاسب من الجهة — يُنقص المستحق عليها."
        : "▼ <b>مصروف</b>: أنفقته الجهة نيابةً عن الشركة — يُعامَل كسداد غير نقدي فيُنقص المستحق.");
    $("#reasonWrap").querySelector("input").placeholder =
      t===TXN_CHARGE ? "شحنة / عمولة / إيراد / تسوية..." : "بند المصروف أو ملاحظة الدفعة";
  };
  $("#tt").onchange=effect; effect();
  $("#cancel").onclick=done;
  $("#tf").addEventListener("submit",async e=>{
    e.preventDefault();
    const fd=Object.fromEntries(new FormData(e.target));
    fd.amount=Number(fd.amount||0);
    if(!(fd.amount>0)){                       // التحقق الوحيد الإلزامي
      toast("أدخل المبلغ (أكبر من صفر)", true); $("#am").focus(); return;
    }
    if(!fd.txn_date) fd.txn_date=today();     // التاريخ يُملأ تلقائياً إن تُرك فارغاً
    const btn=e.target.querySelector('button[type="submit"]');
    btn.disabled=true;                        // منع الحفظ المزدوج بنقرتين سريعتين
    try{
      if(isEdit){ await API.put(`/api/mahmoud/txn/${existing.id}`, fd); toast("تم حفظ التعديل"); }
      else{
        fd.party_id = pid || Number(fd.party_id);
        fd.txn_type = $("#tt").value;
        const r=await API.post("/api/mahmoud/txn", fd);
        toast(`تم التسجيل — الرصيد الجديد ${money(r.party_balance)}`);
      }
      done();                                 // العودة للواجهة السابقة
    }catch(err){ toast(err.message, true); btn.disabled=false; }
  });
}

// ------------------ تبويب تسجيل عملية (اختيار الجهة) ------------------
async function mEntryForm(box, reload, go){
  const parties=await API.get("/api/mahmoud/parties");
  if(!parties.length){ box.innerHTML=`<div class="card">${empty("أضف جهة أولاً من تبويب «الجهات والأرصدة»")}</div>`; return; }
  box.innerHTML=`<div class="card"><h3>تسجيل عملية جديدة</h3>
      <p class="hint">اختر الجهة ثم نوع العملية. النظام يحدّث الرصيد تلقائياً — لا تعديل يدوي للأرصدة.</p>
      <div id="quick"></div></div>`;
  $("#quick").innerHTML=wrapTable(`<table><thead><tr><th>الجهة</th><th>النوع</th>
      <th>المتبقي</th><th>إجراءات</th></tr></thead><tbody>${parties.map(p=>`<tr>
      <td><b>${p.name}</b></td><td>${p.box_type}</td><td>${bal(p.balance)}</td>
      <td class="nowrap"><button class="sm primary" data-new="${p.id}" data-n="${escAttr(p.name)}">＋ عملية</button>
        <button class="sm" data-stmt="${p.id}">كشف الحساب</button></td></tr>`).join("")}
    </tbody></table>`);
  $("#quick").querySelectorAll("[data-new]").forEach(b=>b.onclick=()=>
    mTxnDialog(Number(b.dataset.new), b.dataset.n, ()=>vMahmoud("entry")));
  $("#quick").querySelectorAll("[data-stmt]").forEach(b=>b.onclick=()=>
    mStatement(Number(b.dataset.stmt), "entry"));
}

// ---------------------- سجل العمليات العام ----------------------
async function mLedger(box, period, reload){
  const parties=await API.get("/api/mahmoud/parties");
  box.innerHTML=`<div class="card no-print"><h3>تصفية سجل العمليات</h3>
      <div class="filters">
        <label>الجهة<select id="lp"><option value="">الكل</option>${
          parties.map(p=>`<option value="${p.id}">${p.name} — ${p.box_type}</option>`).join("")}</select></label>
        <label>نوع الحركة<select id="lt">${optsWithAll(TXN_TYPES)}</select></label>
        <label>المستخدم<input id="lu" placeholder="اسم المستخدم"></label>
        <label>بحث<input id="lq" placeholder="سبب/تفاصيل/مرجع"></label>
        <label class="chk-inline"><input type="checkbox" id="lv" checked> إظهار الملغاة</label>
        <button class="sm" id="lxl">⬇ تصدير Excel</button>
        <button class="sm" id="lpr">🖨 طباعة</button>
      </div></div>
    <div class="only-print">${brandHead()}</div>
    <div class="card"><div id="lout"></div></div>`;
  let shown=[];
  const load=async()=>{
    const d=await API.get("/api/mahmoud/ledger",{...period,
      party_id:$("#lp").value, txn_type:$("#lt").value,
      by_user:$("#lu").value, q:$("#lq").value,
      include_void:$("#lv").checked?"true":"false"});
    shown=d.rows;
    const t=d.totals;
    $("#lout").innerHTML=`<div class="kpis" style="margin-bottom:12px">
        <div class="kpi"><div class="label">استحقاقات</div><div class="val">${money(t.charges)}</div></div>
        <div class="kpi cash"><div class="label">دفعات</div><div class="val">${money(t.payments)}</div></div>
        <div class="kpi cash"><div class="label">مصاريف</div><div class="val">${money(t.expenses)}</div></div>
        <div class="kpi gold"><div class="label">صافي الرصيد</div><div class="val">${money(t.balance)}</div></div>
        <div class="kpi"><div class="label">عدد العمليات</div><div class="val">${d.count}</div></div>
      </div>
      ${d.rows.length ? wrapTable(`<table><thead><tr>
        <th>التاريخ</th><th>الوقت</th><th>رقم</th><th>نوع الحركة</th><th>الجهة</th>
        <th>السبب/البند</th><th>القيمة</th><th>الرصيد قبل</th><th>الرصيد بعد</th>
        <th>المستخدم</th><th>ملاحظات</th>
      </tr></thead><tbody>${d.rows.map(r=>`<tr class="${r.is_void?'void-row':''}">
        <td class="nowrap">${r.txn_date}</td><td class="mini">${r.created_at_time}</td>
        <td>${r.id}</td><td class="nowrap">${txnBadge(r.txn_type)}</td>
        <td><b>${r.party_name}</b></td><td>${r.reason||"-"}</td>
        <td><b>${r.signed_amount>0?"+":""}${money(r.signed_amount)}</b></td>
        <td>${r.is_void?"—":money(r.balance_before)}</td>
        <td>${r.is_void?"—":money(r.balance_after)}</td>
        <td class="mini">${r.created_by||"-"}</td>
        <td>${r.description||r.notes||"-"}${r.is_void?'<div class="mini">ملغاة</div>':""}</td>
      </tr>`).join("")}</tbody></table>`) : empty("لا توجد عمليات مطابقة")}`;
  };
  liveFilters(["lp","lt","lu","lq","lv"], load);
  $("#lpr").onclick=()=>printDoc("landscape");
  $("#lxl").onclick=()=>exportXlsx([
      ["txn_date","التاريخ",r=>r.txn_date],["created_at_time","الوقت",r=>r.created_at_time],
      ["id","رقم العملية",r=>r.id],["txn_type","نوع الحركة",r=>r.txn_type],
      ["party_name","الجهة",r=>r.party_name],["reason","السبب/البند",r=>r.reason||"-"],
      ["description","التفاصيل",r=>r.description||"-"],["signed_amount","القيمة",r=>r.signed_amount],
      ["balance_before","الرصيد قبل",r=>r.balance_before??""],
      ["balance_after","الرصيد بعد",r=>r.balance_after??""],
      ["created_by","المستخدم",r=>r.created_by||"-"],["notes","ملاحظات",r=>r.notes||"-"],
    ], shown, "mledger", "سجل عمليات حسابات محمود");
  load();
}

// ---------- مقارنة الجمارك (كما هي — عرض فقط، لا تعدّل النظام الأساسي) ----------
async function mCustoms(box, reload){
  const rows=await API.get("/api/mahmoud/customs");
  box.innerHTML=`<div class="card"><h3>مقارنة جديدة</h3>
      <p class="hint">أدخل المجاميع اليدوية لفترة، ويعرض النظام بجانبها المجموع الأصلي المحسوب
        من الشحنات للمقارنة. <b>لا يؤثر ذلك على أي بيانات في النظام الأساسي.</b></p>
      <form class="grid" id="cf">
        <label>من تاريخ<input type="date" name="date_from" id="cdf" required></label>
        <label>إلى تاريخ<input type="date" name="date_to" id="cdt" required></label>
        <label>مجموع الرسم السوري (يدوي)<input type="number" step="0.01" name="manual_syrian" required></label>
        <label>مجموع الرسم العراقي (يدوي)<input type="number" step="0.01" name="manual_iraqi" required></label>
        <label>ملاحظات<input name="notes"></label>
        <div style="grid-column:1/-1" class="btn-row">
          <button class="primary">حفظ المقارنة</button>
          <button class="sm" type="button" id="peek">👁 معاينة الأصلي للفترة</button>
        </div>
      </form>
      <div id="peekout"></div></div>
    <div class="card"><h3>المقارنات المحفوظة</h3><div id="cl"></div></div>`;

  const cell=(manual,actual,diff)=>`<td>${money(manual)}</td><td>${money(actual)}</td>
    <td class="${Math.abs(diff)<0.01?'pos':'neg'}"><b>${diff>0?"+":""}${money(diff)}</b></td>`;
  $("#cl").innerHTML = rows.length ? wrapTable(`<table><thead><tr>
      <th>الفترة</th><th>شحنات</th>
      <th>سوري يدوي</th><th>سوري أصلي</th><th>الفرق</th>
      <th>عراقي يدوي</th><th>عراقي أصلي</th><th>الفرق</th>
      <th>الحالة</th><th>ملاحظات</th><th></th></tr></thead>
      <tbody>${rows.map(c=>`<tr>
        <td class="nowrap">${c.date_from} ← ${c.date_to}</td><td>${c.shipments}</td>
        ${cell(c.manual_syrian, c.actual_syrian, c.diff_syrian)}
        ${cell(c.manual_iraqi, c.actual_iraqi, c.diff_iraqi)}
        <td>${c.matched?'<span class="badge done">مطابق</span>'
              :`<span class="badge warn">فرق ${money(c.diff_total)}</span>`}</td>
        <td>${c.notes||"-"}</td>
        <td><button class="sm danger" data-del="${c.id}">حذف</button></td>
      </tr>`).join("")}</tbody></table>`) : empty("لا توجد مقارنات محفوظة");
  $("#cl").querySelectorAll("[data-del]").forEach(b=>b.onclick=async()=>{
    if(!confirm("حذف هذه المقارنة؟")) return;
    try{ await API.del("/api/mahmoud/customs/"+b.dataset.del); toast("تم الحذف"); reload(); }
    catch(err){ toast(err.message, true); }
  });
  $("#peek").onclick=async()=>{
    const f=$("#cdf").value, t=$("#cdt").value;
    if(!f||!t){ toast("حدّد الفترة أولاً", true); return; }
    try{
      const a=await API.get("/api/mahmoud/customs/actual",{date_from:f, date_to:t});
      $("#peekout").innerHTML=`<div class="kpis" style="margin-top:12px">
        <div class="kpi"><div class="label">الرسم السوري الأصلي</div><div class="val">${money(a.syrian)}</div></div>
        <div class="kpi"><div class="label">الرسم العراقي الأصلي</div><div class="val">${money(a.iraqi)}</div></div>
        <div class="kpi"><div class="label">عدد الشحنات</div><div class="val">${a.count}</div></div></div>`;
    }catch(err){ toast(err.message, true); }
  };
  $("#cf").addEventListener("submit",async e=>{
    e.preventDefault();
    const fd=Object.fromEntries(new FormData(e.target));
    fd.manual_syrian=Number(fd.manual_syrian||0); fd.manual_iraqi=Number(fd.manual_iraqi||0);
    try{ await API.post("/api/mahmoud/customs",fd); toast("تم حفظ المقارنة"); reload(); }
    catch(err){ toast(err.message, true); }
  });
}

// ---------- الأصناف (إدارة + استيراد Excel) ----------
const escAttr = s => String(s??"").replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;");
async function vItems(){
  const v=$("#view"); let currentItems=[];
  v.innerHTML=`<h1>الأصناف — قاعدة البيانات</h1>
   <div class="card"><h3>إضافة صنف</h3><form class="filters" id="nf">
     <label>الكود<input name="code"></label><label>الصنف<input name="name" required></label>
     <label>الرسم السوري للطن<input type="number" step="0.01" name="syrian_per_ton"></label>
     <label>الرسم العراقي للطن<input type="number" step="0.01" name="iraqi_per_ton"></label>
     <button class="primary">إضافة</button></form></div>
   <div class="card"><h3>استيراد ملف قاعدة البيانات (Excel)</h3>
     <p class="hint">ارفع ملف .xlsx الأصلي (ورقة «قاعدة البيانات») — يُدرَج الجديد ويُحدَّث الموجود بالاسم. تُقرأ الأعمدة: الكود، الصنف، الرسم السوري للطن، وأي عمود يحوي «عراقي» كرسم عراقي للطن.</p>
     <input type="file" id="xlsx" accept=".xlsx"><span id="impmsg"></span></div>
   <div class="card"><label>بحث<input id="q" placeholder="اسم الصنف"></label><div id="il"></div></div>`;
  const load=async(q="")=>{const its=await API.get("/api/items",{q, limit:2000}); currentItems=its;
    $("#il").innerHTML=wrapTable(`<table><thead><tr><th>الكود</th><th>الصنف</th><th>الرسم السوري/طن</th><th>الرسم العراقي/طن</th><th>عدد الأصناف: ${its.length}</th></tr></thead>
      <tbody>${its.map(i=>`<tr data-row="${i.id}"><td>${i.code||""}</td><td>${i.name}</td><td>${money(i.syrian_per_ton)}</td><td>${money(i.iraqi_per_ton)}</td>
        <td><button class="sm" data-edit="${i.id}">تعديل</button>
            <button class="sm danger" data-del="${i.id}">حذف</button></td></tr>`).join("")}</tbody></table>`);
    $("#il").querySelectorAll("[data-del]").forEach(b=>b.onclick=async()=>{
      if(!confirm("حذف هذا الصنف؟")) return;
      try{ await API.del("/api/items/"+b.dataset.del); toast("تم حذف الصنف"); load(q); }
      catch(err){ toast(err.message, true); }
    });
    // تعديل داخل الجدول مباشرة: الصف نفسه يتحول لحقول إدخال مع حفظ/إلغاء
    $("#il").querySelectorAll("[data-edit]").forEach(b=>b.onclick=()=>{
      const it=currentItems.find(x=>String(x.id)===b.dataset.edit); if(!it) return;
      const tr=$("#il").querySelector(`tr[data-row="${it.id}"]`);
      tr.innerHTML=`
        <td><input class="cell-in" data-f="code" value="${escAttr(it.code)}"></td>
        <td><input class="cell-in" data-f="name" value="${escAttr(it.name)}"></td>
        <td><input class="cell-in" data-f="syrian_per_ton" type="number" step="0.01" value="${it.syrian_per_ton}"></td>
        <td><input class="cell-in" data-f="iraqi_per_ton" type="number" step="0.01" value="${it.iraqi_per_ton}"></td>
        <td><button class="sm primary" data-save>حفظ</button>
            <button class="sm" data-cancel>إلغاء</button></td>`;
      tr.querySelector("[data-f=name]").focus();
      tr.querySelector("[data-cancel]").onclick=()=>load(q);
      tr.querySelector("[data-save]").onclick=async()=>{
        const patch={};
        tr.querySelectorAll(".cell-in").forEach(inp=>patch[inp.dataset.f]=inp.value);
        patch.syrian_per_ton=Number(patch.syrian_per_ton||0);
        patch.iraqi_per_ton=Number(patch.iraqi_per_ton||0);
        if(!patch.name.trim()){ toast("اسم الصنف مطلوب", true); return; }
        try{ await API.put("/api/items/"+it.id, patch); toast("تم تعديل الصنف"); load(q); }
        catch(err){ toast(err.message, true); }
      };
    });
  };
  $("#nf").addEventListener("submit",async e=>{e.preventDefault();
    const fd=Object.fromEntries(new FormData(e.target));
    fd.syrian_per_ton=Number(fd.syrian_per_ton||0); fd.iraqi_per_ton=Number(fd.iraqi_per_ton||0);
    try{ await API.post("/api/items",fd); toast("تمت إضافة الصنف"); e.target.reset(); load(); }
    catch(err){ toast(err.message, true); }});
  $("#q").addEventListener("input",e=>load(e.target.value));
  $("#xlsx").addEventListener("change",async e=>{
    const file=e.target.files[0]; if(!file) return;
    $("#impmsg").textContent=" جارٍ الاستيراد...";
    try{
      const res=await API.upload("/api/items/import-xlsx", file);
      $("#impmsg").textContent=` تمّت إضافة ${res.added} وتحديث ${res.updated}.`;
      load();
    }catch(err){ $("#impmsg").textContent=" "+err.message; }
  });
  load();
}

// ---------- القوائم والإعدادات (إدارة كل القوائم المنسدلة في المشروع) ----------
const LIST_LABELS = {
  cities:"المدن/الفروع (جهة الإرسال والاستلام)", parcel_types:"أنواع الطرود",
  expense_categories:"بنود المصاريف", financing_types:"تمويل البضاعة",
  payment_methods:"طرق الدفع", export_statuses:"حالات التصدير",
  delivery_statuses:"حالات التسليم", collection_statuses:"حالات التحصيل",
};
const LIST_ORDER = ["cities","parcel_types","expense_categories","financing_types",
  "payment_methods","export_statuses","delivery_statuses","collection_statuses"];

async function vLists(){
  const v=$("#view"); v.innerHTML=`<h1>القوائم والإعدادات</h1>
    <div class="card"><h3>بيانات الشركة (تظهر مع اللوغو في الفواتير والتقارير)</h3>
      <div class="logo-row">
        <div class="logo-preview"><img id="logoImg" src="${COMPANY.logo||'icons/logo.svg'}" alt="لوغو"></div>
        <div class="logo-actions">
          <label class="file-btn">📤 رفع صورة لوغو
            <input type="file" id="logoFile" accept="image/*" hidden></label>
          ${COMPANY.logo?'<button class="sm danger" id="logoClear">إزالة اللوغو الحالي</button>':''}
          <p class="hint">PNG أو JPG، الحد الأقصى 2 ميغابايت. يظهر في كل الفواتير والتقارير لجميع المستخدمين.</p>
        </div>
      </div>
      <form class="filters" id="cf" style="margin-top:12px">
        <label>اسم الشركة<input name="name" value="${COMPANY.name||''}" placeholder="زوهات للتخليص الجمركي"></label>
        <label>رقم الشركة / الهاتف<input name="phone" value="${COMPANY.phone||''}" placeholder="مثال: 0999 999 999"></label>
        <button class="primary">حفظ البيانات</button>
      </form></div>
    <div class="card"><h3>💾 النسخ الاحتياطي وأرشفة البيانات</h3>
      <p class="hint" id="bkStatus">جارٍ التحقق من إعدادات النسخ الاحتياطي…</p>
      <div class="btn-row">
        <button class="primary" id="bkNow">📤 نسخة احتياطية الآن (إلى تلغرام)</button>
        <button class="primary" id="bkLocal">💻 تنزيل نسخة كاملة محلياً (قاعدة + Excel)</button>
        <button class="sm" id="bkDl">⬇ ملف Excel فقط</button>
      </div>
      <p class="hint">النسخة تُرسل قاعدة البيانات + ملف Excel لسجلات الشحنات إلى تلغرام تلقائياً كل ٢٤ ساعة،
        وتُحفظ البيانات على قرص Railway الدائم. زر «تنزيل محلياً» يحفظ الملفين على جهازك مباشرة.
        ملف قاعدة البيانات (.sqlite) يحوي <b>النظام بالكامل</b>: الشحنات، المستخدمين، المعادلات،
        حسابات محمود، الإعدادات واللوغو — ويكفي وحده لاسترجاع كل شيء.</p>
      <div class="btn-row" style="margin-top:10px">
        <input type="file" id="bkFile" accept=".sqlite,.db" hidden>
        <button class="sm danger" id="bkRestore">↩ استرجاع قاعدة البيانات من نسخة</button>
      </div>
      <p class="hint">الاسترجاع يستبدل <b>كل</b> البيانات الحالية بمحتوى النسخة المرفوعة (بعد فحص سلامتها)،
        مع أخذ نسخة أمان تلقائية من الوضع الحالي قبل الاستبدال.</p>
    </div>
    <p class="hint">إدارة القيم المستخدمة في كل القوائم المنسدلة بالمشروع. القيم المؤمَّنة 🔒 تُستخدم داخل
    منطق الحسابات (calc.py) فلا يمكن حذفها أو تعديلها — لكن يمكن إضافة قيم جديدة بجانبها بحرية.</p>
    <div id="lw"></div>`;
  API.get("/api/backup/status").then(s=>{
    $("#bkStatus").innerHTML = s.telegram_ready
      ? `✅ تلغرام مُفعَّل — نسخة تلقائية كل ${s.interval_hours} ساعة.`
      : `⚠ تلغرام غير مضبوط بعد. اضبط <b>TELEGRAM_BOT_TOKEN</b> و<b>TELEGRAM_CHAT_ID</b> في Railway لتفعيل الإرسال التلقائي.`;
  }).catch(()=>{});
  $("#bkNow").onclick=async()=>{
    $("#bkNow").disabled=true; $("#bkNow").textContent="جارٍ الإرسال…";
    try{ const r=await API.post("/api/backup/now",{}); toast(`تم إرسال النسخة (${(r.sent||[]).join(" + ")})`); }
    catch(err){ toast(err.message, true); }
    $("#bkNow").disabled=false; $("#bkNow").textContent="📤 نسخة احتياطية الآن (إلى تلغرام)";
  };
  $("#bkDl").onclick=()=>API.download("/api/backup/download",{},"zohat_shipments.xlsx")
    .catch(err=>toast(err.message,true));
  // تنزيل محلي كامل: قاعدة البيانات (تحوي كل النظام) + ملف Excel للشحنات
  $("#bkLocal").onclick=async()=>{
    const b=$("#bkLocal"); b.disabled=true; b.textContent="جارٍ التنزيل…";
    const d=new Date().toISOString().slice(0,10);
    try{
      await API.download("/api/backup/db",{},`zohat_db_${d}.sqlite`);
      await API.download("/api/backup/download",{},`zohat_shipments_${d}.xlsx`);
      toast("نُزِّلت قاعدة البيانات وملف Excel على جهازك");
    }catch(err){ toast(err.message,true); }
    b.disabled=false; b.textContent="💻 تنزيل نسخة كاملة محلياً (قاعدة + Excel)";
  };
  // استرجاع نسخة: اختيار ملف ← تأكيد صريح ← رفع ← إعادة تحميل التطبيق
  $("#bkRestore").onclick=()=>$("#bkFile").click();
  $("#bkFile").onchange=async e=>{
    const f=e.target.files[0]; e.target.value="";
    if(!f) return;
    if(!confirm(`استرجاع النسخة «${f.name}»؟\n\nسيتم استبدال كل البيانات الحالية بمحتوى هذه النسخة!\nتُؤخذ نسخة أمان تلقائية من الوضع الحالي قبل الاستبدال.`)) return;
    const b=$("#bkRestore"); b.disabled=true; b.textContent="جارٍ الاسترجاع…";
    try{
      const r=await API.upload("/api/backup/restore", f);
      alert(`تم الاسترجاع بنجاح ✅\nالشحنات: ${r.shipments} — المستخدمون: ${r.users}`+
        (r.safety_copy?`\nنسخة الأمان: ${r.safety_copy}`:""));
      location.reload();   // إعادة تحميل كاملة — البيانات كلها تغيّرت
    }catch(err){
      toast(err.message,true);
      b.disabled=false; b.textContent="↩ استرجاع قاعدة البيانات من نسخة";
    }
  };
  $("#cf").addEventListener("submit",async e=>{
    e.preventDefault();
    try{
      const r=await API.put("/api/settings/company", Object.fromEntries(new FormData(e.target)));
      COMPANY={...COMPANY, name:r.name, phone:r.phone};
      toast("تم حفظ بيانات الشركة");
    }catch(err){ toast(err.message, true); }
  });
  $("#logoFile").addEventListener("change",async e=>{
    const file=e.target.files[0]; if(!file) return;
    try{
      const r=await API.upload("/api/settings/logo", file);
      COMPANY.logo=r.logo; $("#logoImg").src=r.logo;
      toast("تم رفع اللوغو — سيظهر في كل الفواتير والتقارير"); vLists();
    }catch(err){ toast(err.message, true); }
  });
  if($("#logoClear")) $("#logoClear").onclick=async()=>{
    if(!confirm("إزالة اللوغو والعودة للوغو الافتراضي؟")) return;
    try{ const r=await API.del("/api/settings/logo"); COMPANY.logo=r.logo; toast("تمت الإزالة"); vLists(); }
    catch(err){ toast(err.message, true); }
  };
  const load=async()=>{
    const data=await API.get("/api/settings/lists/full");
    $("#lw").innerHTML=LIST_ORDER.filter(k=>data[k]).map(key=>`<div class="card">
      <h3>${LIST_LABELS[key]||key}</h3>
      <div class="chips">${data[key].map(it=>`<span class="chip ${it.protected?'locked':''}">
          <span class="chip-value">${it.value}</span>
          ${it.protected?'<span class="lock" title="قيمة أساسية لا يمكن تعديلها أو حذفها">🔒</span>'
            :`<button class="chip-edit" data-edit="${it.id}">✎</button>
              <button class="chip-del" data-del="${it.id}">✕</button>`}
        </span>`).join("")}</div>
      <form class="add-row" data-add="${key}">
        <input placeholder="قيمة جديدة" required>
        <button class="sm primary" type="submit">إضافة</button>
      </form></div>`).join("");
    $("#lw").querySelectorAll("[data-del]").forEach(b=>b.onclick=async()=>{
      if(!confirm("حذف هذه القيمة؟")) return;
      try{ await API.del("/api/settings/lists/item/"+b.dataset.del); await refreshAll(); }
      catch(err){ toast(err.message, true); }
    });
    $("#lw").querySelectorAll("[data-edit]").forEach(b=>b.onclick=async()=>{
      const cur=b.parentElement.querySelector(".chip-value").textContent;
      const val=prompt("القيمة الجديدة:", cur);
      if(!val || !val.trim() || val.trim()===cur) return;
      try{ await API.put("/api/settings/lists/item/"+b.dataset.edit, {value:val.trim()}); await refreshAll(); }
      catch(err){ toast(err.message, true); }
    });
    $("#lw").querySelectorAll("form.add-row").forEach(f=>f.onsubmit=async e=>{
      e.preventDefault();
      const input=f.querySelector("input"); const val=input.value.trim(); if(!val) return;
      try{ await API.post("/api/settings/lists/"+f.dataset.add, {value:val}); await refreshAll(); }
      catch(err){ toast(err.message, true); }
    });
  };
  const refreshAll=async()=>{ await loadLists(); await load(); };
  load();
}

// ---------- الطباعة والمعادلات (إدارة) ----------
async function vPrintFx(){
  const v=$("#view");
  let calc;
  try{ calc=await API.get("/api/settings/calc"); }
  catch(err){ v.innerHTML=`<h1>الطباعة والمعادلات</h1>${empty(err.message)}`; return; }

  const colBoxes=(cols,selected,name)=>{
    const sel=(selected&&selected.length)?new Set(selected):new Set(cols.map(c=>c[0]));
    return cols.map(([k,l])=>`<label class="chk"><input type="checkbox" data-set="${name}" value="${k}"
      ${sel.has(k)?'checked':''}> ${l}</label>`).join("");
  };
  v.innerHTML=`<h1>الطباعة والمعادلات</h1>

    <div class="card"><h3>🖨 أعمدة فاتورة الزبون (الطباعة وتصدير Excel)</h3>
      <p class="hint">الأعمدة المؤشَّرة فقط تظهر عند <b>الطباعة</b> وفي <b>ملف Excel المُصدَّر</b> — أما الشاشة فتعرض كل الأعمدة دائماً للعمل.</p>
      <div class="chk-grid">${colBoxes(INVOICE_COLS, PRINT_COLS.invoice, "invoice")}</div></div>

    <div class="card"><h3>🖨 أعمدة لوحة التقارير (الطباعة وتصدير Excel)</h3>
      <p class="hint">التقارير تُطبع بالوضع العرضي (landscape) تلقائياً لاستيعاب الأعمدة الكثيرة.</p>
      <div class="chk-grid">${colBoxes(REPORT_COLS, PRINT_COLS.reports, "reports")}</div></div>

    <div class="card"><h3>🖨 أعمدة كشف الجمارك (الطباعة وتصدير Excel)</h3>
      <p class="hint">ما تحدّده هنا يسري على كل المستخدمين فوراً — عند الطباعة أو التصدير إلى Excel.</p>
      <div class="chk-grid">${colBoxes(BROKER_COLS, PRINT_COLS.customs, "customs")}</div>
      <button class="primary" id="saveCols">حفظ أعمدة الطباعة والتصدير</button></div>

    <div class="card"><h3>⚙ الثوابت الحسابية</h3>
      <div class="filters">
        <label>نسبة السلفة الضريبية (مثال 0.02 = 2%)
          <input id="taxRate" type="number" step="0.001" dir="ltr" value="${calc.tax_advance_rate}"></label>
        <label>عمولة الشراء الافتراضية (مثال 0.05 = 5%)
          <input id="commRate" type="number" step="0.001" dir="ltr" value="${calc.default_commission}"></label>
        <label>مصروف الطرفين للطن الواحد ($ / 1000 كغ)
          <input id="twoPartyTon" type="number" step="0.01" dir="ltr" value="${calc.two_party_per_ton}"></label>
      </div>
      <p class="hint">مصروف الطرفين: إن أُدخلت قيمة يدوية في نموذج حساب الجمارك تُعتمد كما هي لكامل الشحنة،
        وإن تُرك الحقل <b>فارغاً</b> يُحسب تلقائياً = (الوزن ÷ 1000) × القيمة أعلاه.</p>
      <h3 class="sub">شرائح رسم الإنفاق الاستهلاكي (على الرسم السوري للطن الأصل)</h3>
      <div id="tiers"></div>
      <button class="sm" id="addTier">+ شريحة</button></div>

    <div class="card"><h3>ƒ معادلات الأعمدة المحسوبة</h3>
      <p class="hint">كل معادلة تقابل عموداً في ملف الإكسل الأصلي. عدّلها بحذر — التغيير يسري فوراً على
      كل الشحنات والتقارير والحسابات. اترك المعادلة كما هي أو اضغط «استرجاع» للعودة للأصل.</p>
      <div id="fx"></div></div>

    <div class="card"><h3>📈 معادلات المؤشرات (لوحة المؤشرات وملخّص الحسابات)</h3>
      <p class="hint">تعمل على المجاميع لا على شحنة مفردة — وتُطبَّق فوراً على كل التقارير.</p>
      <div id="sfx"></div>
      ${wrapTable(`<table><thead><tr><th>المتغير</th><th>المعنى</th></tr></thead><tbody>${
        (calc.summary_variables||[]).map(x=>`<tr><td dir="ltr" style="text-align:left">${x.name}</td><td>${x.doc}</td></tr>`).join("")
      }</tbody></table>`)}
      <button class="primary" id="saveCalc">حفظ الثوابت والشرائح والمعادلات</button>
      <p class="hint">⚠ الحفظ يُنشئ «نسخة معادلات» جديدة: تسري على الشحنات المسجَّلة بعد الحفظ فقط،
        أما الشحنات السابقة فتحتفظ بأرقامها كما هي دون تغيير.</p></div>

    <div class="card"><h3>📖 مرجع المتغيرات المتاحة في المعادلات</h3>
      ${wrapTable(`<table><thead><tr><th>المتغير</th><th>المعنى</th></tr></thead><tbody>${
        calc.variables.map(x=>`<tr><td dir="ltr" style="text-align:left">${x.name}</td><td>${x.doc}</td></tr>`).join("")
      }</tbody></table>`)}
      <p class="hint">الصيغ المسموحة: + − × ÷ والأقواس والمقارنات و«قيمة if شرط else قيمة» ودوال min/max/round/abs فقط.
      النصوص تُكتب بين علامتي اقتباس مزدوجتين مثل "ضد الدفع".</p></div>`;

  // شرائح الإنفاق
  const renderTiers=(tiers)=>{
    $("#tiers").innerHTML=`<table class="tiers-tbl"><thead><tr>
      <th>الحد الأدنى للرسم/طن</th><th>النسبة (0.02 = 2%)</th><th></th></tr></thead><tbody>${
      tiers.map((t,i)=>`<tr>
        <td><input class="cell-in" data-tier="${i}" data-part="0" type="number" step="1" dir="ltr" value="${t[0]}"></td>
        <td><input class="cell-in" data-tier="${i}" data-part="1" type="number" step="0.001" dir="ltr" value="${t[1]}"></td>
        <td><button class="sm danger" data-deltier="${i}">حذف</button></td></tr>`).join("")}</tbody></table>`;
    $("#tiers").querySelectorAll("[data-deltier]").forEach(b=>b.onclick=()=>{
      curTiers.splice(Number(b.dataset.deltier),1); renderTiers(curTiers);
    });
  };
  let curTiers=calc.tiers.map(t=>[...t]);
  renderTiers(curTiers);
  $("#addTier").onclick=()=>{ curTiers.push([0,0]); renderTiers(curTiers); };

  // المعادلات
  $("#fx").innerHTML=calc.formulas.map(f=>`<div class="fx-row" data-key="${f.key}">
      <div class="fx-head"><b>${f.label}</b>
        <span class="fx-cell">${f.excel}</span>
        <button class="sm" data-reset="${f.key}" title="العودة للمعادلة الأصلية">استرجاع</button></div>
      <div class="hint">${f.doc}</div>
      <textarea class="fx-in" dir="ltr" spellcheck="false" data-fx="${f.key}"
        data-default="${escAttr(f.default)}">${f.expr}</textarea>
    </div>`).join("");
  // معادلات المؤشرات
  $("#sfx").innerHTML=(calc.summary_formulas||[]).map(f=>`<div class="fx-row" data-key="${f.key}">
      <div class="fx-head"><b>${f.label}</b>
        <span class="fx-cell">${f.excel}</span>
        <button class="sm" data-reset="${f.key}" title="العودة للمعادلة الأصلية">استرجاع</button></div>
      <div class="hint">${f.doc}</div>
      <textarea class="fx-in" dir="ltr" spellcheck="false" data-sfx="${f.key}"
        data-default="${escAttr(f.default)}">${f.expr}</textarea>
    </div>`).join("");

  v.querySelectorAll("[data-reset]").forEach(b=>b.onclick=()=>{
    const ta=v.querySelector(`[data-fx="${b.dataset.reset}"], [data-sfx="${b.dataset.reset}"]`);
    if(ta){ ta.value=ta.dataset.default; toast("رجعت المعادلة للأصل — اضغط حفظ لتثبيتها"); }
  });

  // حفظ أعمدة الطباعة
  $("#saveCols").onclick=async()=>{
    const collect=name=>{
      const boxes=[...v.querySelectorAll(`input[data-set="${name}"]`)];
      const checked=boxes.filter(b=>b.checked).map(b=>b.value);
      if(!checked.length){ toast("اختر عموداً واحداً على الأقل", true); throw new Error("empty"); }
      return checked.length===boxes.length?[]:checked;   // الكل مؤشَّر = [] (يشمل أي عمود جديد مستقبلاً)
    };
    try{
      const payload={invoice:collect("invoice"), reports:collect("reports"), customs:collect("customs")};
      PRINT_COLS=await API.put("/api/settings/print", payload);
      toast("تم الحفظ — تسري على الطباعة وتصدير Excel لكل المستخدمين");
    }catch(err){ if(err.message!=="empty") toast(err.message, true); }
  };

  // حفظ الثوابت والشرائح والمعادلات
  $("#saveCalc").onclick=async()=>{
    curTiers=[...$("#tiers").querySelectorAll("tbody tr")].map(tr=>{
      const ins=tr.querySelectorAll("input");
      return [Number(ins[0].value||0), Number(ins[1].value||0)];
    });
    const formulas={}, summary_formulas={};
    v.querySelectorAll("[data-fx]").forEach(ta=>formulas[ta.dataset.fx]=ta.value.trim());
    v.querySelectorAll("[data-sfx]").forEach(ta=>summary_formulas[ta.dataset.sfx]=ta.value.trim());
    try{
      const r=await API.put("/api/settings/calc", {
        tax_advance_rate:Number($("#taxRate").value||0),
        default_commission:Number($("#commRate").value||0),
        two_party_per_ton:Number($("#twoPartyTon").value||0),
        tiers:curTiers, formulas, summary_formulas});
      toast(r.changed ? `تم الحفظ كنسخة معادلات جديدة (#${r.version}) — تسري على الشحنات الجديدة فقط`
                      : "لا توجد تغييرات لحفظها");
    }catch(err){ toast(err.message, true); }
  };
}

// ---------- المستخدمون (إدارة: إضافة/تعديل/حذف) ----------
const ROLE_AR={admin:"إدارة شاملة", supervisor:"مشرف إداري", accountant:"محاسب",
  collector:"مسؤول تجميع", broker:"مخلص كمركي", branch:"فرع"};
const roleOpts=cur=>["collector","broker","supervisor","accountant","branch","admin"]
  .map(r=>`<option value="${r}" ${r===cur?'selected':''}>${ROLE_AR[r]}</option>`).join("");
async function vUsers(){
  const v=$("#view"); v.innerHTML=`<h1>المستخدمون والصلاحيات</h1>
   <div class="card"><h3>إضافة مستخدم</h3><form class="grid" id="uf">
     <label>اسم المستخدم<input name="username" required></label>
     <label>الاسم الكامل<input name="full_name"></label>
     <label>كلمة المرور<input name="password" required></label>
     <label>الدور<select name="role">${roleOpts("branch")}</select></label>
     <label>الفرع/المدينة<select name="branch"><option value=""></option>${opts(CITIES)}</select></label>
     <div style="grid-column:1/-1"><button class="primary">إضافة مستخدم</button></div></form></div>
   <div class="card"><h3>المستخدمون الحاليون</h3><div id="ul"></div></div>`;
  let users=[];
  const load=async()=>{users=await API.get("/api/users");
    $("#ul").innerHTML=wrapTable(`<table><thead><tr><th>المستخدم</th><th>الاسم</th><th>الدور</th><th>الفرع</th><th>الحالة</th><th>إجراءات</th></tr></thead>
      <tbody>${users.map(u=>`<tr data-row="${u.id}"><td>${u.username}</td><td>${u.full_name||"-"}</td>
      <td>${ROLE_AR[u.role]||u.role}</td><td>${u.branch||"-"}</td>
      <td>${u.is_active?'<span class="badge done">فعّال</span>':'<span class="badge pend">موقوف</span>'}</td>
      <td class="nowrap"><button class="sm" data-edit="${u.id}">تعديل</button>
        <button class="sm danger" data-del="${u.id}">حذف</button></td></tr>`).join("")}</tbody></table>`);
    $("#ul").querySelectorAll("[data-del]").forEach(b=>b.onclick=async()=>{
      if(!confirm("حذف هذا المستخدم نهائياً؟")) return;
      try{ await API.del("/api/users/"+b.dataset.del); toast("تم حذف المستخدم"); load(); }
      catch(err){ toast(err.message, true); }
    });
    $("#ul").querySelectorAll("[data-edit]").forEach(b=>b.onclick=()=>{
      const u=users.find(x=>String(x.id)===b.dataset.edit); if(!u) return;
      const tr=$("#ul").querySelector(`tr[data-row="${u.id}"]`);
      tr.innerHTML=`
        <td><input class="cell-in" data-f="username" value="${escAttr(u.username)}"></td>
        <td><input class="cell-in" data-f="full_name" value="${escAttr(u.full_name)}"></td>
        <td><select class="cell-in" data-f="role">${roleOpts(u.role)}</select></td>
        <td><select class="cell-in" data-f="branch"><option value=""></option>${opts(CITIES,u.branch)}</select></td>
        <td><select class="cell-in" data-f="is_active"><option value="1" ${u.is_active?'selected':''}>فعّال</option><option value="0" ${!u.is_active?'selected':''}>موقوف</option></select></td>
        <td class="nowrap"><input class="cell-in" data-f="password" placeholder="كلمة مرور جديدة (اختياري)" style="min-width:150px">
          <button class="sm primary" data-save>حفظ</button><button class="sm" data-cancel>إلغاء</button></td>`;
      tr.querySelector("[data-cancel]").onclick=load;
      tr.querySelector("[data-save]").onclick=async()=>{
        const patch={};
        tr.querySelectorAll(".cell-in").forEach(inp=>patch[inp.dataset.f]=inp.value);
        patch.is_active = patch.is_active==="1";
        if(!patch.password) delete patch.password;
        try{ await API.put("/api/users/"+u.id, patch); toast("تم تعديل المستخدم"); load(); }
        catch(err){ toast(err.message, true); }
      };
    });
  };
  $("#uf").addEventListener("submit",async e=>{e.preventDefault();
    try{ await API.post("/api/users",Object.fromEntries(new FormData(e.target)));
      toast("تمت إضافة المستخدم"); e.target.reset(); load();
    }catch(err){ toast(err.message, true); }});
  load();
}

boot();
