"use strict";
// Public by design: the publishable key only identifies the project.
// All access control is enforced in Postgres (RLS + SECURITY DEFINER RPCs), see supabase/migrations.
const SUPABASE_URL = "https://hwiwlyikrjwkqzmovump.supabase.co";
const SUPABASE_KEY = "sb_publishable_lJIRbBa9ShGZxvB3bt5xeg_VINkg0_C";
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { flowType: "pkce", detectSessionInUrl: true, persistSession: true } });

const $ = id => document.getElementById(id);
const store = { get(k){try{return localStorage.getItem(k)}catch{return null}}, set(k,v){try{localStorage.setItem(k,v)}catch{}} };
const state = { user:null, households:[], hid:null, items:new Map(), members:[], channel:null };
const CODE_RE = /^[A-Z0-9]{6,12}$/;
const AVATAR_RE = /^https:\/\/[a-z0-9-]+\.googleusercontent\.com\//;
const normCode = s => String(s||"").toUpperCase().replace(/[^A-Z0-9]/g,"");

// Capture ?join=CODE before the OAuth redirect drops it
const urlJoin = normCode(new URLSearchParams(location.search).get("join"));
if (CODE_RE.test(urlJoin)) store.set("pendingJoin", urlJoin);

function toast(msg){ const t=$("toast"); t.textContent=msg; t.hidden=false; clearTimeout(toast._t); toast._t=setTimeout(()=>t.hidden=true,2600); }
function showErr(el,msg){ el.textContent=msg||""; el.hidden=!msg; }
function esc(s){ return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }

// ---------- Auth ----------
$("gsignin").onclick = async () => {
  const { error } = await sb.auth.signInWithOAuth({ provider:"google", options:{ redirectTo: location.origin + location.pathname } });
  if (error) showErr($("loginErr"), error.message);
};
$("signout").onclick = async () => { await sb.auth.signOut(); location.reload(); };

sb.auth.onAuthStateChange((_e, session) => {
  const u = session?.user || null;
  if (u?.id === state.user?.id) return;
  state.user = u;
  if (u) boot(); else { teardown(); $("login").hidden=false; $("app").hidden=true; }
});

async function boot(){
  $("login").hidden=true; $("app").hidden=false;
  history.replaceState(null,"",location.pathname);
  const pending = store.get("pendingJoin");
  if (pending){ store.set("pendingJoin",""); await joinCode(pending, true); }
  await loadHouseholds();
}

