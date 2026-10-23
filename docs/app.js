(function(){
"use strict";
/* ======================================================================
   Team config: everything team-specific comes from team.json (loaded at boot).
   ====================================================================== */
let C=null,PN=null,A=null;
const PRON={she:{sub:"she",obj:"her",pos:"her",plural:false},he:{sub:"he",obj:"him",pos:"his",plural:false},they:{sub:"they",obj:"them",pos:"their",plural:true}};
const cap=x=>String(x||"").charAt(0).toUpperCase()+String(x||"").slice(1);
const vb=(one,many)=>PN.plural?many:one;           // verb agreement: "she opens" / "they open"
const fill=(t,x)=>String(t||"").replace(/\{(\w+)\}/g,(m,k)=>x&&k in x?x[k]:m);
function useConfig(cfg){C=cfg;const p=PRON[(cfg.athletes&&cfg.athletes.pronouns)||"they"]||PRON.they;
  PN={...p,Sub:cap(p.sub),Obj:cap(p.obj),Pos:cap(p.pos)};
  A={one:cfg.athletes.singular||"athlete",many:cfg.athletes.plural||"athletes",One:cap(cfg.athletes.singular||"athlete"),Many:cap(cfg.athletes.plural||"athletes"),detail:cfg.athletes.detail||{label:"",short:"",suffix:""}};
  const r=document.documentElement.style,col=cfg.team.colors||{};if(col.primary)r.setProperty("--primary",col.primary);if(col.accent)r.setProperty("--accent",col.accent);
  document.title=cfg.brand.name+" · "+cfg.team.name;
  const ic=document.querySelector('link[rel="icon"]');if(ic)ic.href=cfg.team.logo;
  const md=document.querySelector('meta[name="description"]');if(md)md.content=cfg.brand.tagline+" "+cfg.team.name+".";}
const line=k=>fill(C.brand.lines[k],{obj:PN.obj,sub:PN.sub,pos:PN.pos,athlete:A.one,athletes:A.many,team:C.team.name});
const pw=()=>C.labels.practice.toLowerCase();
const isWrestling=()=>/wrestl/i.test(C.team.sport||"");
const detailText=w=>w.weight?((A.detail.prefix||"")+w.weight+(A.detail.suffix?" "+A.detail.suffix:"")):"";
function seasonDays(){const s=C.schedule,wk=new Set(s.practiceWeekdays||[1,2,3,4,5]),br=s.breaks||{},ev={};
  (s.events||[]).forEach(e=>ev[e.date]={key:e.date,kind:"event",name:e.name,where:e.where||"",post:!!e.postseason,end:e.end||null,label:e.label||e.name,priceCents:e.priceCents||null});
  const out=[];const d=new Date(s.practiceStart+"T00:00:00Z"),stop=new Date(s.lastDay+"T00:00:00Z");
  for(;d<=stop;d.setUTCDate(d.getUTCDate()+1)){const key=d.toISOString().slice(0,10);
    if(ev[key]){out.push(ev[key]);continue}if(key>s.practiceEnd||!wk.has(d.getUTCDay())||br[key])continue;
    out.push({key,kind:"practice",name:"Practice",where:"",post:false,end:null,label:C.labels.practice})}return out}
const DEFAULT_ASK=first=>fill(C.copy.defaultAsk,{first});

/* ======================================================================
   Helpers
   ====================================================================== */
const h=(tag,a,...kids)=>{const n=document.createElement(tag);if(a)for(const k in a){const v=a[k];if(v==null||v===false)continue;
  if(k.startsWith("on"))n.addEventListener(k.slice(2),v);else if(k==="class")n.className=v;else if(k==="style")n.style.cssText=v;else if(k==="value")n.value=v;else n.setAttribute(k,v===true?"":v)}
  for(const c of kids.flat()){if(c==null||c===false)continue;n.append(c.nodeType?c:document.createTextNode(String(c)))}return n};
const frag=s=>{const t=document.createElement("template");t.innerHTML=s.trim();return t.content.firstChild};
const P=s=>new Date(s+"T00:00:00Z");
const F=(s,o)=>P(s).toLocaleDateString("en-US",Object.assign({timeZone:"UTC"},o));
const short=s=>F(s,{month:"short",day:"numeric"}), longDay=s=>F(s,{weekday:"long",month:"long",day:"numeric"});
const weekOf=k=>{const d=P(k);d.setUTCDate(d.getUTCDate()-((d.getUTCDay()+6)%7));return d.toISOString().slice(0,10)};
const addDays=(k,n)=>{const d=P(k);d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10)};
const money=c=>"$"+(c/100).toLocaleString("en-US",{minimumFractionDigits:c%100?2:0,maximumFractionDigits:2});
const teamToday=()=>new Intl.DateTimeFormat("en-CA",{timeZone:C.timezone||"America/Chicago",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
const firstName=n=>String(n||"").replace(/\s*\(.*\)\s*/,"").split(/\s+/)[0]||"";
const initials=n=>String(n||"?").split(/\s+/).filter(Boolean).map(x=>x[0]).join("").slice(0,2).toUpperCase();
const errText=e=>(e&&e.message||"Something went wrong. Try again.").replace(/^Firebase(Error)?:\s*/,"");
function toast(msg){document.querySelectorAll(".toast").forEach(t=>t.remove());const t=h("div",{class:"toast",role:"status"},msg);document.body.append(t);setTimeout(()=>t.remove(),3800)}
async function copy(text,el){try{await navigator.clipboard.writeText(text);toast("Copied")}catch(e){if(el){const r=document.createRange();r.selectNodeContents(el);const s=getSelection();s.removeAllRanges();s.addRange(r)}toast("Selected. Copy it from here.")}}

const ENVELOPE=open=>`<svg viewBox="0 0 96 72" aria-hidden="true"><rect x="3" y="14" width="90" height="55" rx="6" fill="#fbf7ef"/>${open?`<g class="letter"><rect x="14" y="2" width="68" height="44" rx="3" fill="#fff"/><path d="M24 14h48M24 22h40M24 30h44" stroke="#c9cfe0" stroke-width="3" stroke-linecap="round"/></g>`:""}<path d="M3 20 48 46 93 20" fill="none" stroke="#d8cdb6" stroke-width="2.5"/><path class="flap" d="M3 20 Q3 14 9 14 H87 Q93 14 93 20 L48 46 Z" fill="#efe6d3"/><circle cx="48" cy="44" r="9" style="fill:var(--accent)"/><path d="M43.5 44h9M48 39.5v9" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/></svg>`;
const MINI_ENV=`<svg class="ic" viewBox="0 0 20 16" aria-hidden="true"><rect x="1" y="2" width="18" height="13" rx="2.5" fill="#fbf7ef"/><path d="M1.5 4 10 10 18.5 4" fill="none" style="stroke:var(--accent)" stroke-width="1.8"/></svg>`;
const MEDAL=`<svg class="md" viewBox="0 0 16 20" aria-hidden="true"><path d="M4 0h3l2 6H6zM9 0h3L10 6H7z" style="fill:var(--accent)"/><circle cx="8" cy="13" r="6" fill="#ffcf5c"/><circle cx="8" cy="13" r="3.4" fill="none" stroke="#b8891f" stroke-width="1.2"/></svg>`;
const SMALL_ENV=`<svg viewBox="0 0 20 16" aria-hidden="true"><rect x="1" y="2" width="18" height="13" rx="2.5" fill="#fbf7ef"/><path d="M1.5 4 10 10 18.5 4" fill="none" style="stroke:var(--accent)" stroke-width="1.8"/></svg>`;

function matSVG(){return frag(`<svg class="mat" viewBox="0 0 1000 1000" aria-hidden="true">
  <circle cx="500" cy="500" r="480" fill="none" style="stroke:var(--accent)" stroke-opacity=".45" stroke-width="30"/>
  <circle cx="500" cy="500" r="450" style="fill:color-mix(in oklab,var(--primary) 35%,#05070f)" fill-opacity=".55"/>
  <circle cx="500" cy="500" r="370" fill="none" stroke="#fff" stroke-opacity=".16" stroke-width="7"/>
</svg>`)}

function placeholderFigure(){return frag(`<svg class="ph" viewBox="0 0 320 420" role="img" aria-label="Photo placeholder">
  <defs><linearGradient id="phg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--navy-3)"/><stop offset="1" style="stop-color:var(--navy-2)"/></linearGradient></defs>
  ${PN&&PN.sub==="she"?'<path d="M196 70 C232 66 252 96 246 126 C262 150 258 186 238 196" fill="none" stroke="url(#phg)" stroke-width="26" stroke-linecap="round"/>':""}
  <circle cx="160" cy="112" r="56" fill="url(#phg)"/>
  <path d="M60 420 C60 300 92 214 160 210 C228 214 260 300 260 420 Z" fill="url(#phg)"/>
  <path d="M120 222 L132 300 L160 330 L188 300 L200 222" fill="none" style="stroke:var(--accent)" stroke-width="10" stroke-linejoin="round" opacity=".8"/>
  <path d="M160 26 a86 86 0 0 1 0 172 a86 86 0 0 1 0 -172" fill="none" style="stroke:var(--primary-soft)" stroke-opacity=".5" stroke-width="2.5" stroke-dasharray="7 9"/>
  <text x="160" y="400" text-anchor="middle" font-family="Figtree,system-ui,sans-serif" font-weight="700" font-size="17" style="fill:var(--muted)">Photo goes here</text>
</svg>`)}

function ringSVG(pct){const r=88,c=2*Math.PI*r;return frag(`<svg viewBox="0 0 220 220" role="img" aria-label="${Math.round(pct*100)} percent of days filled">
   <circle cx="110" cy="110" r="${r}" fill="none" style="stroke:var(--navy-2)" stroke-width="22"/>
   <circle cx="110" cy="110" r="${r}" fill="none" style="stroke:var(--primary)" stroke-width="22" stroke-linecap="round" stroke-dasharray="${(c*pct).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 110 110)"/>
   <text x="110" y="132" text-anchor="middle" font-family="Big Shoulders Display,Impact,sans-serif" font-weight="900" font-size="64" fill="#fff">${Math.round(pct*100)}%</text></svg>`)}
const progressSVG=pct=>isWrestling()?singletSVG(pct):ringSVG(pct);
function singletSVG(pct){const body="M62 10 H90 C95 44 125 44 130 10 H158 C160 62 167 98 177 134 C187 174 193 216 197 264 C171 284 141 282 125 256 L110 232 L95 256 C79 282 49 284 23 264 C27 216 33 174 43 134 C53 98 60 62 62 10 Z";
  const y=292-Math.round(282*pct);const id="sc"+Math.random().toString(36).slice(2,7);
  return frag(`<svg viewBox="0 0 220 300" role="img" aria-label="${Math.round(pct*100)} percent of days filled"><defs><clipPath id="${id}"><path d="${body}"/></clipPath></defs>
   <path d="${body}" style="fill:var(--navy-2)"/><g clip-path="url(#${id})"><rect x="0" y="${y}" width="220" height="${300-y}" style="fill:var(--primary)"/>
   <path d="M43 134 C33 174 27 216 23 264 L42 272 C46 220 52 176 60 136 Z" style="fill:var(--accent)"/><path d="M177 134 C187 174 193 216 197 264 L178 272 C174 220 168 176 160 136 Z" style="fill:var(--accent)"/></g>
   <path d="${body}" fill="none" stroke="#f3f6ff" stroke-width="7" stroke-linejoin="round"/>
   <text x="110" y="190" text-anchor="middle" font-family="Big Shoulders Display,Impact,sans-serif" font-weight="900" font-size="64" fill="#fff">${Math.round(pct*100)}%</text></svg>`)}

/* ======================================================================
   Backends: same interface. Demo = in memory. Live = Firebase.
   ====================================================================== */
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function makeDemoBackend(){
  const D=await (await fetch("demo.json",{cache:"no-store"})).json();
  const TODAY=D.today;
  const season={days:seasonDays(),breaks:C.schedule.breaks||{},offDays:[],practicePriceCents:C.prices.practiceCents,eventMultiplier:C.prices.eventMultiplier,
    rewardName:C.reward.name,rewardText:C.reward.text,payNote:C.payNote};
  const W=D.athletes.map(a=>({id:a.id,slug:a.slug,name:a.name,weight:String(a.weight||""),photoUrl:a.photo||"",photoCutout:!!a.photo,askText:a.ask||DEFAULT_ASK(firstName(a.name)),active:true,raisedCents:0,daysPaid:0,sponsorCount:0}));
  const emails=Object.fromEntries(D.athletes.map(a=>[a.id,a.email||""]));
  const claims={},orders={},messages={};let seq=1;const L=new Set();const emit=()=>L.forEach(f=>f());
  const dayMap=Object.fromEntries(season.days.map(d=>[d.key,d]));
  const price=k=>dayMap[k].priceCents||(dayMap[k].kind==="event"?season.practicePriceCents*season.eventMultiplier:season.practicePriceCents);
  const taken=c=>c&&(c.status==="paid"||(c.status==="held"&&c.holdExpires>Date.now()));
  function place(inp,method){const keys=[...new Set(inp.dayKeys)].sort();const tk=keys.filter(k=>taken(claims[inp.wrestlerId+"__"+k]));
    if(tk.length){const e=new Error("Someone just took one of those days.");e.details={taken:tk};throw e}
    const id="o"+(seq++),amount=keys.reduce((s,k)=>s+price(k),0);
    orders[id]={id,wrestlerId:inp.wrestlerId,dayKeys:keys,amountCents:amount,donorName:inp.donorName,anon:!!inp.anon,contact:inp.contact||"",message:inp.message||"",revealDay:keys.includes(inp.revealDay)?inp.revealDay:keys[0],status:"pending",method,createdAt:Date.now()-seq*60000};
    keys.forEach(k=>claims[inp.wrestlerId+"__"+k]={wrestlerId:inp.wrestlerId,dayKey:k,status:"held",orderId:id,displayName:inp.anon?"Anonymous":inp.donorName,hasNote:false,holdExpires:Date.now()+15*60000});
    return{orderId:id,amountCents:amount,holdExpires:Date.now()+15*60000}}
  function moderate(id,ok,text){const m=messages[id];m.status=ok?"approved":"rejected";if(text!=null)m.text=text;m.released=ok&&m.revealDay<=TODAY;
    const c=claims[m.wrestlerId+"__"+m.revealDay];if(c&&c.orderId===id)c.hasNote=ok}
  function pay(id,provider,approve){const o=orders[id];if(!o||o.status!=="pending")return{status:o?o.status:"missing"};o.status="paid";o.payment={provider};
    o.dayKeys.forEach(k=>claims[o.wrestlerId+"__"+k]={wrestlerId:o.wrestlerId,dayKey:k,status:"paid",orderId:id,displayName:o.anon?"Anonymous":o.donorName,hasNote:!!o.message&&k===o.revealDay});
    const w=W.find(x=>x.id===o.wrestlerId);w.raisedCents+=o.amountCents;w.daysPaid+=o.dayKeys.length;w.sponsorCount++;
    if(o.message){messages[id]={id,wrestlerId:o.wrestlerId,text:o.message,fromName:o.anon?"Someone in your corner":o.donorName,revealDay:o.revealDay,status:"pending",released:false};if(approve)moderate(id,true)}
    return{status:"paid"}}
  (D.sponsorships||[]).forEach(([w,keys,n,msg,rev])=>pay(place({wrestlerId:w,dayKeys:keys,donorName:n,anon:n==="Anonymous",message:msg,revealDay:rev||keys[0]},"sample").orderId,"sample",true));
  (D.awaitingApproval||[]).forEach(([w,keys,n,msg,rev])=>pay(place({wrestlerId:w,dayKeys:keys,donorName:n,message:msg,revealDay:rev||keys[0]},"online").orderId,"mock",false));
  (D.awaitingPayment||[]).forEach(([w,keys,n,msg,rev])=>place({wrestlerId:w,dayKeys:keys,donorName:n,message:msg,revealDay:rev||keys[0]},"online"));
  const FEATURED=D.featured;
  let auth={signedIn:false,admin:false,wrestlerId:null,email:""};const AL=new Set();const pushAuth=()=>AL.forEach(f=>f(auth));
  return{mode:"demo",today:()=>TODAY,featured:FEATURED,todayLabel:F(TODAY,{weekday:"short",month:"short",day:"numeric"}),
    watchSeason(cb){const f=()=>cb(season);L.add(f);f();return()=>L.delete(f)},
    watchWrestlers(cb){const f=()=>cb(W.map(x=>({...x})));L.add(f);f();return()=>L.delete(f)},
    watchTeam(cb){const f=()=>cb(W.reduce((a,w)=>({raisedCents:a.raisedCents+w.raisedCents,daysPaid:a.daysPaid+w.daysPaid}),{raisedCents:0,daysPaid:0}));L.add(f);f();return()=>L.delete(f)},
    watchClaims(wid,cb){const f=()=>{const m={};Object.values(claims).forEach(c=>{if(c.wrestlerId===wid)m[c.dayKey]={...c}});cb(m)};L.add(f);f();return()=>L.delete(f)},
    watchMyNotes(wid,cb){const f=()=>cb(Object.values(messages).filter(m=>m.wrestlerId===wid&&m.released).sort((a,b)=>b.revealDay.localeCompare(a.revealDay)).map(m=>({...m})));L.add(f);f();return()=>L.delete(f)},
    async paymentMode(){return"mock"},
    async createOrder(inp){await wait(450);const r=place(inp,"online");emit();return r},
    async mockPay(id){await wait(1000);const r=pay(id,"mock",false);emit();return r},
    onAuth(cb){AL.add(cb);cb(auth)},
    demoAs(view){auth=view==="admin"?{signedIn:true,admin:true,wrestlerId:null,email:"coach@example.org"}:view==="athlete"?{signedIn:true,admin:false,wrestlerId:FEATURED,email:emails[FEATURED]}:{signedIn:false,admin:false,wrestlerId:null,email:""};pushAuth()},
    async sendSignInLink(){await wait(400)}, async signInGoogle(){this.demoAs("athlete")}, async signOut(){this.demoAs("public")}, async finishEmailLink(){return false},
    async updateMyProfile(p){Object.assign(W.find(x=>x.id===auth.wrestlerId),p);emit()},
    async uploadPhoto(wid,blob){return URL.createObjectURL(blob)},
    watchAdmin(cb){const f=()=>cb({pending:Object.values(messages).filter(m=>m.status==="pending").map(m=>({...m})),orders:Object.values(orders).sort((a,b)=>b.createdAt-a.createdAt).map(o=>({...o})),emails:{...emails}});L.add(f);f();return()=>L.delete(f)},
    async setup(){toast("The sample season is already set up")},
    async saveSettings(s){const{matchName,matchCapCents,...rest}=s;Object.assign(season,rest,{match:matchName&&matchCapCents?{name:matchName,capCents:matchCapCents}:null});emit()},
    async importRoster(rows){let added=0,updated=0;const skipped=[];rows.forEach(r=>{const em=String(r.email||"").toLowerCase();if(!r.name||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)){skipped.push(r.email||r.name);return}
      const ex=Object.keys(emails).find(k=>emails[k]===em);if(ex){Object.assign(W.find(w=>w.id===ex),{name:r.name,weight:r.weight||W.find(w=>w.id===ex).weight});updated++}
      else{const id="n"+(seq++);W.push({id,name:r.name,weight:r.weight||"",photoUrl:"",photoCutout:false,askText:DEFAULT_ASK(firstName(r.name)),active:true,raisedCents:0,daysPaid:0,sponsorCount:0});emails[id]=em;added++}});emit();return{added,updated,skipped}},
    async saveWrestler(p){if(p.slug!=null){p.slug=String(p.slug).toLowerCase().trim();if(!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(p.slug))throw new Error("Links can use lowercase letters, numbers, and dashes, like addison-clark.");if(W.some(x=>x.id!==p.id&&x.slug===p.slug))throw new Error("Another wrestler already has that link.")}Object.assign(W.find(x=>x.id===p.id),p);emit();return{id:p.id,slug:W.find(x=>x.id===p.id).slug}},
    async setOffDay(k,off){if(off&&Object.values(claims).some(c=>c.dayKey===k&&taken(c)))throw new Error("Someone already sponsored this day. Void that sponsorship first.");season.offDays=off?[...season.offDays,k]:season.offDays.filter(x=>x!==k);emit()},
    async recordPayment(inp){const r=place(inp,inp.method);pay(r.orderId,inp.method,false);emit();return r},
    async confirmOrder(id){pay(id,"manual",false);emit()},
    async voidOrder(id){const o=orders[id];if(o.status==="paid"){const w=W.find(x=>x.id===o.wrestlerId);w.raisedCents-=o.amountCents;w.daysPaid-=o.dayKeys.length;w.sponsorCount--}
      o.dayKeys.forEach(k=>{const c=claims[o.wrestlerId+"__"+k];if(c&&c.orderId===id)delete claims[o.wrestlerId+"__"+k]});if(messages[id]){messages[id].status="rejected";messages[id].released=false}o.status="void";emit()},
    async moderate(id,ok,text){moderate(id,ok,text);emit()}};
}

async function makeLiveBackend(){
  // Firebase Hosting serves the project's web config at this path. Anywhere else (like a claude.ai preview) it fails and the page runs the demo.
  const ctl=new AbortController();const t=setTimeout(()=>ctl.abort(),2500);
  const res=await fetch("/__/firebase/init.json",{signal:ctl.signal});clearTimeout(t);if(!res.ok)throw new Error("no config");
  const config=await res.json();const B="https://www.gstatic.com/firebasejs/10.12.2/";
  const [A,FS,FN,AU,ST]=await Promise.all(["firebase-app.js","firebase-firestore.js","firebase-functions.js","firebase-auth.js","firebase-storage.js"].map(f=>import(B+f)));
  const app=A.initializeApp(config),db=FS.getFirestore(app),fns=FN.getFunctions(app),auth=AU.getAuth(app),storage=ST.getStorage(app);
  if(["localhost","127.0.0.1"].includes(location.hostname)){FS.connectFirestoreEmulator(db,"127.0.0.1",8080);FN.connectFunctionsEmulator(fns,"127.0.0.1",5001);AU.connectAuthEmulator(auth,"http://127.0.0.1:9099",{disableWarnings:true});ST.connectStorageEmulator(storage,"127.0.0.1",9199)}
  const call=async(name,data)=>{try{return(await FN.httpsCallable(fns,name)(data)).data}catch(e){const err=new Error(errText(e));err.details=e.details;err.code=e.code;throw err}};
  const ms=v=>v&&v.toMillis?v.toMillis():v;
  const snapErr=e=>{console.error(e);toast("Live updates paused: "+errText(e))};
  const EMAIL_KEY="bb-signin-email";
  return{mode:"live",today:teamToday,
    watchSeason:cb=>FS.onSnapshot(FS.doc(db,"config/season"),s=>cb(s.exists()?s.data():null),snapErr),
    watchWrestlers:cb=>FS.onSnapshot(FS.collection(db,"wrestlers"),q=>cb(q.docs.map(d=>({id:d.id,raisedCents:0,daysPaid:0,sponsorCount:0,...d.data()}))),snapErr),
    watchTeam:cb=>FS.onSnapshot(FS.doc(db,"team/totals"),s=>cb(s.data()||{raisedCents:0,daysPaid:0}),snapErr),
    watchClaims:(wid,cb)=>FS.onSnapshot(FS.query(FS.collection(db,"claims"),FS.where("wrestlerId","==",wid)),q=>{const m={};q.docs.forEach(d=>{const c=d.data();m[c.dayKey]={...c,holdExpires:ms(c.holdExpires)}});cb(m)},snapErr),
    watchMyNotes:(wid,cb)=>FS.onSnapshot(FS.query(FS.collection(db,"messages"),FS.where("wrestlerId","==",wid),FS.where("released","==",true),FS.orderBy("revealAt","desc"),FS.limit(120)),q=>cb(q.docs.map(d=>({id:d.id,...d.data()}))),snapErr),
    async paymentMode(){try{return(await call("paymentMode",{})).mode}catch(e){return"mock"}},
    createOrder:inp=>call("createOrder",inp), mockPay:orderId=>call("mockPay",{orderId}),
    onAuth(cb){AU.onAuthStateChanged(auth,async u=>{if(!u)return cb({signedIn:false,admin:false,wrestlerId:null,email:""});
      let tok=await u.getIdTokenResult();
      try{const r=await call("claimRoles",{});if(r.changed)tok=await u.getIdTokenResult(true)}catch(e){toast(errText(e))}
      cb({signedIn:true,admin:tok.claims.admin===true,wrestlerId:tok.claims.wrestlerId||null,email:u.email})})},
    async sendSignInLink(email){await AU.sendSignInLinkToEmail(auth,email,{url:location.origin+"/?signin=1",handleCodeInApp:true});try{localStorage.setItem(EMAIL_KEY,email)}catch(e){}},
    async finishEmailLink(askEmail){if(!AU.isSignInWithEmailLink(auth,location.href))return false;let email="";try{email=localStorage.getItem(EMAIL_KEY)||""}catch(e){}
      if(!email)email=await askEmail();if(!email)return false;await AU.signInWithEmailLink(auth,email,location.href);try{localStorage.removeItem(EMAIL_KEY)}catch(e){}history.replaceState(null,"",location.pathname+location.hash);return true},
    async signInGoogle(){await AU.signInWithPopup(auth,new AU.GoogleAuthProvider())},
    async signOut(){await AU.signOut(auth)},
    updateMyProfile:p=>call("athleteUpdateProfile",p),
    async uploadPhoto(wid,blob,type){const r=ST.ref(storage,`wrestlers/${wid}/${Date.now()}.${type==="image/png"?"png":"jpg"}`);await ST.uploadBytes(r,blob,{contentType:type});return ST.getDownloadURL(r)},
    watchAdmin(cb){let pend=[],ords=[],emails={};const push=()=>cb({pending:pend,orders:ords,emails});
      const u=[FS.onSnapshot(FS.query(FS.collection(db,"messages"),FS.where("status","==","pending")),q=>{pend=q.docs.map(d=>({id:d.id,...d.data()}));push()},snapErr),
        FS.onSnapshot(FS.query(FS.collection(db,"orders"),FS.orderBy("createdAt","desc"),FS.limit(300)),q=>{ords=q.docs.map(d=>({id:d.id,...d.data(),createdAt:ms(d.data().createdAt)}));push()},snapErr),
        FS.onSnapshot(FS.collection(db,"wrestlerPrivate"),q=>{emails={};q.docs.forEach(d=>emails[d.id]=d.data().email);push()},snapErr)];
      return()=>u.forEach(f=>f())},
    setup:()=>call("adminSetup",{}), saveSettings:s=>call("adminSettings",s), importRoster:rows=>call("adminImportRoster",{rows}),
    saveWrestler:p=>call("adminSaveWrestler",p), setOffDay:(dayKey,off)=>call("adminSetOffDay",{dayKey,off}),
    recordPayment:inp=>call("adminRecordPayment",inp), confirmOrder:orderId=>call("adminConfirmOrder",{orderId}),
    voidOrder:orderId=>call("adminVoidOrder",{orderId}), moderate:(messageId,approve,text)=>call("adminModerate",{messageId,approve,text})};
}

/* ======================================================================
   State
   ====================================================================== */
const S={season:null,loaded:false,wrestlers:[],team:{raisedCents:0,daysPaid:0},claims:{},notes:[],cur:null,sel:new Set(),
  auth:{signedIn:false,admin:false,wrestlerId:null,email:""},admin:{pending:[],orders:[],emails:{}},orgTab:"notes",dayTool:false,
  modal:null,payMode:"mock",demoView:"public",csv:null};
let api,unClaims=()=>{},unNotes=()=>{},unAdmin=null;
const app=document.getElementById("app");
const roster=()=>S.wrestlers.filter(w=>w.active!==false).sort((a,b)=>(+a.weight||999)-(+b.weight||999)||a.name.localeCompare(b.name));
const curW=()=>S.wrestlers.find(w=>w.id===S.cur);
const days=()=>S.season?S.season.days:[];
const dayMap=()=>Object.fromEntries(days().map(d=>[d.key,d]));
const priceOf=d=>d.priceCents?d.priceCents:d.kind==="event"?S.season.practicePriceCents*S.season.eventMultiplier:S.season.practicePriceCents;
const isOff=k=>!!S.season&&(S.season.offDays||[]).includes(k);
const claimOf=k=>{const c=S.claims[k];if(!c)return null;if(c.status==="paid")return c;if(c.status==="held"&&c.holdExpires>Date.now())return c;return null};
const isMine=()=>S.auth.wrestlerId&&S.auth.wrestlerId===S.cur;
const fillAsk=(t,w)=>String(t||DEFAULT_ASK(firstName(w.name))).replaceAll("{practice}",money(S.season.practicePriceCents)).replaceAll("{meet}",money(S.season.practicePriceCents*S.season.eventMultiplier)).replaceAll("{name}",firstName(w.name));

/* Each athlete has their own link. Live (Firebase Hosting): https://site/addison-clark. Preview/GitHub Pages: page#addison-clark. */
const linkToken=()=>{const segs=location.pathname.split("/").filter(Boolean);const last=decodeURIComponent(segs[segs.length-1]||"");
  const fromPath=/^[a-z0-9]+(-[a-z0-9]+)*$/.test(last)&&!/\.html?$/.test(last)?last:"";return (location.hash.slice(1)||fromPath).toLowerCase()};
const findWrestler=t=>t?S.wrestlers.find(w=>w.slug===t||w.id===t):null;
const linkFor=w=>api.mode==="live"?location.origin+"/"+(w.slug||w.id):location.origin+location.pathname+"#"+(w.slug||w.id);
function select(id){if(!id||S.cur===id)return;S.cur=id;S.sel.clear();S.claims={};S.notes=[];unClaims();unNotes();
  unClaims=api.watchClaims(id,m=>{S.claims=m;[...S.sel].forEach(k=>{if(claimOf(k))S.sel.delete(k)});render()});
  if(S.auth.wrestlerId===id)unNotes=api.watchMyNotes(id,n=>{S.notes=n;render()});else unNotes=()=>{};
  const w=S.wrestlers.find(x=>x.id===id),tok=w&&(w.slug||w.id);
  try{if(api.mode==="live")history.replaceState(null,"","/"+tok);else history.replaceState(null,"",location.pathname+"#"+tok)}catch(e){}render()}

/* ======================================================================
   Render
   ====================================================================== */
function render(){
  if(!S.introDone&&S.season&&S.wrestlers.length){S.introDone=true;app.classList.add("intro");setTimeout(()=>app.classList.remove("intro"),2400)}
  const y=window.scrollY,fid=document.activeElement&&document.activeElement.id,fpos=document.activeElement&&document.activeElement.selectionStart;
  app.replaceChildren(topBar());
  if(api.mode==="demo")app.append(demoBar());
  if(!S.season||!curW()){
    app.append(h("div",{class:"wrap",style:"padding-block:70px"},h("h1",{style:"font-size:48px;text-transform:uppercase"},!S.loaded?"Loading…":!S.season?"Season not set up yet":"No wrestlers yet"),
      h("p",{style:"color:var(--muted)"},S.loaded?"Organizers: sign in, then use the organizer tools to set up the season and import the roster.":"")));
    if(S.auth.admin)app.append(h("div",{class:"wrap"},orgPanel()));app.append(footer());if(S.modal)app.append(sheet());return}
  const w=curW();
  app.append(poster(w),strip(w));
  const main=h("div",{class:"wrap"});app.append(main);
  if(isMine())main.append(locker(w));
  main.append(rosterChips(),idea(w),rules(),calendar(w),backers(w),standings());
  if(S.auth.admin)main.append(orgPanel());
  app.append(footer());
  if(S.sel.size&&!S.modal)app.append(cartBar(w));
  if(S.modal)app.append(sheet());
  window.scrollTo(0,y);
  if(fid){const f=document.getElementById(fid);if(f){f.focus({preventScroll:true});if(fpos!=null&&f.setSelectionRange)try{f.setSelectionRange(fpos,fpos)}catch(e){}}}
}

function topBar(){const a=S.auth;return h("header",{class:"top"},h("div",{class:"wrap"},
  h("img",{src:C.team.logo,alt:C.team.name}),
  h("div",{class:"brand"},h("b",null,C.brand.name),h("span",null,C.team.name)),
  h("nav",{"aria-label":"Sections"},
    h("a",{href:"#calendar",class:"hide-sm",onclick:jump("calendar")},"Calendar"),h("a",{href:"#standings",class:"hide-sm",onclick:jump("standings")},"Standings"),
    a.wrestlerId?h("button",{class:"me",onclick:()=>{select(a.wrestlerId);setTimeout(()=>document.getElementById("locker")?.scrollIntoView({behavior:"smooth"}),40)}},"My page"):null,
    a.admin?h("button",{class:"me",onclick:()=>document.getElementById("organizer")?.scrollIntoView({behavior:"smooth"})},"Organizer"):null,
    !a.signedIn?h("button",{onclick:()=>{S.modal={type:"signin",stage:"email",email:""};render()}},"Sign in"):null)))}
const jump=id=>e=>{e.preventDefault();document.getElementById(id)?.scrollIntoView({behavior:"smooth"})};

function demoBar(){const v=S.demoView;const set=x=>()=>{S.demoView=x;api.demoAs(x);if(x==="athlete")select(api.featured);render();window.scrollTo({top:0})};
  const fw=S.wrestlers.find(w=>w.id===api.featured);
  return h("div",{class:"demo"},h("div",{class:"wrap"},h("span",null,h("b",null,"Preview. "),"Sample "+A.many+" and sponsors; nothing is saved and no money moves. It pretends today is "+api.todayLabel+"."),
    h("div",{class:"views",role:"group","aria-label":"Preview as"},[["public","Sponsor"],["athlete",(fw?firstName(fw.name):A.One)+" signed in"],["admin","Coach"]].map(([k,l])=>h("button",{"aria-pressed":String(v===k),onclick:set(k)},l)))))}

function poster(w){const first=firstName(w.name),full=w.name.replace(/\s*\(sample\)\s*/,"");
  const fig=h("div",{class:"fig"});
  if(w.photoUrl)fig.append(h("img",{class:w.photoCutout?"cut":"framed",src:w.photoUrl,alt:full}));else fig.append(placeholderFigure());
  const paras=fillAsk(w.askText,w).split(/\n\s*\n/).map(s=>s.trim()).filter(Boolean);
  const sponsors=w.sponsorCount||0;
  return h("section",{class:"poster","aria-label":full},isWrestling()?matSVG():null,h("div",{class:"beam","aria-hidden":"true"}),h("div",{class:"edge","aria-hidden":"true"}),
    h("div",{class:"wrap"},fig,
      h("div",{class:"say"},
        h("div",{class:"eyebrow"},C.team.name+" · "+C.team.season+(w.weight?" · "+detailText(w):"")),
        h("h1",{class:"name"},full),
        h("div",{class:"bubble"},h("span",{class:"tape","aria-hidden":"true"}),paras.map(p=>h("p",null,p)),h("div",{class:"sig"},"♡ "+first)),
        h("div",{class:"corner"},
          h("a",{class:"cta",href:"#calendar",onclick:jump("calendar")},"Send "+first+" your strength"),
          h("span",null,sponsors?[h("b",null,sponsors+" "+(sponsors===1?"person is":"people are")),` in ${first}'s corner`]:"Be the first in "+first+"'s corner")),
        (()=>{const m=matchInfo();return m&&m.left?h("div",{class:"match"},h("b",null,"Doubled: "),m.name+" matches every dollar, up to "+money(m.cap)+". "+money(m.left)+" of matching left."):null})())))}

function strip(w){const today=api.today();const live=days().filter(d=>!isOff(d.key));
  const months=[...new Set(live.map(d=>d.key.slice(0,7)))];
  const m=months.find(x=>x>=today.slice(0,7))||months[months.length-1];
  const inM=live.filter(d=>d.key.startsWith(m)),filled=inM.filter(d=>{const c=claimOf(d.key);return c&&c.status==="paid"}).length;
  const mName=F(m+"-01",{month:"long"});const left=inM.length-filled;
  const sealed=days().filter(d=>{const c=S.claims[d.key];return c&&c.status==="paid"&&c.hasNote&&d.key>today}).length;
  return h("section",{class:"strip","aria-label":"Progress"},h("div",{class:"wrap"},
    h("div",{class:"singlet"},progressSVG(inM.length?filled/inM.length:0)),
    h("div",{class:"st"},h("b",{class:"num"},filled+" / "+inM.length),h("span",null,mName+" days filled"+(left?" · "+left+" to go":" · full!"))),
    h("div",{class:"st gold"},h("b",{class:"num"},money(w.raisedCents||0)),h("span",null,"raised for the team")),
    h("div",{class:"st"},h("b",{class:"num"},String(sealed)),h("span",null,"sealed notes waiting"))))}

function rosterChips(){const list=roster();if(list.length<2)return null;
  return h("div",{class:"roster",role:"group","aria-label":"Choose "+(/^[aeiou]/i.test(A.one)?"an ":"a ")+A.one},list.map(w=>h("button",{class:"tagbtn","aria-pressed":String(w.id===S.cur),onclick:()=>{select(w.id);window.scrollTo({top:0})}},h("span",{class:"w"},w.weight||"—"),w.name)))}

function rules(){const p=S.season.practicePriceCents;const post=days().filter(d=>d.post&&d.priceCents).map(d=>d.priceCents);
  const lo=post.length?Math.min(...post):p*5,hi=post.length?Math.max(...post):p*5;
  return h("section",{class:"pricing"},h("div",{class:"rules"},
    h("div",{class:"rule"},h("b",null,C.labels.practice),h("span",{class:"p num"},money(p)),h("span",null,C.labels.practiceDesc)),
    h("div",{class:"rule ev"},h("b",null,C.labels.event),h("span",{class:"p num"},money(p*S.season.eventMultiplier)),h("span",null,C.labels.eventDesc)),
    h("div",{class:"rule post"},h("b",null,C.labels.postseason),h("span",{class:"p num"},money(lo)+"–"+money(hi).slice(1)),h("span",null,C.labels.postseasonDesc))),
    h("p",{class:"backer-line"},h("b",null,S.season.rewardName+": "),S.season.rewardText))}

/* ---------- evidence-backed nudges ---------- */
// Matching gift (Karlan & List 2007): only shown when an organizer enters a real match.
function matchInfo(){const m=S.season&&S.season.match;if(!m||!m.name||!m.capCents)return null;
  const used=Math.min(S.team.raisedCents||0,m.capCents);return{name:m.name,cap:m.capCents,left:Math.max(0,m.capCents-used)}}
// Social information (Shang & Croson 2009): a real ~90th-percentile gift to this athlete. Needs 3+ sponsors; never invented.
function referenceGift(){const map=dayMap(),by={};
  Object.values(S.claims).forEach(c=>{if(c.status!=="paid"||!map[c.dayKey])return;by[c.orderId]=by[c.orderId]||{days:0,cents:0,ev:0};by[c.orderId].days++;by[c.orderId].cents+=priceOf(map[c.dayKey]);if(map[c.dayKey].kind==="event")by[c.orderId].ev++});
  const list=Object.values(by).sort((a,b)=>a.cents-b.cents);if(list.length<3)return null;
  return list[Math.floor(0.9*(list.length-1))]}
function referenceLine(first){const r=referenceGift();if(!r)return null;
  const ew=C.labels.event.toLowerCase(),pw=C.labels.practice.toLowerCase();const what=r.ev&&r.days===r.ev?(r.ev===1?"a "+ew:r.ev+" "+ew+"s"):r.days===1?"a "+pw:r.days+" days";
  return "One of "+first+"'s sponsors backed "+what+" ("+money(r.cents)+")."}
// Quick picks: one tap to a sensible choice. No amount is preselected (Altmann et al.: defaults shift gifts but not totals).
function quickPicks(w,today){const first=firstName(w.name);const open=days().filter(d=>!isOff(d.key)&&!claimOf(d.key)&&d.key>=today);
  const nextP=open.find(d=>d.kind==="practice"),nextE=open.find(d=>d.kind==="event");
  let week=null;for(const d of open){if(d.kind!=="practice")continue;const wk=weekOf(d.key);const ks=open.filter(x=>x.kind==="practice"&&weekOf(x.key)===wk);if(ks.length>=3){week=ks;break}}
  const go=keys=>()=>{S.sel=new Set(keys);render()};
  const opts=[nextP&&{k:[nextP.key],t:PN.Pos+" next "+C.labels.practice.toLowerCase(),d:F(nextP.key,{weekday:"short",month:"short",day:"numeric"}),c:priceOf(nextP)},
    week&&{k:week.map(x=>x.key),t:"A week of "+pw(),d:"Week of "+short(weekOf(week[0].key))+" · "+week.length+" days",c:week.reduce((a,x)=>a+priceOf(x),0),star:week.length>=5},
    nextE&&{k:[nextE.key],t:PN.Pos+" next "+C.labels.event.toLowerCase(),d:nextE.name+" · "+short(nextE.key),c:priceOf(nextE),star:true}].filter(Boolean);
  if(!opts.length)return null;const ref=referenceLine(first);
  return h("div",{class:"quick"},h("div",{class:"quick-h"},h("b",null,"Quick picks"),ref?h("span",null,ref):null),
    h("div",{class:"quick-row"},opts.map(o=>h("button",{class:"qp",onclick:go(o.k)},h("span",{class:"qp-t"},o.t),h("span",{class:"qp-d"},o.d),h("span",{class:"qp-c num"},money(o.c)),o.star?h("span",{class:"qp-b"},"Makes you a "+S.season.rewardName):null))))}

/* ---------- month calendars ---------- */
function calendar(w){
  const today=api.today(),first=firstName(w.name),map=dayMap();
  const contMap={};days().forEach(d=>{if(d.end){let k=addDays(d.key,1);while(k<=d.end){contMap[k]=d;k=addDays(k,1)}}});
  const months=[...new Set(days().map(d=>d.key.slice(0,7)))];
  const sec=h("section",{class:"cal",id:"calendar"});
  sec.append(h("div",{class:"sechead"},h("h2",null,S.dayTool?"Turn days off":first+"'s season"),
    h("p",null,S.dayTool?"Organizer tool: tap a "+pw()+" to cancel it or bring it back.":"Tap open days to pick them, or + for a whole week of "+C.labels.practice.toLowerCase()+". Then sponsor them together and leave "+PN.obj+" a note.")));
  if(!S.dayTool){const q=quickPicks(w,today);if(q)sec.append(q)}
  sec.append(h("nav",{class:"monthnav","aria-label":"Months"},months.map(m=>{const open=days().filter(d=>d.key.startsWith(m)&&!isOff(d.key)&&!claimOf(d.key)).length;
    return h("a",{href:"#m-"+m,onclick:jump("m-"+m)},F(m+"-01",{month:"short"}),h("small",null,open+" open"))})));
  sec.append(h("div",{class:"legend"},h("span",null,h("i",{style:"background:var(--navy);border:1.5px solid var(--line-2)"}),C.labels.practice),
    h("span",null,h("i",{style:"background:color-mix(in oklab,var(--accent) 26%,var(--night));border:1.5px solid color-mix(in oklab,var(--accent) 55%,var(--night))"}),C.labels.event),h("span",null,h("i",{style:"background:var(--primary)"}),"Sponsored"),
    h("span",null,h("i",{style:"background:#3a3214;border:2px solid var(--gold)"}),"Your picks"),h("span",null,frag(SMALL_ENV.replace("<svg",'<svg width="16" height="13" style="vertical-align:-2px;margin-right:6px"')),"Sealed note")));
  months.forEach(m=>{
    const [Y,M]=m.split("-").map(Number);const firstDay=new Date(Date.UTC(Y,M-1,1)),dim=new Date(Date.UTC(Y,M,0)).getUTCDate();
    const inMonth=days().filter(d=>d.key.startsWith(m));
    const pr=inMonth.filter(d=>d.kind==="practice"&&!isOff(d.key)).length,ev=inMonth.filter(d=>d.kind==="event").length;
    const box=h("div",{class:"month",id:"m-"+m});
    box.append(h("div",{class:"month-h"},h("h3",null,F(m+"-01",{month:"long"}),h("small",null,String(Y))),h("span",null,[pr?pr+" "+C.labels.practice.toLowerCase()+"s":"",ev?ev+" "+C.labels.event.toLowerCase()+(ev>1?"s":""):""].filter(Boolean).join(" · "))));
    const grid=h("div",{class:"grid",role:"grid","aria-label":F(m+"-01",{month:"long",year:"numeric"})});
    grid.append(h("div",{"aria-hidden":"true"}),...["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map(x=>h("div",{class:"dow","aria-hidden":"true"},x.slice(0,window.innerWidth<520?1:3))));
    const lead=firstDay.getUTCDay();const cells=Math.ceil((lead+dim)/7)*7;
    const seasonFirst=days()[0].key,seasonLast=days()[days().length-1].end||days()[days().length-1].key;
    for(let i=0;i<cells;i++){
      if(i%7===0){const rk=[];for(let j=0;j<7;j++){const dn=i+j-lead+1;if(dn>=1&&dn<=dim)rk.push(m+"-"+String(dn).padStart(2,"0"))}
        if(rk.length&&(rk[rk.length-1]<seasonFirst||rk[0]>seasonLast)){i+=6;continue}}
      if(i%7===0){const rowKeys=[];for(let j=0;j<7;j++){const dn=i+j-lead+1;if(dn>=1&&dn<=dim)rowKeys.push(m+"-"+String(dn).padStart(2,"0"))}
        const open=rowKeys.map(k=>map[k]).filter(d=>d&&d.kind==="practice"&&!isOff(d.key)&&!claimOf(d.key));
        const all=open.length&&open.every(d=>S.sel.has(d.key));
        grid.append(h("div",{class:"wk"},open.length>=2&&!S.dayTool?h("button",{"aria-pressed":String(!!all),"aria-label":(all?"Unpick":"Pick")+" all "+open.length+" open "+pw()+"s the week of "+short(rowKeys[0]),title:"Pick the whole week",onclick:()=>{open.forEach(d=>all?S.sel.delete(d.key):S.sel.add(d.key));render()}},all?"✓":"+"):null))}
      const dn=i-lead+1;if(dn<1||dn>dim){grid.append(h("div",{class:"cell out","aria-hidden":"true"}));continue}
      const key=m+"-"+String(dn).padStart(2,"0");grid.append(cell(key,map[key],contMap[key],today,first))}
    box.append(grid);sec.append(box)});
  return sec}

function cell(key,d,cont,today,first){
  const dn=String(+key.slice(8));const todayCls=key===today?" today":"";const past=key<today?" past":"";
  if(cont)return h("div",{class:"cell cont"+todayCls,title:cont.name},h("span",{class:"dn"},dn),h("span",{class:"lb"},cont.label+" · day "+(Math.round((P(key)-P(cont.key))/864e5)+1)));
  if(!d){const br=S.season.breaks&&S.season.breaks[key];return h("div",{class:"cell blank"+todayCls},h("span",{class:"dn"},dn),br?h("span",{class:"lb"},br):null)}
  const c=claimOf(key),off=isOff(key),sel=S.sel.has(key),ev=d.kind==="event";
  const paid=c&&c.status==="paid",held=c&&c.status==="held";
  let cls="cell"+todayCls+past;
  if(off)cls+=" off";else if(paid)cls+=" paid"+(ev?" evp":"");else if(held)cls+=" held";else if(sel)cls+=" sel"+(ev?" ev":"")+(S.lastPick===key?" pop":"");else cls+=ev?" ev":" open";
  const label=longDay(key)+", "+(ev?d.name:"practice")+": "+(off?"no "+pw():paid?"sponsored by "+c.displayName+(c.hasNote?", with a sealed note":""):held?"someone is sponsoring it now":(sel?"picked, ":"open, ")+money(priceOf(d)));
  const kids=[h("span",{class:"dn"},dn),h("span",{class:"lb"},off?"No "+C.labels.practice.toLowerCase():ev?d.label:C.labels.practice)];
  if(paid)kids.push(h("span",{class:"nm"},c.displayName),h("span",{class:"ini","aria-hidden":"true"},c.displayName==="Anonymous"?"♥":initials(c.displayName)));else if(held)kids.push(h("span",{class:"nm"},"Taken…"));else if(!off)kids.push(h("span",{class:"pr num"},money(priceOf(d))));
  const b=h("button",{class:cls,"aria-label":label,"aria-pressed":(!paid&&!held&&!off&&!S.dayTool)?String(sel):null,disabled:(held&&!S.dayTool)||null,onclick:()=>onCell(d,c,first)},kids);
  if(ev&&!off)b.append(frag(MEDAL));
  if(paid&&c.hasNote)b.append(frag(MINI_ENV));
  return b}

async function onCell(d,c,first){
  if(S.dayTool){if(d.kind!=="practice")return toast("Only "+pw()+" days can be turned off.");const off=!isOff(d.key);
    try{await api.setOffDay(d.key,off);toast(off?C.labels.practice+" turned off":C.labels.practice+" is back on")}catch(e){toast(errText(e))}return}
  if(c&&c.status==="paid"){S.modal={type:"day",key:d.key};render();return}
  if(isOff(d.key))return;
  S.sel.has(d.key)?S.sel.delete(d.key):S.sel.add(d.key);S.lastPick=d.key;setTimeout(()=>{if(S.lastPick===d.key)S.lastPick=null},400);
  if(S.sel.has(d.key)&&d.kind==="event")toast(d.name+" · "+d.where);
  render()}

function picks(keys){const map=dayMap();const items=[...(keys||S.sel)].sort().map(k=>map[k]).filter(Boolean);
  return{items,total:items.reduce((s,d)=>s+priceOf(d),0),units:items.reduce((s,d)=>s+(d.kind==="event"?S.season.eventMultiplier:1),0)}}

function cartBar(w){const s=picks();const first=firstName(w.name);
  return h("div",{class:"cart",role:"region","aria-label":"Your picks"},h("div",{class:"wrap"},
    h("span",{class:"sum num"},money(s.total)),
    h("span",{class:"what"},s.items.length+" day"+(s.items.length>1?"s":"")+" for "+first+(s.units>=5?" · you'll be a "+S.season.rewardName:s.units>0?" · "+(5-s.units)+" more "+pw()+(5-s.units>1?"s":"")+" to be a "+S.season.rewardName:"")),
    h("button",{class:"clr",onclick:()=>{S.sel.clear();render()}},"Clear"),
    h("button",{class:"go",onclick:()=>{S.modal={type:"checkout",step:1,keys:[...S.sel],form:{donorName:"",anon:false,contact:"",message:"",revealDay:s.items[0].key}};render()}},S.auth.admin?"Record":"Send your strength")))}

/* ---------- backers / standings / how ---------- */
function backers(w){const map=dayMap();const t={};
  Object.values(S.claims).forEach(c=>{if(c.status!=="paid"||c.displayName==="Anonymous"||!map[c.dayKey])return;const k=c.displayName.toLowerCase();t[k]=t[k]||{name:c.displayName,u:0};t[k].u+=map[c.dayKey].kind==="event"?S.season.eventMultiplier:1});
  const list=Object.values(t).filter(b=>b.u>=5).sort((a,b)=>b.u-a.u);
  return h("section",{class:"panel"},h("div",{class:"sechead"},h("h2",null,S.season.rewardName+"s"),h("p",null,"Sponsored a week of "+C.labels.practice.toLowerCase()+" or a "+C.labels.event.toLowerCase()+" for "+firstName(w.name)+".")),
    list.length?h("div",{class:"backers"},list.map(b=>h("span",{class:"backer"},h("img",{src:C.team.logo,alt:""}),b.name))):h("p",{class:"empty"},"No "+S.season.rewardName+"s yet. Pick five "+C.labels.practice.toLowerCase()+"s or a "+C.labels.event.toLowerCase()+" to be the first."))}

function standings(){const list=roster().slice().sort((a,b)=>(b.raisedCents||0)-(a.raisedCents||0));const top=Math.max(1,...list.map(w=>w.raisedCents||0));
  return h("section",{class:"panel",id:"standings"},h("div",{class:"sechead"},h("h2",null,"Team standings"),h("p",null,line("standings")+" Every day sponsored supports the whole team.")),
    h("div",{class:"teamtotal"},h("b",{class:"num"},money(S.team.raisedCents||0)),h("span",null,"raised by the team · "+(S.team.daysPaid||0)+" days sponsored")),
    list.length>=3&&list[0].raisedCents?h("div",{class:"podium"},[1,0,2].map(i=>{const w=list[i];return h("button",{class:"pod p"+(i+1),onclick:()=>{select(w.id);window.scrollTo({top:0})},"aria-label":`${i+1}. ${w.name}, ${money(w.raisedCents||0)}`},
      h("span",{class:"av",style:w.photoUrl?`background-image:url("${encodeURI(w.photoUrl)}")`:""},w.photoUrl?"":initials(firstName(w.name))),
      h("span",{class:"nm"},firstName(w.name)),h("span",{class:"amt num"},money(w.raisedCents||0)),h("span",{class:"blk"},String(i+1)))})):null,
    h("div",{class:"board"},(list.length>=3&&list[0].raisedCents?list.slice(3):list).map((w,j,arr)=>{const i=list.indexOf(w);return h("button",{class:"rank"+(i===0&&w.raisedCents?" first":""),onclick:()=>{select(w.id);window.scrollTo({top:0})},"aria-label":`${i+1}. ${w.name}, ${money(w.raisedCents||0)}`},
      h("span",{class:"pos num"},String(i+1)),h("span",{class:"nm"},h("span",null,w.name),w.weight?h("small",null,w.weight+" LB"):null),
      h("span",{class:"bar"},h("i",{style:`width:${Math.round(100*(w.raisedCents||0)/top)}%`})),
      h("span",{class:"amt num"},money(w.raisedCents||0),h("small",null,(w.daysPaid||0)+((w.daysPaid||0)===1?" day · ":" days · ")+(w.sponsorCount||0)+((w.sponsorCount||0)===1?" sponsor":" sponsors"))))}))) }

const revealTime=()=>{const hr=Number.isInteger(C.revealHour)?C.revealHour:5;return (hr%12||12)+(hr<12?" a.m.":" p.m.")};
function idea(w){const first=firstName(w.name);const n=days().filter(d=>!isOff(d.key)).length;const L=C.labels;
  return h("section",{class:"idea",id:"how","aria-labelledby":"idea-h"},
    h("div",{class:"idea-lead"},h("div",{class:"eyebrow"},C.brand.name),h("h2",{id:"idea-h"},C.brand.tagline),
      h("p",{class:"idea-line"},line("idea")),
      h("p",null,"A "+C.team.sport+" season is "+n+" days of work most people never see. Pick one of "+first+"'s days: you back "+PN.obj+" for that day, and you send "+PN.obj+" a note "+PN.sub+" "+vb("opens","open")+" that morning.")),
    h("ol",{class:"idea-steps"},
      h("li",null,h("b",null,"Pick a day"),h("span",null,"A "+L.practice.toLowerCase()+", a "+L.event.toLowerCase()+", or a "+L.postseason.toLowerCase()+" day. You're backing "+PN.pos+" journey, not a result: if "+PN.sub+" "+vb("doesn't","don't")+" qualify or "+vb("doesn't","don't")+" compete that day, your day still counts.")),
      h("li",null,h("b",null,"Send a message"),h("span",null,"It stays sealed until "+revealTime()+" on your day, after a coach reads it. "+line("note")+" "+PN.Sub+" "+vb("keeps","keep")+" every note all season.")),
      h("li",null,h("b",null,"Help build the athlete"),h("span",null,S.season.payNote+" Your day turns blue on "+PN.pos+" calendar as soon as the payment goes through."))))}

function footer(){const a=S.auth;return h("footer",{class:"wrap foot"},h("span",null,C.team.school+" "+C.team.name+" · "+C.team.season+" · Schedule from "+C.team.scheduleSource+". "),
  a.signedIn?h("span",null,a.email+" · ",h("button",{onclick:()=>{api.signOut();if(api.mode==="demo")S.demoView="public"}},"Sign out")):h("button",{onclick:()=>{S.modal={type:"signin",stage:"email",email:""};render()}},A.One+" or coach sign-in"))}

/* ---------- the athlete's locker ---------- */
function locker(w){const today=api.today(),first=firstName(w.name);const todays=S.notes.filter(n=>n.revealDay===today);
  const sealed=days().filter(d=>{const c=S.claims[d.key];return c&&c.status==="paid"&&c.hasNote&&d.key>today});
  const opened=S.notes.filter(n=>n.revealDay!==today);
  const box=h("section",{class:"locker",id:"locker","aria-label":"Your locker"},h("div",null,h("div",{class:"eyebrow"},"Only you and your coaches see this"),h("h2",null,"Your locker, "+first)));
  if(todays.length)todays.forEach(n=>box.append(h("div",{class:"todaynote open"},frag(`<div class="env">${ENVELOPE(true)}</div>`),
    h("div",null,h("div",{class:"eyebrow"},"Today's note · "+longDay(today)),h("q",null,n.text),h("div",{class:"from"},"— "+n.fromName)))));
  else box.append(h("div",{class:"todaynote"},frag(`<div class="env">${ENVELOPE(false)}</div>`),h("div",null,h("div",{class:"eyebrow"},longDay(today)),
    h("q",{style:"quotes:none"},sealed.length?"No note today. Your next one opens "+F(sealed[0].key,{weekday:"long",month:"short",day:"numeric"})+".":"No sealed notes yet. Send your link and they'll start coming in."),
    h("p",null,"Notes open at "+revealTime()+" on their day and stay here all season."))));
  if(sealed.length)box.append(h("div",null,h("h3",null,sealed.length+" sealed"),h("div",{class:"sealed"},sealed.slice(0,30).map(d=>h("span",null,frag(SMALL_ENV),short(d.key))))));
  if(opened.length)box.append(h("div",null,h("h3",null,"Opened notes"),h("div",{class:"notes"},opened.map((n,i)=>h("article",{class:"notecard",style:`--r:${[-1.2,.9,-.5,1.3][i%4]}deg`},h("p",null,n.text),h("footer",null,h("b",null,n.fromName),h("span",null,short(n.revealDay))))))));
  // edit message + photo
  const ta=h("textarea",{class:"inp",id:"my-ask",maxlength:"900",style:"min-height:220px"});ta.value=w.askText||DEFAULT_ASK(first);
  const file=h("input",{type:"file",accept:"image/*",id:"my-photo",class:"sr",onchange:e=>uploadFor(w,e.target.files[0],p=>api.updateMyProfile(p))});
  box.append(h("div",{class:"two"},
    h("div",{class:"card"},h("h3",null,"Your message"),h("p",null,"This is what people read in your speech bubble. Make it sound like you. {practice} and {meet} fill in the prices."),ta,
      h("div",{class:"btns"},h("button",{class:"btn",onclick:()=>{ta.value=DEFAULT_ASK(first)}},"Start over"),h("button",{class:"btn blu",onclick:async e=>{e.target.disabled=true;try{await api.updateMyProfile({askText:ta.value});toast("Saved. Your bubble is updated.")}catch(er){toast(errText(er))}e.target.disabled=false}},"Save message"))),
    h("div",{class:"card"},h("h3",null,"Your photo"),h("p",null,"An action shot or a pose in your uniform. For the cutout look, remove the background first: on iPhone, press and hold yourself in the Photos app and tap Copy or Share; on Android, use Cutout in Google Photos. Save it as PNG."),
      h("div",{class:"btns",style:"justify-content:flex-start"},h("label",{class:"btn blu",for:"my-photo",style:"cursor:pointer"},w.photoUrl?"Replace photo":"Upload photo",file)),
      h("h3",{style:"margin-top:10px"},"Ask your people"),h("p",null,"Texts from you work far better than a post. Send this to family, neighbors, and family friends one at a time."),
      (()=>{const link=shareLink(w);const msg=fill(C.copy.shareText,{first,team:C.team.name,practice:money(S.season.practicePriceCents),meet:money(S.season.practicePriceCents*S.season.eventMultiplier),link});
        const el=h("div",{class:"share"},msg);return h("div",{style:"display:grid;gap:8px"},el,h("div",{class:"btns",style:"justify-content:flex-start"},h("button",{class:"btn",onclick:()=>copy(msg,el)},"Copy text"),h("button",{class:"btn",onclick:()=>copy(link)},"Copy link")))})())));
  return box}
const shareLink=w=>linkFor(w);

async function uploadFor(w,f,save){if(!f)return;toast("Uploading…");
  try{const {blob,type,cutout}=await prepImage(f);const url=await api.uploadPhoto(w.id,blob,type);await save({photoUrl:url,photoCutout:cutout});toast(cutout?"Cutout photo saved":"Photo saved")}catch(e){toast(errText(e))}}
/* Shrinks to 1100px. Keeps PNG transparency and detects it: a see-through edge means a cutout. */
function prepImage(file){return new Promise((res,rej)=>{const img=new Image();img.onload=()=>{const s=Math.min(1,1100/Math.max(img.width,img.height));const c=document.createElement("canvas");c.width=Math.round(img.width*s);c.height=Math.round(img.height*s);
  const x=c.getContext("2d");x.drawImage(img,0,0,c.width,c.height);let cutout=false;
  try{const W=c.width,H=c.height,pts=[[1,1],[W-2,1],[1,H-2],[W-2,H-2],[W>>1,1]];cutout=pts.filter(([a,b])=>x.getImageData(a,b,1,1).data[3]<20).length>=3}catch(e){}
  const type=cutout?"image/png":"image/jpeg";c.toBlob(b=>b?res({blob:b,type,cutout}):rej(new Error("Couldn't read that image")),type,.88)};
  img.onerror=()=>rej(new Error("Couldn't read that image. Try a JPG or PNG."));img.src=URL.createObjectURL(file)})}

/* ---------- sheets ---------- */
let holdTimer=null;
function close(){S.modal=null;clearInterval(holdTimer);render()}
function sheet(){const m=S.modal;
  const scrim=h("div",{class:"scrim",onclick:e=>{if(e.target===scrim&&!(m.type==="checkout"&&m.step===2))close()}});
  const box=h("div",{class:"sheet",role:"dialog","aria-modal":"true","aria-labelledby":"sheet-h"});scrim.append(box);
  if(m.type==="signin")signinSheet(box,m);else if(m.type==="day")daySheet(box,m);else checkoutSheet(box,m);
  setTimeout(()=>{if(!box.contains(document.activeElement)){const f=box.querySelector("input:not(.sr),textarea,.paybtn,.btn.pri,.btn.blu");f&&f.focus()}},0);
  return scrim}

function daySheet(box,m){const d=dayMap()[m.key],c=S.claims[m.key],w=curW();
  box.append(h("div",{class:"eyebrow"},longDay(m.key)),h("h3",{id:"sheet-h"},d.kind==="event"?d.name:C.labels.practice+" day"),
    d.where?h("p",{style:"margin:0;color:var(--muted)"},d.where):null,
    h("p",{style:"margin:0;font-size:18px"},"Sponsored by ",h("b",null,c.displayName),"."),
    c.hasNote?h("p",{class:"mod"},m.key<=api.today()?firstName(w.name)+" has opened the note for this day.":"There's a sealed note waiting. "+firstName(w.name)+" opens it the morning of "+short(m.key)+"."):null,
    h("div",{class:"btns"},h("button",{class:"btn pri",onclick:close},"Close")))}

function signinSheet(box,m){
  const err=h("p",{class:"err",role:"alert"});
  if(m.stage==="sent"){box.append(h("h3",{id:"sheet-h"},"Check your email"),h("p",{style:"margin:0"},"We sent a sign-in link to ",h("b",null,m.email),". Open it on this device. It may take a minute, and school email sometimes files it under Junk."),h("div",{class:"btns"},h("button",{class:"btn pri",onclick:close},"OK")));return}
  if(m.stage==="confirm"){const em=h("input",{class:"inp",id:"si-email2",type:"email",autocomplete:"email"});
    box.append(h("h3",{id:"sheet-h"},"Confirm your email"),h("p",{style:"margin:0;color:var(--muted)"},"You opened the link on a different device. Type the same email to finish signing in."),em,err,
      h("div",{class:"btns"},h("button",{class:"btn",onclick:()=>{m.resolve("");close()}},"Cancel"),h("button",{class:"btn pri",onclick:()=>{m.resolve(em.value.trim());close()}},"Sign in")));return}
  const em=h("input",{class:"inp",id:"si-email",type:"email",autocomplete:"email",placeholder:"you@example.org",value:m.email,oninput:e=>m.email=e.target.value});
  box.append(h("h3",{id:"sheet-h"},"Sign in"),h("p",{style:"margin:0;color:var(--muted)"},A.Many+": use the school email your coach put on the roster. Coaches: use the email on the organizer list. No password; we email you a link."),
    h("label",{class:"field",for:"si-email"},"Email",em),err,
    h("div",{class:"btns"},h("button",{class:"btn",onclick:()=>api.signInGoogle().then(close).catch(e=>err.textContent=errText(e))},"Use Google instead"),
      h("button",{class:"btn pri",onclick:async e=>{const v=m.email.trim();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)){err.textContent="Enter a full email address.";return}
        e.target.disabled=true;try{await api.sendSignInLink(v);m.stage="sent";render()}catch(er){err.textContent=errText(er);e.target.disabled=false}}},"Email me a link")))}

function checkoutSheet(box,m){const w=curW(),s=picks(m.keys),first=firstName(w.name),org=S.auth.admin;
  box.append(h("div",{class:"steps","aria-hidden":"true"},[1,2,3].map(i=>h("i",{class:i<=m.step?"on":""}))));
  if(m.step===1){const f=m.form;
    const name=h("input",{class:"inp",id:"c-name",autocomplete:"name",value:f.donorName,maxlength:"60",oninput:e=>f.donorName=e.target.value});
    const anon=h("input",{type:"checkbox",id:"c-anon",onchange:e=>f.anon=e.target.checked});anon.checked=f.anon;
    const contact=h("input",{class:"inp",id:"c-contact",autocomplete:"email",value:f.contact,maxlength:"120",oninput:e=>f.contact=e.target.value});
    const cnt=h("div",{class:"counter num"},f.message.length+"/280");
    const msg=h("textarea",{class:"inp note-in",id:"c-msg",maxlength:"280",placeholder:`Dear ${first}, …`,oninput:e=>{f.message=e.target.value;cnt.textContent=f.message.length+"/280"}});msg.value=f.message;
    const rev=h("select",{class:"inp",id:"c-rev",onchange:e=>f.revealDay=e.target.value},s.items.map(d=>h("option",{value:d.key},F(d.key,{weekday:"short",month:"short",day:"numeric"})+(d.kind==="event"?" · "+d.name:" · "+C.labels.practice.toLowerCase()))));rev.value=f.revealDay;
    const err=h("p",{class:"err",role:"alert"});
    box.append(h("h3",{id:"sheet-h"},org?"Record a sponsor":"Send "+first+" your strength"),
      h("div",{class:"summary"},s.items.slice(0,5).map(d=>h("div",null,h("span",null,F(d.key,{weekday:"short",month:"short",day:"numeric"})+" · "+(d.kind==="event"?d.name:C.labels.practice)),h("span",{class:"num"},money(priceOf(d))))),
        s.items.length>5?h("div",null,h("span",null,"+ "+(s.items.length-5)+" more"),h("span",null,"")):null,h("div",{class:"tot"},h("span",null,"Total"),h("span",{class:"num"},money(s.total))),
        (()=>{const m=matchInfo();if(!m||!m.left)return null;const add=Math.min(s.total,m.left);return h("div",{class:"matched"},h("span",null,m.name+" matches it"),h("span",{class:"num"},"+"+money(add)+" → "+money(s.total+add)+" for the team"))})()),
      (()=>{const r=referenceLine(first);return r?h("p",{class:"ref"},r):null})(),
      h("label",{class:"field",for:"c-msg"},h("span",null,"Your note to "+first+" ",h("small",null,"("+line("note").replace(/\.$/,"").toLowerCase()+")")),msg,cnt),
      s.items.length>1?h("label",{class:"field",for:"c-rev"},PN.Sub+" "+vb("opens","open")+" it on",rev):h("p",{class:"mod",style:"border-color:var(--primary-soft)"},PN.Sub+" "+vb("opens","open")+" it the morning of "+longDay(s.items[0].key)+"."),
      h("label",{class:"field",for:"c-name"},"Your name",name),
      h("label",{class:"check"},anon,"Show me as Anonymous on "+PN.pos+" calendar"),
      h("label",{class:"field",for:"c-contact"},h("span",null,"Email or phone ",h("small",null,"(optional; only organizers see it)")),contact),
      h("p",{class:"mod"},"You're backing "+PN.obj+" for this day, whatever it brings. Even if "+PN.sub+" "+vb("doesn't","don't")+" compete that day, your note opens that morning to keep "+PN.obj+" going. A coach reads every note first."),err,
      h("div",{class:"btns"},h("button",{class:"btn",onclick:close},"Cancel"),h("button",{class:"btn pri",onclick:async e=>{
        if(!f.donorName.trim()){err.textContent="Add your name so "+PN.sub+" "+vb("knows","know")+" who to thank.";name.focus();return}
        if(org){m.step=2;render();return}
        e.target.disabled=true;e.target.textContent="Holding your days…";
        try{m.order=await api.createOrder({wrestlerId:w.id,dayKeys:s.items.map(d=>d.key),donorName:f.donorName.trim(),anon:f.anon,contact:f.contact.trim(),message:f.message.trim(),revealDay:f.revealDay});m.step=2;render()}
        catch(er){const tk=er.details&&er.details.taken;if(tk){tk.forEach(k=>S.sel.delete(k));m.keys=m.keys.filter(k=>!tk.includes(k));if(!m.keys.length){close();toast("Those days were just taken. Pick others.");return}err.textContent="Someone just took "+tk.map(short).join(", ")+". It's off your list.";}else err.textContent=errText(er);
          e.target.disabled=false;e.target.textContent="Continue"}}},"Continue")))}
  else if(m.step===2&&org){const err=h("p",{class:"err",role:"alert"});
    const rec=async(method,btn)=>{btn.disabled=true;try{await api.recordPayment({wrestlerId:w.id,dayKeys:s.items.map(d=>d.key),donorName:m.form.donorName.trim(),anon:m.form.anon,contact:m.form.contact,message:m.form.message,revealDay:m.form.revealDay,method});
      m.paid={total:s.total,units:s.units};m.step=3;S.sel.clear();render()}catch(e){err.textContent=errText(e);btn.disabled=false}};
    box.append(h("h3",{id:"sheet-h"},"How did they pay?"),h("div",{class:"paybox"},h("span",{class:"amt num"},money(s.total)),h("span",null,m.form.donorName+" → "+first)),err,
      h("div",{class:"btns"},h("button",{class:"btn",onclick:()=>{m.step=1;render()}},"Back"),[["cash","Cash"],["check","Check"],["venmo","Venmo received"]].map(([k,l])=>h("button",{class:"btn blu",onclick:e=>rec(k,e.target)},l))))}
  else if(m.step===2&&S.payMode==="manual"){const o=m.order;const memo=first+" – "+m.form.donorName.trim();const el=h("div",{class:"share",style:"text-align:center"},memo);
    box.append(h("h3",{id:"sheet-h"},"Send your support"),h("div",{class:"paybox"},h("span",{class:"amt num"},money(o.amountCents)),h("span",null,S.season.payNote),
      h("span",{style:"font-size:14px;color:var(--muted)"},"Put this in the memo so the coaches can match it:"),el,h("button",{class:"btn",onclick:()=>copy(memo,el)},"Copy memo")),
      h("p",{class:"mod"},"Your days are held for 3 days. They turn blue on "+PN.pos+" calendar as soon as a coach confirms your payment."),
      h("div",{class:"btns"},h("button",{class:"btn pri",onclick:()=>{m.paid={total:o.amountCents,units:s.units,pending:true};m.step=3;S.sel.clear();render()}},"Got it")))}
  else if(m.step===2){const o=m.order,err=h("p",{class:"err",role:"alert"}),timer=h("div",{class:"timer num"});
    const tick=()=>{const left=Math.max(0,o.holdExpires-Date.now());timer.textContent=left?"Your days are held for "+Math.floor(left/60000)+":"+String(Math.floor(left/1000)%60).padStart(2,"0"):"Your hold ran out. You can still pay if nobody else took the days."};
    clearInterval(holdTimer);holdTimer=setInterval(tick,1000);tick();
    box.append(h("h3",{id:"sheet-h"},"Send your support"),h("div",{class:"paybox"},h("span",{class:"amt num"},money(o.amountCents)),h("span",null,"for "+first+" and "+C.team.name),
      h("button",{class:"paybtn",onclick:async e=>{const b=e.currentTarget;b.disabled=true;b.firstChild.textContent="Processing…";
        try{const r=await api.mockPay(o.orderId);clearInterval(holdTimer);if(r.status==="conflict"){err.textContent="Your hold ran out and someone else took a day. An organizer will refund you.";return}
          m.paid={total:o.amountCents,units:s.units};m.step=3;S.sel.clear();render()}catch(er){err.textContent=errText(er);b.disabled=false;b.firstChild.textContent="Send "+money(o.amountCents)+" with Venmo"}}},
        "Send "+money(o.amountCents)+" with Venmo",h("small",null,S.payMode==="mock"?"Test mode · no money moves":"Opens secure checkout")),timer),err,
      S.payMode==="mock"?h("p",{class:"mod"},"Stand-in payment step. When the booster club picks its processor, this button opens that checkout and the calendar updates when the payment clears."):null,
      h("div",{class:"btns"},h("button",{class:"btn",onclick:close},"Finish later")))}
  else{const backer=m.paid.units>=5;
    box.append(h("div",{class:"done"},h("img",{src:C.team.logo,alt:""}),h("h3",{id:"sheet-h"},"Your strength is on its way"),h("p",{class:"idea-line",style:"margin:0"},line("thanks")),
      h("p",{style:"margin:0;color:var(--muted)"},money(m.paid.total)+(m.paid.pending?" for the team, once your payment arrives. ":" for the team. ")+(m.form.message?"Your note is sealed. "+PN.Sub+"'ll open it the morning of "+longDay(m.form.revealDay)+".":"Thank you for backing "+C.team.name+".")),
      backer?h("span",{class:"badge"},"You're a "+S.season.rewardName):null),h("div",{class:"btns"},h("button",{class:"btn pri",onclick:close},"Done")))}
}

/* ---------- organizer ---------- */
function orgPanel(){const wrap=h("section",{class:"org",id:"organizer"});
  wrap.append(h("div",{class:"eyebrow"},"Signed in as "+S.auth.email),h("h2",null,"Organizer"));
  if(!S.season){wrap.append(h("div",{class:"btns",style:"justify-content:flex-start;margin-top:14px"},h("button",{class:"btn pri",onclick:()=>api.setup().then(()=>toast("Season set up")).catch(e=>toast(errText(e)))},"Set up season")));return wrap}
  const pend=S.admin.pending,ords=S.admin.orders,open=ords.filter(o=>o.status==="pending"||o.status==="conflict");
  const T=[["notes","Notes to read ("+pend.length+")"],["money","Money ("+open.length+" open)"],["roster","Roster & logins"],["settings","Settings"]];
  wrap.append(h("div",{class:"tabs",role:"tablist"},T.map(([k,l])=>h("button",{role:"tab","aria-selected":String(S.orgTab===k),onclick:()=>{S.orgTab=k;render()}},l))));
  const wn=id=>(S.wrestlers.find(w=>w.id===id)||{}).name||id;
  if(S.orgTab==="notes"){
    wrap.append(h("p",{style:"color:var(--muted);margin:14px 0 0"},"Approve each note so it can open on its day. You can fix a typo or trim something before approving."));
    if(!pend.length)wrap.append(h("p",{class:"empty",style:"margin-top:12px"},"All caught up."));
    pend.sort((a,b)=>a.revealDay.localeCompare(b.revealDay)).forEach(n=>{const ta=h("textarea",{class:"inp",id:"mod-"+n.id,maxlength:"280"});ta.value=n.text;
      wrap.append(h("div",{class:"q"},h("div",{class:"meta"},h("b",null,"For "+wn(n.wrestlerId)),h("span",null,"from "+n.fromName),h("span",null,"opens "+F(n.revealDay,{weekday:"short",month:"short",day:"numeric"}))),ta,
        h("div",{class:"btns"},h("button",{class:"btn mini",onclick:()=>api.moderate(n.id,false).then(()=>toast("Hidden. "+PN.Sub+" won't see it.")).catch(e=>toast(errText(e)))},"Don't show "+PN.obj),
          h("button",{class:"btn blu mini",onclick:()=>api.moderate(n.id,true,ta.value).then(()=>toast("Approved")).catch(e=>toast(errText(e)))},"Approve"))))})}
  else if(S.orgTab==="money"){
    const rows=roster().map(w=>{const os=ords.filter(o=>o.wrestlerId===w.id);const by=k=>os.filter(o=>o.status==="paid"&&((o.payment&&o.payment.provider)||o.method)===k).reduce((s,o)=>s+o.amountCents,0);
      return{w,online:by("mock")+by("online")+by("manual"),cash:by("cash")+by("check"),venmo:by("venmo"),open:os.filter(o=>o.status==="pending").reduce((s,o)=>s+o.amountCents,0),n:os.filter(o=>o.status==="paid").length}});
    wrap.append(h("h3",null,"Collected by "+A.one),h("div",{class:"tablewrap"},h("table",null,h("thead",null,h("tr",null,...[A.One,"Sponsors","Online","Cash & check","Venmo","Total","Unpaid"].map(x=>h("th",null,x)))),
      h("tbody",null,rows.map(r=>h("tr",null,h("td",null,r.w.name),h("td",{class:"num"},String(r.n)),h("td",{class:"num"},money(r.online)),h("td",{class:"num"},money(r.cash)),h("td",{class:"num"},money(r.venmo)),h("td",{class:"num"},h("b",null,money(r.w.raisedCents||0))),h("td",{class:"num"},money(r.open))))))));
    wrap.append(h("h3",null,"Every sponsorship"),h("p",{style:"color:var(--muted);margin:0"},"To record cash or a check, pick the days on "+(/^[aeiou]/i.test(A.one)?"an ":"a ")+A.one+"'s calendar while signed in and tap Record."));
    if(!ords.length)wrap.append(h("p",{class:"empty"},"Nothing yet."));
    ords.slice(0,80).forEach(o=>wrap.append(h("div",{class:"q"},h("div",{class:"meta"},h("span",{class:"st-pill "+o.status},o.status),h("b",null,money(o.amountCents)),h("span",null,o.donorName+(o.anon?" (anonymous)":"")+" → "+wn(o.wrestlerId)),h("span",null,o.dayKeys.length+" day"+(o.dayKeys.length>1?"s":"")),h("span",null,(o.payment&&o.payment.provider)||o.method),o.contact?h("span",null,o.contact):null),
      h("div",{class:"btns"},o.status==="pending"?h("button",{class:"btn blu mini",onclick:()=>api.confirmOrder(o.id).then(()=>toast("Marked paid")).catch(e=>toast(errText(e)))},"Money received"):null,
        o.status!=="void"?h("button",{class:"btn mini",onclick:e=>{if(e.target.dataset.sure)api.voidOrder(o.id).then(()=>toast("Voided")).catch(er=>toast(errText(er)));else{e.target.dataset.sure="1";e.target.textContent="Tap again to void"}}},"Void"):null))))}
  else if(S.orgTab==="roster")wrap.append(rosterTools());
  else{const pp=h("input",{class:"inp",id:"s-price",type:"number",min:"1",max:"100",step:"1",value:String(S.season.practicePriceCents/100),style:"width:110px"});
    const rn=h("input",{class:"inp",id:"s-rn",value:S.season.rewardName}),rt=h("textarea",{class:"inp",id:"s-rt"}),pn=h("input",{class:"inp",id:"s-pn",value:S.season.payNote});rt.value=S.season.rewardText;
    const mt=S.season.match||{};const mn=h("input",{class:"inp",id:"s-mn",value:mt.name||"",placeholder:"e.g. a local business"}),mc=h("input",{class:"inp",id:"s-mc",type:"number",min:"0",step:"50",value:mt.capCents?String(mt.capCents/100):"",placeholder:"0",style:"width:130px"});
    wrap.append(h("div",{style:"display:grid;gap:12px;max-width:640px;margin-top:14px"},
      h("div",{style:"display:flex;gap:12px;flex-wrap:wrap"},h("label",{class:"field",for:"s-price"},"Practice price ($)",pp),h("label",{class:"field",for:"s-rn",style:"flex:1;min-width:200px"},"Reward name",rn)),
      h("p",{class:"mod"},"A "+C.labels.event.toLowerCase()+" costs "+S.season.eventMultiplier+" "+C.labels.practice.toLowerCase()+"s; postseason prices come from team.json. Price changes apply to new sponsorships."),
      h("label",{class:"field",for:"s-rt"},"What a Backer gets",rt),h("label",{class:"field",for:"s-pn"},"Where the money goes (How it works)",pn),
      h("div",{style:"display:flex;gap:12px;flex-wrap:wrap;align-items:end"},h("label",{class:"field",for:"s-mn",style:"flex:1;min-width:200px"},"Matching sponsor",mn),h("label",{class:"field",for:"s-mc"},"Match up to ($)",mc)),
      h("p",{class:"mod"},"A real 1:1 match is the strongest proven boost for a fundraiser. Fill this in only when a sponsor has actually committed. Leave it blank and nothing shows."),
      h("div",{class:"btns",style:"justify-content:flex-start"},h("button",{class:"btn blu",onclick:()=>api.saveSettings({practicePriceCents:Math.round(+pp.value*100),rewardName:rn.value.trim(),rewardText:rt.value.trim(),payNote:pn.value.trim(),matchName:mn.value.trim(),matchCapCents:Math.round((+mc.value||0)*100)}).then(()=>toast("Saved")).catch(e=>toast(errText(e)))},"Save settings"),
        h("button",{class:"btn"+(S.dayTool?" blu":""),onclick:()=>{S.dayTool=!S.dayTool;S.sel.clear();render();if(S.dayTool)document.getElementById("calendar").scrollIntoView({behavior:"smooth"})}},S.dayTool?"Done turning days off":"Turn practice days off"),
        h("button",{class:"btn",onclick:()=>api.setup().then(()=>toast("Schedule reloaded")).catch(e=>toast(errText(e)))},"Reload schedule"))))}
  return wrap}

function rosterTools(){const box=h("div",{style:"display:grid;gap:12px;margin-top:14px"});
  box.append(h("p",{style:"color:var(--muted);margin:0"},"Upload a CSV with a name, school email, and "+A.detail.label.toLowerCase()+" for each "+A.one+". Each one gets their own page and signs in with that email. Re-uploading updates names and details; it never creates duplicates."));
  const input=h("input",{type:"file",accept:".csv,text/csv",id:"csv-in",class:"sr",onchange:e=>readCsv(e.target.files[0])});
  const drop=h("label",{class:"drop",for:"csv-in",ondragover:e=>{e.preventDefault();drop.classList.add("over")},ondragleave:()=>drop.classList.remove("over"),ondrop:e=>{e.preventDefault();drop.classList.remove("over");readCsv(e.dataTransfer.files[0])}},
    h("b",{style:"color:var(--ink)"},"Choose roster CSV"),h("div",null,"or drop it here · columns: name, email, weight"),input);
  box.append(drop);
  if(S.csv){const r=S.csv;box.append(h("div",{class:"q"},h("div",{class:"meta"},h("b",null,r.rows.length+" "+A.many+" found"),r.bad.length?h("span",{style:"color:var(--accent-soft)"},r.bad.length+" rows skipped (missing name or email)"):null),
    h("div",{class:"tablewrap"},h("table",null,h("thead",null,h("tr",null,h("th",null,"Name"),h("th",null,"Email"),h("th",null,"Weight"))),h("tbody",null,r.rows.slice(0,40).map(x=>h("tr",null,h("td",null,x.name),h("td",null,x.email),h("td",null,x.weight||"")))))),
    h("div",{class:"btns"},h("button",{class:"btn",onclick:()=>{S.csv=null;render()}},"Cancel"),h("button",{class:"btn blu",onclick:async e=>{e.target.disabled=true;try{const res=await api.importRoster(r.rows);S.csv=null;toast(`Added ${res.added}, updated ${res.updated}`+(res.skipped.length?`, skipped ${res.skipped.length}`:""));if(!S.cur&&roster()[0])select(roster()[0].id);render()}catch(er){toast(errText(er));e.target.disabled=false}}},"Import roster"))))}
  const list=S.wrestlers.slice().sort((a,b)=>(+a.weight||999)-(+b.weight||999));
  box.append(h("div",{class:"tablewrap"},h("table",null,h("thead",null,h("tr",null,...["Name",A.detail.short||"Detail","Link","School email","Photo","On site",""].map(x=>h("th",null,x)))),
    h("tbody",null,list.map(w=>{const n=h("input",{class:"inp",id:"rn-"+w.id,value:w.name,style:"min-width:140px"}),wt=h("input",{class:"inp",id:"rw-"+w.id,value:w.weight||"",inputmode:"numeric",style:"width:64px"});
      const act=h("input",{type:"checkbox",id:"ra-"+w.id});act.checked=w.active!==false;
      const sl=h("input",{class:"inp",id:"rs-"+w.id,value:w.slug||"",style:"width:150px","aria-label":"Link name"});
      const f=h("input",{type:"file",accept:"image/*",class:"sr",id:"rp-"+w.id,onchange:e=>uploadFor(w,e.target.files[0],p=>api.saveWrestler({id:w.id,...p}))});
      const full=linkFor(w);
      return h("tr",null,h("td",null,n),h("td",null,wt),
        h("td",null,h("div",{style:"display:flex;gap:6px;align-items:center"},h("span",{style:"color:var(--muted);font-size:13px"},"/"),sl,h("button",{class:"btn mini",title:full,onclick:()=>copy(full)},"Copy link"))),
        h("td",{style:"font-size:13px;color:var(--muted)"},S.admin.emails[w.id]||"—"),
        h("td",null,h("label",{class:"btn mini",for:"rp-"+w.id,style:"display:inline-block;cursor:pointer"},w.photoUrl?"Replace":"Upload",f)),h("td",null,h("label",{class:"check"},act,h("span",{class:"sr"},"Show on site"))),
        h("td",null,h("button",{class:"btn blu mini",onclick:()=>api.saveWrestler({id:w.id,name:n.value.trim(),weight:wt.value.trim(),active:act.checked,...(sl.value.trim()!==(w.slug||"")?{slug:sl.value.trim()}:{})}).then(()=>toast("Saved")).catch(e=>toast(errText(e)))},"Save")))})))));
  return box}

function parseCsv(text){const rows=[];let row=[],f="",q=false;for(let i=0;i<text.length;i++){const ch=text[i];
    if(q){if(ch==='"'){if(text[i+1]==='"'){f+='"';i++}else q=false}else f+=ch}
    else if(ch==='"')q=true;else if(ch===","){row.push(f);f=""}else if(ch==="\n"||ch==="\r"){if(ch==="\r"&&text[i+1]==="\n")i++;row.push(f);rows.push(row);row=[];f=""}else f+=ch}
  if(f||row.length){row.push(f);rows.push(row)}return rows.filter(r=>r.some(c=>c.trim()))}
function readCsv(file){if(!file)return;const rd=new FileReader();rd.onload=()=>{const all=parseCsv(String(rd.result).replace(/^﻿/,""));if(!all.length)return toast("That file is empty.");
  const head=all[0].map(x=>x.trim().toLowerCase());const has=head.some(x=>/mail/.test(x));
  const ix=re=>head.findIndex(x=>re.test(x));let iName=ix(/^(full\s*)?name$|student/),iFirst=ix(/first/),iLast=ix(/last/),iEmail=ix(/mail/),iW=ix(new RegExp("weight|wt|class|detail|position|number"+(A.detail.label?"|"+A.detail.label.toLowerCase():"")));
  const body=has?all.slice(1):all;if(!has){iName=0;iEmail=body[0].findIndex(c=>c.includes("@"));iW=2;iFirst=iLast=-1}
  const rows=[],bad=[];body.forEach(r=>{const name=(iName>=0?r[iName]:[r[iFirst],r[iLast]].filter(Boolean).join(" "))||"";const email=(r[iEmail]||"").trim();const weight=(r[iW]||"").trim().slice(0,12);
    (name.trim()&&/@/.test(email)?rows:bad).push({name:name.trim(),email,weight})});
  S.csv={rows,bad};render()};rd.readAsText(file)}

/* ======================================================================
   Boot
   ====================================================================== */
document.addEventListener("keydown",e=>{if(e.key==="Escape"&&S.modal&&!(S.modal.type==="checkout"&&S.modal.step===2))close()});
(async function boot(){
  try{useConfig(await (await fetch("team.json",{cache:"no-store"})).json())}
  catch(e){app.replaceChildren(h("div",{class:"wrap",style:"padding-block:60px"},h("h1",{style:"font-size:40px"},"Setup needed"),h("p",{style:"color:var(--muted)"},"This page couldn't load team.json. Run node scripts/sync-config.js and check the file is valid JSON.")));return}
  try{api=await makeLiveBackend()}catch(e){api=await makeDemoBackend()}
  api.watchSeason(s=>{S.season=s;S.loaded=true;render()});
  api.watchTeam(t=>{S.team=t;render()});
  api.watchWrestlers(list=>{S.wrestlers=list;if(!S.cur){const r=roster();const pick=findWrestler(linkToken())||(api.featured&&r.find(w=>w.id===api.featured))||r[0];if(pick)select(pick.id)}render()});
  api.onAuth(a=>{const was=S.auth.wrestlerId;S.auth=a;
    if(a.admin&&!unAdmin)unAdmin=api.watchAdmin(d=>{S.admin=d;render()});
    if(!a.admin&&unAdmin){unAdmin();unAdmin=null;S.dayTool=false}
    if(a.wrestlerId&&a.wrestlerId!==was){S.cur=null;select(a.wrestlerId)}
    if(!a.wrestlerId&&was){unNotes();S.notes=[]}
    if(a.signedIn&&!a.admin&&!a.wrestlerId)toast("Signed in, but "+a.email+" isn't on the roster or organizer list. Ask your coach.");
    render()});
  try{await api.finishEmailLink(()=>new Promise(r=>{S.modal={type:"signin",stage:"confirm",resolve:r};render()}))}catch(e){toast(errText(e))}
  S.payMode=await api.paymentMode();
  window.addEventListener("hashchange",()=>{const w=findWrestler(linkToken());if(w)select(w.id)});
  render();
})();
})();
