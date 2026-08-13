/* 履约云 · 界面层 */
"use strict";
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
let ME=null, VIEWDATA=[], curId=null, tabI=0, PENDING=null;

function say(m){const t=$("#toast");t.textContent=m;t.classList.add("on");clearTimeout(t._);t._=setTimeout(()=>t.classList.remove("on"),2600)}
const tone=s=>({crit:"var(--crit)",warn:"var(--warn)",ok:"var(--ok)",info:"var(--info)"}[s]);
function sevPill(c){
  if(c.late>0)return `<span class="pill crit">逾期 ${c.late} 天</span>`;
  if(c.arrPct<1&&c.gap!=null&&c.gap<=7)return `<span class="pill warn">${c.gap<=0?"今日到期":c.gap+" 天内交期"}</span>`;
  if(c.closed)return `<span class="pill ok">已闭环</span>`;
  if(c.arrPct>=1&&c.owe>0)return `<span class="pill info">待付款</span>`;
  return `<span class="pill mute">在途</span>`;
}
function prog(c){
  return `<div class="prog"><div class="track"><i style="width:${c.arrPct*100}%;background:var(--info)"></i></div>
  <div class="track"><i style="width:${c.invPct*100}%;background:var(--accent)"></i></div>
  <div class="track"><i style="width:${c.payPct*100}%;background:var(--ok)"></i></div>
  <div class="lg"><span>到 ${Math.round(c.arrPct*100)}%</span><span>票 ${Math.round(c.invPct*100)}%</span><span>付 ${Math.round(c.payPct*100)}%</span></div></div>`;
}
function modal(title,body,foot){
  $("#mTitle").textContent=title;$("#mBody").innerHTML=body;$("#mFoot").innerHTML=foot||"";
  $("#modal").classList.add("on");
  const f=$("#mBody").querySelector("input,select,textarea");if(f)setTimeout(()=>f.focus(),40);
}
const closeModal=()=>$("#modal").classList.remove("on");
function download(name,content,type){
  const blob=content instanceof Blob?content:new Blob([content],{type:type||"text/plain;charset=utf-8"});
  const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=name;a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href),4000);
}
function csv(rowsArr,cols,names,name){
  const cell=v=>{
    v=v??"";
    let s=String(v);
    /* 以 = + - @ 开头的单元格，Excel 会当成公式执行。备注、供应商名这些
       字段是人手输入的，可能无意（也可能恶意）以这些字符开头，加个前置
       单引号让 Excel 老实当文本显示。 */
    if(/^[=+\-@\t\r]/.test(s)) s="'"+s;
    return /[",\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;
  };
  download(name,"﻿"+cols.map(c=>names[c]||c).join(",")+"\n"+rowsArr.map(r=>cols.map(c=>cell(r[c])).join(",")).join("\n"),"text/csv;charset=utf-8");
  say("已导出 "+name);
}
async function logIt(cid,what){ await Store.be.insert("audit",{contract_id:cid,at:nowTS(),who:(ME&&ME.name)||"系统",what}) }
function reload(){ VIEWDATA=Store.view(); }

/* ================= 登录 ================= */
async function boot(){
  try{const th=localStorage.getItem("ly_theme");if(th)document.documentElement.dataset.theme=th}catch(e){}
  if(!window.isSecureContext){
    $("#gate").hidden=false;
    $("#gateBody").innerHTML=`<div class="critbox">当前是以本地文件方式打开的，浏览器在这种情况下禁用了数据库和加密接口，系统无法运行。<br><br>
      请用网址访问（部署到 GitHub Pages 后即可），或在本机启动附带的 <code>启动.bat</code> 后访问 <code>http://localhost:8080</code>。</div>`;
    return;
  }
  const cfg=CloudBackend.cfg();
  try{
    if(cfg&&cfg.url){ await Store.useCloud(cfg); $("#modeTag").textContent="云端"; }
    else { await Store.useLocal(); $("#modeTag").textContent="本机"; }
  }catch(e){ await Store.useLocal(); $("#modeTag").textContent="本机"; }
  if(Store.be.kind==="cloud"&&CloudBackend.token){
    try{ await CloudBackend.fetchProfile(); await CloudBackend.loadAll(); ME=CloudBackend.user; return enter(); }catch(e){ CloudBackend.logout(); }
  }
  const sess=(()=>{try{return JSON.parse(sessionStorage.getItem("ly_me")||"null")}catch(e){return null}})();
  if(Store.be.kind==="local"&&sess&&Store.be.all("users").some(u=>u.id===sess.id)){ ME=sess; return enter(); }
  gateLogin();
}
function gateLogin(){
  $("#app").hidden=true; $("#gate").hidden=false;
  const cloud=Store.be.kind==="cloud";
  const first=!cloud&&Store.be.all("users").length===0;
  if(first){
    $("#gateBody").innerHTML=`<div class="hint">第一次使用，先建管理员账号。密码由系统随机生成，只显示这一次。</div>
      <div class="gform"><label><span>管理员账号</span><input id="iU" value="admin"></label>
      <label><span>姓名</span><input id="iN" placeholder="你的名字"></label></div>
      <button class="btn pri" id="doInit">创建并进入</button>`;
    return;
  }
  if(cloud){
    $("#gateBody").innerHTML=`<div class="gform">
      <label><span>邮箱</span><input id="iU" type="email" autocomplete="username" placeholder="you@qq.com"></label>
      <label><span>密码</span><input id="iP" type="password" autocomplete="current-password"></label></div>
      <button class="btn pri" id="doLogin">登录</button><div id="loginErr"></div>
      <div class="muted" style="margin-top:10px">云端模式下账号是邮箱。还没有账号？让管理员在「用户管理」给你建一个。</div>`;
    return;
  }
  $("#gateBody").innerHTML=`<div class="gform">
    <label><span>账号</span><input id="iU" autocomplete="username"></label>
    <label><span>密码</span><input id="iP" type="password" autocomplete="current-password"></label></div>
    <button class="btn pri" id="doLogin">登录</button><div id="loginErr"></div>`;
}
async function doInit(){
  const u=$("#iU").value.trim()||"admin", n=$("#iN").value.trim()||u;
  const pw=randPw(12);
  await Store.be.createUser({username:u,name:n,role:"admin",password:pw});
  $("#gateBody").innerHTML=`<div class="cred">
    <div class="eyebrow">请立刻记下，关掉就看不到了</div>
    <div class="row"><span>账号</span><code>${esc(u)}</code></div>
    <div class="row"><span>密码</span><code>${esc(pw)}</code></div></div>
    <button class="btn pri" id="doLoginNow" data-u="${esc(u)}" data-p="${esc(pw)}">我记好了，进入系统</button>`;
}
async function login(u,p){
  try{
    ME=await Store.be.login(u,p);
    if(Store.be.kind==="cloud")await CloudBackend.loadAll();
    else sessionStorage.setItem("ly_me",JSON.stringify(ME));
    enter();
  }catch(e){ const el=$("#loginErr"); if(el)el.innerHTML=`<div class="critbox" style="margin-top:10px">${esc(e.message)}</div>`; else say(e.message) }
}
function enter(){
  $("#gate").hidden=true; $("#app").hidden=false;
  $("#who").innerHTML=`<div class="avatar">${esc((ME.name||ME.username).slice(0,1))}</div>
    <div style="line-height:1.25"><div style="font-size:12px;font-weight:600">${esc(ME.name||ME.username)}</div>
    <div style="font-size:10px;color:var(--ink-3)">${ME.role==="admin"?"管理员":"成员"}</div></div>
    <button class="iconbtn" id="logout" style="margin-left:6px">退出</button>`;
  $("#navUsers").hidden=ME.role!=="admin";
  $("#railFoot").innerHTML=Store.be.kind==="cloud"?"云端库 · 多人共用":"本机浏览器存储<br>请定期备份";
  reload(); go("home");
}

/* ================= 工作台 ================= */
function renderHome(){
  reload();
  $("#todayTag").textContent=iso(TODAY)+" · 共 "+VIEWDATA.length+" 份合同";
  const L=VIEWDATA.filter(x=>!x.o.is_void);
  const noPlan=L.filter(x=>x.pls.length===0&&x.c.owe>0).length;
  $("#notes").innerHTML=[
    L.length===0?`<div class="hint">还没有数据。到「数据管理」把现有系统导出的 Excel 粘进来即可。</div>`:"",
    noPlan?`<div class="warnbox">有 <b>${noPlan}</b> 份待付合同还没有付款节点，去「付款计划」批量生成后现金流预测才准。</div>`:""
  ].join("");
  const overdue=L.filter(x=>x.c.late>0), payable=L.filter(x=>x.c.arrPct>=1&&x.c.owe>0);
  const transit=L.filter(x=>x.c.arrPct<1).reduce((s,x)=>s+(+x.o.total_amount||0)*(1-x.c.arrPct),0);
  const unbilled=L.reduce((s,x)=>s+Math.max(0,x.c.arr-x.c.inv),0);
  const shortN=L.reduce((s,x)=>s+x.c.shortLines.length,0);
  const K=[
    {t:"crit",l:"逾期未到货",v:overdue.length+" 份",s:`货值 <b>¥${wan(overdue.reduce((s,x)=>s+(+x.o.total_amount||0)*(1-x.c.arrPct),0))}</b>${overdue.length?` · 最长 ${Math.max(...overdue.map(x=>x.c.late))} 天`:""}`},
    {t:"warn",l:"已到货待付款",v:"¥"+wan(payable.reduce((s,x)=>s+x.c.owe,0)),s:`<b>${payable.length}</b> 份可安排付款`},
    {t:"info",l:"在途货值",v:"¥"+wan(transit),s:`缺料 <b>${shortN}</b> 个物料行`},
    {t:"accent",l:"已到货未开票",v:"¥"+wan(unbilled),s:`应付余额 ¥${wan(L.reduce((s,x)=>s+x.c.owe,0))}`}];
  $("#kpis").innerHTML=K.map(k=>`<div class="kpi" style="--tone:var(--${k.t})"><div class="eyebrow">${k.l}</div><div class="v">${k.v}</div><div class="sub">${k.s}</div></div>`).join("");
  const q=L.filter(x=>!x.c.closed).sort((a,b)=>b.c.risk-a.c.risk).slice(0,10);
  $("#qCount").textContent=q.length+" 项待办";
  $("#queue").innerHTML=q.length?q.map(({o,c})=>{
    const act=c.late>0?"催交货":(c.arrPct>=1&&c.owe>0?"安排付款":"跟进");
    return `<button class="qrow" style="--tone:${tone(c.sev)}" data-open="${o.id}"><span class="stripe"></span>
    <span><span class="t"><span class="mono">${esc(o.contract_no)}</span>${sevPill(c)}<span class="pill mute">${act}</span></span>
    <span class="d">${esc(o.supplier_name)} · ${esc(o.contract_name||"")} · ${c.dueSrc} ${c.due}</span></span>
    <span class="amt">¥${wan(o.total_amount)}<small>待付 ¥${wan(c.owe)}</small></span></button>`}).join(""):`<div class="empty">没有未闭环的合同</div>`;
  const by={};L.forEach(({o,c})=>{if(c.risk)by[o.supplier_name]=(by[o.supplier_name]||0)+c.risk});
  const top=Object.entries(by).sort((a,b)=>b[1]-a[1]).slice(0,6),mx=top.length?top[0][1]:1;
  $("#supRisk").innerHTML=top.length?top.map(([s,v])=>`<div style="display:flex;align-items:center;gap:9px;padding:5px 0">
    <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px">${esc(s)}</span>
    <span style="width:110px"><span class="track" style="height:5px"><i style="width:${v/mx*100}%;background:${v/mx>.6?"var(--crit)":"var(--warn)"}"></i></span></span>
    <span class="num" style="font-size:11px;width:30px;text-align:right">${v}</span></div>`).join(""):`<div class="empty">无风险敞口</div>`;
  $("#stamp").textContent=Store.be.kind==="cloud"?"云端":(Store.be.data.meta.updated?"更新于 "+Store.be.data.meta.updated:"");
  drawCash();
}
const cssv=n=>getComputedStyle(document.documentElement).getPropertyValue(n).trim();
function cashBuckets(weeks){
  const b=new Array(weeks).fill(0);
  VIEWDATA.filter(x=>!x.o.is_void).forEach(({o,c,pls})=>{
    if(pls.length){
      pls.filter(p=>!p.paid).forEach(p=>{
        const dd=d(p.due_date); const g=dd?days(dd,TODAY):null;
        if(g===null)return; const i=g<0?0:Math.floor(g/7); if(i<weeks)b[i]+=(+p.amount||0);
      });
    } else if(c.owe>0&&c.dueDate){
      const g=days(c.dueDate,TODAY),i=g<0?0:Math.floor(g/7); if(i<weeks)b[i]+=c.owe;
    }
  });
  return b;
}
function drawCash(){
  const cv=$("#cash");if(!cv||!cv.offsetWidth)return;
  const c=cv.getContext("2d"),w=cv.width=cv.offsetWidth*2,h=cv.height=300,p=38;
  c.clearRect(0,0,w,h);
  const B=cashBuckets(12),mx=Math.max(...B,1),bw=(w-p*2)/12;
  c.strokeStyle=cssv("--line");c.lineWidth=2;
  [0,.5,1].forEach(f=>{const y=h-p-f*(h-p*1.75);c.beginPath();c.moveTo(p,y);c.lineTo(w-p,y);c.stroke()});
  c.font="17px "+cssv("--font-mono");c.textAlign="center";
  B.forEach((v,i)=>{
    const bh=v/mx*(h-p*1.75),x=p+i*bw+bw*.15;
    c.fillStyle=i===0?cssv("--crit"):(i<4?cssv("--accent"):cssv("--info"));
    c.fillRect(x,h-p-bh,bw*.7,Math.max(bh,v>0?2:0));
    c.fillStyle=cssv("--ink-3");c.fillText(i===0?"逾期/本周":"W"+(i+1),x+bw*.35,h-14);
    if(v>0){c.fillStyle=cssv("--ink");c.save();c.font="15px "+cssv("--font-mono");c.fillText(wan(v),x+bw*.35,h-p-bh-8);c.restore()}
  });
}

/* ================= 台账 ================= */
const COLS=[
 {k:"contract_no",t:"合同号",r:({o})=>`<span class="cno" data-open="${o.id}">${esc(o.contract_no)}</span>`},
 {k:"supplier_name",t:"供应商",r:({o})=>`<span class="sup" title="${esc(o.supplier_name)}">${esc(o.supplier_name)}</span>`},
 {k:"contract_name",t:"合同名称",r:({o})=>esc(o.contract_name)},
 {k:"total_amount",t:"合同总额",cls:"r",v:x=>+x.o.total_amount||0,r:({o})=>`<span class="num">${fmt(o.total_amount)}</span>`},
 {k:"due",t:"交期",v:x=>x.c.due,r:({c})=>`<span class="mono" title="${c.dueSrc}">${c.due}</span>`},
 {k:"sev",t:"履约状态",v:x=>x.c.risk,r:({c})=>sevPill(c)},
 {k:"pr",t:"到货 / 开票 / 付款",nosort:1,r:({c})=>prog(c)},
 {k:"short",t:"缺料行",cls:"r",v:x=>x.c.shortLines.length,r:({c})=>c.shortLines.length?`<span class="pill crit">${c.shortLines.length}</span>`:`<span style="color:var(--ink-3)">—</span>`},
 {k:"owe",t:"待付款",cls:"r",v:x=>x.c.owe,r:({c})=>`<span class="num" style="color:${c.owe>0?"var(--warn)":"var(--ink-3)"}">${fmt(c.owe)}</span>`},
 {k:"purchaser",t:"采购员",r:({o})=>esc(o.purchaser)},
 {k:"act",t:"",nosort:1,r:({o})=>`<button class="btn" data-edit="${o.id}" style="padding:3px 8px">编辑</button>`}
];
let sortK="sev",sortD=-1,view="risk";
const VIEWS=[
 {k:"risk",t:"风险优先",f:x=>!x.c.closed},{k:"late",t:"已逾期",f:x=>x.c.late>0},
 {k:"soon",t:"7天内交期",f:x=>x.c.arrPct<1&&x.c.gap!=null&&x.c.gap>=0&&x.c.gap<=7},
 {k:"owe",t:"待付款",f:x=>x.c.arrPct>=1&&x.c.owe>0},{k:"short",t:"有缺料",f:x=>x.c.shortLines.length>0},
 {k:"all",t:"全部",f:()=>true}];
const baseRows=()=>$("#fVoid").checked?VIEWDATA:VIEWDATA.filter(x=>!x.o.is_void);
function filtered(){
  const v=VIEWS.find(x=>x.k===view);
  const q=$("#fq").value.trim(),a=$("#fArr").value,p=$("#fPay").value,su=$("#fSup").value;
  let r=baseRows().filter(v.f);
  if(q)r=r.filter(x=>[x.o.contract_no,x.o.supplier_name,x.o.order_no,x.o.contract_name,x.o.purchaser].join("|").includes(q));
  if(a)r=r.filter(x=>x.c.arrS===a);
  if(p)r=r.filter(x=>x.c.payS===p);
  if(su)r=r.filter(x=>x.o.supplier_name===su);
  const col=COLS.find(c=>c.k===sortK);
  return r.sort((x,y)=>{const A=col&&col.v?col.v(x):(x.o[sortK]??""),B=col&&col.v?col.v(y):(y.o[sortK]??"");return (A>B?1:A<B?-1:0)*sortD});
}
function renderList(){
  reload();
  const sups=[...new Set(VIEWDATA.map(x=>x.o.supplier_name).filter(Boolean))].sort();
  const sel=$("#fSup"),keep=sel.value;
  sel.innerHTML=`<option value="">全部</option>`+sups.map(s=>`<option>${esc(s)}</option>`).join("");sel.value=keep;
  $("#views").innerHTML=VIEWS.map(v=>`<button class="chip" aria-pressed="${v.k===view}" data-v="${v.k}">${v.t}<span class="n">${baseRows().filter(v.f).length}</span></button>`).join("");
  $("#thr").innerHTML=`<th class="no"></th>`+COLS.map(c=>`<th class="${c.cls||""} ${c.nosort?"no":""}" data-k="${c.k}">${c.t}${sortK===c.k?` <span class="ar">${sortD>0?"▲":"▼"}</span>`:""}</th>`).join("");
  const r=filtered();
  $("#cnt").textContent=`${r.length} 份 · 合计 ¥${wan(r.reduce((s,x)=>s+(+x.o.total_amount||0),0))} · 待付 ¥${wan(r.reduce((s,x)=>s+x.c.owe,0))}`;
  $("#tb").innerHTML=r.length?r.map(x=>`<tr${x.o.is_void?' style="opacity:.5"':""}>
    <td class="risk" style="--tone:${tone(x.c.sev)}"></td>${COLS.map(col=>`<td class="${col.cls||""}">${col.r(x)}</td>`).join("")}</tr>`).join("")
    :`<tr><td colspan="${COLS.length+1}" class="empty">没有符合条件的合同</td></tr>`;
}

/* ================= 预警 ================= */
function renderAlert(){
  reload();
  const L=VIEWDATA.filter(x=>!x.o.is_void);
  const late=L.filter(x=>x.c.late>0).sort((a,b)=>b.c.late-a.c.late);
  const soon=L.filter(x=>x.c.arrPct<1&&x.c.gap!=null&&x.c.gap>=0&&x.c.gap<=7).sort((a,b)=>a.c.gap-b.c.gap);
  const owe=L.filter(x=>x.c.arrPct>=1&&x.c.owe>0).sort((a,b)=>b.c.owe-a.c.owe);
  const nodue=L.filter(x=>!x.c.dueDate&&x.c.arrPct<1);
  updateBadge();
  $("#aKpi").innerHTML=[["crit","已逾期",late.length,"份超交期未到齐"],["warn","7 天内临期",soon.length,"份即将到期"],
    ["accent","可安排付款",owe.length,"份已全到货未付清"],["info","缺交期",nodue.length,"份未到货且无交期"]]
    .map(k=>`<div class="kpi" style="--tone:var(--${k[0]})"><div class="eyebrow">${k[1]}</div><div class="v">${k[2]}</div><div class="sub">${k[3]}</div></div>`).join("");
  const row=({o,c},desc,amt)=>`<button class="qrow" style="--tone:${tone(c.sev)}" data-open="${o.id}"><span class="stripe"></span>
    <span><span class="t"><span class="mono">${esc(o.contract_no)}</span>${sevPill(c)}</span>
    <span class="d">${esc(o.supplier_name)} · ${desc}</span></span><span class="amt">${amt}</span></button>`;
  $("#aDeliver").innerHTML=[...late.map(x=>row(x,`${x.c.dueSrc} ${x.c.due} · 逾期 ${x.c.late} 天 · 已到 ${Math.round(x.c.arrPct*100)}%${x.c.shortLines.length?` · 缺 ${x.c.shortLines.length} 行`:""}`,"未到 ¥"+wan((+x.o.total_amount||0)*(1-x.c.arrPct)))),
    ...soon.map(x=>row(x,`${x.c.dueSrc} ${x.c.due} · 还有 ${x.c.gap} 天`,"¥"+wan(x.o.total_amount)))].join("")||`<div class="empty">交货一切正常</div>`;
  $("#aPay").innerHTML=owe.map(x=>row(x,`${esc(x.o.pay_condition_text||"未设付款条件")} · 已到货 100% · ${x.c.invS}`,"待付 ¥"+wan(x.c.owe))).join("")||`<div class="empty">没有待付款项</div>`;
}
function updateBadge(){
  const L=VIEWDATA.filter(x=>!x.o.is_void);
  const n=L.filter(x=>x.c.late>0).length+L.filter(x=>x.c.arrPct<1&&x.c.gap!=null&&x.c.gap>=0&&x.c.gap<=7).length+L.filter(x=>x.c.arrPct>=1&&x.c.owe>0).length;
  $("#navBadge").textContent=n;$("#navBadge").style.display=n?"":"none";
}

/* ================= 付款计划 ================= */
function allNodes(){
  const out=[];
  VIEWDATA.filter(x=>!x.o.is_void).forEach(x=>x.pls.filter(p=>!p.paid).forEach(p=>out.push({x,p})));
  return out.sort((a,b)=>String(a.p.due_date||"9999").localeCompare(String(b.p.due_date||"9999")));
}
function renderCash(){
  reload();
  const nodes=allNodes();
  $("#payTot").textContent=`未结 ${nodes.length} 个节点 · ¥${wan(nodes.reduce((s,n)=>s+(+n.p.amount||0),0))}`;
  const y=TODAY.getFullYear(),m=TODAY.getMonth();
  $("#calTag").textContent=y+"-"+String(m+1).padStart(2,"0");
  const first=new Date(y,m,1).getDay(),dim=new Date(y,m+1,0).getDate(),map={};
  nodes.forEach(({p})=>{const dt=d(p.due_date);if(dt&&dt.getFullYear()===y&&dt.getMonth()===m)map[dt.getDate()]=(map[dt.getDate()]||0)+(+p.amount||0)});
  let h=["日","一","二","三","四","五","六"].map(x=>`<div class="cal-h">${x}</div>`).join("");
  for(let i=0;i<first;i++)h+=`<div></div>`;
  for(let i=1;i<=dim;i++)h+=`<div class="day ${map[i]?"has":""} ${i===TODAY.getDate()?"today":""}"><b>${i}</b>${map[i]?`<span class="m">¥${wan(map[i])}</span>`:""}</div>`;
  $("#cal").innerHTML=h;
  $("#payList").innerHTML=nodes.slice(0,25).map(({x,p})=>{
    const dt=d(p.due_date),g=dt?days(dt,TODAY):null,t=g===null?"info":g<0?"crit":g<=7?"warn":"info";
    return `<button class="qrow" style="--tone:${tone(t)}" data-open="${x.o.id}"><span class="stripe"></span>
    <span><span class="t"><span class="mono">${esc(x.o.contract_no)}</span><span class="pill ${t}">${g===null?"无到期日":g<0?"逾期 "+(-g)+" 天":g===0?"今日到期":g+" 天后"}</span></span>
    <span class="d">${esc(x.o.supplier_name)} · ${esc(p.name)} · ${esc(p.due_date||"—")}</span></span>
    <span class="amt">¥${wan(p.amount)}<small>${Math.round((+p.ratio||0)*100)}%</small></span></button>`}).join("")||`<div class="empty">没有未结节点。到合同详情里生成付款计划。</div>`;
}
async function genPlansFor(list){
  let n=0;
  for(const x of list){
    if(x.pls.length)continue;
    for(const p of genPlan(x.o,x.c)){
      await Store.be.insert("payplans",{contract_id:x.o.id,name:p.name,ratio:p.ratio,amount:p.amount,due_date:p.due_date,paid:0});
      n++;
    }
    await logIt(x.o.id,"生成付款计划");
  }
  reload(); say("生成了 "+n+" 个付款节点");
}

/* ================= 催货清单 ================= */
function shortRows(){
  const only=$("#shortLateOnly").checked;
  const out=[];
  VIEWDATA.filter(x=>!x.o.is_void).forEach(({o,c})=>{
    if(only&&!(c.late>0))return;
    c.shortLines.forEach(l=>out.push({
      contract_no:o.contract_no,supplier_name:o.supplier_name,due:c.due,late:c.late,
      line_no:l.m.line_no,material_name:l.m.material_name,spec:l.m.spec,unit:l.m.unit,
      plan_qty:l.m.plan_qty,arrived:l.arrived,short:l.short,
      short_amt:+( (l.short*(+l.m.price_tax_in||0)).toFixed(2) ),id:o.id}));
  });
  return out.sort((a,b)=>b.late-a.late);
}
function renderShort(){
  reload();
  const r=shortRows();
  $("#shortCnt").textContent=`${r.length} 个物料行 · 未到金额 ¥${wan(r.reduce((s,x)=>s+x.short_amt,0))}`;
  $("#shortTb").innerHTML=r.length?r.map(x=>`<tr>
    <td><span class="cno" data-open="${x.id}">${esc(x.contract_no)}</span></td><td><span class="sup">${esc(x.supplier_name)}</span></td>
    <td class="mono">${x.due}</td><td>${x.late>0?`<span class="pill crit">${x.late} 天</span>`:`<span class="pill mute">未到期</span>`}</td>
    <td class="mono">${esc(x.line_no)}</td><td>${esc(x.material_name)}</td><td>${esc(x.spec)}</td>
    <td class="r num">${fmt(x.plan_qty)}</td><td class="r num">${fmt(x.arrived)}</td>
    <td class="r num" style="color:var(--crit)">${fmt(x.short)}</td><td>${esc(x.unit)}</td>
    <td class="r num">${fmt(x.short_amt)}</td></tr>`).join("")
    :`<tr><td colspan="12" class="empty">没有缺料行${$("#shortLateOnly").checked?"（只看已过交期，可取消勾选看全部）":""}</td></tr>`;
}

/* ================= 抽屉 ================= */
function openD(id){
  const x=VIEWDATA.find(v=>v.o.id===id);if(!x)return;
  curId=id;tabI=0;
  $("#drawer").classList.add("on");$("#scrim").classList.add("on");$("#drawer").setAttribute("aria-hidden","false");
  drawHead();drawTab();
}
function shutD(){$("#drawer").classList.remove("on");$("#scrim").classList.remove("on");$("#drawer").setAttribute("aria-hidden","true");curId=null}
const CUR=()=>VIEWDATA.find(v=>v.o.id===curId);
function drawHead(){
  const x=CUR();if(!x)return;const{o,c}=x;
  $("#dhead").innerHTML=`<div style="flex:1"><div class="eyebrow">${esc(o.order_no||"")} ${esc(o.purchase_org||"")} ${esc(o.project||"")}</div>
    <h3 class="mono">${esc(o.contract_no)}</h3><div style="color:var(--ink-3)">${esc(o.supplier_name)}</div>
    <div style="display:flex;gap:6px;margin-top:7px;flex-wrap:wrap">${sevPill(c)}<span class="pill info">${c.arrS}</span><span class="pill mute">${c.invS}</span><span class="pill ${c.payPct>=1?"ok":"warn"}">${c.payS}</span>${o.is_void?'<span class="pill crit">已作废</span>':""}</div>
    <div style="display:flex;gap:6px;margin-top:10px;flex-wrap:wrap">
      <button class="btn" data-reg="到货">登记到货</button><button class="btn" data-reg="开票">登记开票</button>
      <button class="btn" data-reg="付款">登记付款</button><button class="btn" data-edit="${o.id}">编辑</button></div></div>
  <div style="text-align:right"><div class="eyebrow">合同总额</div><div class="num" style="font-size:20px">${fmt(o.total_amount)} ${esc(o.currency||"")}</div>
    <div class="num" style="color:var(--warn);font-size:11.5px">待付 ${fmt(c.owe)}</div>
    <button class="btn" id="closeD" style="margin-top:8px">关闭 Esc</button></div>`;
}
function drawTab(){
  const x=CUR();if(!x)return;const{o,c,ms,as,is,ps,pls,ats}=x;const b=$("#dbody");
  $$("#dtabs .tab").forEach(t=>t.setAttribute("aria-selected",String(+t.dataset.t===tabI)));
  if(tabI===0){
    const steps=[["签订",o.sign_date,"合同签订"],["约定交期",o.contract_delivery_date,"ERP 原始约定"],
      ["承诺交期",o.promised_delivery_date,"供应商二次确认"],["装箱单",o.packing_list_date,"供应商提交装箱单"],
      ["发货通知",o.shipment_notice_date,"发货通知已回传"],["要求到港",o.required_arrival_date,"要求到港/到厂"]];
    const evs=[...as.map(a=>({dt:a.date,t:"到货",amt:a.amount,no:a.no,rm:a.remark})),
               ...is.map(i=>({dt:i.date,t:"开票",amt:i.amount,no:i.no,rm:i.remark})),
               ...ps.map(p=>({dt:p.date,t:"付款",amt:p.amount,no:p.no,rm:p.remark}))].sort((m,n)=>String(m.dt).localeCompare(String(n.dt)));
    b.innerHTML=`<div class="${c.late>0?"critbox":"hint"}"><b>判定口径：</b>取 ${c.dueSrc} = ${c.due}，今天 ${iso(TODAY)}${c.late>0?`，未到货部分逾期 <b>${c.late}</b> 天（到货率 ${Math.round(c.arrPct*100)}%）`:(c.gap!=null?`，距交期 ${c.gap} 天`:"")}。</div>
    <dl class="kv"><div><dt>采购员</dt><dd>${esc(o.purchaser||"—")}</dd></div><div><dt>物流负责人</dt><dd>${esc(o.logistics_owner||"—")}</dd></div>
    <div><dt>付款条件</dt><dd>${esc(o.pay_condition_text||"—")}</dd></div><div><dt>交货地址</dt><dd>${esc(o.delivery_address||"—")}</dd></div>
    <div><dt>已到货</dt><dd class="num">${fmt(c.arr)}</dd></div><div><dt>已开票</dt><dd class="num">${fmt(c.inv)}</dd></div>
    <div><dt>已付款</dt><dd class="num">${fmt(c.paid)}</dd></div><div><dt>待付款</dt><dd class="num">${fmt(c.owe)}</dd></div></dl>
    <div class="card"><header><h2>履约时间轴</h2></header><div style="padding:14px 16px 4px"><ul class="tl">${
      steps.map(([lb,dt,desc],i)=>{const has=!!dt,isLate=i===2&&c.late>0;
        return `<li class="${isLate?"late":has?"done":"next"}"><span class="dt">${dt?String(dt).slice(0,10):"—"}</span><span class="dot"></span>
        <span class="lb">${lb}${isLate?` <span class="pill crit">逾期 ${c.late} 天</span>`:""}<small>${desc}</small></span></li>`}).join("")
      +evs.map(e=>`<li class="done"><span class="dt">${esc(e.dt)}</span><span class="dot"></span><span class="lb">${e.t} <span class="num">¥${fmt(e.amt)}</span>${e.no?` <span class="mono" style="color:var(--ink-3)">${esc(e.no)}</span>`:""}<small>${esc(e.rm||"")}</small></span></li>`).join("")
    }</ul></div></div>`;
  }
  else if(tabI===1){
    const sum=ms.reduce((s,m)=>s+(+m.amount_tax_in||0),0);
    b.innerHTML=`${ms.length?`<div class="tw"><table><thead><tr><th class="no">行号</th><th class="no">物料</th><th class="no">规格</th><th class="no r">订购</th><th class="no r">已到</th><th class="no r">未到</th><th class="no">进度</th><th class="no r">价税合计</th></tr></thead>
      <tbody>${c.lines.map(l=>`<tr><td class="mono">${esc(l.m.line_no)}</td><td>${esc(l.m.material_name)}<div style="color:var(--ink-3);font-size:11px">${esc(l.m.material_code||"")}</div></td>
      <td>${esc(l.m.spec)}</td><td class="r num">${fmt(l.m.plan_qty)} ${esc(l.m.unit||"")}</td><td class="r num">${fmt(l.arrived)}</td>
      <td class="r num" style="color:${l.short>0?"var(--crit)":"var(--ink-3)"}">${fmt(l.short)}</td>
      <td style="min-width:90px"><div class="track"><i style="width:${l.pct*100}%;background:${l.pct>=1?"var(--ok)":"var(--warn)"}"></i></div></td>
      <td class="r num">${fmt(l.m.amount_tax_in)}</td></tr>`).join("")}</tbody>
      <tfoot><tr><td colspan="7" class="r"><b>物料合计</b></td><td class="r num"><b>${fmt(sum)}</b></td></tr></tfoot></table></div>
      ${Math.abs(sum-(+o.total_amount||0))>0.05?`<div class="warnbox">物料价税合计与合同总额相差 ¥${fmt(sum-(+o.total_amount||0))}，建议核对。</div>`:""}`
      :`<div class="empty">没有物料明细，可在「数据管理」导入明细表</div>`}
    <div class="card"><header><h2>到货记录</h2><span class="eyebrow">${as.length} 笔</span></header>
      <div class="tw" style="border:0">${as.length?`<table><thead><tr><th class="no">日期</th><th class="no">单号</th><th class="no">物料</th><th class="no r">数量</th><th class="no r">金额</th><th class="no"></th></tr></thead>
      <tbody>${as.map(a=>{const m=ms.find(z=>z.id===a.material_id);
        return `<tr><td class="mono">${esc(a.date)}</td><td class="mono">${esc(a.no||"")}</td><td>${m?esc(m.material_name):"（整单）"}</td>
        <td class="r num">${a.qty?fmt(a.qty):"—"}</td><td class="r num">${fmt(a.amount)}</td>
        <td class="r"><button class="btn danger" data-del="arrivals:${a.id}" style="padding:2px 7px">删除</button></td></tr>`}).join("")}</tbody></table>`
      :`<div class="empty">还没有到货记录</div>`}</div></div>`;
  }
  else if(tabI===2){
    b.innerHTML=`${pls.length?`<div class="tw"><table><thead><tr><th class="no">节点</th><th class="no">比例</th><th class="no">到期日</th><th class="no r">金额</th><th class="no">状态</th><th class="no"></th></tr></thead>
      <tbody>${pls.map(p=>{const dt=d(p.due_date),g=dt?days(dt,TODAY):null;
        return `<tr><td>${esc(p.name)}</td><td class="mono">${Math.round((+p.ratio||0)*100)}%</td><td class="mono">${esc(p.due_date||"—")}</td>
        <td class="r num">${fmt(p.amount)}</td>
        <td>${p.paid?'<span class="pill ok">已付</span>':g===null?'<span class="pill mute">无到期日</span>':g<0?`<span class="pill crit">逾期 ${-g} 天</span>`:`<span class="pill warn">${g} 天后</span>`}</td>
        <td class="r">${p.paid?"":`<button class="btn" data-paynode="${p.id}" style="padding:2px 7px">登记付款</button>`}</td></tr>`}).join("")}</tbody>
      <tfoot><tr><td colspan="3" class="r"><b>合计</b></td><td class="r num"><b>${fmt(pls.reduce((s,p)=>s+(+p.amount||0),0))}</b></td><td colspan="2"></td></tr></tfoot></table></div>
      <div class="bar"><button class="btn danger" data-act="clearplan">清空并重新生成</button></div>`
      :`<div class="empty">还没有付款计划</div><div class="bar" style="justify-content:center"><button class="btn pri" data-act="genplan">按「${esc(o.pay_condition_text||"未填付款条件")}」生成节点</button></div>`}
      <div class="card"><header><h2>付款记录</h2><span class="eyebrow">${ps.length} 笔</span></header>
      <div class="tw" style="border:0">${ps.length?`<table><thead><tr><th class="no">日期</th><th class="no">单号</th><th class="no r">金额</th><th class="no">备注</th><th class="no"></th></tr></thead>
      <tbody>${ps.map(p=>`<tr><td class="mono">${esc(p.date)}</td><td class="mono">${esc(p.no||"")}</td><td class="r num">${fmt(p.amount)}</td><td>${esc(p.remark||"")}</td>
      <td class="r"><button class="btn danger" data-del="payments:${p.id}" style="padding:2px 7px">删除</button></td></tr>`).join("")}</tbody></table>`:`<div class="empty">还没有付款记录</div>`}</div></div>`;
  }
  else if(tabI===3){
    b.innerHTML=`<div class="hint">合同 PDF、装箱单、发票、报关单都可以传到这里，跟合同绑在一起。</div>
      <div class="drop" id="attDrop">点这里选文件，或拖进来</div><input type="file" id="attFile" multiple hidden>
      ${ats.length?`<div class="tw"><table><thead><tr><th class="no">文件名</th><th class="no r">大小</th><th class="no">上传人</th><th class="no">时间</th><th class="no"></th></tr></thead>
      <tbody>${ats.map(a=>`<tr><td>${esc(a.name)}</td><td class="r num">${(a.size/1024).toFixed(0)} KB</td><td>${esc(a.by||"")}</td><td class="mono">${esc(a.at||"")}</td>
      <td class="r"><button class="btn" data-getfile="${a.id}" style="padding:2px 7px">下载</button>
      <button class="btn danger" data-delfile="${a.id}" style="padding:2px 7px">删除</button></td></tr>`).join("")}</tbody></table></div>`
      :`<div class="empty">还没有附件</div>`}`;
  }
  else {
    const lg=Store.be.all("audit").filter(a=>a.contract_id===o.id).sort((a,b)=>String(b.at).localeCompare(String(a.at)));
    b.innerHTML=`<div class="card"><header><h2>变更留痕</h2><span class="eyebrow">${lg.length} 条</span></header>
      <div style="padding:14px 16px 4px">${lg.length?`<ul class="tl">${lg.map(l=>`<li class="done"><span class="dt">${esc(String(l.at).slice(5))}</span><span class="dot"></span>
      <span class="lb">${esc(l.what)}<small>${esc(l.who||"")}</small></span></li>`).join("")}</ul>`:`<div class="empty">暂无记录</div>`}</div></div>`;
  }
}

/* ================= 登记 ================= */
function regModal(type){
  const x=CUR();if(!x)return;const{o,c,ms}=x;
  if(type==="到货"&&ms.length){
    modal("登记到货 · 按物料行",`<div class="hint">填本次到货数量，留空或 0 的行不记。金额按含税单价自动算。</div>
      <div class="form" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr))">
      <label><span>到货日期</span><input id="aDate" type="date" value="${iso(TODAY)}"></label>
      <label><span>到货单号</span><input id="aNo"></label></div>
      <div class="tw"><table><thead><tr><th class="no">行号</th><th class="no">物料</th><th class="no r">订购</th><th class="no r">已到</th><th class="no r">未到</th><th class="no">本次到货</th></tr></thead>
      <tbody>${c.lines.map(l=>`<tr><td class="mono">${esc(l.m.line_no)}</td><td>${esc(l.m.material_name)}<div style="color:var(--ink-3);font-size:11px">${esc(l.m.spec||"")}</div></td>
      <td class="r num">${fmt(l.m.plan_qty)}</td><td class="r num">${fmt(l.arrived)}</td><td class="r num">${fmt(l.short)}</td>
      <td><input class="lineQty" data-mid="${l.m.id}" data-price="${+l.m.price_tax_in||0}" value="${l.short>0?l.short:""}" style="width:100px;border:1px solid var(--line);border-radius:4px;padding:3px 6px;background:var(--surface-2);text-align:right"></td></tr>`).join("")}</tbody></table></div>`,
      `<div class="spacer"></div><button class="btn" data-close>取消</button><button class="btn pri" data-act="saveArrLines">登记</button>`);
    return;
  }
  const remain=type==="到货"?(+o.total_amount||0)-c.arr:type==="开票"?c.arr-c.inv:(+o.total_amount||0)-c.paid;
  modal("登记"+type,`<div class="form">
    <label><span>日期</span><input id="eDate" type="date" value="${iso(TODAY)}"></label>
    <label><span>金额</span><input id="eAmt" value="${Math.max(0,remain).toFixed(2)}"></label>
    <label><span>${type==="到货"?"到货单号":type==="开票"?"发票号":"付款单号"}</span><input id="eNo"></label>
    <label class="wide"><span>备注</span><input id="eRemark"></label></div>
    <div class="hint">当前${type==="开票"?"可开票":type==="到货"?"未到货":"未付款"}余额 ¥${fmt(Math.max(0,remain))}</div>`,
    `<div class="spacer"></div><button class="btn" data-close>取消</button><button class="btn pri" data-act="saveEvent" data-type="${type}">登记</button>`);
}
const TBL={"到货":"arrivals","开票":"invoices","付款":"payments"};
async function saveEvent(type,planId){
  const o=CUR().o, amt=num($("#eAmt").value);
  if(!amt){say("金额要大于 0");return}
  const row={contract_id:o.id,date:$("#eDate").value||iso(TODAY),amount:amt,no:$("#eNo").value.trim(),remark:$("#eRemark").value.trim(),by:(ME&&ME.name)||""};
  if(type==="付款"&&planId)row.plan_id=planId;
  await Store.be.insert(TBL[type],row);
  if(type==="付款"&&planId){
    const pl=Store.be.all("payplans").find(p=>p.id===planId);
    if(pl&&amt>=(+pl.amount||0)-0.005)await Store.be.update("payplans",planId,{paid:1,paid_date:row.date});
  }
  await logIt(o.id,`登记${type} ¥${fmt(amt)}${row.no?"（"+row.no+"）":""}`);
  closeModal();reload();drawHead();drawTab();refreshPage();
  const c=CUR().c;
  say(`已登记${type} ¥${fmt(amt)}　→ 到 ${Math.round(c.arrPct*100)}% / 票 ${Math.round(c.invPct*100)}% / 付 ${Math.round(c.payPct*100)}%`);
}
async function saveArrLines(){
  const o=CUR().o, date=$("#aDate").value||iso(TODAY), no=$("#aNo").value.trim();
  const rows=$$(".lineQty").map(el=>({mid:el.dataset.mid,price:+el.dataset.price||0,qty:num(el.value)})).filter(r=>r.qty>0);
  if(!rows.length){say("没有填任何数量");return}
  let total=0;
  for(const r of rows){
    const amt=+(r.qty*r.price).toFixed(2); total+=amt;
    await Store.be.insert("arrivals",{contract_id:o.id,material_id:r.mid,date,qty:r.qty,amount:amt,no,by:(ME&&ME.name)||""});
  }
  await logIt(o.id,`登记到货 ${rows.length} 个物料行，合计 ¥${fmt(total)}`);
  closeModal();reload();drawHead();drawTab();refreshPage();
  say(`已登记 ${rows.length} 行，合计 ¥${fmt(total)}`);
}

/* ================= 合同表单 ================= */
const FI=(k,label,val,type)=>`<label${k==="remark"?' class="wide"':""}><span>${label}</span><input name="${k}" type="${type||"text"}" value="${esc(val??"")}"></label>`;
function editContract(id){
  const x=id?VIEWDATA.find(v=>v.o.id===id):null;
  const o=x?x.o:{currency:"CNY"};
  modal(id?"编辑合同":"新增合同",`<div class="form" id="cForm">
    ${FI("contract_no","合同号 *",o.contract_no)}${FI("order_no","订单编号",o.order_no)}
    ${FI("supplier_name","供应商 *",o.supplier_name)}${FI("contract_name","合同名称",o.contract_name)}
    ${FI("purchase_org","采购组织",o.purchase_org)}${FI("project","项目",o.project)}
    ${FI("purchaser","采购员",o.purchaser)}${FI("logistics_owner","物流负责人",o.logistics_owner)}
    ${FI("total_amount","合同总额 *",o.total_amount)}
    <label><span>币别</span><select name="currency">${["CNY","USD","EUR"].map(c=>`<option${o.currency===c?" selected":""}>${c}</option>`).join("")}</select></label>
    ${FI("sign_date","签订日期",o.sign_date,"date")}${FI("contract_delivery_date","约定交期",o.contract_delivery_date,"date")}
    ${FI("promised_delivery_date","承诺交期",o.promised_delivery_date,"date")}${FI("packing_list_date","装箱单日期",o.packing_list_date,"date")}
    ${FI("shipment_notice_date","发货通知日期",o.shipment_notice_date,"date")}${FI("required_arrival_date","要求到港日期",o.required_arrival_date,"date")}
    ${FI("pay_condition_text","付款条件",o.pay_condition_text)}${FI("delivery_address","交货地址",o.delivery_address)}
    ${FI("remark","备注",o.remark)}</div>`,
    `${id?`<button class="btn danger" data-act="void" data-id="${id}">${o.is_void?"取消作废":"作废"}</button><button class="btn danger" data-act="delc" data-id="${id}">删除</button>`:""}
     <div class="spacer"></div><button class="btn" data-close>取消</button><button class="btn pri" data-act="saveC" data-id="${id||""}">保存</button>`);
}
async function saveContract(id){
  const f={};$$("#cForm [name]").forEach(el=>f[el.name]=el.value.trim());
  if(!f.contract_no)return say("合同号必填");
  if(!f.supplier_name)return say("供应商必填");
  f.total_amount=num(f.total_amount);
  DATE_FIELDS.forEach(k=>{if(f[k])f[k]=normDate(f[k])});
  if(id){
    const old=VIEWDATA.find(v=>v.o.id===id).o;
    const changed=Object.keys(f).filter(k=>String(old[k]??"")!==String(f[k]??""));
    await Store.be.update("contracts",id,f);
    if(changed.length)await logIt(id,"修改："+changed.join("、"));
  }else{
    if(Store.be.all("contracts").some(c=>c.contract_no===f.contract_no))return say("合同号已存在");
    f.is_void=0; const r=await Store.be.insert("contracts",f);
    await logIt(r.id,"新建合同");
  }
  closeModal();reload();refreshPage();if(curId){drawHead();drawTab()}say("已保存");
}

/* ================= 导入 ================= */
const XLSX_EXT=/\.xlsx?$/i;
/* 把 .xlsx/.xls 转成跟"从 Excel 里全选复制"完全一样的 TSV 文本，
   这样后面复用一套 parseTable()，不用再单独维护一条二进制解析逻辑。
   工作簿可能有好几个 sheet（比如我们自己发的导入模板），
   挑表头里含"合同号"、且能对上系统字段最多的那个 sheet。 */
function xlsxToTSV(arrayBuffer){
  if(typeof XLSX==="undefined") throw new Error("Excel 解析库没加载成功，换成「全选复制→粘贴」的方式导入，或检查网络");
  const wb=XLSX.read(arrayBuffer,{type:"array",cellDates:true});
  let best=null,bestScore=-1,candidates=0;
  for(const name of wb.SheetNames){
    const tsv=XLSX.utils.sheet_to_csv(wb.Sheets[name],{FS:"\t",blankrows:false});
    const head=(tsv.split("\n")[0]||"").split("\t").map(h=>h.trim().replace(/^﻿/,"").replace(/[▲▼①②③\s]/g,""));
    if(!head.includes("合同号"))continue;
    candidates++;
    const score=head.filter(h=>MAP[h]).length;
    if(score>bestScore){bestScore=score;best={name,tsv}}
  }
  if(!best) throw new Error("这个 Excel 文件里没有找到含「合同号」列的表，确认导出内容对不对，或改用「全选复制→粘贴」导入");
  best.otherCandidates=candidates-1; // 除了选中的这个，还有几个 sheet 也像数据表
  return best;
}
async function loadImportFile(f){
  if(XLSX_EXT.test(f.name)){
    try{
      const buf=await f.arrayBuffer();
      const {name,tsv,otherCandidates}=xlsxToTSV(buf);
      $("#pasteBox").value=tsv; preview(tsv);
      say(`已从「${name}」sheet 读取`+(otherCandidates>0?`（工作簿里还有 ${otherCandidates} 个 sheet 看起来也是数据表，没读，需要的话单独复制粘贴）`:""));
    }catch(e){ $("#importPreview").innerHTML=`<div class="critbox">${esc(e.message)}</div>` }
    return;
  }
  const r=new FileReader();
  r.onload=()=>{$("#pasteBox").value=r.result;preview(r.result)};
  r.readAsText(f,"utf-8");
}
function preview(text){
  const p=parseTable(text);
  const box=$("#importPreview");
  if(!p)return box.innerHTML=`<div class="critbox">没解析到内容，请粘贴带表头的完整表格。</div>`;
  if(p.error)return box.innerHTML=`<div class="critbox">${esc(p.error)}</div>`;
  const nos=[...new Set(p.data.map(r=>r.contract_no))];
  const exist=nos.filter(n=>Store.be.all("contracts").some(c=>c.contract_no===n));
  PENDING=p;
  box.innerHTML=`<div class="hint">识别为 <b>${p.isMaterial?"物料明细表":"合同台账表"}</b>：${p.data.length} 行 → ${nos.length} 份合同，
    其中 <b>${exist.length}</b> 份已存在将更新，<b>${nos.length-exist.length}</b> 份新增。
    忽略的列：${esc(p.head.filter((h,i)=>!p.keys[i]).join("、")||"无")}</div>
    <div class="tw" style="max-height:230px;overflow:auto"><table><thead><tr>${p.keys.map((k,i)=>k?`<th class="no">${esc(p.head[i])}</th>`:"").join("")}</tr></thead>
    <tbody>${p.data.slice(0,6).map(r=>`<tr>${p.keys.filter(Boolean).map(k=>`<td>${esc(r[k])}</td>`).join("")}</tr>`).join("")}</tbody></table></div>
    <div class="bar"><button class="btn pri" id="doImport">确认导入</button></div>`;
}
async function doImport(){
  if(!PENDING)return;
  const p=PENDING,byNo={};
  p.data.forEach(r=>{(byNo[r.contract_no]=byNo[r.contract_no]||[]).push(r)});
  let added=0,updated=0,mats=0,arrN=0;
  for(const [no,rs] of Object.entries(byNo)){
    let o=Store.be.all("contracts").find(c=>c.contract_no===no);
    const head=rs[0], patch={};
    HEAD_FIELDS.forEach(k=>{if(head[k]!=null&&head[k]!=="")patch[k]=DATE_FIELDS.includes(k)?normDate(head[k]):head[k]});
    if(head.total_amount)patch.total_amount=num(head.total_amount);
    if(!o){ o=await Store.be.insert("contracts",Object.assign({contract_no:no,is_void:0,currency:"CNY"},patch)); added++; }
    else { await Store.be.update("contracts",o.id,patch); updated++; }
    if(p.isMaterial){
      await Store.be.removeWhere("materials",m=>m.contract_id===o.id);
      for(const r of rs.filter(r=>r.material_code||r.material_name)){
        await Store.be.insert("materials",{contract_id:o.id,line_no:r.line_no||"",material_code:r.material_code||"",
          material_name:r.material_name||"",spec:r.spec||"",unit:r.unit||"",plan_qty:num(r.plan_qty),
          price_tax_in:num(r.price_tax_in),amount_tax_in:num(r.amount_tax_in),brand:r.brand||"",info_code:r.info_code||""});
        mats++;
      }
      if(!num(o.total_amount)){
        const sum=Store.be.all("materials").filter(m=>m.contract_id===o.id).reduce((s,m)=>s+(+m.amount_tax_in||0),0);
        await Store.be.update("contracts",o.id,{total_amount:sum});
      }
    }
    /* 期初金额 → 一条汇总记录，后续登记在此基础上累加 */
    for(const [k,type] of [["_arr","到货"],["_inv","开票"],["_paid","付款"]]){
      const v=num(head[k]); if(!v)continue;
      const t=TBL[type];
      const has=Store.be.all(t).some(z=>z.contract_id===o.id&&z.no==="期初导入");
      if(!has){ await Store.be.insert(t,{contract_id:o.id,date:head.sign_date?normDate(head.sign_date):iso(TODAY),amount:v,no:"期初导入",remark:"从 Excel 导入的累计金额",by:(ME&&ME.name)||""}); arrN++; }
    }
    await logIt(o.id,"Excel 导入更新");
  }
  $("#importPreview").innerHTML=`<div class="hint">导入完成：新增 <b>${added}</b> 份，更新 <b>${updated}</b> 份${mats?`，物料 <b>${mats}</b> 行`:""}${arrN?`，期初金额 <b>${arrN}</b> 条`:""}。</div>`;
  $("#pasteBox").value="";PENDING=null;reload();renderData();say("导入完成");
}
/* ---------- 批量上传附件：按文件名里的合同号自动归档 ---------- */
let BULK=null;   // [{file, contractId|null, reason}]
/* 用合同号/订单编号去文件名里找。取最长匹配，避免 "HT-1" 命中 "HT-12" 这种误伤。
   比较时统一去掉大小写和常见分隔符，容忍 "HCMH2025 0516-02" 这类手工命名。 */
function normKey(s){ return String(s||"").toUpperCase().replace(/[\s_\-—－]/g,"") }
function matchFileToContract(fileName,rows){
  const nk=normKey(fileName);
  let best=null,bestLen=0;
  for(const {o} of rows){
    for(const [field,label] of [[o.contract_no,"合同号"],[o.order_no,"订单编号"]]){
      const key=normKey(field);
      if(key.length<4)continue;             // 太短的编号不参与匹配，误命中风险高
      if(nk.includes(key)&&key.length>bestLen){ best={id:o.id,by:label,hit:field}; bestLen=key.length }
    }
  }
  return best;
}
function bulkPickFiles(files){
  const rows=VIEWDATA.filter(x=>!x.o.is_void);
  BULK=[...files].map(f=>{
    const m=matchFileToContract(f.name,rows);
    return {file:f, contractId:m?m.id:null, by:m?m.by:null, hit:m?m.hit:null,
            tooBig:f.size>8*1024*1024};
  });
  renderBulkPreview();
}
function bulkSummary(){
  const okN=BULK.filter(b=>b.contractId&&!b.tooBig).length;
  const badN=BULK.filter(b=>b.tooBig).length;
  const unmatchedN=BULK.filter(b=>!b.contractId&&!b.tooBig).length;
  return {okN,badN,unmatchedN,
    html:`<div class="${unmatchedN||badN?"warnbox":"hint"}">共 ${BULK.length} 个文件：<b>${okN}</b> 个待上传${unmatchedN?`，<b>${unmatchedN}</b> 个没认出合同号（在下面手动选）`:""}${badN?`，<b>${badN}</b> 个超过 8MB 无法上传`:""}。</div>`};
}
/* 只在文件集合变化时重建表格；改下拉框时走 refreshBulkCounts()，
   否则整表重绘会让刚点开的下拉框失焦、列表跳回顶部。 */
function renderBulkPreview(){
  const box=$("#attBulkPreview");
  if(!BULK||!BULK.length){ box.innerHTML=""; return }
  const rows=VIEWDATA.filter(x=>!x.o.is_void)
    .sort((a,b)=>String(a.o.contract_no).localeCompare(String(b.o.contract_no)));
  const opts=id=>`<option value="">— 跳过，不上传 —</option>`+rows.map(({o})=>
    `<option value="${o.id}"${o.id===id?" selected":""}>${esc(o.contract_no)} · ${esc(o.supplier_name)}</option>`).join("");
  const s=bulkSummary();
  box.innerHTML=`<div id="bulkSum">${s.html}</div>
    <div class="tw" style="max-height:300px;overflow:auto"><table><thead><tr>
      <th class="no">文件名</th><th class="no r">大小</th><th class="no">归到哪份合同</th></tr></thead>
    <tbody>${BULK.map((b,i)=>`<tr>
      <td>${esc(b.file.name)}${b.by?`<div style="color:var(--ink-3);font-size:11px">按${b.by}匹配到 ${esc(b.hit)}</div>`:""}</td>
      <td class="r num">${(b.file.size/1024).toFixed(0)} KB</td>
      <td>${b.tooBig?`<span class="pill crit">超过 8MB，跳过</span>`
        :`<select data-bulkpick="${i}" style="max-width:280px;border:1px solid var(--line);border-radius:4px;padding:3px 6px;background:var(--surface-2)">${opts(b.contractId)}</select>`}</td>
    </tr>`).join("")}</tbody></table></div>
    <div class="bar"><button class="btn pri" id="doBulkAtt"${s.okN?"":" disabled"}>上传这 ${s.okN} 个文件</button>
    <button class="btn" id="cancelBulkAtt">取消</button></div>`;
}
function refreshBulkCounts(){
  if(!BULK)return;
  const s=bulkSummary();
  const sum=$("#bulkSum"); if(sum)sum.innerHTML=s.html;
  const btn=$("#doBulkAtt"); if(btn){ btn.disabled=!s.okN; btn.textContent=`上传这 ${s.okN} 个文件` }
}
async function doBulkAttach(){
  const todo=BULK.filter(b=>b.contractId&&!b.tooBig);
  if(!todo.length)return say("没有可上传的文件");
  const btn=$("#doBulkAtt"); if(btn){btn.disabled=true;btn.textContent="上传中…"}
  let done=0,failed=[];
  const byContract={};
  for(const b of todo){
    try{
      const dataUrl=await new Promise((ok,no)=>{const fr=new FileReader();fr.onload=()=>ok(fr.result);fr.onerror=()=>no(new Error("读取失败"));fr.readAsDataURL(b.file)});
      const rec=await Store.be.insert("attachments",{contract_id:b.contractId,name:b.file.name,
        size:b.file.size,type:b.file.type,by:(ME&&ME.name)||"",at:nowTS()});
      await Store.be.putFile(rec.id,dataUrl);
      (byContract[b.contractId]=byContract[b.contractId]||[]).push(b.file.name);
      done++;
      if(btn)btn.textContent=`上传中… ${done}/${todo.length}`;
    }catch(e){ failed.push(b.file.name+"（"+e.message+"）") }
  }
  for(const [cid,names] of Object.entries(byContract)) await logIt(cid,"批量上传附件 "+names.join("、"));
  BULK=null; reload();
  $("#attBulkPreview").innerHTML=`<div class="${failed.length?"warnbox":"hint"}">
    已上传 <b>${done}</b> 个附件，归到 ${Object.keys(byContract).length} 份合同下。
    ${failed.length?`<br>失败 ${failed.length} 个：${esc(failed.join("；"))}`:""}</div>`;
  renderData(); say(`已上传 ${done} 个附件`);
}
function renderData(){
  const n=Store.be.all("contracts").length,m=Store.be.all("materials").length;
  const ev=Store.be.all("arrivals").length+Store.be.all("invoices").length+Store.be.all("payments").length;
  $("#dbStat").innerHTML=`<dl class="kv"><div><dt>合同</dt><dd class="num">${n}</dd></div><div><dt>物料行</dt><dd class="num">${m}</dd></div>
    <div><dt>登记记录</dt><dd class="num">${ev}</dd></div><div><dt>付款节点</dt><dd class="num">${Store.be.all("payplans").length}</dd></div>
    <div><dt>附件</dt><dd class="num">${Store.be.all("attachments").length}</dd></div>
    <div><dt>模式</dt><dd>${Store.be.kind==="cloud"?"云端":"本机"}</dd></div></dl>`;
  const cfg=CloudBackend.cfg();
  if(cfg){$("#cfgUrl").value=cfg.url||"";$("#cfgKey").value=cfg.key||"";}
  $("#cfgState").innerHTML=Store.be.kind==="cloud"?`<div class="hint">已连接云端：${esc(CloudBackend.url)}</div>`:`<div class="muted">当前本机模式</div>`;
}

/* ================= 用户管理 ================= */
async function renderUsers(){
  if(Store.be.kind==="cloud")return renderUsersCloud();
  const us=Store.be.all("users");
  $("#userTb").innerHTML=us.map(u=>`<tr><td class="mono">${esc(u.username)}</td><td>${esc(u.name||"")}</td>
    <td>${u.role==="admin"?'<span class="pill info">管理员</span>':'<span class="pill mute">成员</span>'}</td>
    <td class="mono">${esc(u.created||"")}</td>
    <td>${u.disabled?'<span class="pill crit">已停用</span>':'<span class="pill ok">正常</span>'}</td>
    <td class="r"><button class="btn" data-resetu="${u.id}" style="padding:2px 7px">重置密码</button>
    ${u.id===ME.id?"":`<button class="btn danger" data-toggleu="${u.id}" style="padding:2px 7px">${u.disabled?"启用":"停用"}</button>`}</td></tr>`).join("")
    ||`<tr><td colspan="6" class="empty">还没有其他账号</td></tr>`;
}
/* 云端模式的账号列表读自 profiles 表（有 RLS，任何登录用户可读）；
   角色是数据库侧唯一权威，改角色/启停用都走 set_user_role() 这个函数，
   该函数会先检查调用者自己是不是管理员，不是就直接拒绝——不依赖前端隐藏按钮。 */
async function renderUsersCloud(){
  $("#userTb").innerHTML=`<tr><td colspan="6" class="empty">加载中…</td></tr>`;
  let rows;
  try{ rows=await CloudBackend.rest("profiles?select=*&order=created_at.asc"); }
  catch(e){ $("#userTb").innerHTML=`<tr><td colspan="6" class="empty">${esc(e.message)}<br>如果提示读不到 profiles 表，需要先在 Supabase 后台跑一遍 schema_v2_roles.sql。</td></tr>`; return; }
  $("#userTb").innerHTML=rows.map(u=>`<tr><td class="mono">${esc(u.email)}</td><td>${esc(u.name||"")}</td>
    <td>${u.role==="admin"?'<span class="pill info">管理员</span>':'<span class="pill mute">成员</span>'}</td>
    <td class="mono">${esc(String(u.created_at||"").slice(0,16).replace("T"," "))}</td>
    <td>${u.disabled?'<span class="pill crit">已停用</span>':'<span class="pill ok">正常</span>'}</td>
    <td class="r">${u.id===ME.id?'<span style="color:var(--ink-3);font-size:11px">这是你自己</span>':`
    <button class="btn" data-cloudrole="${u.id}" data-role="${u.role==="admin"?"user":"admin"}" data-disabled="${u.disabled}" style="padding:2px 7px">${u.role==="admin"?"设为成员":"设为管理员"}</button>
    <button class="btn danger" data-cloudtoggle="${u.id}" data-role="${u.role}" data-disabled="${!u.disabled}" style="padding:2px 7px">${u.disabled?"启用":"停用"}</button>`}</td></tr>`).join("")
    ||`<tr><td colspan="6" class="empty">还没有其他账号</td></tr>`;
}
function newUserModal(){
  const cloud=Store.be.kind==="cloud";
  modal("新建账号",`<div class="form">
    <label><span>${cloud?"邮箱":"账号"}</span><input id="nuU" type="${cloud?"email":"text"}" placeholder="${cloud?"zhangsan@qq.com":"拼音或工号"}"></label>
    <label><span>姓名</span><input id="nuN"></label>
    ${cloud?"":'<label><span>角色</span><select id="nuR"><option value="user">成员</option><option value="admin">管理员</option></select></label>'}</div>
    <div class="hint">${cloud?"云端模式下账号是邮箱地址（不需要本人能收信，只要域名真实存在，如 qq.com/163.com/gmail.com）。新账号默认是「成员」，建完后可以在列表里把它设为管理员。":""}密码由系统随机生成（12 位，去掉了容易看错的 0O1lI），创建后只显示一次。</div>`,
    `<div class="spacer"></div><button class="btn" data-close>取消</button><button class="btn pri" data-act="createUser">创建</button>`);
}
async function createUser(){
  const cloud=Store.be.kind==="cloud";
  const username=$("#nuU").value.trim(),name=$("#nuN").value.trim()||username,role=cloud?"user":$("#nuR").value;
  if(!username)return say(cloud?"邮箱必填":"账号必填");
  if(cloud&&!username.includes("@"))return say("云端模式下账号是邮箱地址，请输入完整邮箱");
  const pw=randPw(12);
  try{ await Store.be.createUser({username,name,role,password:pw}); }
  catch(e){ return say(e.message) }
  closeModal();await renderUsers();
  $("#newCred").innerHTML=`<div class="cred"><div class="eyebrow">新账号已创建，密码只显示这一次</div>
    <div class="row"><span>账号</span><code>${esc(username)}</code></div>
    <div class="row"><span>密码</span><code>${esc(pw)}</code></div>
    <div class="row"><button class="btn" data-copycred="${esc(username)}|${esc(pw)}">复制账号密码</button>
    <button class="btn" data-hidecred>我已发给对方，隐藏</button></div></div>`;
}
async function resetUser(id){
  const pw=randPw(12);
  const u=await Store.be.resetPw(id,pw);
  $("#newCred").innerHTML=`<div class="cred"><div class="eyebrow">密码已重置，只显示这一次</div>
    <div class="row"><span>账号</span><code>${esc(u.username)}</code></div>
    <div class="row"><span>新密码</span><code>${esc(pw)}</code></div>
    <div class="row"><button class="btn" data-copycred="${esc(u.username)}|${esc(pw)}">复制</button>
    <button class="btn" data-hidecred>隐藏</button></div></div>`;
  await renderUsers();
}

/* ================= 路由 ================= */
const PAGES={home:renderHome,list:renderList,alert:renderAlert,cash:renderCash,short:renderShort,data:renderData,users:renderUsers};
function go(p){
  $$(".page").forEach(s=>s.hidden=s.id!=="p-"+p);
  $$(".nav").forEach(n=>n.setAttribute("aria-current",String(n.dataset.go===p)));
  reload(); PAGES[p](); updateBadge(); window.scrollTo(0,0);
}
function refreshPage(){ const cur=($(".nav[aria-current='true']")||{dataset:{go:"home"}}).dataset.go; PAGES[cur](); updateBadge(); }
function toggleTheme(){
  const now=document.documentElement.dataset.theme||(matchMedia("(prefers-color-scheme:dark)").matches?"dark":"light");
  document.documentElement.dataset.theme=now==="dark"?"light":"dark";
  try{localStorage.setItem("ly_theme",document.documentElement.dataset.theme)}catch(e){}
  if(!$("#p-home").hidden)drawCash();
}

/* ================= 事件 ================= */
document.addEventListener("click",async e=>{
  const t=e.target;
  try{
    if(t.id==="doInit")return doInit();
    if(t.id==="doLogin")return login($("#iU").value.trim(),$("#iP").value);
    if(t.id==="doLoginNow")return login(t.dataset.u,t.dataset.p);
    if(t.id==="logout"){ sessionStorage.removeItem("ly_me"); if(Store.be.kind==="cloud")CloudBackend.logout(); location.reload(); return }
    const nav=t.closest("[data-go]"); if(nav)return go(nav.dataset.go);
    const op=t.closest("[data-open]"); if(op)return openD(op.dataset.open);
    const ed=t.closest("[data-edit]"); if(ed)return editContract(ed.dataset.edit);
    const rg=t.closest("[data-reg]"); if(rg)return regModal(rg.dataset.reg);
    const dv=t.closest("[data-v]"); if(dv){view=dv.dataset.v;return renderList()}
    const th=t.closest("th[data-k]"); if(th&&!th.classList.contains("no")){const k=th.dataset.k;sortD=sortK===k?-sortD:-1;sortK=k;return renderList()}
    const tb=t.closest("#dtabs .tab"); if(tb){tabI=+tb.dataset.t;return drawTab()}
    const pn=t.closest("[data-paynode]"); if(pn){
      const pl=Store.be.all("payplans").find(p=>p.id===pn.dataset.paynode);
      modal("登记付款 · "+pl.name,`<div class="form">
        <label><span>日期</span><input id="eDate" type="date" value="${iso(TODAY)}"></label>
        <label><span>金额</span><input id="eAmt" value="${(+pl.amount||0).toFixed(2)}"></label>
        <label><span>付款单号</span><input id="eNo"></label>
        <label class="wide"><span>备注</span><input id="eRemark" value="${esc(pl.name)}"></label></div>`,
        `<div class="spacer"></div><button class="btn" data-close>取消</button><button class="btn pri" data-act="saveEvent" data-type="付款" data-plan="${pl.id}">登记</button>`);
      return;
    }
    const del=t.closest("[data-del]"); if(del){
      const [tbl,id]=del.dataset.del.split(":");
      if(!confirm("确认删除这条记录？"))return;
      await Store.be.remove(tbl,id); await logIt(curId,"删除一条"+({arrivals:"到货",invoices:"开票",payments:"付款"}[tbl])+"记录");
      reload();drawHead();drawTab();refreshPage();say("已删除");return;
    }
    const gf=t.closest("[data-getfile]"); if(gf){
      const a=Store.be.all("attachments").find(z=>z.id===gf.dataset.getfile);
      const dataUrl=await Store.be.getFile(a.id);
      if(!dataUrl)return say("附件读取失败");
      const blob=await (await fetch(dataUrl)).blob(); download(a.name,blob); return;
    }
    const df=t.closest("[data-delfile]"); if(df){
      if(!confirm("确认删除该附件？"))return;
      await Store.be.delFile(df.dataset.delfile); await Store.be.remove("attachments",df.dataset.delfile);
      await logIt(curId,"删除附件"); reload();drawTab();say("已删除");return;
    }
    if(t.id==="attDrop")return $("#attFile").click();
    if(t.id==="attBulkDrop")return $("#attBulkFile").click();
    if(t.id==="doBulkAtt")return doBulkAttach();
    if(t.id==="cancelBulkAtt"){BULK=null;$("#attBulkPreview").innerHTML="";return}
    const ru=t.closest("[data-resetu]"); if(ru)return resetUser(ru.dataset.resetu);
    const cr=t.closest("[data-cloudrole]")||t.closest("[data-cloudtoggle]");
    if(cr){
      const id=cr.dataset.cloudrole||cr.dataset.cloudtoggle;
      const role=cr.dataset.role, disabled=cr.dataset.disabled==="true";
      if(cr.dataset.cloudtoggle&&!confirm(disabled?"确认停用该账号？停用后对方无法登录。":"确认启用该账号？"))return;
      try{ await CloudBackend.setUserRole(id,role,disabled); say("已更新"); }
      catch(err){ say(err.message.includes("只有管理员")?"只有管理员能改权限":err.message) }
      return renderUsers();
    }
    const tu=t.closest("[data-toggleu]"); if(tu){
      const u=Store.be.all("users").find(z=>z.id===tu.dataset.toggleu);
      await Store.be.setUser(u.id,{disabled:u.disabled?0:1});renderUsers();return;
    }
    const cc=t.closest("[data-copycred]"); if(cc){
      const [u,p]=cc.dataset.copycred.split("|");
      try{await navigator.clipboard.writeText(`账号：${u}\n密码：${p}`);say("已复制")}catch(err){say("复制失败，请手动记录")}
      return;
    }
    if(t.closest("[data-hidecred]")){$("#newCred").innerHTML="";return}
    if(t.closest("[data-close]"))return closeModal();
    const act=t.closest("[data-act]");
    if(act){
      const a=act.dataset.act;
      if(a==="saveC")return saveContract(act.dataset.id||null);
      if(a==="saveEvent")return saveEvent(act.dataset.type,act.dataset.plan||null);
      if(a==="saveArrLines")return saveArrLines();
      if(a==="createUser")return createUser();
      if(a==="genplan"){await genPlansFor([CUR()]);drawTab();refreshPage();return}
      if(a==="clearplan"){await Store.be.removeWhere("payplans",p=>p.contract_id===curId);reload();await genPlansFor([CUR()]);drawTab();refreshPage();return}
      if(a==="void"){
        const x=VIEWDATA.find(v=>v.o.id===act.dataset.id);
        await Store.be.update("contracts",x.o.id,{is_void:x.o.is_void?0:1});
        await logIt(x.o.id,x.o.is_void?"取消作废":"作废");
        closeModal();reload();refreshPage();if(curId)drawHead();say("已处理");return;
      }
      if(a==="delc"){
        if(!confirm("确认删除该合同及其物料、记录？不可恢复。"))return;
        const id=act.dataset.id;
        /* 先删实际的附件文件，否则数据库记录没了、文件还占着云存储，
           再也没有入口能清理到它们 */
        for(const at of Store.be.all("attachments").filter(x=>x.contract_id===id)){
          try{ await Store.be.delFile(at.id) }catch(err){ console.warn("附件文件删除失败",at.name,err) }
        }
        for(const tb2 of ["materials","arrivals","invoices","payments","payplans","attachments","audit"])
          await Store.be.removeWhere(tb2,r=>r.contract_id===id);
        await Store.be.remove("contracts",id);
        closeModal();shutD();reload();refreshPage();say("已删除");return;
      }
    }
    if(t.id==="closeD"||t.id==="scrim")return shutD();
    if(t.id==="openCmd")return showCmd();
    if(t.id==="themeBtn")return toggleTheme();
    if(t.id==="newC")return editContract(null);
    if(t.id==="newU")return newUserModal();
    if(t.id==="reset"){["fq","fArr","fPay","fSup"].forEach(id=>$("#"+id).value="");return renderList()}
    if(t.id==="doParse")return preview($("#pasteBox").value);
    if(t.id==="doImport")return doImport();
    if(t.id==="pickFile")return $("#file").click();
    if(t.id==="drop")return $("#file").click();
    if(t.id==="genAll"){await genPlansFor(VIEWDATA.filter(x=>!x.o.is_void&&x.c.owe>0));refreshPage();return}
    if(t.id==="backup"){
      const dump={contracts:Store.be.all("contracts"),materials:Store.be.all("materials"),arrivals:Store.be.all("arrivals"),
        invoices:Store.be.all("invoices"),payments:Store.be.all("payments"),payplans:Store.be.all("payplans"),
        attachments:Store.be.all("attachments"),audit:Store.be.all("audit"),users:Store.be.all("users"),meta:{exported:nowTS()}};
      download("履约云备份_"+iso(TODAY)+".json",JSON.stringify(dump,null,1),"application/json");return;
    }
    if(t.id==="restore")return $("#restoreFile").click();
    if(t.id==="wipe"){
      if(!confirm("确认清空全部数据？请先备份。"))return;
      const keepUsers=Store.be.all("users");
      const e2=emptyDB();e2.users=keepUsers;await Store.be.replaceAll(e2);
      reload();refreshPage();renderData();say("已清空（账号保留）");return;
    }
    if(t.id==="cfgSave"){
      const url=$("#cfgUrl").value.trim(),key=$("#cfgKey").value.trim();
      if(!url||!key)return say("地址和密钥都要填");
      localStorage.setItem("lvyue_cloud_cfg",JSON.stringify({url,key}));
      say("已保存，正在重新连接…");setTimeout(()=>location.reload(),800);return;
    }
    if(t.id==="cfgClear"){localStorage.setItem("lvyue_cloud_cfg",JSON.stringify({forceLocal:true}));localStorage.removeItem("lvyue_sess");say("已断开");setTimeout(()=>location.reload(),600);return}
    if(t.id==="expBtn")return csv(filtered().map(({o,c})=>Object.assign({},o,{due:c.due,dueSrc:c.dueSrc,late:c.late,arrS:c.arrS,invS:c.invS,payS:c.payS,arr:c.arr,inv:c.inv,paid:c.paid,owe:c.owe,shortN:c.shortLines.length})),
      ["contract_no","order_no","supplier_name","contract_name","total_amount","currency","sign_date","due","dueSrc","late","arrS","invS","payS","arr","inv","paid","owe","shortN","purchaser","pay_condition_text"],
      {contract_no:"合同号",order_no:"订单编号",supplier_name:"供应商",contract_name:"合同名称",total_amount:"合同总额",currency:"币别",sign_date:"签订日期",due:"交期",dueSrc:"交期口径",late:"逾期天数",arrS:"到货状态",invS:"开票状态",payS:"付款状态",arr:"已到货金额",inv:"已开票金额",paid:"已付款金额",owe:"待付款",shortN:"缺料行数",purchaser:"采购员",pay_condition_text:"付款条件"},"合同台账.csv");
    if(t.id==="expShort")return csv(shortRows(),["contract_no","supplier_name","due","late","line_no","material_name","spec","plan_qty","arrived","short","unit","short_amt"],
      {contract_no:"合同号",supplier_name:"供应商",due:"交期",late:"逾期天数",line_no:"行号",material_name:"物料名称",spec:"规格型号",plan_qty:"订购数量",arrived:"已到数量",short:"未到数量",unit:"单位",short_amt:"未到金额"},"催货清单.csv");
    const li=t.closest("#cmdl li[data-i]"); if(li)return runCmd(+li.dataset.i);
    if(!t.closest("#cmdk"))$("#cmdk").classList.remove("on");
  }catch(err){ say("出错了："+err.message); console.error(err) }
});
["fq","fArr","fPay","fSup"].forEach(id=>document.addEventListener("input",e=>{if(e.target.id===id)renderList()}));
document.addEventListener("change",async e=>{
  if(e.target.id==="fVoid")return renderList();
  if(e.target.id==="shortLateOnly")return renderShort();
  if(e.target.id==="attBulkFile"){const fs=[...e.target.files];if(fs.length)bulkPickFiles(fs);return}
  const bp=e.target.closest&&e.target.closest("[data-bulkpick]");
  if(bp&&BULK){ BULK[+bp.dataset.bulkpick].contractId=bp.value||null; return refreshBulkCounts() }
  if(e.target.id==="file"){const f=e.target.files[0];if(!f)return;return loadImportFile(f)}
  if(e.target.id==="restoreFile"){const f=e.target.files[0];if(!f)return;const r=new FileReader();
    r.onload=async()=>{try{
      const j=JSON.parse(r.result); if(!j.contracts)throw new Error("不是本系统的备份");
      const next=emptyDB();
      ["contracts","materials","arrivals","invoices","payments","payplans","attachments","audit","users"].forEach(k=>{if(j[k])next[k]=j[k]});
      await Store.be.replaceAll(next);reload();refreshPage();renderData();say("已还原 "+next.contracts.length+" 份合同");
    }catch(err){say("还原失败："+err.message)}};
    r.readAsText(f,"utf-8");return}
  if(e.target.id==="attFile"){
    const files=[...e.target.files];if(!files.length)return;
    for(const f of files){
      if(f.size>8*1024*1024){say(f.name+" 超过 8MB，跳过");continue}
      const dataUrl=await new Promise(ok=>{const fr=new FileReader();fr.onload=()=>ok(fr.result);fr.readAsDataURL(f)});
      const rec=await Store.be.insert("attachments",{contract_id:curId,name:f.name,size:f.size,type:f.type,by:(ME&&ME.name)||"",at:nowTS()});
      await Store.be.putFile(rec.id,dataUrl);
    }
    await logIt(curId,"上传附件 "+files.map(f=>f.name).join("、"));
    reload();drawTab();say("附件已保存");
  }
});
document.addEventListener("keydown",e=>{
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="k"){e.preventDefault();return showCmd()}
  if(e.key==="Escape"){$("#cmdk").classList.remove("on");if($("#modal").classList.contains("on"))return closeModal();return shutD()}
  if(e.key==="Enter"&&!$("#gate").hidden){const b=$("#doLogin")||$("#doInit")||$("#doLoginNow");if(b)b.click()}
  if($("#cmdk").classList.contains("on")&&["ArrowDown","ArrowUp","Enter"].includes(e.key)){
    e.preventDefault();if(e.key==="Enter")return runCmd(cmdSel);
    cmdSel=Math.max(0,Math.min(cmdItems.length-1,cmdSel+(e.key==="ArrowDown"?1:-1)));
    $$("#cmdl li").forEach((l,i)=>l.setAttribute("aria-selected",String(i===cmdSel)));
  }
});
addEventListener("resize",()=>{if(!$("#p-home").hidden)drawCash()});
document.addEventListener("dragover",e=>{const dz=e.target.closest(".drop");if(dz){e.preventDefault();dz.classList.add("hot")}});
document.addEventListener("dragleave",e=>{const dz=e.target.closest(".drop");if(dz)dz.classList.remove("hot")});
document.addEventListener("drop",async e=>{
  const dz=e.target.closest(".drop");if(!dz)return;e.preventDefault();dz.classList.remove("hot");
  const f=e.dataTransfer.files[0];if(!f)return;
  if(dz.id==="attDrop"){$("#attFile").files=e.dataTransfer.files;$("#attFile").dispatchEvent(new Event("change",{bubbles:true}));return}
  if(dz.id==="attBulkDrop"){ const fs=[...e.dataTransfer.files]; if(fs.length)bulkPickFiles(fs); return }
  return loadImportFile(f);
});

