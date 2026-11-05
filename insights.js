"use strict";
// Insights: built from public.item_events (added / bought / unbought / removed), readable by household members only.
const SUPABASE_URL = "https://hwiwlyikrjwkqzmovump.supabase.co";
const SUPABASE_KEY = "sb_publishable_lJIRbBa9ShGZxvB3bt5xeg_VINkg0_C";
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { flowType: "pkce", persistSession: true } });

const $ = id => document.getElementById(id);
const store = { get(k){try{return localStorage.getItem(k)}catch{return null}}, set(k,v){try{localStorage.setItem(k,v)}catch{}} };
const esc = s => String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const DAY = 864e5, HOUR = 36e5;
const TRIP_GAP = 3 * HOUR;          // buys closer than this are one shopping trip
const iso = s => "\u2068" + s + "\u2069";   // bidi-isolate user text inside translated strings
const keyOf = n => String(n||"").trim().toLowerCase();

const S = { hid:null, hhName:"", events:[], onList:new Set(), range:Number(store.get("insRange")) || 90 };

function toast(msg){ const el=$("toast"); el.textContent=msg; el.hidden=false; clearTimeout(toast._t); toast._t=setTimeout(()=>el.hidden=true,2400); }
function dur(ms){
  if (ms < HOUR) return t("dur_min");
  if (ms < 36 * HOUR) return t("dur_h",[Math.round(ms/HOUR)]);
  return t("dur_d",[Math.round(ms/DAY)]);
}
function days(ms){ return t("dur_d",[Math.max(1, Math.round(ms/DAY))]); }
const fmtNum = n => new Intl.NumberFormat(LANG==="he"?"he-IL":"en-GB").format(n);
const median = a => { if(!a.length) return null; const s=[...a].sort((x,y)=>x-y), m=s.length>>1; return s.length%2 ? s[m] : (s[m-1]+s[m])/2; };
function actorLabel(n){
  if (!n || n==="Agent") return t("agent_label");
  const m=/^(.*) via agent$/.exec(n); return m ? t("via_agent",{name:m[1]}) : n;
}

// ---------- data ----------
async function boot(){
  const { data:{ session } } = await sb.auth.getSession();
  if (!session){ location.replace("./"); return; }
  const { data: hh } = await sb.from("household_members").select("households(id,name)").eq("user_id", session.user.id);
  const list = (hh||[]).map(r=>r.households).filter(Boolean);
  const pick = list.find(h=>h.id===store.get("hid")) || list[0];
  if (!pick){ location.replace("./"); return; }
  S.hid = pick.id; S.hhName = pick.name; $("hhSub").textContent = pick.name;
  const since = new Date(Date.now() - 400*DAY).toISOString();
  const [ev, items] = await Promise.all([
    sb.from("item_events").select("item_id,name,action,actor_name,at").eq("household_id",S.hid).gte("at",since).order("at").limit(20000),
    sb.from("items").select("name").eq("household_id",S.hid).eq("checked",false),
  ]);
  if (ev.error){ toast(tErr(ev.error)); return; }
  S.events = ev.data.map(e=>({ ...e, t: Date.parse(e.at), k: keyOf(e.name) }));
  S.onList = new Set((items.data||[]).map(i=>keyOf(i.name)));
  render();
}

// ---------- analysis ----------
function analyse(rangeDays){
  const from = Date.now() - rangeDays*DAY;
  const inRange = S.events.filter(e=>e.t>=from);
  const buys = inRange.filter(e=>e.action==="bought");

  // trips: clusters of buys
  let trips = 0, last = -Infinity;
  for (const b of buys){ if (b.t - last > TRIP_GAP) trips++; last = b.t; }

  // time from (latest) add to buy, per item_id
  const lastAdd = new Map(), waits = [];
  for (const e of S.events){
    if (e.action==="added") lastAdd.set(e.item_id, e.t);
    else if (e.action==="bought" && e.t>=from && lastAdd.has(e.item_id)) waits.push(e.t - lastAdd.get(e.item_id));
  }

  // top items in range
  const counts = new Map(), display = new Map();
  for (const b of buys){ counts.set(b.k,(counts.get(b.k)||0)+1); display.set(b.k,b.name); }
  const top = [...counts].sort((a,b)=>b[1]-a[1]).slice(0,8).map(([k,n])=>({ k, name:display.get(k), n }));

  // weekday (Sunday-first) by trip, so one big shop counts once
  const wd = Array(7).fill(0); last = -Infinity;
  for (const b of buys){ if (b.t - last > TRIP_GAP) wd[new Date(b.t).getDay()]++; last = b.t; }

  // who adds
  const adders = new Map();
  for (const e of inRange) if (e.action==="added") { const a=actorLabel(e.actor_name); adders.set(a,(adders.get(a)||0)+1); }
  const addersArr = [...adders].sort((a,b)=>b[1]-a[1]).slice(0,6).map(([name,n])=>({name,n}));

  // running low: uses all history (not the range). Need >=3 separate purchases (2 intervals).
  const byItem = new Map();
  for (const e of S.events) if (e.action==="bought"){
    const arr = byItem.get(e.k) || []; const prev = arr[arr.length-1];
    if (!prev || e.t - prev.t > 12*HOUR) arr.push({ t:e.t, name:e.name }); else prev.t = e.t;
    byItem.set(e.k, arr);
  }
  const low = [];
  for (const [k, arr] of byItem){
    if (arr.length < 3) continue;
    const gaps = arr.slice(1).map((x,i)=>x.t-arr[i].t);
    const every = median(gaps), since = Date.now() - arr[arr.length-1].t;
    if (since >= 0.9*every) low.push({ k, name:arr[arr.length-1].name, every, since, score: since/every });
  }
  low.sort((a,b)=>b.score-a.score);

  return { bought: buys.length, trips, ttb: median(waits), top, wd, adders: addersArr, low: low.slice(0,8) };
}