// ---------- Households ----------
async function loadHouseholds(preferId){
  const { data, error } = await sb.from("household_members")
    .select("household_id, households(id,name,invite_code)").eq("user_id", state.user.id).order("joined_at");
  if (error){ toast(error.message); return; }
  state.households = data.map(r=>r.households).filter(Boolean);
  const saved = preferId || store.get("hid");
  const pick = state.households.find(h=>h.id===saved) || state.households[0];
  if (pick) await selectHousehold(pick.id); else noHousehold();
  renderSheet();
}
function noHousehold(){
  state.hid=null; teardown();
  $("hhName").textContent="Pantry Run"; $("count").textContent="No household yet"; $("faces").replaceChildren();
  $("needHousehold").hidden=false; $("listArea").hidden=true; $("addBar").hidden=true;
}
async function selectHousehold(id){
  state.hid=id; store.set("hid",id);
  const h = state.households.find(x=>x.id===id);
  $("hhName").textContent = h?.name || "List";
  $("needHousehold").hidden=true; $("listArea").hidden=false; $("addBar").hidden=false;
  await Promise.all([loadItems(), loadMembers()]);
  subscribe();
  renderSheet();
}
async function joinCode(raw, silent){
  const code = normCode(raw);
  const say = m => silent ? toast(m) : showErr($("sheetErr"), m);
  if (!CODE_RE.test(code)) return say("Invite codes are 10 letters and numbers.");
  const { data, error } = await sb.rpc("join_household", { p_code: code });
  if (error) return say(error.message);
  if (!data) return say("That code didn't match a household. Check it and try again.");
  store.set("hid", data);
  if (!silent){ $("joinCode").value=""; await loadHouseholds(data); closeSheet(); }
  toast("Joined household");
}
$("joinForm").onsubmit = e => { e.preventDefault(); joinCode($("joinCode").value); };
$("createForm").onsubmit = async e => {
  e.preventDefault(); const name=$("createName").value.trim()||"Home";
  const { data, error } = await sb.rpc("create_household", { p_name:name });
  if (error) return showErr($("sheetErr"), error.message);
  $("createName").value=""; await loadHouseholds(data.id); toast(`Created ${name}`);
};
$("leave").onclick = async () => {
  const b=$("leave");
  if (b.dataset.confirm!=="1"){ b.dataset.confirm="1"; b.textContent="Tap again to leave"; return; }
  const { error } = await sb.from("household_members").delete().eq("household_id",state.hid).eq("user_id",state.user.id);
  if (error) return showErr($("sheetErr"), error.message);
  store.set("hid",""); closeSheet(); await loadHouseholds();
};
$("rotate").onclick = async () => {
  const b=$("rotate");
  if (b.dataset.confirm!=="1"){ b.dataset.confirm="1"; b.textContent="Old code stops working. Tap again"; return; }
  b.dataset.confirm=""; b.textContent="New code";
  const { data, error } = await sb.rpc("rotate_invite_code", { p_household: state.hid });
  if (error) return showErr($("sheetErr"), error.message);
  const h = state.households.find(x=>x.id===state.hid); if (h) h.invite_code=data;
  renderSheet(); toast("New invite code made");
};

// ---------- Sheet ----------
function openSheet(){
  showErr($("sheetErr"),"");
  for (const [id,label] of [["leave","Leave household"],["rotate","New code"]]){ $(id).dataset.confirm=""; $(id).textContent=label; }
  $("newToken").hidden=true; $("tokVal").textContent="";
  $("sheet").hidden=false;
  if (state.hid) loadTokens();
}

// ---------- Agent tokens ----------
const MCP_URL = `${SUPABASE_URL}/functions/v1/pantry-agent/mcp`;
function ago(ts){ if(!ts) return "never used"; const m=Math.round((Date.now()-new Date(ts))/60000);
  return m<2?"used just now":m<60?`used ${m} min ago`:m<1440?`used ${Math.round(m/60)} h ago`:`used ${Math.round(m/1440)} d ago`; }
