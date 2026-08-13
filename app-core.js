/* ============================================================
   履约云 · 数据层
   两种后端：local（IndexedDB，本机）/ cloud（Supabase）
   业务代码只跟 Store 打交道，不关心后端是哪个
   ============================================================ */
"use strict";

/* ---------- 小工具 ---------- */
const TODAY=(()=>{const t=new Date();t.setHours(0,0,0,0);return t})();
const d=s=>{if(!s)return null;const x=new Date(String(s).slice(0,10)+"T00:00:00");return isNaN(x)?null:x};
const days=(a,b)=>Math.round((a-b)/864e5);
const iso=x=>x.getFullYear()+"-"+String(x.getMonth()+1).padStart(2,"0")+"-"+String(x.getDate()).padStart(2,"0");
const addDays=(s,n)=>{const x=d(s);if(!x)return "";x.setDate(x.getDate()+n);return iso(x)};
const fmt=n=>(+n||0).toLocaleString("zh-CN",{minimumFractionDigits:2,maximumFractionDigits:2});
const wan=n=>Math.abs(+n||0)>=1e4?((+n)/1e4).toFixed(1)+"万":fmt(n);
const esc=s=>String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const num=v=>{if(v==null||v==="")return 0;const n=parseFloat(String(v).replace(/[,，\s¥$€]/g,""));return isNaN(n)?0:n};
const uid=p=>(p||"r")+Date.now().toString(36)+Math.floor(Math.random()*1e6).toString(36);
const nowTS=()=>{const n=new Date();return iso(n)+" "+String(n.getHours()).padStart(2,"0")+":"+String(n.getMinutes()).padStart(2,"0")};
function normDate(v){
  if(v==null)return "";
  let s=String(v).trim(); if(!s||s==="—"||s==="-")return "";
  if(/^\d{4}-\d{2}-\d{2}$/.test(s))return s;
  if(/^\d{5}$/.test(s)){const t=new Date(Date.UTC(1899,11,30)+(+s)*864e5);return iso(new Date(t.getUTCFullYear(),t.getUTCMonth(),t.getUTCDate()))}
  const m=s.match(/^(\d{4})[\/\.\-年](\d{1,2})[\/\.\-月](\d{1,2})/);
  if(m)return m[1]+"-"+String(m[2]).padStart(2,"0")+"-"+String(m[3]).padStart(2,"0");
  const x=new Date(s);return isNaN(x)?"":iso(x);
}

/* ---------- 密码：PBKDF2 派生，不存明文 ---------- */
async function hashPw(pw,salt){
  const enc=new TextEncoder();
  const key=await crypto.subtle.importKey("raw",enc.encode(pw),"PBKDF2",false,["deriveBits"]);
  const bits=await crypto.subtle.deriveBits({name:"PBKDF2",salt:enc.encode(salt),iterations:120000,hash:"SHA-256"},key,256);
  return [...new Uint8Array(bits)].map(b=>b.toString(16).padStart(2,"0")).join("");
}
function randPw(len){
  // 去掉容易看错的 0/O/1/l/I，方便口头或微信传达
  const A="ABCDEFGHJKMNPQRSTUVWXYZ",a="abcdefghijkmnpqrstuvwxyz",n="23456789",s="!@#$%&*";
  const all=A+a+n+s, pick=x=>x[crypto.getRandomValues(new Uint32Array(1))[0]%x.length];
  let out=[pick(A),pick(a),pick(n),pick(s)];
  for(let i=out.length;i<(len||12);i++)out.push(pick(all));
  for(let i=out.length-1;i>0;i--){const j=crypto.getRandomValues(new Uint32Array(1))[0]%(i+1);[out[i],out[j]]=[out[j],out[i]]}
  return out.join("");
}

/* ---------- IndexedDB ---------- */
const IDB={
  db:null,
  open(){ return new Promise((ok,no)=>{
    const rq=indexedDB.open("lvyue_cloud",1);
    rq.onupgradeneeded=()=>{const db=rq.result;
      if(!db.objectStoreNames.contains("kv"))db.createObjectStore("kv");
      if(!db.objectStoreNames.contains("files"))db.createObjectStore("files");};
    rq.onsuccess=()=>{IDB.db=rq.result;ok(IDB.db)}; rq.onerror=()=>no(rq.error);
  })},
  tx(store,mode){ return IDB.db.transaction(store,mode).objectStore(store) },
  get(store,k){ return new Promise((ok,no)=>{const r=IDB.tx(store,"readonly").get(k);r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error)}) },
  put(store,k,v){ return new Promise((ok,no)=>{const r=IDB.tx(store,"readwrite").put(v,k);r.onsuccess=()=>ok(true);r.onerror=()=>no(r.error)}) },
  del(store,k){ return new Promise((ok,no)=>{const r=IDB.tx(store,"readwrite").delete(k);r.onsuccess=()=>ok(true);r.onerror=()=>no(r.error)}) },
  keys(store){ return new Promise((ok,no)=>{const r=IDB.tx(store,"readonly").getAllKeys();r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error)}) }
};