// ---------- render ----------
function hbars(el, rows, valueText){
  if (!rows.length){ el.innerHTML = `<p class="small muted-empty">${esc(t("no_data"))}</p>`; return; }
  const max = Math.max(...rows.map(r=>r.n));
  el.innerHTML = rows.map(r=>`<div class="hbar" data-tip="${esc(iso(r.name))}: ${esc(valueText(r.n))}" tabindex="0">
    <span class="hbar-l" dir="auto">${esc(r.name)}</span>
    <span class="hbar-track"><span class="hbar-fill" data-w="${(r.n/max*100).toFixed(1)}"></span></span>
    <span class="hbar-v">${esc(fmtNum(r.n))}</span></div>`).join("");
}
function cols(el, vals){
  const names = t("weekdays"), max = Math.max(1, ...vals);
  el.innerHTML = vals.map((n,i)=>`<div class="col" data-tip="${esc(t("weekday_tip",{day:names[i], n:t("times",[n])}))}" tabindex="0">
    <span class="col-v">${n ? esc(fmtNum(n)) : ""}</span>
    <span class="col-track"><span class="col-fill" data-h="${(n/max*100).toFixed(1)}"></span></span>
    <span class="col-l">${esc(names[i])}</span></div>`).join("");
}
function render(){
  document.querySelectorAll("[data-range]").forEach(b=>b.setAttribute("aria-pressed", String(Number(b.dataset.range)===S.range)));
  const a = analyse(S.range);
  $("stBought").textContent = fmtNum(a.bought);
  $("stTrips").textContent = fmtNum(a.trips);
  $("stTtb").textContent = a.ttb==null ? "–" : dur(a.ttb);
  $("emptyAll").hidden = S.events.some(e=>e.action==="bought");

  $("lowList").innerHTML = a.low.map(x=>{
    const on = S.onList.has(x.k);
    return `<li><div class="txt"><div class="name" dir="auto">${esc(x.name)}</div>
      <div class="meta">${esc(t("low_meta",{every:days(x.every), ago:days(x.since)}))}</div></div>
      ${on ? `<span class="pill">${esc(t("on_list"))}</span>` : `<button class="btn ghost sm" type="button" data-add="${esc(x.name)}">${esc(t("add_to_list"))}</button>`}</li>`;
  }).join("");
  $("lowList").hidden = !a.low.length; $("lowEmpty").hidden = !!a.low.length;

  hbars($("topBars"), a.top, n=>t("times",[n]));
  cols($("wdCols"), a.wd);
  hbars($("adderBars"), a.adders, n=>t("times",[n]));

  // CSP forbids inline style attributes; size the marks through the CSSOM instead.
  document.querySelectorAll("[data-w]").forEach(el=>el.style.setProperty("--w", el.dataset.w+"%"));
  document.querySelectorAll("[data-h]").forEach(el=>el.style.setProperty("--h", el.dataset.h+"%"));
  document.title = `${t("insights_title")} · ${t("title")}`;

  const first = S.events[0];
  $("since").textContent = first ? t("history_since",{ date: new Date(first.t).toLocaleDateString(LANG==="he"?"he-IL":"en-GB",{ day:"numeric", month:"long", year:"numeric" }) }) : "";
}

// ---------- interactions ----------
$("range").addEventListener("click", e=>{
  const b = e.target.closest("[data-range]"); if (!b) return;
  S.range = Number(b.dataset.range); store.set("insRange", String(S.range)); render();
});
$("lowList").addEventListener("click", async e=>{
  const b = e.target.closest("[data-add]"); if (!b) return;
  b.disabled = true;
  const name = b.dataset.add;
  const { error } = await sb.from("items").insert({ household_id:S.hid, name, quantity:null });
  if (error){ b.disabled=false; toast(tErr(error)); return; }
  S.onList.add(keyOf(name)); render(); toast(t("added_to_list",{name}));
});
// hover / focus tooltip for bars and columns
const tip = $("tip");
function showTip(el, x, y){
  tip.textContent = el.dataset.tip; tip.hidden = false;
  const r = tip.getBoundingClientRect();
  tip.style.left = Math.min(innerWidth - r.width - 8, Math.max(8, x - r.width/2)) + "px";
  tip.style.top = Math.max(8, y - r.height - 12) + "px";
}
document.addEventListener("pointermove", e=>{ const el=e.target.closest("[data-tip]"); if (el) showTip(el, e.clientX, e.clientY); else tip.hidden=true; });
document.addEventListener("focusin", e=>{ const el=e.target.closest("[data-tip]"); if (el){ const r=el.getBoundingClientRect(); showTip(el, r.left+r.width/2, r.top); } });
document.addEventListener("focusout", ()=>{ tip.hidden=true; });
document.addEventListener("langchange", render);

boot();