async function loadTokens(){
  const { data, error } = await sb.from("api_tokens").select("id,name,token_hint,created_at,last_used_at")
    .eq("household_id", state.hid).eq("user_id", state.user.id).order("created_at");
  if (error) return showErr($("sheetErr"), error.message);
  $("tokenList").innerHTML = data.map(t=>`<div class="tok"><div class="txt"><div class="name">${esc(t.name)}</div>
    <div class="meta">…${esc(t.token_hint)} · ${esc(ago(t.last_used_at))}</div></div>
    <button class="revoke" type="button" data-tok="${esc(t.id)}">Revoke</button></div>`).join("");
  $("tokenList").querySelectorAll("[data-tok]").forEach(b=>b.onclick=async()=>{
    if (b.dataset.confirm!=="1"){ b.dataset.confirm="1"; b.textContent="Tap to confirm"; return; }
    const { error } = await sb.from("api_tokens").delete().eq("id", b.dataset.tok);
    if (error) return showErr($("sheetErr"), error.message);
    toast("Token revoked"); loadTokens();
  });
}
$("tokenForm").onsubmit = async e => {
  e.preventDefault();
  const { data, error } = await sb.rpc("create_api_token", { p_household: state.hid, p_name: $("tokenName").value.trim() || "Agent" });
  if (error) return showErr($("sheetErr"), error.message);
  $("tokenName").value=""; $("tokVal").textContent=data.token; $("mcpUrl").textContent=MCP_URL; $("newToken").hidden=false;
  loadTokens();
};
async function copyText(text, label){
  try{ await navigator.clipboard.writeText(text); toast(`${label} copied`); }
  catch{ toast("Select the text and copy it"); }
}
$("copyTok").onclick = () => copyText($("tokVal").textContent, "Token");
$("copyMcp").onclick = () => copyText(MCP_URL, "MCP URL");
function closeSheet(){ $("sheet").hidden=true; $("newToken").hidden=true; $("tokVal").textContent=""; }
$("openSheet").onclick=openSheet; $("openSheet2").onclick=openSheet; $("closeSheet").onclick=closeSheet;
$("sheet").onclick=e=>{ if(e.target.id==="sheet") closeSheet(); };
document.addEventListener("keydown",e=>{ if(e.key==="Escape" && !$("sheet").hidden) closeSheet(); });
function inviteURL(code){ return `${location.origin}${location.pathname}?join=${encodeURIComponent(code)}`; }
function renderSheet(){
  const h = state.households.find(x=>x.id===state.hid);
  $("shareBox").hidden=!h; $("leave").hidden=!h; $("agentBox").hidden=!h;
  if (h && !$("sheet").hidden) loadTokens();
  if (h){ $("inviteCode").textContent=h.invite_code; $("inviteLink").textContent=inviteURL(h.invite_code); }
  $("myHouseholds").hidden = state.households.length<2;
  $("hlist").innerHTML = state.households.map(x=>`<button type="button" data-id="${esc(x.id)}" class="${x.id===state.hid?"on":""}"><span>${esc(x.name)}</span><span class="small">${x.id===state.hid?"Current":""}</span></button>`).join("");
  $("hlist").querySelectorAll("button").forEach(b=>b.onclick=()=>{ selectHousehold(b.dataset.id); closeSheet(); });
}
$("copyLink").onclick = async () => {
  const link=$("inviteLink").textContent;
  try{ await navigator.clipboard.writeText(link); toast("Invite link copied"); }
  catch{ const r=document.createRange(); r.selectNodeContents($("inviteLink")); getSelection().removeAllRanges(); getSelection().addRange(r); toast("Link selected. Copy it to share"); }
};