/* ---------- 空库 ---------- */
function emptyDB(){
  return {contracts:[],materials:[],arrivals:[],invoices:[],payments:[],payplans:[],attachments:[],audit:[],users:[],meta:{updated:null,seeded:false}};
}

/* ============================================================
   本机后端
   ============================================================ */
const LocalBackend={
  kind:"local", data:null,
  async init(){ await IDB.open(); this.data=await IDB.get("kv","db")||emptyDB(); return this },
  async flush(){ this.data.meta.updated=nowTS(); await IDB.put("kv","db",this.data) },
  all(t){ return (this.data[t]||[]).slice() },
  async insert(t,row){ row.id=row.id||uid(t[0]); this.data[t].push(row); await this.flush(); return row },
  async update(t,id,patch){ const r=this.data[t].find(x=>x.id===id); if(r)Object.assign(r,patch); await this.flush(); return r },
  async remove(t,id){ this.data[t]=this.data[t].filter(x=>x.id!==id); await this.flush() },
  async removeWhere(t,fn){ this.data[t]=this.data[t].filter(x=>!fn(x)); await this.flush() },
  async replaceAll(next){ this.data=next; await this.flush() },
  async putFile(id,blobData){ await IDB.put("files",id,blobData) },
  async getFile(id){ return await IDB.get("files",id) },
  async delFile(id){ await IDB.del("files",id) },
  /* 本机账号 */
  async login(username,pw){
    const u=this.data.users.find(x=>x.username===username);
    if(!u)throw new Error("账号不存在");
    if(u.disabled)throw new Error("账号已停用");
    if(await hashPw(pw,u.salt)!==u.pw)throw new Error("密码不对");
    return {id:u.id,username:u.username,name:u.name,role:u.role};
  },
  async createUser({username,name,role,password}){
    if(this.data.users.some(x=>x.username===username))throw new Error("账号已存在："+username);
    const salt=uid("s");
    const u={id:uid("u"),username,name,role:role||"user",salt,pw:await hashPw(password,salt),disabled:0,created:nowTS()};
    this.data.users.push(u); await this.flush(); return u;
  },
  async resetPw(id,password){
    const u=this.data.users.find(x=>x.id===id); if(!u)throw new Error("用户不存在");
    u.salt=uid("s"); u.pw=await hashPw(password,u.salt); u.mustChange=1; await this.flush(); return u;
  },
  async setUser(id,patch){ const u=this.data.users.find(x=>x.id===id); if(u)Object.assign(u,patch); await this.flush(); return u }
};

/* ============================================================
   云端后端（Supabase）
   表结构见 schema.sql；鉴权用 Supabase Auth，数据走 PostgREST
   ============================================================ */
