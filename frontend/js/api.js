// طبقة الاتصال بالـ API + إدارة الجلسة
const API = {
  base: "",                       // نفس الأصل (الخادم يخدم الواجهة)
  token: localStorage.getItem("token") || "",
  role: localStorage.getItem("role") || "",
  branch: localStorage.getItem("branch") || "",
  name: localStorage.getItem("name") || "",
  username: localStorage.getItem("username") || "",   // اسم الدخول — لتمييز سجلات المستخدم نفسه

  save(d){ this.token=d.access_token; this.role=d.role; this.branch=d.branch||"";
    this.name=d.full_name||""; this.username=d.username||"";
    localStorage.setItem("token",this.token); localStorage.setItem("role",this.role);
    localStorage.setItem("branch",this.branch); localStorage.setItem("name",this.name);
    localStorage.setItem("username",this.username); },
  clear(){ ["token","role","branch","name","username"].forEach(k=>localStorage.removeItem(k));
    this.token=this.role=this.branch=this.name=this.username=""; },

  async login(username,password){
    const body=new URLSearchParams({username,password});
    const r=await fetch(this.base+"/api/auth/login",{method:"POST",body});
    if(!r.ok) throw new Error(await this.errText(r,"فشل الدخول"));
    const d=await r.json(); this.save(d); return d;
  },
  // رسالة الخطأ من رد الخادم. الرد قد لا يكون JSON إطلاقاً: خطأ خادم خام،
  // أو صفحة HTML من وسيط/بوابة (502/504). قراءته كـJSON مباشرةً كانت تُسقط
  // التحليل فتظهر رسالة «Unexpected token … is not valid JSON» بدل السبب الحقيقي.
  async errText(r, fallback="تعذّر تنفيذ الطلب"){
    let raw="";
    try{ raw=await r.text(); }catch(e){ raw=""; }
    try{
      const j=JSON.parse(raw);
      if(j && j.detail){
        // أخطاء التحقّق في FastAPI تأتي مصفوفةً من كائنات
        if(Array.isArray(j.detail))
          return j.detail.map(d=>d.msg||JSON.stringify(d)).join("، ");
        return typeof j.detail==="string" ? j.detail : JSON.stringify(j.detail);
      }
    }catch(e){/* ليس JSON — نكمل بالنص الخام */}
    const snippet=raw.replace(/<[^>]*>/g," ").replace(/\s+/g," ").trim().slice(0,160);
    if(r.status>=500) return `خطأ في الخادم (${r.status})${snippet?": "+snippet:""}`;
    if(r.status===0 || !r.status) return "تعذّر الوصول إلى الخادم";
    return snippet ? `${fallback} (${r.status}): ${snippet}` : `${fallback} (${r.status})`;
  },
  async req(path,{method="GET",body=null,params=null}={}){
    let url=this.base+path;
    if(params){const q=new URLSearchParams(Object.entries(params).filter(([,v])=>v));url+="?"+q;}
    const opt={method,headers:{Authorization:"Bearer "+this.token}};
    if(body){opt.headers["Content-Type"]="application/json";opt.body=JSON.stringify(body);}
    let r;
    try{ r=await fetch(url,opt); }
    catch(e){ throw new Error("تعذّر الوصول إلى الخادم — تحقّق من الاتصال"); }
    if(r.status===401){this.clear();location.reload();return;}
    if(!r.ok) throw new Error(await this.errText(r));
    if(r.status===204) return null;
    // حتى الرد الناجح قد يصل مبتوراً أو غير JSON إن تدخّل وسيط
    const raw=await r.text();
    if(!raw) return null;
    try{ return JSON.parse(raw); }
    catch(e){ throw new Error("رد الخادم غير مفهوم — أعد المحاولة، وإن تكرّر أبلغ الدعم"); }
  },
  get(p,params){return this.req(p,{params});},
  post(p,body){return this.req(p,{method:"POST",body});},
  put(p,body){return this.req(p,{method:"PUT",body});},
  del(p){return this.req(p,{method:"DELETE"});},
  // ينزّل ملفاً ناتجاً عن طلب POST (تصدير Excel) ويحفظه باسم مقروء
  async download(path, body, filename){
    const r=await fetch(this.base+path,{method:"POST",
      headers:{Authorization:"Bearer "+this.token,"Content-Type":"application/json"},
      body:JSON.stringify(body)});
    if(r.status===401){this.clear();location.reload();return;}
    if(!r.ok) throw new Error(await this.errText(r,"تعذّر التصدير"));
    const blob=await r.blob();
    // داخل برنامج سطح المكتب (WebView2) لا يعمل تنزيل الروابط المؤقتة (blob)،
    // فنمرّر الملف إلى بايثون ليحفظه عبر نافذة «حفظ باسم» الأصلية.
    if(window.pywebview && window.pywebview.api && window.pywebview.api.save_file){
      const b64=await new Promise((res,rej)=>{
        const fr=new FileReader();
        fr.onload=()=>res(String(fr.result).split(",")[1]);
        fr.onerror=()=>rej(new Error("تعذّرت قراءة الملف"));
        fr.readAsDataURL(blob);
      });
      const saved=await window.pywebview.api.save_file(filename, b64);
      if(saved===false) throw new Error("أُلغي الحفظ");
      return saved;
    }
    const url=URL.createObjectURL(blob);
    const a=document.createElement("a"); a.href=url; a.download=filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  },
  async upload(path,file){
    const fd=new FormData(); fd.append("file",file);
    const r=await fetch(this.base+path,{method:"POST",headers:{Authorization:"Bearer "+this.token},body:fd});
    if(r.status===401){this.clear();location.reload();return;}
    if(!r.ok) throw new Error(await this.errText(r,"تعذّر الرفع"));
    return r.json();
  },
};