// ---------- Items ----------
async function loadItems(){
  const hid = state.hid;
  const { data, error } = await sb.from("items").select("*").eq("household_id",hid).order("created_at");
  if (error){ toast(error.message); return; }
  if (hid !== state.hid) return;
  state.items = new Map(data.map(i=>[i.id,i])); render();
}
async function loadMembers(){
  const { data } = await sb.from("household_members").select("user_id,display_name,avatar_url").eq("household_id",state.hid);
  state.members = data||[]; renderFaces();
}
function renderFaces(){
  $("faces").innerHTML = state.members.slice(0,4).map(m=> AVATAR_RE.test(m.avatar_url||"")
    ? `<img src="${esc(m.avatar_url)}" alt="${esc(m.display_name)}" title="${esc(m.display_name)}" referrerpolicy="no-referrer">`
    : `<span class="ph" title="${esc(m.display_name)}">${esc((m.display_name||"?")[0].toUpperCase())}</span>`).join("");
}
function render(){
  const all=[...state.items.values()];
  const todo=all.filter(i=>!i.checked).sort((a,b)=>a.created_at.localeCompare(b.created_at));
  const done=all.filter(i=>i.checked).sort((a,b)=>b.updated_at.localeCompare(a.updated_at));
  $("todo").innerHTML=todo.map(row).join(""); $("done").innerHTML=done.map(row).join("");
  $("todo").hidden=!todo.length; $("emptyTodo").hidden=!!todo.length; $("doneWrap").hidden=!done.length;
  $("nTodo").textContent=todo.length; $("nDone").textContent=done.length;
  $("count").textContent = `${todo.length} to buy · ${state.members.length} member${state.members.length===1?"":"s"}`;
}
function row(i){
  return `<li data-id="${esc(i.id)}" class="${i.checked?"done":""}">
    <button class="chk" type="button" aria-label="${i.checked?"Uncheck":"Check off"} ${esc(i.name)}" data-act="toggle"></button>
    <div class="txt"><div class="name">${esc(i.name)}</div><div class="meta">${esc(i.added_by_name||"")}</div></div>
    ${i.quantity?`<span class="qty">${esc(i.quantity)}</span>`:""}
    <button class="del" type="button" aria-label="Remove ${esc(i.name)}" data-act="del">×</button></li>`;
}
document.addEventListener("click", async e=>{
  const b=e.target.closest("[data-act]"); if(!b) return;
  const id=b.closest("li").dataset.id, it=state.items.get(id); if(!it) return;
  if (b.dataset.act==="toggle"){
    const prev=it.checked; it.checked=!prev; it.updated_at=new Date().toISOString(); render();
    const { error } = await sb.from("items").update({ checked:it.checked }).eq("id",id);
    if (error){ it.checked=prev; render(); toast(error.message); }
  } else {
    state.items.delete(id); render();
    const { error } = await sb.from("items").delete().eq("id",id);
    if (error){ state.items.set(id,it); render(); toast(error.message); }
  }
});
$("addForm").onsubmit = async e => {
  e.preventDefault();
  const name=$("addName").value.trim(), quantity=$("addQty").value.trim()||null; if(!name) return;
  $("addName").value=""; $("addQty").value=""; $("addName").focus();
  // Author is set server-side by a trigger; the client can't claim to be someone else.
  const { data, error } = await sb.from("items").insert({ household_id:state.hid, name, quantity }).select().single();
  if (error) return toast(error.message);
  state.items.set(data.id,data); render();
};
$("clearDone").onclick = async () => {
  const ids=[...state.items.values()].filter(i=>i.checked).map(i=>i.id); if(!ids.length) return;
  ids.forEach(id=>state.items.delete(id)); render();
  const { error } = await sb.from("items").delete().in("id",ids);
  if (error){ toast(error.message); loadItems(); } else toast(`Cleared ${ids.length} item${ids.length>1?"s":""}`);
};

// ---------- Realtime ----------
function teardown(){ if(state.channel){ sb.removeChannel(state.channel); state.channel=null; } }
function subscribe(){
  teardown();
  const hid=state.hid;
  state.channel = sb.channel(`hh-${hid}`)
    .on("postgres_changes",{ event:"INSERT", schema:"public", table:"items", filter:`household_id=eq.${hid}` }, p=>{ state.items.set(p.new.id,p.new); render(); })
    .on("postgres_changes",{ event:"UPDATE", schema:"public", table:"items", filter:`household_id=eq.${hid}` }, p=>{ state.items.set(p.new.id,p.new); render(); })
    // Supabase can't filter DELETE events; with RLS they carry only the row id, so we drop ids we don't hold.
    .on("postgres_changes",{ event:"DELETE", schema:"public", table:"items" }, p=>{ if(state.items.delete(p.old.id)) render(); })
    .on("postgres_changes",{ event:"*", schema:"public", table:"household_members", filter:`household_id=eq.${hid}` }, ()=>loadMembers().then(render))
    .subscribe(status=>{
      const live = status==="SUBSCRIBED"; $("live").classList.toggle("live",live);
      if (live) render(); else if (status==="CHANNEL_ERROR"||status==="TIMED_OUT") $("count").textContent="Reconnecting…";
    });
}
document.addEventListener("visibilitychange",()=>{ if(!document.hidden && state.hid) loadItems(); });

sb.auth.getSession().then(({data})=>{ if(!data.session) $("login").hidden=false; });