const CloudBackend={
  kind:"cloud", url:null, key:null, token:null, user:null, data:null,
  cfg(){ try{return JSON.parse(localStorage.getItem("lvyue_cloud_cfg")||"null")}catch(e){return null} },
  async init(cfg){
    cfg=cfg||this.cfg(); if(!cfg||!cfg.url||!cfg.key)throw new Error("未配置云端");
    this.url=cfg.url.replace(/\/+$/,""); this.key=cfg.key;
    localStorage.setItem("lvyue_cloud_cfg",JSON.stringify({url:this.url,key:this.key}));
    const sess=(()=>{try{return JSON.parse(localStorage.getItem("lvyue_sess")||"null")}catch(e){return null}})();
    if(sess&&sess.token){ this.token=sess.token; this.user=sess.user; }
    return this;
  },
  head(extra){
    const h={apikey:this.key,"Content-Type":"application/json"};
    if(this.token)h.Authorization="Bearer "+this.token;
    return Object.assign(h,extra||{});
  },
  async rest(path,opt){
    /* opt 自己也可能带 headers（如 insert 用的 Prefer），必须先摘出来合并进
       this.head()，再展开其余字段——否则外层 Object.assign 会用 opt.headers
       整个覆盖掉算好的 apikey/Authorization，导致所有带自定义 header 的写入
       （目前只有 insert）都会因缺 apikey 被 Supabase 拒绝。 */
    opt=opt||{};
    const {headers:extraHeaders,...restOpt}=opt;
    const r=await fetch(this.url+"/rest/v1/"+path,Object.assign({headers:this.head(extraHeaders)},restOpt));
    if(r.status===401){ throw new Error("登录已过期，请重新登录 ["+(await r.text()).slice(0,200)+"]") }
    if(!r.ok) throw new Error("接口错误 "+r.status+"："+(await r.text()).slice(0,180));
    const txt=await r.text(); return txt?JSON.parse(txt):null;
  },
  /* 云端账号 = 真实邮箱。不再拼假域名——Supabase 会校验域名真实性，
     伪造域名（如 xxx.local）会被直接拒绝而不是走认证失败，且无法做密码找回。 */
  async login(email,pw){
    email=String(email||"").trim();
    if(!email.includes("@"))throw new Error("云端模式下账号是邮箱地址，请输入完整邮箱");
    const r=await fetch(this.url+"/auth/v1/token?grant_type=password",{method:"POST",headers:{apikey:this.key,"Content-Type":"application/json"},
      body:JSON.stringify({email,password:pw})});
    if(!r.ok){
      const body=await r.json().catch(()=>({}));
      if(body.error_code==="email_not_confirmed")throw new Error("该账号还未确认邮箱。请到 Supabase 后台 Authentication→Providers→Email 关闭「Confirm email」后重试");
      throw new Error("账号或密码不对");
    }
    const j=await r.json();
    this.token=j.access_token;
    const meta=j.user.user_metadata||{};
    this.user={id:j.user.id,username:email,name:meta.name||email,role:meta.role||"user"};
    localStorage.setItem("lvyue_sess",JSON.stringify({token:this.token,user:this.user}));
    return this.user;
  },
  logout(){ this.token=null; this.user=null; localStorage.removeItem("lvyue_sess") },
  /* 用 anon key 的 signUp 建号：管理员点一下就生成账号+随机密码。
     email 必须是真实可达的邮箱域名（不必是本人常用邮箱，但域名要存在）。 */
  async createUser({username,name,role,password}){
    const email=String(username||"").trim();
    if(!email.includes("@"))throw new Error("云端模式下账号是邮箱地址，请输入完整邮箱，例如 zhangsan@qq.com");
    const r=await fetch(this.url+"/auth/v1/signup",{method:"POST",headers:{apikey:this.key,"Content-Type":"application/json"},
      body:JSON.stringify({email,password,data:{name,role:role||"user",username:email}})});
    if(!r.ok){
      const body=await r.json().catch(()=>({}));
      if(body.error_code==="email_address_invalid")throw new Error("这个邮箱地址被判定为无效，换一个真实域名的邮箱试试（如 qq.com / 163.com / gmail.com）");
      if(body.msg&&/already registered/i.test(body.msg))throw new Error("这个邮箱已经建过账号了");
      throw new Error("建号失败："+(body.msg||JSON.stringify(body)).slice(0,160));
    }
    return await r.json();
  },
  async loadAll(){
    const t=["contracts","materials","arrivals","invoices","payments","payplans","attachments","audit"];
    const got=await Promise.all(t.map(x=>this.rest(x+"?select=*&limit=5000")));
    this.data=emptyDB(); t.forEach((k,i)=>this.data[k]=got[i]||[]);
    this.data.users=[]; return this.data;
  },
  all(t){ return (this.data[t]||[]).slice() },
  async insert(t,row){
    row.id=row.id||uid(t[0]);
    const r=await this.rest(t,{method:"POST",headers:{Prefer:"return=representation"},body:JSON.stringify(row)});
    const saved=(r&&r[0])||row; this.data[t].push(saved); return saved;
  },
  async update(t,id,patch){
    await this.rest(t+"?id=eq."+encodeURIComponent(id),{method:"PATCH",body:JSON.stringify(patch)});
    const r=this.data[t].find(x=>x.id===id); if(r)Object.assign(r,patch); return r;
  },
  async remove(t,id){
    await this.rest(t+"?id=eq."+encodeURIComponent(id),{method:"DELETE"});
    this.data[t]=this.data[t].filter(x=>x.id!==id);
  },
  async removeWhere(t,fn){
    const gone=this.data[t].filter(fn);
    for(const g of gone) await this.remove(t,g.id);
  },
  async putFile(id,dataUrl){
    const blob=await (await fetch(dataUrl)).blob();
    const r=await fetch(this.url+"/storage/v1/object/attachments/"+id,{method:"POST",headers:{apikey:this.key,Authorization:"Bearer "+this.token},body:blob});
    if(!r.ok)throw new Error("附件上传失败："+(await r.text()).slice(0,140));
  },
  async getFile(id){
    const r=await fetch(this.url+"/storage/v1/object/attachments/"+id,{headers:{apikey:this.key,Authorization:"Bearer "+this.token}});
    if(!r.ok)return null;
    return await new Promise(ok=>{const fr=new FileReader();fr.onload=()=>ok(fr.result);fr.readAsDataURL(new Blob([new Uint8Array(0)]))});
  },
  async delFile(id){ await fetch(this.url+"/storage/v1/object/attachments/"+id,{method:"DELETE",headers:{apikey:this.key,Authorization:"Bearer "+this.token}}) }
};

