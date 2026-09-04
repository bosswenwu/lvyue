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
/* id 生成器。随机部分只有 100 万种取值，而批量写入时一整批 id 是在同一个
   同步循环里生成的——Date.now() 完全相同，于是只剩那 100 万种可选。按生日
   问题算，一批 138 行就有约 1% 撞车、385 行约 7%。数据库里 id 是主键，一撞
   整批 INSERT 就被拒，导入直接中断。
   实测用户那份 2798 行的表，一次云端导入约 11.4% 的概率会炸在主键重复上。
   本机模式（IndexedDB）不校验唯一性，所以本地测试永远发现不了，只在云端炸。
   加一个单调递增的会话内计数器：同一个会话里绝无可能重复；跨会话跨设备仍靠
   时间戳加随机数，两台机器要在同一毫秒、同一随机数、同一序号上同时撞才可能。 */
let _uidSeq=0;
const uid=p=>(p||"r")+Date.now().toString(36)+(_uidSeq++).toString(36)+Math.floor(Math.random()*1e6).toString(36);
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
  /* 乐观锁条件更新：只有当前 version 仍等于 expectVer 才写。冲突返回 {row:null}。 */
  async updateVersioned(t,id,patch,expectVer){
    const r=this.data[t].find(x=>x.id===id);
    if(r&&(+r.version||0)!==(+expectVer||0)) return {row:null,locked:true};
    if(r)Object.assign(r,patch); await this.flush(); return {row:r||null,locked:true};
  },
  async remove(t,id){ this.data[t]=this.data[t].filter(x=>x.id!==id); await this.flush() },
  async removeWhere(t,fn){ this.data[t]=this.data[t].filter(x=>!fn(x)); await this.flush() },
  async removeByField(t,field,values){ const set=new Set(values); this.data[t]=this.data[t].filter(x=>!set.has(x[field])); await this.flush() },
  /* 按唯一键合并写入。本机模式没有唯一约束，自己按 key 找一遍。 */
  async upsertMany(t,rows,onConflict){
    if(!rows||!rows.length)return [];
    const key=onConflict||"id";
    const idx=new Map(this.data[t].map((r,i)=>[r[key],i]));
    for(const row of rows){
      row.id=row.id||uid(t[0]);
      const i=idx.get(row[key]);
      if(i==null){ idx.set(row[key],this.data[t].length); this.data[t].push(row) }
      else Object.assign(this.data[t][i],row);
    }
    await this.flush(); return rows;
  },
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
  async setUser(id,patch){ const u=this.data.users.find(x=>x.id===id); if(u)Object.assign(u,patch); await this.flush(); return u },
  async setUserName(id,name){ return this.setUser(id,{name}) }
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
  kind:"cloud", url:null, key:null, token:null, refresh:null, expAt:0, user:null, data:null, _refreshing:null,
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
    if(sess&&sess.token&&sess.stamp===this.stamp()){
      this.token=sess.token; this.user=sess.user;
      this.refresh=sess.refresh||null; this.expAt=+sess.expAt||0;
    }
    else if(sess) localStorage.removeItem("lvyue_sess");
    return this;
  },
  stamp(){ return this.url+"|"+this.key },
  persist(){ localStorage.setItem("lvyue_sess",JSON.stringify({token:this.token,refresh:this.refresh,expAt:this.expAt,user:this.user,stamp:this.stamp()})) },
  /* ---------- 会话续期 ----------
     Supabase 的 access token 默认 1 小时过期。原来只存 access_token、
     把 refresh_token 丢掉了，于是页面开过一小时，任何写操作都拿 401，
     提示「登录已过期，请重新登录」——正在导入的话会断在一半。
     现在存下 refresh_token 和过期时刻：请求前若快到期就先续期，万一还是
     拿了 401 就续期一次再重放这次请求。
     refresh_token 在 Supabase 是一次性的（用一次就换新的），所以并发请求
     必须共用同一个续期 Promise，否则几个请求各自拿同一个 refresh_token 去
     续期，后到的会因为凭证已被作废而失败，把人踢回登录页。 */
  setSession(j){
    this.token=j.access_token;
    if(j.refresh_token)this.refresh=j.refresh_token;
    this.expAt=Date.now()+((+j.expires_in||3600)*1000);
    this.persist();
  },
  async refreshSession(){
    if(this._refreshing)return this._refreshing;            // 并发共用同一次续期
    if(!this.refresh)throw new Error("没有可用的续期凭证");
    this._refreshing=(async()=>{
      const r=await fetch(this.url+"/auth/v1/token?grant_type=refresh_token",{method:"POST",
        headers:{apikey:this.key,"Content-Type":"application/json"},
        body:JSON.stringify({refresh_token:this.refresh})});
      if(!r.ok){ this.logout(); throw new Error("会话已过期且无法自动续期，请重新登录") }
      const j=await r.json(); this.setSession(j); return j;
    })();
    try{ return await this._refreshing } finally{ this._refreshing=null }
  },
  /* 提前 60 秒续期，避免请求正好卡在过期那一瞬间 */
  async ensureFresh(){
    if(!this.token||!this.refresh||!this.expAt)return;
    if(Date.now()>this.expAt-60000){ try{ await this.refreshSession() }catch(e){} }
  },
  /* 带鉴权的 fetch：先保证令牌新鲜，拿到 401 再续期一次并重放。
     附件走 Storage 接口、不经过 rest()，所以单独抽出来两边共用。 */
  async authFetch(url,opt){
    await this.ensureFresh();
    const build=()=>Object.assign({},opt,{headers:Object.assign({apikey:this.key},(opt&&opt.headers)||{},
      this.token?{Authorization:"Bearer "+this.token}:{})});
    let r=await fetch(url,build());
    if(r.status===401&&this.refresh){
      try{ await this.refreshSession(); r=await fetch(url,build()); }catch(e){}
    }
    return r;
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
    await this.ensureFresh();
    const go=()=>fetch(this.url+"/rest/v1/"+path,Object.assign({headers:this.head(extraHeaders)},restOpt));
    let r=await go();
    /* 令牌过期了就自动续一次再重放，而不是把人踢回登录页 */
    if(r.status===401&&this.refresh){
      try{ await this.refreshSession(); r=await go(); }catch(e){}
    }
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
    this.setSession(j);
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
    this.persist();
    return this.user;
  },
  async setUserRole(targetId,newRole,newDisabled){
    await this.rest("rpc/set_user_role",{method:"POST",body:JSON.stringify({target_id:targetId,new_role:newRole,new_disabled:newDisabled})});
  },
  /* 改名走 set_user_name() 函数：管理员可改任何人，本人可改自己，函数内部校验 */
  async setUserName(targetId,name){
    await this.rest("rpc/set_user_name",{method:"POST",body:JSON.stringify({target_id:targetId,new_name:name})});
  },
  logout(){ this.token=null; this.refresh=null; this.expAt=0; this.user=null; localStorage.removeItem("lvyue_sess") },
  /* 用 anon key 的 signUp 建号：管理员点一下就生成账号+随机密码。
     email 必须是真实可达的邮箱域名（不必是本人常用邮箱，但域名要存在）。
     新账号一律从「成员」开始——role 字段即使传了也会被数据库触发器忽略，
     要升管理员必须已登录的管理员调用 setUserRole()。 */
  /* 建号走 Edge Function，不再走公开注册。
     公开注册必须关掉（本仓库公开、key 在代码里、RLS 又是任何登录用户可读写
     全部数据），关掉之后 /auth/v1/signup 就用不了了。真正建号需要 service_role
     密钥，而它绝对不能出现在前端——那等于把整个数据库的钥匙公开。
     所以建号挪到服务端函数里：service_role 只存在于函数的环境变量中，浏览器
     拿不到；函数自己会校验调用者确实是管理员（见 supabase/functions/
     admin-create-user/index.ts 的注释）。
     函数没部署时不要报一句看不懂的话，明确给出两条可行路径。 */
  async createUser({username,name,password}){
    const email=String(username||"").trim();
    if(!email.includes("@"))throw new Error("云端模式下账号是邮箱地址，请输入完整邮箱，例如 zhangsan@qq.com");
    let r;
    try{
      r=await this.authFetch(this.url+"/functions/v1/admin-create-user",
        {method:"POST",headers:{"Content-Type":"application/json"},
         body:JSON.stringify({email,password,name})});
    }catch(e){
      throw new Error("连不上建号服务。检查网络；若网络正常，多半是建号函数还没部署——"+
        "可以先到 Supabase 后台 Authentication → Users → Add user 手工建号（记得勾 Auto Confirm User）。");
    }
    if(r.status===404)
      throw new Error("建号函数还没部署，所以暂时不能在这里建号。两个办法："+
        "①（推荐，一次性）Supabase 控制台 → Edge Functions → Deploy a new function，名字填 "+
        "admin-create-user，把仓库里 supabase/functions/admin-create-user/index.ts 的内容粘进去部署；"+
        "② 每次到 Authentication → Users → Add user 手工建，记得勾选 Auto Confirm User。");
    const body=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error(body.error||("建号失败（HTTP "+r.status+"）"));
    return body;
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
  async insertMany(t,rows,onBatch){
    if(!rows||!rows.length)return [];
    rows.forEach(r=>{r.id=r.id||uid(t[0])});
    const out=[];
    for(let i=0;i<rows.length;i+=500){
      const batch=rows.slice(i,i+500);
      const r=await this.rest(t,{method:"POST",headers:{Prefer:"return=representation"},body:JSON.stringify(batch)});
      const saved=(r&&r.length)?r:batch;
      saved.forEach(x=>this.data[t].push(x)); out.push(...saved);
      if(onBatch)onBatch(Math.min(i+500,rows.length),rows.length);
    }
    return out;
  },
  /* 按唯一键批量合并写入（PostgREST 的 upsert）。
     导入时几百份合同大多是「已存在、要更新」，而 PATCH 一次只能改一行，
     于是 385 份合同就是 385 次串行往返。用户实测每次往返约 5.5 秒，
     整个导入要跑近两小时。改成 on_conflict + merge-duplicates 之后，
     500 份合同一个请求就写完。
     关键：必须发「合并后的完整行」。merge-duplicates 是整行覆盖，只发改动的
     字段会把其余列打成默认值。内存里的行本来就是 select=* 取回来的完整行，
     在它上面合并 patch 再发回去，任何列都不会丢——包括后来加的 version。 */
  async upsertMany(t,rows,onConflict,onBatch){
    if(!rows||!rows.length)return [];
    rows.forEach(r=>{r.id=r.id||uid(t[0])});
    const q=onConflict?("?on_conflict="+encodeURIComponent(onConflict)):"";
    for(let i=0;i<rows.length;i+=500){
      const batch=rows.slice(i,i+500);
      await this.rest(t+q,{method:"POST",
        headers:{Prefer:"resolution=merge-duplicates,return=minimal"},
        body:JSON.stringify(batch)});
      if(onBatch)onBatch(Math.min(i+500,rows.length),rows.length);
    }
    /* 同步内存副本 */
    const key=onConflict||"id";
    const idx=new Map(this.data[t].map((r,i)=>[r[key],i]));
    for(const row of rows){
      const i=idx.get(row[key]);
      if(i==null){ idx.set(row[key],this.data[t].length); this.data[t].push(row) }
      else Object.assign(this.data[t][i],row);
    }
    return rows;
  },
  /* 按某个字段的一批取值删除。导入时要清掉几百份合同的旧物料——
     逐份合同发一个 DELETE 是几百次往返，按 contract_id 批量删只要几次。 */
  async removeByField(t,field,values){
    const vals=[...new Set(values)].filter(v=>v!=null);
    if(!vals.length)return;
    for(let i=0;i<vals.length;i+=100){
      const list=vals.slice(i,i+100).map(x=>encodeURIComponent('"'+String(x).replace(/"/g,'\\"')+'"')).join(",");
      await this.rest(t+"?"+field+"=in.("+list+")",{method:"DELETE"});
    }
    const set=new Set(vals);
    this.data[t]=this.data[t].filter(x=>!set.has(x[field]));
  },
  async update(t,id,patch){
    await this.rest(t+"?id=eq."+encodeURIComponent(id),{method:"PATCH",body:JSON.stringify(patch)});
    const r=this.data[t].find(x=>x.id===id); if(r)Object.assign(r,patch); return r;
  },
  /* 乐观锁条件更新：PATCH 时带 version=eq.<expectVer> 过滤，只有没被别人改过才命中。
     return=representation 拿回受影响的行——为空说明 version 已经变了（有人抢先改了），
     返回 {row:null} 交给上层提示冲突。version 列不存在（迁移没跑）时不该走到这里，
     上层用「加载到的行里有没有 version 字段」来决定用不用锁。 */
  async updateVersioned(t,id,patch,expectVer){
    const r=await this.rest(t+"?id=eq."+encodeURIComponent(id)+"&version=eq."+(+expectVer||0),
      {method:"PATCH",headers:{Prefer:"return=representation"},body:JSON.stringify(patch)});
    const row=(r&&r[0])||null;
    if(row){ const c=this.data[t].find(x=>x.id===id); if(c)Object.assign(c,patch); }
    return {row,locked:true};
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
    const r=await this.authFetch(this.url+"/storage/v1/object/attachments/"+id,{method:"POST",
      headers:{"x-upsert":"true"},body:blob});
    if(!r.ok)throw new Error("附件上传失败："+(await r.text()).slice(0,140));
  },
  async getFile(id){
    const r=await this.authFetch(this.url+"/storage/v1/object/attachments/"+id,{});
    if(!r.ok)return null;
    /* 必须读 r 自己的响应体。之前这里读的是一个新建的空 Blob，
       导致云端模式下载下来的附件全是 0 字节。 */
    const blob=await r.blob();
    return await new Promise((ok,no)=>{const fr=new FileReader();fr.onload=()=>ok(fr.result);fr.onerror=()=>no(new Error("附件读取失败"));fr.readAsDataURL(blob)});
  },
  async delFile(id){ await this.authFetch(this.url+"/storage/v1/object/attachments/"+id,{method:"DELETE"}) }
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
    /* 验收要跟到货分开。原来两者都叫「到货款」，于是「预付30%，货到付30%，
       验收付30%，质保付10%」会生成两个同名同到期日的「到货款」节点，登记
       付款时根本分不清哪个是哪个。用户表里有 9 份合同是这种写法。
       到期日按「交期 + 30 天」：验收总在到货之后，跟到货同一天到期是不对的，
       会把验收款提前压进现金流预测。30 天是通用默认值，具体天数各家不同，
       可以在付款计划页按合同手工改。 */
    else if(/验收/.test(k)) push("验收款",r,due?addDays(due,30):"");
    else if(/货到/.test(k)) push("到货款",r,due);
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
 "订单编号":"order_no","订单号":"order_no","采购订单号":"order_no","采购组织":"purchase_org","项目":"project",
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
 "物料编码":"material_code","物料编号":"material_code","物料代码":"material_code",
 "物料名称":"material_name","品名":"material_name","物资名称":"material_name",
 "规格型号":"spec","规格":"spec","单位":"unit",
 "订购数量":"plan_qty","数量":"plan_qty",
 "含税单价":"price_tax_in","单价":"price_tax_in",
 "价税合计":"amount_tax_in","含税总价":"amount_tax_in","含税金额":"amount_tax_in","总价":"amount_tax_in",
 "税率":"tax_rate","增值税率":"tax_rate","物料品牌":"brand","品牌":"brand",
 "信息编码":"info_code","请购信息":"info_code","请购单号":"info_code",
 "需求人":"demand_user","订单行备注":"line_remark","备注":"line_remark","单重/千克":"unit_weight"
};
const DATE_FIELDS=["sign_date","contract_delivery_date","promised_delivery_date","packing_list_date","shipment_notice_date","required_arrival_date"];
const HEAD_FIELDS=["order_no","purchase_org","project","purchaser","contract_name","supplier_name","currency",
  "sign_date","contract_delivery_date","promised_delivery_date","packing_list_date","shipment_notice_date",
  "required_arrival_date","logistics_owner","pay_condition_text","delivery_address","remark"];

const cleanHead=h=>String(h||"").trim().replace(/^﻿/,"").replace(/[▲▼①②③]/g,"").replace(/\s+/g,"");
/* 表头末尾的括号单位后缀，例如「含税单价（元）」「价税合计(元）」「重量（吨）」。
   全半角经常混用，甚至一个括号左半角右全角（用户的表里就有 "价税合计(元）"），
   所以左右括号各自都接受两种写法。 */
const stripUnit=h=>h.replace(/[（(][^（()）]*[)）]$/,"");
/* 表头 → 字段名。逐级放宽地匹配，而不是只认一个写法：
     1. 原样命中 MAP
     2. 去掉末尾括号单位后再试   含税单价（元） → 含税单价
     3. 去掉「合同/采购/订单」前缀再试  合同物料名称 → 物料名称、采购订单号 → 订单号
   顺序很重要：先原样匹配，「合同号」「合同名称」「合同总额」「采购员」这些
   本身就是正式字段名的表头才不会被第 3 步误剥。
   起因：用户导出的「摩通合同列表」15 列里有 9 列因为这三类写法差异没被认出来，
   其中包括物料名称和物料编号，导致整表被误判成合同台账表——385 份合同全成了
   没有金额、没有物料的空壳，合同总额从 3.07 亿变成 0。 */
function headKey(h){
  const c=cleanHead(h);
  if(MAP[c])return MAP[c];
  const u=stripUnit(c);
  if(u!==c&&MAP[u])return MAP[u];
  const p=u.replace(/^(合同|采购|订单)/,"");
  if(p&&p!==u&&MAP[p])return MAP[p];
  return null;
}
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
    const hits=cells.filter(h=>headKey(h)).length;
    if(!cells.map(h=>headKey(h)).includes("contract_no"))continue;
    if(hits>bestScore){bestScore=hits;headIdx=i}
  }
  if(headIdx<0)return {error:"没有找到「合同号」列。请确认复制/导出的内容里带着表头行（系统会在前 15 行里自动找表头）"};
  const head=split(lines[headIdx]).map(cleanHead);
  const keys=head.map(h=>headKey(h));
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
  const data=raw.filter(r=>r.contract_no&&!headKey(r.contract_no));  // 跳过重复出现的表头行
  return {head,keys,data,headRow:headIdx+1,carried,
    isMaterial:keys.includes("material_code")||keys.includes("material_name")};
}
