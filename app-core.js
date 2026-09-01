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
  async insertMany(t,rows){ if(!rows||!rows.length)return []; rows.forEach(r=>{r.id=r.id||uid(t[0]);this.data[t].push(r)}); await this.flush(); return rows },
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
/* 团队默认的云端项目，写死在代码里——这样任何人打开这个网址，
   不管什么设备什么浏览器，都默认连同一个云端库，不用每人手动
   在「数据管理」里填一遍地址和 key（之前就是因为这个，同一个人
   换个浏览器就会被当成本机模式，看到的是"建管理员"而不是登录框）。
   要接到别的 Supabase 项目，就改这两个值，或者仍然可以用
   「数据管理→接入云端」在某台设备上临时覆盖（存那台设备的浏览器里）。 */
const DEFAULT_CLOUD_CFG={
  url:"https://acvpjtlokrygvnwuuewr.supabase.co",
  key:"sb_publishable_j81sdF6Rd1lW_QVf_dZ1Kw_BSlYtA3N"
};
const CloudBackend={
  kind:"cloud", url:null, key:null, token:null, user:null, data:null,
  cfg(){
    /* forceLocal 是显式"我就要本机模式"的标记（数据管理页「断开，改回本机」按钮写入）。
       光是删掉本地覆盖值不够——那样会落回下面的默认云端配置，等于点了没用。 */
    try{
      const s=JSON.parse(localStorage.getItem("lvyue_cloud_cfg")||"null");
      if(s&&s.forceLocal) return null;
      /* 只认「人手工填过的」覆盖值（manual 标记，数据管理页保存时写入）。
         以前 init() 会把默认配置也原样写回 localStorage，于是默认地址/密钥
         一旦更新（最典型的就是 Supabase 把旧 anon key 换成 publishable key、
         旧 key 随即失效），老浏览器里存的还是当初那份旧的，永远拿不到新配置——
         表现就是「用了好好的，某天突然登不上了」，而换台新设备/新浏览器反而正常。
         没有 manual 标记的旧记录一律忽略，直接用代码里的默认配置。 */
      if(s&&s.manual&&s.url&&s.key) return {url:s.url,key:s.key,manual:true};
    }catch(e){}
    return DEFAULT_CLOUD_CFG.url?{url:DEFAULT_CLOUD_CFG.url,key:DEFAULT_CLOUD_CFG.key}:null;
  },
  async init(cfg){
    cfg=cfg||this.cfg(); if(!cfg||!cfg.url||!cfg.key)throw new Error("未配置云端");
    this.url=cfg.url.replace(/\/+$/,""); this.key=cfg.key;
    /* 这里不再把配置写回 localStorage：写回去的那份会被 cfg() 当成"用户的覆盖值"，
       把代码里的默认配置永久钉死在这台浏览器上（见 cfg() 的注释）。
       只有数据管理页「接入云端」手工保存时才写，且带 manual 标记。 */
    const sess=(()=>{try{return JSON.parse(localStorage.getItem("lvyue_sess")||"null")}catch(e){return null}})();
    /* 会话是绑定「哪个项目 + 哪把密钥」的。配置换过之后还留着旧 token，
       只会在后面每一个请求上拿 401，不如在这里就丢掉，干脆退回登录页重登一次。 */
    if(sess&&sess.token&&sess.stamp===this.stamp()){ this.token=sess.token; this.user=sess.user; }
    else if(sess) localStorage.removeItem("lvyue_sess");
    return this;
  },
  stamp(){ return this.url+"|"+this.key },
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
    let r;
    try{
      r=await fetch(this.url+"/auth/v1/token?grant_type=password",{method:"POST",headers:{apikey:this.key,"Content-Type":"application/json"},
        body:JSON.stringify({email,password:pw})});
    }catch(e){
      /* fetch 直接抛 = 请求根本没发出去或没拿到响应：断网、DNS 解析不了、
         项目被暂停/删除后域名不再解析、被网络策略挡掉。跟密码没有任何关系。 */
      throw new Error("连不上云端服务器（"+this.url+"）。先检查网络；如果网络正常，多半是这个 Supabase 项目被暂停或删除了——免费项目长时间没人访问会自动暂停，到 Supabase 后台点 Restore 恢复即可。");
    }
    if(!r.ok){
      /* 以前这里不管什么状态码一律报「账号或密码不对」，于是密钥失效、项目暂停、
         被限流这些跟密码毫无关系的故障，全都表现成"密码错了"，只会让人一遍遍
         去试密码、去重置密码，永远修不到点子上。按状态码分开说清楚。 */
      const body=await r.json().catch(()=>({}));
      const code=String(body.error_code||body.error||"");
      const msg=String(body.msg||body.error_description||body.message||"");
      const raw=(msg||code)?("｜服务器原文："+(msg||code).slice(0,160)):"";
      if(code==="email_not_confirmed")throw new Error("该账号还未确认邮箱。请到 Supabase 后台 Authentication→Providers→Email 关闭「Confirm email」后重试");
      if(code==="user_banned")throw new Error("这个账号在 Supabase 后台被封禁了（banned），到 Authentication→Users 里解除即可"+raw);
      if(r.status===401||/api[ _-]?key/i.test(msg+code))
        throw new Error("云端密钥（API key）被拒绝了，这不是密码的问题。多半是 Supabase 里轮换过密钥、而这台浏览器还存着旧的那把。到「数据管理 → 接入云端」重新填一遍最新的 Project URL 和 Publishable key"+raw);
      if(r.status===429)
        throw new Error("登录太频繁，被 Supabase 限流了。等一两分钟再试，别连续点"+raw);
      if(r.status>=500||r.status===540)
        throw new Error("云端服务器返回 "+r.status+"，账号密码没走到校验那一步。多半是 Supabase 项目被暂停了，到后台点 Restore 恢复后再登"+raw);
      if(r.status===400&&/invalid[ _]?(login[ _]?)?credentials|invalid_grant/i.test(code+" "+msg))
        throw new Error("账号或密码不对。云端模式下账号是完整邮箱；密码忘了要到 Supabase 后台 Authentication→Users 里重置");
      throw new Error("登录失败（HTTP "+r.status+"）"+(raw||"｜服务器没有返回具体原因"));
    }
    const j=await r.json();
    this.token=j.access_token;
    const meta=j.user.user_metadata||{};
    /* role 绝不从这里的 metadata 取——那是登录时客户端自己传的，任何人都能伪造。
       真正的角色权威来源是数据库里的 profiles 表，见 fetchProfile()。 */
    this.user={id:j.user.id,username:email,name:meta.name||email,role:"user"};
    await this.fetchProfile();
    return this.user;
  },
  /* 权限的唯一可信来源：profiles 表由 handle_new_user 触发器写入，
     注册时客户端传什么 role 字段都不会被数据库采纳。
     如果 schema_v2_roles.sql 还没在 Supabase 项目里跑过（表不存在），
     不阻断登录——退回「按成员处理」，不锁任何人在外面；等表建好了
     下次登录会自动切换成数据库校验的真实角色，不需要谁再做什么。 */
  async fetchProfile(){
    try{
      const rows=await this.rest("profiles?id=eq."+this.user.id+"&select=role,disabled,name");
      const p=rows&&rows[0];
      if(!p) console.warn("这个账号还没有权限记录，暂时按「成员」处理，管理员可在「用户管理」或 Supabase 后台补上");
      else{
        if(p.disabled) throw new Error("该账号已被管理员停用");
        this.user.role=p.role; this.user.name=p.name||this.user.name;
      }
    }catch(e){
      if(/已被管理员停用/.test(e.message)) throw e; // 停用是真错误，必须拦下
      console.warn("profiles 表还不可用（可能没跑 schema_v2_roles.sql），暂时按「成员」处理：",e.message);
    }
    localStorage.setItem("lvyue_sess",JSON.stringify({token:this.token,user:this.user,stamp:this.stamp()}));
    return this.user;
  },
  async setUserRole(targetId,newRole,newDisabled){
    await this.rest("rpc/set_user_role",{method:"POST",body:JSON.stringify({target_id:targetId,new_role:newRole,new_disabled:newDisabled})});
  },
  logout(){ this.token=null; this.user=null; localStorage.removeItem("lvyue_sess") },
  /* 用 anon key 的 signUp 建号：管理员点一下就生成账号+随机密码。
     email 必须是真实可达的邮箱域名（不必是本人常用邮箱，但域名要存在）。
     新账号一律从「成员」开始——role 字段即使传了也会被数据库触发器忽略，
     要升管理员必须已登录的管理员调用 setUserRole()。 */
  async createUser({username,name,password}){
    const email=String(username||"").trim();
    if(!email.includes("@"))throw new Error("云端模式下账号是邮箱地址，请输入完整邮箱，例如 zhangsan@qq.com");
    const r=await fetch(this.url+"/auth/v1/signup",{method:"POST",headers:{apikey:this.key,"Content-Type":"application/json"},
      body:JSON.stringify({email,password,data:{name}})});
    if(!r.ok){
      const body=await r.json().catch(()=>({}));
      if(body.error_code==="email_address_invalid")throw new Error("这个邮箱地址被判定为无效，换一个真实域名的邮箱试试（如 qq.com / 163.com / gmail.com）");
      if(body.msg&&/already registered/i.test(body.msg))throw new Error("这个邮箱已经建过账号了");
      throw new Error("建号失败："+(body.msg||JSON.stringify(body)).slice(0,160));
    }
    return await r.json();
  },
  /* 分页读到底。原来固定 limit=5000，超出的行会被静默丢掉——
     物料明细最容易超（几百份合同就能到几千行），而且丢了完全没有提示，
     表现成"数据莫名其妙少了"，很难排查。 */
  async pageAll(t){
    const PAGE=1000; let out=[],from=0;
    for(let guard=0;guard<200;guard++){
      const rows=await this.rest(t+"?select=*&order=id.asc&offset="+from+"&limit="+PAGE);
      if(!rows||!rows.length)break;
      out=out.concat(rows);
      if(rows.length<PAGE)break;
      from+=PAGE;
    }
    return out;
  },
  async loadAll(){
    const t=["contracts","materials","arrivals","invoices","payments","payplans","attachments","audit"];
    const got=await Promise.all(t.map(x=>this.pageAll(x)));
    this.data=emptyDB(); t.forEach((k,i)=>this.data[k]=got[i]||[]);
    this.data.users=[]; return this.data;
  },
  all(t){ return (this.data[t]||[]).slice() },
  async insert(t,row){
    row.id=row.id||uid(t[0]);
    const r=await this.rest(t,{method:"POST",headers:{Prefer:"return=representation"},body:JSON.stringify(row)});
    const saved=(r&&r[0])||row; this.data[t].push(saved); return saved;
  },
  /* 批量插入：一次 POST 一个数组（PostgREST 原生支持），500 一批避免请求体过大。
     导入几千行物料时，从"一行一个请求"降到十几个请求，快一两个数量级。 */
  async insertMany(t,rows){
    if(!rows||!rows.length)return [];
    rows.forEach(r=>{r.id=r.id||uid(t[0])});
    const out=[];
    for(let i=0;i<rows.length;i+=500){
      const batch=rows.slice(i,i+500);
      const r=await this.rest(t,{method:"POST",headers:{Prefer:"return=representation"},body:JSON.stringify(batch)});
      const saved=(r&&r.length)?r:batch;
      saved.forEach(x=>this.data[t].push(x)); out.push(...saved);
    }
    return out;
  },
  async update(t,id,patch){
    await this.rest(t+"?id=eq."+encodeURIComponent(id),{method:"PATCH",body:JSON.stringify(patch)});
    const r=this.data[t].find(x=>x.id===id); if(r)Object.assign(r,patch); return r;
  },
  async remove(t,id){
    await this.rest(t+"?id=eq."+encodeURIComponent(id),{method:"DELETE"});
    this.data[t]=this.data[t].filter(x=>x.id!==id);
  },
  /* 按条件批量删除：本地先算出要删哪些 id，再用一条 id=in.(...) 一次删掉，
     而不是每行发一个 DELETE。删一份带几十行物料的合同从几十个请求降到一两个。
     id 太多会撑爆 URL 长度，按 100 个一批切开。 */
  async removeWhere(t,fn){
    const gone=this.data[t].filter(fn);
    if(!gone.length)return;
    const ids=gone.map(g=>g.id);
    for(let i=0;i<ids.length;i+=100){
      /* 每个 id 用双引号包起来再整体百分号编码，逗号分隔符保持原样——
         这样即使 id 里含特殊字符也不会被 PostgREST 误当成分隔符。 */
      const list=ids.slice(i,i+100).map(x=>encodeURIComponent('"'+String(x).replace(/"/g,'\\"')+'"')).join(",");
      await this.rest(t+"?id=in.("+list+")",{method:"DELETE"});
    }
    const goneSet=new Set(ids);
    this.data[t]=this.data[t].filter(x=>!goneSet.has(x.id));
  },
  /* 整库替换：还原备份、清空数据都走这里。
     顺序很重要——先删子表再删主表，否则外键会挡住；写回时反过来（主表先）。

     回滚保护：这是唯一一条会"先把线上库删光"的路径。以前写回中途一旦失败
     （断网 / 请求体过大 / RLS 拦截），旧数据已删、新数据只进去一半，等于
     还原备份反而把数据搞没了。现在删库前先在内存里存一份全量快照，写回失败
     就尽最大努力回滚到操作前的状态，并明确告诉用户当前处于什么状态。 */
  async replaceAll(next){
    const CHILD=["materials","arrivals","invoices","payments","payplans","attachments","audit"];
    const ORDER=["contracts",...CHILD];               // 写回顺序：主表先，子表后
    const backup={}; for(const t of ORDER) backup[t]=this.all(t);   // 删库前的安全副本
    const wipe=async()=>{
      for(const t of CHILD) await this.rest(t+"?id=not.is.null",{method:"DELETE"});
      await this.rest("contracts?id=not.is.null",{method:"DELETE"});
    };
    const writeBack=async src=>{
      for(const t of ORDER){
        const rows=(src&&src[t])||[];
        for(let i=0;i<rows.length;i+=500){   // 分批写，避免一次请求体过大被网关拒掉
          await this.rest(t,{method:"POST",headers:{Prefer:"return=minimal"},body:JSON.stringify(rows.slice(i,i+500))});
        }
      }
    };
    try{
      await wipe();
      await writeBack(next);
    }catch(e){
      try{ await wipe(); await writeBack(backup); }
      catch(e2){ throw new Error("还原失败，且自动回滚也没成功——数据库可能处于不完整状态，请不要再做写操作，尽快用最近一次导出的备份手动恢复。原始错误："+e.message+"｜回滚错误："+e2.message); }
      throw new Error("还原失败，已自动回滚到操作前的数据（未发生改动）。原因："+e.message);
    }
    await this.loadAll();
  },
  async putFile(id,dataUrl){
    const blob=await (await fetch(dataUrl)).blob();
    /* x-upsert 让同一个 id 重传时覆盖而不是报 409（重试、修正上传都会碰到） */
    const r=await fetch(this.url+"/storage/v1/object/attachments/"+id,{method:"POST",
      headers:{apikey:this.key,Authorization:"Bearer "+this.token,"x-upsert":"true"},body:blob});
    if(!r.ok)throw new Error("附件上传失败："+(await r.text()).slice(0,140));
  },
  async getFile(id){
    const r=await fetch(this.url+"/storage/v1/object/attachments/"+id,{headers:{apikey:this.key,Authorization:"Bearer "+this.token}});
    if(!r.ok)return null;
    /* 必须读 r 自己的响应体。之前这里读的是一个新建的空 Blob，
       导致云端模式下载下来的附件全是 0 字节。 */
    const blob=await r.blob();
    return await new Promise((ok,no)=>{const fr=new FileReader();fr.onload=()=>ok(fr.result);fr.onerror=()=>no(new Error("附件读取失败"));fr.readAsDataURL(blob)});
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
 "合同号":"contract_no","合同编号":"contract_no",
 "订单编号":"order_no","采购组织":"purchase_org","项目":"project",
 "采购员":"purchaser","责任人":"purchaser","采购负责人":"purchaser",
 "合同名称":"contract_name","供应商":"supplier_name","供应商名称":"supplier_name",
 "合同总额":"total_amount","合同金额":"total_amount",
 "币别":"currency","币种":"currency","签订日期":"sign_date","签订时间":"sign_date",
 "约定交期":"contract_delivery_date","采购计划到货日期":"contract_delivery_date",
 "计划交货日期":"contract_delivery_date","计划交期":"contract_delivery_date","要求交货日期":"contract_delivery_date",
 "承诺交期":"promised_delivery_date","供应商承诺交期":"promised_delivery_date",
 "装箱单日期":"packing_list_date","发货通知日期":"shipment_notice_date",
 "要求到港日期":"required_arrival_date","计划到货日期":"required_arrival_date",
 "物流负责人":"logistics_owner","付款条件":"pay_condition_text","付款方式":"pay_condition_text",
 "交货地址":"delivery_address","计划到货地点":"delivery_address","到货地点":"delivery_address",
 "合同备注":"remark","运输方式":"transport_mode",
 "已到货金额":"_arr","已开票金额":"_inv","已支付金额":"_paid","已付款金额":"_paid",
 "行号":"line_no","序号":"line_no",
 "物料编码":"material_code","物料名称":"material_name","品名":"material_name","物资名称":"material_name",
 "规格型号":"spec","规格":"spec","单位":"unit",
 "订购数量":"plan_qty","数量":"plan_qty",
 "含税单价":"price_tax_in","单价":"price_tax_in",
 "价税合计":"amount_tax_in","含税总价":"amount_tax_in","含税金额":"amount_tax_in","总价":"amount_tax_in",
 "税率":"tax_rate","物料品牌":"brand","品牌":"brand",
 "信息编码":"info_code","请购信息":"info_code","请购单号":"info_code",
 "需求人":"demand_user","订单行备注":"line_remark","备注":"line_remark","单重/千克":"unit_weight"
};
const DATE_FIELDS=["sign_date","contract_delivery_date","promised_delivery_date","packing_list_date","shipment_notice_date","required_arrival_date"];
const HEAD_FIELDS=["order_no","purchase_org","project","purchaser","contract_name","supplier_name","currency",
  "sign_date","contract_delivery_date","promised_delivery_date","packing_list_date","shipment_notice_date",
  "required_arrival_date","logistics_owner","pay_condition_text","delivery_address","remark"];

const cleanHead=h=>String(h||"").trim().replace(/^﻿/,"").replace(/[▲▼①②③]/g,"").replace(/\s+/g,"");
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
  /* 表头不一定在第一行。国内的表常见「大标题 + 分组表头 + 真表头」三层结构
     （例如第1行"刚果物资明细表"、第2~3行"采购信息/合同参数"、第4行才是
     合同号|供应商|…）。所以在前 15 行里挑"认出字段最多且含合同号"的那一行，
     它下面才是数据。 */
  const LOOK=Math.min(15,lines.length-1);
  let headIdx=-1,bestScore=0;
  for(let i=0;i<LOOK;i++){
    const cells=split(lines[i]).map(cleanHead);
    const hits=cells.filter(h=>MAP[h]).length;
    if(!cells.map(h=>MAP[h]).includes("contract_no"))continue;
    if(hits>bestScore){bestScore=hits;headIdx=i}
  }
  if(headIdx<0)return {error:"没有找到「合同号」列。请确认复制/导出的内容里带着表头行（系统会在前 15 行里自动找表头）"};
  const head=split(lines[headIdx]).map(cleanHead);
  const keys=head.map(h=>MAP[h]||null);
  const raw=lines.slice(headIdx+1).map(l=>{const cs=split(l),r={};keys.forEach((k,i)=>{if(k)r[k]=(cs[i]||"").trim()});return r});

  /* 合并单元格向下补齐。同一份合同的多行物料，Excel 里常把合同号、供应商、
     日期等合同级字段合并成一格，导出后只有第一行有值，后面全是空。
     不补的话这些行会因为"没有合同号"被整行丢掉——实测用户的表 2103 行物料
     里有 1713 行是这种情况，会丢掉八成数据。
     只在这一行确实有物料内容时才继承，避免把表格末尾的空行也带上。 */
  const CARRY=["contract_no","supplier_name","sign_date","contract_delivery_date",
    "promised_delivery_date","delivery_address","pay_condition_text","purchaser",
    "order_no","purchase_org","project","currency","logistics_owner","transport_mode","contract_name"];
  const last={};
  let carried=0;
  for(const r of raw){
    const hasContent=(r.material_name||r.material_code||r.spec||r.plan_qty||r.amount_tax_in);
    for(const k of CARRY){
      if(r[k])last[k]=r[k];
      else if(hasContent&&last[k]){ r[k]=last[k]; if(k==="contract_no")carried++ }
    }
  }
  const data=raw.filter(r=>r.contract_no&&!MAP[cleanHead(r.contract_no)]);  // 跳过重复出现的表头行
  return {head,keys,data,headRow:headIdx+1,carried,
    isMaterial:keys.includes("material_code")||keys.includes("material_name")};
}