/* ============================================================
   业务计算
   ============================================================ */
const Store={
  be:null, me:null,
  async useLocal(){ this.be=await LocalBackend.init(); return this.be },
  async useCloud(cfg){ this.be=await CloudBackend.init(cfg); return this.be },
  t(n){ return this.be.all(n) },
  /* 合同聚合 */
  view(){
    const mats=this.t("materials"),arr=this.t("arrivals"),inv=this.t("invoices"),pay=this.t("payments"),plans=this.t("payplans"),att=this.t("attachments");
    const byC=(list)=>{const m={};list.forEach(x=>{(m[x.contract_id]=m[x.contract_id]||[]).push(x)});return m};
    const M=byC(mats),A=byC(arr),I=byC(inv),P=byC(pay),PL=byC(plans),AT=byC(att);
    return this.t("contracts").map(o=>{
      const ms=M[o.id]||[],as=A[o.id]||[],is=I[o.id]||[],ps=P[o.id]||[],pls=PL[o.id]||[],ats=AT[o.id]||[];
      return {o,ms,as,is,ps,pls,ats,c:calcContract(o,ms,as,is,ps)};
    });
  }
};
function calcContract(o,ms,as,is,ps){
  const tot=+o.total_amount||0;
  const arr=as.reduce((s,x)=>s+(+x.amount||0),0);
  const inv=is.reduce((s,x)=>s+(+x.amount||0),0);
  const paid=ps.reduce((s,x)=>s+(+x.amount||0),0);
  const c={arr,inv,paid,owe:Math.max(0,tot-paid)};
  c.arrPct=tot?Math.min(1,arr/tot):0; c.invPct=tot?Math.min(1,inv/tot):0; c.payPct=tot?Math.min(1,paid/tot):0;
  c.dueDate=d(o.promised_delivery_date)||d(o.contract_delivery_date);
  c.dueSrc=o.promised_delivery_date?"承诺交期":(o.contract_delivery_date?"约定交期":"无交期");
  c.due=c.dueDate?iso(c.dueDate):"—";
  c.late=(c.arrPct<1&&c.dueDate)?Math.max(0,days(TODAY,c.dueDate)):0;
  c.gap=c.dueDate?days(c.dueDate,TODAY):null;
  c.arrS=c.arrPct<=0?"未到货":c.arrPct<1?"部分到货":"全部到货";
  c.invS=c.invPct<=0?"未开票":c.invPct<1?"部分开票":"全部开票";
  c.payS=c.payPct<=0?"未付款":c.payPct<1?"部分付款":"全部付清";
  c.closed=c.arrPct>=1&&c.owe<=0.005;
  c.sev=c.late>0?"crit":(c.arrPct<1&&c.gap!=null&&c.gap<=7)?"warn":(c.closed?"ok":"info");
  c.risk=(c.late>0?c.late*10:0)+(c.owe>1e6?30:c.owe>1e5?15:c.owe>0?5:0)+(c.arrPct<1?5:0);
  /* 物料行级到货 */
  c.lines=ms.map(m=>{
    const got=as.filter(a=>a.material_id===m.id).reduce((s,a)=>s+(+a.qty||0),0);
    const planq=+m.plan_qty||0;
    return {m,arrived:got,short:Math.max(0,planq-got),pct:planq?Math.min(1,got/planq):0};
  });
  c.shortLines=c.lines.filter(l=>l.short>0.0001);
  return c;
}