/* 命令面板 */
let cmdSel=0,cmdItems=[];
function showCmd(){$("#cmdk").classList.add("on");$("#cmdi").value="";fillCmd();$("#cmdi").focus()}
function fillCmd(){
  const q=$("#cmdi").value.trim();
  const nav=[["工作台","home"],["合同台账","list"],["预警中心","alert"],["付款计划","cash"],["催货清单","short"],["数据管理","data"]]
    .filter(x=>!q||x[0].includes(q)).map(x=>({k:"导航",t:x[0],f:()=>go(x[1])}));
  const hits=q?VIEWDATA.filter(({o,ms})=>[o.contract_no,o.supplier_name,o.contract_name,o.order_no].join("|").includes(q)||ms.some(m=>String(m.material_name||"").includes(q))).slice(0,8)
    .map(({o})=>({k:"合同",t:o.contract_no+" · "+o.supplier_name,f:()=>openD(o.id)})):[];
  cmdItems=[...hits,...nav];cmdSel=0;
  $("#cmdl").innerHTML=cmdItems.map((c,i)=>`<li aria-selected="${i===cmdSel}" data-i="${i}"><span class="k">${c.k}</span>${esc(c.t)}</li>`).join("")||`<li style="color:var(--ink-3)">无结果</li>`;
}
function runCmd(i){const c=cmdItems[i];if(!c)return;$("#cmdk").classList.remove("on");c.f()}
document.addEventListener("input",e=>{if(e.target.id==="cmdi")fillCmd()});

/* 调试/自动化入口：顶层 let/const 不挂在 window 上，这里显式暴露一份 */
window.LY={
  Store,CloudBackend,LocalBackend,
  get ME(){return ME}, get VIEWDATA(){return VIEWDATA},
  get curId(){return curId}, set curId(v){curId=v},
  get tabI(){return tabI}, set tabI(v){tabI=v},
  num,iso,fmt,wan,nowTS,normDate,randPw,hashPw,genPlan,calcContract,parseTable,emptyDB,
  cashBuckets,CUR,go,openD,shutD,drawTab,drawHead,regModal,saveArrLines,saveEvent,
  saveContract,editContract,preview,doImport,genPlansFor,createUser,newUserModal,
  matchFileToContract,bulkPickFiles,doBulkAttach,loadImportFile,xlsxToTSV,
  get BULK(){return BULK}, set BULK(v){BULK=v},
  resetUser,renderUsers,shortRows,filtered,reload,refreshPage,csv
};

boot();
