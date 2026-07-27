// ===== واجهة قائمة على الأدوار =====
const $ = s => document.querySelector(s);
const money = n => (Number(n)||0).toLocaleString("en",{minimumFractionDigits:2})+" $";
const el = (t,c,h)=>{const e=document.createElement(t);if(c)e.className=c;if(h!=null)e.innerHTML=h;return e;};

// قوائم الأدوار: أي صفحة يراها كل دور
const MENUS = {
  admin:      ["dashboard","shipments","customs","broker","invoice","reports","accounting","items","lists","printfx","users"],
  supervisor: ["dashboard","shipments","customs","invoice","reports","accounting"],
  accountant: ["dashboard","shipments","reports","accounting","invoice"],
  collector:  ["shipments"],
  broker:     ["broker"],
  branch:     ["shipments","deliver","invoice"],
};
const TITLES = {dashboard:"لوحة المؤشرات",shipments:"سجل الشحنات",customs:"حساب الجمارك",
  broker:"التخليص الجمركي",invoice:"فاتورة الزبون",reports:"لوحة التقارير",accounting:"الحسابات",
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
  ["receiver_name","المستلِم",r=>r.receiver_name],
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
// تصدير Excel (.xlsx) بنفس أعمدة الطباعة المختارة — الأرقام تُصدَّر كأرقام حقيقية
async function exportXlsx(cols, rows, selectedKeys, title){
  if(!rows || !rows.length){ toast("لا توجد بيانات للتصدير", true); return; }
  const sel=(selectedKeys&&selectedKeys.length)?new Set(selectedKeys):null;
  const use=cols.filter(([k])=>!sel||sel.has(k));
  const headers=use.map(([,label])=>label);
  const body=rows.map(r=>use.map(([k,,fn])=>{
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
  st.textContent=`@page{size:A4 ${orientation||"portrait"};margin:9mm}`;
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
    reports:vReports,accounting:vAccounting,items:vItems,lists:vLists,printfx:vPrintFx,users:vUsers,deliver:vDeliver}[key])();
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
       <button class="primary" id="go">بحث</button>
       ${API.role!=="accountant"?'<button class="primary gold" id="add">＋ شحنة جديدة</button>':''}
     </div>
     <div id="exportbar"></div>
     <div id="tbl"></div>
   </div>`;
  let tab="قيد التصدير";
  const load=async()=>{
    const params={date_from:$("#df").value,date_to:$("#dt").value,
      to_city:$("#tc").value,receiver:$("#snd").value};
    if(tab) params.export_status=tab;
    if(isBranch) params.from_city=API.branch;   // صفحة الاستلام تعرض ما أنشأه الفرع فقط
    const rows=await API.get("/api/shipments", params);
    renderShip(rows, tab, load);
  };
  $("#seg").querySelectorAll(".seg-btn").forEach(b=>b.onclick=()=>{
    tab=b.dataset.tab;
    $("#seg").querySelectorAll(".seg-btn").forEach(x=>x.classList.toggle("active",x===b));
    load();
  });
  $("#go").onclick=load;
  if($("#add")) $("#add").onclick=()=>shipForm(vShipments);
  load();
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
      <button class="primary" id="cgo">بحث</button>
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
  $("#cgo").onclick=load;
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
        <button class="seg-btn active" data-tab="تم التصدير">المُصدَّرة (في الطريق)</button>
        <button class="seg-btn" data-tab="قيد التصدير">قيد التصدير</button>
        <button class="seg-btn" data-tab="">الكل</button>
      </div>
      <div class="filters">
        <label>من تاريخ<input type="date" id="bdf"></label>
        <label>إلى تاريخ<input type="date" id="bdt"></label>
        <label>جهة الاستلام<select id="btc">${optsWithAll(CITIES)}</select></label>
        <button class="primary" id="bgo">بحث</button>
        <button class="sm" id="bpr">🖨 طباعة كشف الجمارك</button>
        <button class="sm" id="bxl">⬇ تصدير Excel</button>
      </div>
    </div>
    <div class="only-print">${brandHead()}<h2 class="print-title">كشف بيانات التخليص الجمركي</h2></div>
    <div class="card"><div id="btbl"></div></div>`;
  let tab="تم التصدير", lastRows=[];
  const load=async()=>{
    const params={date_from:$("#bdf").value,date_to:$("#bdt").value,to_city:$("#btc").value};
    if(tab) params.export_status=tab;
    const rows=await API.get("/api/shipments", params);
    lastRows=rows; renderBroker(rows, load);
  };
  $("#bxl").onclick=()=>exportXlsx(BROKER_COLS, lastRows, PRINT_COLS.customs, "كشف الجمارك");
  $("#bseg").querySelectorAll(".seg-btn").forEach(b=>b.onclick=()=>{
    tab=b.dataset.tab;
    $("#bseg").querySelectorAll(".seg-btn").forEach(x=>x.classList.toggle("active",x===b));
    load();
  });
  $("#bgo").onclick=load;
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

// ---------- فاتورة الزبون (بحث باسم المستلِم — هو من يُحصَّل منه عند التسليم) ----------
async function vInvoice(){
  const v=$("#view"); v.innerHTML=`<h1>فاتورة الزبون</h1>
    <div class="card no-print"><div class="filters">
      <label>اسم المستلِم<input id="recv" list="custs" placeholder="اكتب اسم المستلِم"></label>
      <datalist id="custs"></datalist>
      <label>من تاريخ<input type="date" id="if"></label>
      <label>إلى تاريخ<input type="date" id="it"></label>
      <button class="primary" id="go">عرض الفاتورة</button>
      <button class="sm" id="pr">🖨 طباعة</button>
      <button class="sm" id="ixl">⬇ تصدير Excel</button>
    </div></div>
    <div id="inv"></div>`;
  let invRows=[], invName="";
  $("#recv").addEventListener("input",async e=>{
    if(e.target.value.length<1)return;
    const rows=await API.get("/api/shipments",{receiver:e.target.value});
    const names=[...new Set(rows.map(r=>r.receiver_name))];
    $("#custs").innerHTML=names.map(n=>`<option value="${n}">`).join("");
  });
  $("#pr").onclick=()=>printDoc("portrait");
  $("#ixl").onclick=()=>exportXlsx(INVOICE_COLS, invRows, PRINT_COLS.invoice,
    invName?`فاتورة ${invName}`:"فاتورة الزبون");
  $("#go").onclick=async()=>{
    const receiver=$("#recv").value.trim();
    if(!receiver){ $("#inv").innerHTML="<p>الرجاء كتابة اسم المستلِم.</p>"; return; }
    const data=await API.get("/api/shipments/invoice",{receiver,date_from:$("#if").value,date_to:$("#it").value});
    invRows=data.rows; invName=receiver;
    $("#inv").innerHTML=invoiceHtml(receiver, data);
  };
}
function invoiceHtml(receiver, data){
  const rows=data.rows;
  const table = rows.length ? colsTable(INVOICE_COLS, rows, PRINT_COLS.invoice)
    : empty("لا توجد شحنات لهذا المستلِم ضمن الفترة المحددة");
  return `<div class="card invoice-sheet">
    ${brandHead()}
    <h2>فاتورة الزبون (المستلِم): ${receiver}</h2>
    ${table}
    <p class="hint no-print">الرسوم = الرسم السوري الفعلي + الرسم العراقي الفعلي + مصروف طرفين.</p>
    <div class="kpis" style="margin-top:14px">
      <div class="kpi cash"><div class="label">الواصل نقداً</div><div class="val">${money(data.summary.cash_in)}</div></div>
      <div class="kpi cod"><div class="label">المستحق ضد الدفع</div><div class="val">${money(data.summary.cod_due)}</div></div>
      <div class="kpi"><div class="label">إجمالي المبلغ</div><div class="val">${money(data.summary.grand_total)}</div></div>
    </div></div>`;
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
     <label>تمويل البضاعة<select id="rfin">${optsWithAll(FINANCE)}</select></label>
     <label>دفع الأجور<select id="rfp">${optsWithAll(PAY)}</select></label>
     <label>حالة الجمركة<select id="rcs">${optsWithAll(CUSTOMS_ST)}</select></label>
     <label>حالة التسليم<select id="rds">${optsWithAll(DELIVERY)}</select></label>
     <label>حالة التحصيل<select id="rcol">${optsWithAll(COLLECTION)}</select></label>
     <label class="chk-inline"><input type="checkbox" id="ralpha"> ترتيب أبجدي حسب المستلِم</label>
     <button class="primary" id="go">بحث</button>
     <button class="sm" id="rpr">🖨 طباعة</button>
     <button class="sm" id="exp">⬇ تصدير Excel</button>
   </div></div>
   <div class="only-print">${brandHead()}<h2 class="print-title">تقرير الشحنات</h2></div>
   <div id="rk" class="kpis"></div>
   <div class="card"><div id="rtbl"></div></div>`;
  $("#rpr").onclick=()=>printDoc("landscape");
  let lastRows=[];
  $("#go").onclick=async()=>{
    const rows=await API.get("/api/shipments",{
      date_from:$("#rdf").value, date_to:$("#rdt").value, from_city:$("#rfc").value,
      to_city:$("#rtc").value, receiver:$("#rsnd").value, financing:$("#rfin").value,
      fees_payment:$("#rfp").value, customs_status:$("#rcs").value,
      delivery_status:$("#rds").value, collection_status:$("#rcol").value});
    // الترتيب الأبجدي يسري على الشاشة والطباعة وتصدير Excel معاً
    if($("#ralpha").checked)
      rows.sort((a,b)=>(a.receiver_name||"").localeCompare(b.receiver_name||"","ar"));
    lastRows=rows;
    const owners=new Set(rows.map(r=>r.receiver_name));   // صاحب الشحنة = المستلِم
    const sum=k=>rows.reduce((a,r)=>a+(Number(r[k])||0),0);
    const countIf=(k,v)=>rows.filter(r=>r[k]===v).length;
    const K=[["عدد الشحنات",rows.length],["عدد الزبائن",owners.size],
      ["إجمالي الوزن",sum("weight_kg").toFixed(1)+" كغ"],["إجمالي قيمة البضاعة",money(sum("goods_value"))],
      ["إجمالي أجور الشحن والجمركة",money(sum("fees_total"))],["إجمالي المبلغ",money(sum("grand_total"))],
      ["الواصل نقداً",money(sum("cash_in"))],["غير الواصل (ضد الدفع)",money(sum("cod_due"))],
      ["ذمة على المرسِل (آجل)",money(sum("sender_debt"))],
      ["عمولة الشراء",money(sum("commission"))],["المحصَّل فعلياً (نقد)",money(sum("collected_actual"))],
      ["المتبقي في الذمة",money(sum("remaining"))],["شحنات قيد التسليم",countIf("delivery_status","قيد التسليم")]];
    $("#rk").innerHTML=K.map(([l,val])=>`<div class="kpi"><div class="label">${l}</div><div class="val">${val}</div></div>`).join("");
    $("#rtbl").innerHTML=reportsTable(rows);
  };
  $("#exp").onclick=()=>exportXlsx(REPORT_COLS, lastRows, PRINT_COLS.reports, "تقرير الشحنات");
  $("#go").click();
}

// ---------- الحسابات (تبويبات) ----------
async function vAccounting(){
  const v=$("#view"); v.innerHTML=`<h1>الحسابات</h1>
    <div class="card"><div class="filters">
      <label>من<input type="date" id="af"></label><label>إلى<input type="date" id="at"></label>
      <label>الفرع<select id="ab">${optsWithAll(CITIES)}</select></label>
      <button class="primary" id="ago">عرض</button></div></div>
    <div class="tabs" id="atabs"></div>
    <div id="atab"></div>`;
  const TABS=[["summary","الملخّص"],["journal","دفتر القيود"],["purchases","مشتريات نيابةً"],
    ["branches","مقارنة الفروع"],["receivables","الذمم حسب المكتب"],["alerts","التنبيهات"]];
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
    else if(cur==="receivables") box.innerHTML=accTableHtml(
      ["المكتب","المستحق ضد الدفع","المحصَّل فعلياً","المتبقي"], data.receivables_by_office,
      r=>[r.city, money(r.cod_due), money(r.collected), money(r.remaining)]);
    else if(cur==="alerts") box.innerHTML=accTableHtml(
      ["القيد","الزبون (المستلِم)","التنبيه"], data.alerts, r=>[r.ref_no, r.customer, r.message]);
  };
  const load=async()=>{
    data=await API.get("/api/accounting/summary", filters());
    renderTabs(); renderBody();
  };
  $("#ago").onclick=load;
  load();
}
function accSummaryHtml(s){
  const K=[["الإيرادات",s.revenue,""],["المصاريف التشغيلية",s.opex,"cod"],
    ["مشتريات (مدفوع)",s.invested,"gold"],["إجمالي المدفوعات",s.total_payments,"cod"],
    ["صافي الربح التشغيلي",s.operating_net,"gold"],["صافي التدفق النقدي",s.cash_net,""],
    ["النقد المحصَّل",s.cash_collected,"cash"],["الذمم المدينة",s.receivables,"cod"],
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
function accPurchasesHtml(s){
  const detail = accTableHtml(
    ["القيد","التاريخ","الزبون (المستلِم)","من قام بالشراء","المبلغ","العمولة","حالة التحصيل","الوجهة"],
    s.purchases_detail, r=>[r.ref_no, r.ship_date, r.customer, r.bought_by||"-", money(r.amount),
                            money(r.commission), r.collection_status, r.destination]);
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
        <button class="sm" id="bkDl">⬇ تنزيل ملف Excel لكل الشحنات</button>
      </div>
      <p class="hint">النسخة تُرسل قاعدة البيانات + ملف Excel لسجلات الشحنات إلى تلغرام تلقائياً كل ٢٤ ساعة،
        وتُحفظ البيانات على قرص Railway الدائم. لتفعيل تلغرام اضبط المتغيّرات في Railway (انظر ملف .env.example).</p>
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

    <div class="card"><h3>🖨 أعمدة طباعة فاتورة الزبون</h3>
      <p class="hint">الأعمدة المؤشَّرة فقط تظهر في ملف الـ PDF عند الطباعة — الشاشة تعرض كل الأعمدة دائماً.</p>
      <div class="chk-grid">${colBoxes(INVOICE_COLS, PRINT_COLS.invoice, "invoice")}</div></div>

    <div class="card"><h3>🖨 أعمدة طباعة لوحة التقارير</h3>
      <p class="hint">التقارير تُطبع بالوضع العرضي (landscape) تلقائياً لاستيعاب الأعمدة الكثيرة.</p>
      <div class="chk-grid">${colBoxes(REPORT_COLS, PRINT_COLS.reports, "reports")}</div></div>

    <div class="card"><h3>🖨 أعمدة طباعة كشف الجمارك (المخلص الكمركي)</h3>
      <p class="hint">ما تحدّده هنا يسري على كل المستخدمين — عند طباعة كشف الجمارك أو تصديره إلى Excel.</p>
      <div class="chk-grid">${colBoxes(BROKER_COLS, PRINT_COLS.customs, "customs")}</div>
      <button class="primary" id="saveCols">حفظ أعمدة الطباعة</button></div>

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
      toast("تم حفظ أعمدة الطباعة — سرت على كل المستخدمين");
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
