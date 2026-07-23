// طبقة الاتصال بالـ API + إدارة الجلسة
const API = {
  base: "",                       // نفس الأصل (الخادم يخدم الواجهة)
  token: localStorage.getItem("token") || "",
  role: localStorage.getItem("role") || "",
  branch: localStorage.getItem("branch") || "",
  name: localStorage.getItem("name") || "",

  save(d){ this.token=d.access_token; this.role=d.role; this.branch=d.branch||"";
    this.name=d.full_name||"";
    localStorage.setItem("token",this.token); localStorage.setItem("role",this.role);
    localStorage.setItem("branch",this.branch); localStorage.setItem("name",this.name); },
  clear(){ ["token","role","branch","name"].forEach(k=>localStorage.removeItem(k));
    this.token=this.role=this.branch=this.name=""; },

  async login(username,password){
    const body=new URLSearchParams({username,password});
    const r=await fetch(this.base+"/api/auth/login",{method:"POST",body});
    if(!r.ok) throw new Error((await r.json()).detail||"فشل الدخول");
    const d=await r.json(); this.save(d); return d;
  },
  async req(path,{method="GET",body=null,params=null}={}){
    let url=this.base+path;
    if(params){const q=new URLSearchParams(Object.entries(params).filter(([,v])=>v));url+="?"+q;}
    const opt={method,headers:{Authorization:"Bearer "+this.token}};
    if(body){opt.headers["Content-Type"]="application/json";opt.body=JSON.stringify(body);}
    const r=await fetch(url,opt);
    if(r.status===401){this.clear();location.reload();return;}
    if(!r.ok) throw new Error((await r.json()).detail||"خطأ");
    return r.status===204?null:r.json();
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
    if(!r.ok) throw new Error((await r.json()).detail||"تعذّر التصدير");
    const blob=await r.blob();
    const url=URL.createObjectURL(blob);
    const a=document.createElement("a"); a.href=url; a.download=filename; a.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  },
  async upload(path,file){
    const fd=new FormData(); fd.append("file",file);
    const r=await fetch(this.base+path,{method:"POST",headers:{Authorization:"Bearer "+this.token},body:fd});
    if(r.status===401){this.clear();location.reload();return;}
    if(!r.ok) throw new Error((await r.json()).detail||"خطأ");
    return r.json();
  },
};