/* ---------- 付款条件 → 付款节点 ---------- */
function genPlan(o,c){
  const txt=String(o.pay_condition_text||"").trim(), tot=+o.total_amount||0, out=[];
  const due=c&&c.due!=="—"?c.due:(o.promised_delivery_date||o.contract_delivery_date||"");
  const push=(name,ratio,dd)=>out.push({name,ratio,amount:+(tot*ratio).toFixed(2),due_date:dd||""});
  if(!txt){ push("全额",1,due); return out }
  let matched=false;
  const rx=/(预付|定金|发货付|发货|货到付|货到|验收付|验收|质保金|质保|尾款)\D{0,4}(\d{1,3})\s*%/g;
  let m;
  while((m=rx.exec(txt))){
    matched=true; const k=m[1],r=(+m[2])/100;
    if(/预付|定金/.test(k)) push("预付款",r,o.sign_date||"");
    else if(/发货/.test(k)) push("发货款",r,o.shipment_notice_date||due);
    else if(/货到|验收/.test(k)) push("到货款",r,due);
    else if(/质保/.test(k)) push("质保金",r,due?addDays(due,365):"");
    else push("尾款",r,due);
  }
  const mon=txt.match(/月结\s*(\d{1,3})?\s*天?/);
  if(mon){ matched=true; const n=mon[1]?+mon[1]:30;
    const rest=1-out.reduce((s,x)=>s+x.ratio,0);
    if(rest>0.001) push("月结"+n+"天",rest,due?addDays(due,n):""); }
  if(!matched){
    const p=txt.match(/(\d{1,3})\s*%/);
    if(p) push(txt,(+p[1])/100,due); else push(txt,1,due);
  }
  const sum=out.reduce((s,x)=>s+x.ratio,0);
  if(sum<0.999) push("余款",+(1-sum).toFixed(4),due);
  return out;
}

/* ---------- 导入映射 ---------- */
const MAP={
 "合同号":"contract_no","订单编号":"order_no","采购组织":"purchase_org","项目":"project","采购员":"purchaser",
 "合同名称":"contract_name","供应商":"supplier_name","供应商名称":"supplier_name","合同总额":"total_amount",
 "币别":"currency","币种":"currency","签订日期":"sign_date","约定交期":"contract_delivery_date",
 "采购计划到货日期":"contract_delivery_date","承诺交期":"promised_delivery_date","装箱单日期":"packing_list_date",
 "发货通知日期":"shipment_notice_date","要求到港日期":"required_arrival_date","物流负责人":"logistics_owner",
 "付款条件":"pay_condition_text","交货地址":"delivery_address","合同备注":"remark",
 "已到货金额":"_arr","已开票金额":"_inv","已支付金额":"_paid","已付款金额":"_paid",
 "行号":"line_no","物料编码":"material_code","物料名称":"material_name","规格型号":"spec","单位":"unit",
 "订购数量":"plan_qty","含税单价":"price_tax_in","价税合计":"amount_tax_in","税率":"tax_rate",
 "物料品牌":"brand","信息编码":"info_code","需求人":"demand_user","订单行备注":"line_remark"
};
const DATE_FIELDS=["sign_date","contract_delivery_date","promised_delivery_date","packing_list_date","shipment_notice_date","required_arrival_date"];
const HEAD_FIELDS=["order_no","purchase_org","project","purchaser","contract_name","supplier_name","currency",
  "sign_date","contract_delivery_date","promised_delivery_date","packing_list_date","shipment_notice_date",
  "required_arrival_date","logistics_owner","pay_condition_text","delivery_address","remark"];

function parseTable(text){
  const t=String(text||"").replace(/\r/g,"").trim(); if(!t)return null;
  const lines=t.split("\n").filter(l=>l.trim()!=="");
  if(lines.length<2)return null;
  const sep=(lines[0].match(/\t/g)||[]).length>=(lines[0].match(/,/g)||[]).length?"\t":",";
  const split=l=>{
    if(sep==="\t")return l.split("\t");
    const out=[];let cur="",q=false;
    for(let i=0;i<l.length;i++){const ch=l[i];
      if(q){ if(ch==='"'){ if(l[i+1]==='"'){cur+='"';i++} else q=false } else cur+=ch }
      else { if(ch==='"')q=true; else if(ch===","){out.push(cur);cur=""} else cur+=ch }}
    out.push(cur);return out};
  const head=split(lines[0]).map(h=>h.trim().replace(/^﻿/,"").replace(/[▲▼①②③\s]/g,""));
  const keys=head.map(h=>MAP[h]||null);
  if(!keys.includes("contract_no"))return {error:"没有找到「合同号」列，请确认复制时带上了表头行"};
  const data=lines.slice(1).map(l=>{const cs=split(l),r={};keys.forEach((k,i)=>{if(k)r[k]=(cs[i]||"").trim()});return r}).filter(r=>r.contract_no);
  return {head,keys,data,isMaterial:keys.includes("material_code")||keys.includes("material_name")};
}
