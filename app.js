
(() => {
"use strict";

const APP_VERSION = "2.0-preview";
const DB_NAME = "braindock-db";
const DB_VERSION = 2;
const STORES = ["projects","captures","trash","settings"];
let db;
let state = { view:"home", projectId:null, projectTab:"overview", query:"", modal:null, toast:null, sidebar:false };
let mediaRecorder = null, recordingChunks = [], recordingStarted = 0, recordingTimer = null;

const $ = (s, root=document) => root.querySelector(s);
const esc = (v="") => String(v).replace(/[&<>"']/g, m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));
const uid = (prefix="id") => `${prefix}_${Date.now().toString(36)}_${crypto.getRandomValues(new Uint32Array(1))[0].toString(36)}`;
const now = () => new Date().toISOString();
const fmt = iso => new Intl.DateTimeFormat(undefined,{month:"short",day:"numeric",year:new Date(iso).getFullYear()!==new Date().getFullYear()?"numeric":undefined,hour:"numeric",minute:"2-digit"}).format(new Date(iso));
const typeIcon = t => ({note:"✎",task:"✓",recording:"●",file:"↥",capture:"✦"}[t] || "✦");

function openDB(){
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open(DB_NAME,DB_VERSION);
    req.onupgradeneeded=e=>{
      const d=e.target.result;
      for(const name of STORES){
        if(!d.objectStoreNames.contains(name)){
          const s=d.createObjectStore(name,{keyPath:"id"});
          if(name==="captures"){s.createIndex("projectId","projectId");s.createIndex("updatedAt","updatedAt");}
          if(name==="trash"){s.createIndex("deletedAt","deletedAt");}
        }
      }
    };
    req.onsuccess=e=>resolve(e.target.result);
    req.onerror=()=>reject(req.error);
  });
}
function tx(store,mode="readonly"){return db.transaction(store,mode).objectStore(store)}
function all(store){return new Promise((res,rej)=>{const r=tx(store).getAll();r.onsuccess=()=>res(r.result||[]);r.onerror=()=>rej(r.error)})}
function get(store,id){return new Promise((res,rej)=>{const r=tx(store).get(id);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}
function put(store,obj){return new Promise((res,rej)=>{const r=tx(store,"readwrite").put(obj);r.onsuccess=()=>res(obj);r.onerror=()=>rej(r.error)})}
function del(store,id){return new Promise((res,rej)=>{const r=tx(store,"readwrite").delete(id);r.onsuccess=()=>res();r.onerror=()=>rej(r.error)})}
function clear(store){return new Promise((res,rej)=>{const r=tx(store,"readwrite").clear();r.onsuccess=()=>res();r.onerror=()=>rej(r.error)})}

async function seed(){
  const projects=await all("projects");
  if(projects.length) return;
  const defaults=[
    ["Tallgrass Film Association","Film, events, board work, and the charming chaos surrounding all of it.","#b98283"],
    ["Korn Ferry","Work notes, recruiting coordination, and follow-ups.","#7f9384"],
    ["WSU","Classes, assignments, study notes, and deadlines.","#b08a54"],
    ["Personal","Life administration and everything that refuses to fit elsewhere.","#b96f53"],
    ["Creative Projects","Ideas, artwork, experiments, and future schemes.","#77866f"]
  ];
  for(const [name,description,color] of defaults) await put("projects",{id:uid("project"),name,description,color,createdAt:now(),updatedAt:now()});
  await put("settings",{id:"profile",name:"Jenni",voice:"dry",createdAt:now(),updatedAt:now()});
}

async function purgeTrash(){
  const cutoff=Date.now()-30*24*60*60*1000;
  for(const item of await all("trash")) if(new Date(item.deletedAt).getTime()<cutoff) await del("trash",item.id);
}

function setState(p){Object.assign(state,p);render()}
function notify(message){state.toast=message;render();setTimeout(()=>{if(state.toast===message){state.toast=null;render()}},2400)}

async function data(){
  const [projects,captures,trash,settings]=await Promise.all(STORES.map(all));
  return {projects,captures,trash,settings};
}
function activeCaptures(captures){return captures.filter(x=>!x.deletedAt).sort((a,b)=>new Date(b.updatedAt)-new Date(a.updatedAt))}
function projectById(projects,id){return projects.find(p=>p.id===id)}
function counts(captures,pid){
  const c=captures.filter(x=>x.projectId===pid);
  return {all:c.length,tasks:c.filter(x=>x.type==="task"&&!x.completed).length,files:c.reduce((n,x)=>n+(x.attachments?.length||0),0)};
}
function snippet(c){return c.body || c.summary || (c.attachments?.[0]?.name) || (c.type==="recording"?"Audio recording":"No details yet")}

function sidebar(projects){
  const nav=[["home","⌂","Home"],["captures","✦","Captures"],["tasks","✓","Tasks"],["timeline","◷","Timeline"],["trash","♲","Recently Deleted"],["settings","⚙","Settings"]];
  return `<aside class="sidebar ${state.sidebar?"open":""}">
    <div class="brand"><img src="./icons/icon.svg" alt=""><div><div class="brand-name">BrainDock</div><div class="brand-tag">Your second brain, without the clutter.</div></div></div>
    <nav class="nav">${nav.map(([v,i,l])=>`<button data-view="${v}" class="${state.view===v?"active":""}"><span class="icon">${i}</span>${l}</button>`).join("")}</nav>
    <div><div class="sidebar-section-title">Projects</div><div class="project-nav">
      ${projects.map(p=>`<button data-project="${p.id}"><span class="project-dot" style="background:${esc(p.color)}"></span><span>${esc(p.name)}</span></button>`).join("")}
    </div></div>
    <div class="sidebar-bottom"><button data-action="new-project">＋ New project</button><button data-action="backup">⇩ Backup</button><button data-action="restore">⇧ Restore</button></div>
  </aside>`;
}
function topbar(){
  return `<header class="topbar"><button class="icon-btn menu-toggle" data-action="menu">☰</button>
    <div class="search-wrap"><input id="global-search" value="${esc(state.query)}" placeholder="Search your second brain…" aria-label="Search"></div>
    <button class="primary-btn" data-action="new-capture">＋ Capture</button>
  </header>`;
}
function mobileNav(){
  return `<nav class="mobile-nav">
    <button data-view="home"><span>⌂</span>Home</button>
    <button data-view="captures"><span>✦</span>Captures</button>
    <button class="capture-main" data-action="new-capture"><span>＋</span>Capture</button>
    <button data-view="tasks"><span>✓</span>Tasks</button>
    <button data-view="settings"><span>•••</span>More</button>
  </nav>`;
}
function captureRow(c,projects){
  const p=projectById(projects,c.projectId);
  return `<article class="capture-row" data-open-capture="${c.id}">
    <div class="capture-type">${typeIcon(c.type)}</div>
    <div><div class="capture-title">${esc(c.title||"Untitled capture")}</div><div class="capture-preview">${esc(snippet(c)).slice(0,130)}</div>
    <div class="capture-meta">${p?esc(p.name)+" · ":""}${fmt(c.updatedAt)}</div></div>
    <div class="row-actions"><span class="badge ${c.type==="task"?"rose":""}">${esc(c.type)}</span></div>
  </article>`;
}
async function homeView(d){
  const captures=activeCaptures(d.captures);
  const recent=captures.slice(0,6);
  return `<div class="page">
    <section class="hero"><div class="eyebrow">Good ${new Date().getHours()<12?"morning":new Date().getHours()<18?"afternoon":"evening"}, Jenni</div>
      <h1>Your second brain,<br>without the clutter.</h1>
      <p>For busy minds managing a dozen projects, each with ten more things demanding attention. Capture first. BrainDock will help you find your way back.</p>
      <div class="quote">${captures.length?`You have ${captures.length} captures across ${d.projects.length} projects. Admirably organized, considering reality’s general refusal to cooperate.`:`It is unusually quiet in here. Let’s capture something before your brain decides to store it in the least retrievable corner available.`}</div>
    </section>
    <div class="section-head"><div><h2>Capture</h2><p>Get it out of your head before it wanders off.</p></div></div>
    <div class="grid">
      <div class="card quick-capture"><div><div class="quick-icon">●</div><h3>Voice</h3><p class="muted">Record a thought or meeting.</p></div><button class="secondary-btn" data-action="record">Record</button></div>
      <div class="card quick-capture"><div><div class="quick-icon">✎</div><h3>Note</h3><p class="muted">Write without setting up a miniature bureaucracy.</p></div><button class="secondary-btn" data-new-type="note">Write</button></div>
      <div class="card quick-capture"><div><div class="quick-icon">✓</div><h3>Task</h3><p class="muted">Give Future You a fighting chance.</p></div><button class="secondary-btn" data-new-type="task">Add task</button></div>
    </div>
    <div class="section-head"><div><h2>Continue Thinking</h2><p>Projects where your attention last landed.</p></div><button class="secondary-btn" data-action="new-project">New project</button></div>
    <div class="grid">${d.projects.map(p=>{const n=counts(captures,p.id);return `<div class="card project-card"><button class="stretched" aria-label="Open ${esc(p.name)}" data-project="${p.id}"></button><span class="badge" style="background:${esc(p.color)}22;color:${esc(p.color)}">${n.all} captures</span><h3 style="margin-top:16px">${esc(p.name)}</h3><div class="project-meta">${esc(p.description||"")}</div><div class="project-stats"><div class="stat"><strong>${n.tasks}</strong>open tasks</div><div class="stat"><strong>${n.files}</strong>files</div></div></div>`}).join("")}</div>
    <div class="section-head"><div><h2>Recent Captures</h2><p>Where you left off, minus the frantic tab hunting.</p></div></div>
    <div class="capture-list">${recent.length?recent.map(c=>captureRow(c,d.projects)).join(""):`<div class="empty">No captures yet.</div>`}</div>
  </div>`;
}
async function listView(d,mode){
  let items=activeCaptures(d.captures);
  let title="All Captures",sub="Notes, recordings, tasks, and files in one place.";
  if(mode==="tasks"){items=items.filter(x=>x.type==="task");title="Tasks";sub="The loose ends, now at least visible."}
  if(state.query){const q=state.query.toLowerCase();items=items.filter(x=>[x.title,x.body,x.summary,...(x.tags||[])].join(" ").toLowerCase().includes(q))}
  return `<div class="page"><div class="workspace-head"><div class="workspace-title"><div class="eyebrow">BrainDock</div><h2>${title}</h2><p>${sub}</p></div><button class="primary-btn" data-action="new-capture">＋ Capture</button></div>
    <div class="capture-list">${items.length?items.map(c=>captureRow(c,d.projects)).join(""):`<div class="empty">Nothing matches. Either wonderfully tidy or suspiciously unrecorded.</div>`}</div></div>`;
}
async function projectView(d){
  const p=projectById(d.projects,state.projectId);
  if(!p){state.view="home";return homeView(d)}
  const caps=activeCaptures(d.captures).filter(c=>c.projectId===p.id);
  const tab=state.projectTab;
  let content="";
  if(tab==="overview"){
    const open=caps.filter(c=>c.type==="task"&&!c.completed);
    content=`<div class="two-col"><div class="stack">
      <div class="card"><h3>Recent Captures</h3><div class="divider"></div><div class="capture-list">${caps.slice(0,6).map(c=>captureRow(c,d.projects)).join("")||`<div class="empty">This workspace is ready for its first thought.</div>`}</div></div>
    </div><div class="stack"><div class="card"><div class="eyebrow">At a glance</div><h3 style="margin-top:8px">${caps.length} captures</h3><div class="divider"></div><p>${open.length} open task${open.length===1?"":"s"}</p><p>${caps.reduce((n,x)=>n+(x.attachments?.length||0),0)} attached file${caps.reduce((n,x)=>n+(x.attachments?.length||0),0)===1?"":"s"}</p></div>
      <div class="card"><h3>BrainDock says</h3><p class="muted">${open.length?`There ${open.length===1?"is":"are"} ${open.length} open task${open.length===1?"":"s"} here. Nothing catastrophic, but they are beginning to look comfortable.`:`No open tasks. A rare administrative miracle.`}</p></div></div></div>`;
  }else{
    let items=caps;
    if(tab==="tasks") items=caps.filter(c=>c.type==="task");
    if(tab==="files") items=caps.filter(c=>(c.attachments||[]).length);
    content=`<div class="capture-list">${items.length?items.map(c=>captureRow(c,d.projects)).join(""):`<div class="empty">Nothing here yet.</div>`}</div>`;
  }
  return `<div class="page"><div class="workspace-head"><div class="workspace-title"><div class="eyebrow">Project workspace</div><h2>${esc(p.name)}</h2><p>${esc(p.description||"")}</p></div><div class="actions"><button class="icon-btn" data-edit-project="${p.id}">✎</button><button class="primary-btn" data-new-project-capture="${p.id}">＋ Capture</button></div></div>
    <div class="tabs">${["overview","captures","tasks","files","timeline"].map(t=>`<button data-project-tab="${t}" class="${tab===t?"active":""}">${t[0].toUpperCase()+t.slice(1)}</button>`).join("")}</div>
    ${tab==="timeline"?timelineMarkup(caps,d.projects):content}</div>`;
}
function timelineMarkup(items,projects){
  return `<div class="card timeline">${items.length?items.map(c=>`<div class="timeline-item"><strong>${esc(c.title||"Untitled")}</strong><div class="kicker">${fmt(c.updatedAt)} · ${esc(c.type)}</div><div class="muted">${esc(snippet(c)).slice(0,150)}</div></div>`).join(""):`<div class="empty">No history yet.</div>`}</div>`;
}
async function timelineView(d){return `<div class="page"><div class="workspace-head"><div><div class="eyebrow">Chronological memory</div><h2>Timeline</h2><p class="muted">Your work as it actually happened, rather than how folders pretend it happened.</p></div></div>${timelineMarkup(activeCaptures(d.captures),d.projects)}</div>`}
async function trashView(d){
  return `<div class="page"><div class="workspace-head"><div><div class="eyebrow">30-day safety net</div><h2>Recently Deleted</h2><p class="muted">Deleted items remain here for 30 days.</p></div></div>
  <div class="capture-list">${d.trash.length?d.trash.sort((a,b)=>new Date(b.deletedAt)-new Date(a.deletedAt)).map(x=>`<div class="capture-row"><div class="capture-type">♲</div><div><div class="capture-title">${esc(x.item.title||x.item.name||"Deleted item")}</div><div class="capture-meta">Deleted ${fmt(x.deletedAt)}</div></div><div class="row-actions"><button class="secondary-btn" data-restore-trash="${x.id}">Restore</button> <button class="danger-btn" data-purge-trash="${x.id}">Delete forever</button></div></div>`).join(""):`<div class="empty">Trash is empty. Remarkably civilized.</div>`}</div></div>`;
}
async function settingsView(d){
  const size=JSON.stringify({projects:d.projects,captures:d.captures}).length;
  return `<div class="page"><div class="workspace-head"><div><div class="eyebrow">Preferences and safety</div><h2>Settings</h2><p class="muted">Local-first storage. Your data stays in this browser unless you export it.</p></div></div>
  <div class="settings-grid"><div class="card"><h3>Backup</h3><p class="muted">Create a timestamped JSON backup containing projects, captures, and attachments.</p><button class="primary-btn" data-action="backup">Create backup</button></div>
  <div class="card"><h3>Restore</h3><p class="muted">Merge a backup with current data or replace everything.</p><button class="secondary-btn" data-action="restore">Restore backup</button></div>
  <div class="card"><h3>Storage</h3><p><strong>${(size/1024).toFixed(1)} KB</strong> of structured data, plus stored file blobs.</p><p class="small muted">Browser storage is device-specific. Mac and phone do not sync yet.</p></div>
  <div class="card"><h3>Version</h3><p><strong>${APP_VERSION}</strong></p><p class="small muted">A working foundation, not a button museum pretending every future service is connected.</p></div></div></div>`;
}

function modalMarkup(d){
  if(!state.modal) return "";
  const close=`<button class="icon-btn" data-action="close-modal">×</button>`;
  if(state.modal.kind==="capture"){
    const c=state.modal.item||{}, type=c.type||state.modal.type||"note";
    return `<div class="modal-backdrop"><div class="modal"><div class="modal-head"><div><div class="eyebrow">${c.id?"Edit":"New"} capture</div><h3>${type==="recording"?"Voice recording":type[0].toUpperCase()+type.slice(1)}</h3></div>${close}</div>
      <form id="capture-form" class="form-grid">
        <input type="hidden" name="id" value="${esc(c.id||"")}"><input type="hidden" name="type" value="${esc(type)}">
        <label>Title<input name="title" required value="${esc(c.title||"")}" placeholder="What is this about?"></label>
        <label>Project<select name="projectId"><option value="">No project</option>${d.projects.map(p=>`<option value="${p.id}" ${(c.projectId||state.modal.projectId)===p.id?"selected":""}>${esc(p.name)}</option>`).join("")}</select></label>
        ${type==="task"?`<label>Due date<input type="date" name="dueDate" value="${esc(c.dueDate||"")}"></label>`:""}
        ${type==="recording"&&state.modal.recordingBlob?`<div class="recording-panel"><strong>Recording ready</strong><p class="muted">${Math.round((state.modal.duration||0)/1000)} seconds</p><audio controls src="${URL.createObjectURL(state.modal.recordingBlob)}"></audio></div>`:""}
        <label>Notes<textarea name="body" placeholder="Add context, details, or the part your future self will otherwise have to reconstruct.">${esc(c.body||"")}</textarea></label>
        <label>Tags<input name="tags" value="${esc((c.tags||[]).join(", "))}" placeholder="meeting, idea, follow-up"></label>
        <div><button type="button" class="secondary-btn" data-action="attach-files">↥ Attach files</button><div id="pending-files"></div>
          ${(c.attachments||[]).map(a=>`<div class="file-chip"><span>${esc(a.name)} <small>${Math.round(a.size/1024)} KB</small></span><button type="button" data-download-attachment="${a.id}" data-capture-id="${c.id}">Download</button></div>`).join("")}
        </div>
        ${c.type==="task"?`<label><span><input type="checkbox" name="completed" ${c.completed?"checked":""}> Completed</span></label>`:""}
        <div class="form-actions">${c.id?`<button type="button" class="danger-btn" data-delete-capture="${c.id}">Delete</button>`:""}<button type="button" class="secondary-btn" data-action="close-modal">Cancel</button><button class="primary-btn" type="submit">Save capture</button></div>
      </form></div></div>`;
  }
  if(state.modal.kind==="project"){
    const p=state.modal.item||{};
    return `<div class="modal-backdrop"><div class="modal"><div class="modal-head"><div><div class="eyebrow">${p.id?"Edit":"New"} workspace</div><h3>Project</h3></div>${close}</div>
    <form id="project-form" class="form-grid"><input type="hidden" name="id" value="${esc(p.id||"")}">
      <label>Name<input name="name" required value="${esc(p.name||"")}"></label>
      <label>Description<textarea name="description" style="min-height:100px">${esc(p.description||"")}</textarea></label>
      <label>Accent color<input name="color" type="color" value="${esc(p.color||"#b98283")}"></label>
      <div class="form-actions">${p.id?`<button type="button" class="danger-btn" data-delete-project="${p.id}">Delete project</button>`:""}<button type="button" class="secondary-btn" data-action="close-modal">Cancel</button><button class="primary-btn">Save project</button></div>
    </form></div></div>`;
  }
  if(state.modal.kind==="restore"){
    return `<div class="modal-backdrop"><div class="modal"><div class="modal-head"><div><div class="eyebrow">Restore</div><h3>Choose how to restore</h3></div>${close}</div>
      <p class="muted">Merge keeps existing items and adds anything missing. Replace clears the current database first, because sometimes humans prefer the dramatic option.</p>
      <div class="form-actions"><button class="secondary-btn" data-restore-mode="merge">Merge</button><button class="danger-btn" data-restore-mode="replace">Replace everything</button></div></div></div>`;
  }
  return "";
}

async function render(){
  const d=await data();
  let content;
  if(state.view==="home") content=await homeView(d);
  else if(state.view==="project") content=await projectView(d);
  else if(state.view==="captures"||state.view==="tasks") content=await listView(d,state.view);
  else if(state.view==="timeline") content=await timelineView(d);
  else if(state.view==="trash") content=await trashView(d);
  else content=await settingsView(d);
  $("#app").innerHTML=`<div class="app-shell">${sidebar(d.projects)}<main class="main">${topbar()}${content}</main></div>${mobileNav()}${modalMarkup(d)}${state.toast?`<div class="toast">${esc(state.toast)}</div>`:""}`;
  bind(d);
}
function bind(d){
  document.querySelectorAll("[data-view]").forEach(b=>b.onclick=()=>setState({view:b.dataset.view,projectId:null,sidebar:false}));
  document.querySelectorAll("[data-project]").forEach(b=>b.onclick=()=>setState({view:"project",projectId:b.dataset.project,projectTab:"overview",sidebar:false}));
  document.querySelectorAll("[data-project-tab]").forEach(b=>b.onclick=()=>setState({projectTab:b.dataset.projectTab}));
  document.querySelectorAll("[data-action]").forEach(b=>b.onclick=()=>handleAction(b.dataset.action,d));
  document.querySelectorAll("[data-new-type]").forEach(b=>b.onclick=()=>setState({modal:{kind:"capture",type:b.dataset.newType}}));
  document.querySelectorAll("[data-new-project-capture]").forEach(b=>b.onclick=()=>setState({modal:{kind:"capture",type:"note",projectId:b.dataset.newProjectCapture}}));
  document.querySelectorAll("[data-edit-project]").forEach(b=>b.onclick=()=>setState({modal:{kind:"project",item:projectById(d.projects,b.dataset.editProject)}}));
  document.querySelectorAll("[data-open-capture]").forEach(b=>b.onclick=()=>setState({modal:{kind:"capture",item:d.captures.find(c=>c.id===b.dataset.openCapture)}}));
  document.querySelectorAll("[data-delete-capture]").forEach(b=>b.onclick=()=>deleteCapture(b.dataset.deleteCapture));
  document.querySelectorAll("[data-delete-project]").forEach(b=>b.onclick=()=>deleteProject(b.dataset.deleteProject));
  document.querySelectorAll("[data-restore-trash]").forEach(b=>b.onclick=()=>restoreTrash(b.dataset.restoreTrash));
  document.querySelectorAll("[data-purge-trash]").forEach(b=>b.onclick=async()=>{await del("trash",b.dataset.purgeTrash);notify("Deleted forever.")});
  document.querySelectorAll("[data-restore-mode]").forEach(b=>b.onclick=()=>{state.restoreMode=b.dataset.restoreMode;$("#restore-file").click()});
  document.querySelectorAll("[data-download-attachment]").forEach(b=>b.onclick=e=>{e.stopPropagation();downloadAttachment(b.dataset.captureId,b.dataset.downloadAttachment)});
  $("#global-search").oninput=e=>{state.query=e.target.value;if(state.view!=="captures")state.view="captures";render()};
  const cf=$("#capture-form"); if(cf) cf.onsubmit=saveCapture;
  const pf=$("#project-form"); if(pf) pf.onsubmit=saveProject;
}
async function handleAction(a,d){
  if(a==="menu") return setState({sidebar:!state.sidebar});
  if(a==="close-modal") return setState({modal:null});
  if(a==="new-capture") return setState({modal:{kind:"capture",type:"note",projectId:state.projectId}});
  if(a==="new-project") return setState({modal:{kind:"project"}});
  if(a==="attach-files") return $("#attachment-file").click();
  if(a==="backup") return backup();
  if(a==="restore") return setState({modal:{kind:"restore"}});
  if(a==="record") return startRecording();
}

let pendingAttachments=[];
$("#attachment-file").addEventListener("change",async e=>{
  pendingAttachments=[...e.target.files].map(f=>({id:uid("file"),name:f.name,type:f.type,size:f.size,blob:f}));
  const box=$("#pending-files"); if(box) box.innerHTML=pendingAttachments.map(a=>`<div class="file-chip">${esc(a.name)} <small>${Math.round(a.size/1024)} KB</small></div>`).join("");
});

async function saveCapture(e){
  e.preventDefault(); const fd=new FormData(e.target); const id=fd.get("id")||uid("capture"); const existing=await get("captures",id);
  const attachments=[...(existing?.attachments||[]),...pendingAttachments];
  if(state.modal?.recordingBlob) attachments.push({id:uid("audio"),name:`Recording-${new Date().toISOString().replace(/[:.]/g,"-")}.webm`,type:state.modal.recordingBlob.type||"audio/webm",size:state.modal.recordingBlob.size,blob:state.modal.recordingBlob});
  const item={...(existing||{}),id,type:fd.get("type"),title:fd.get("title").trim(),projectId:fd.get("projectId")||null,body:fd.get("body").trim(),tags:String(fd.get("tags")||"").split(",").map(x=>x.trim()).filter(Boolean),dueDate:fd.get("dueDate")||null,completed:fd.get("completed")==="on",attachments,createdAt:existing?.createdAt||now(),updatedAt:now(),version:APP_VERSION};
  await put("captures",item); pendingAttachments=[]; state.modal=null; notify("Saved. Future You has one less mystery.");
}
async function saveProject(e){
  e.preventDefault(); const fd=new FormData(e.target); const id=fd.get("id")||uid("project"); const existing=await get("projects",id);
  await put("projects",{...(existing||{}),id,name:fd.get("name").trim(),description:fd.get("description").trim(),color:fd.get("color"),createdAt:existing?.createdAt||now(),updatedAt:now()});
  state.modal=null; notify("Project saved.");
}
async function deleteCapture(id){
  if(!confirm("Move this capture to Recently Deleted?")) return;
  const item=await get("captures",id); if(!item)return;
  await put("trash",{id:uid("trash"),kind:"capture",item,deletedAt:now()}); await del("captures",id); state.modal=null; notify("Moved to Recently Deleted.");
}
async function deleteProject(id){
  if(!confirm("Delete this project? Its captures will remain but become unassigned."))return;
  const p=await get("projects",id); if(!p)return;
  await put("trash",{id:uid("trash"),kind:"project",item:p,deletedAt:now()}); await del("projects",id);
  for(const c of await all("captures")) if(c.projectId===id) await put("captures",{...c,projectId:null,updatedAt:now()});
  state.modal=null;state.view="home";state.projectId=null;notify("Project moved to Recently Deleted.");
}
async function restoreTrash(id){
  const t=await get("trash",id);if(!t)return;
  await put(t.kind==="project"?"projects":"captures",t.item);await del("trash",id);notify("Restored.");
}
async function downloadAttachment(captureId,attachmentId){
  const c=await get("captures",captureId); const a=c?.attachments?.find(x=>x.id===attachmentId); if(!a)return;
  const url=URL.createObjectURL(a.blob);const link=document.createElement("a");link.href=url;link.download=a.name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function startRecording(){
  if(!navigator.mediaDevices?.getUserMedia){return notify("This browser does not support microphone recording.")}
  try{
    const stream=await navigator.mediaDevices.getUserMedia({audio:true});
    recordingChunks=[];mediaRecorder=new MediaRecorder(stream);recordingStarted=Date.now();
    mediaRecorder.ondataavailable=e=>{if(e.data.size)recordingChunks.push(e.data)};
    mediaRecorder.onstop=()=>{
      stream.getTracks().forEach(t=>t.stop());
      const blob=new Blob(recordingChunks,{type:mediaRecorder.mimeType||"audio/webm"});
      setState({modal:{kind:"capture",type:"recording",recordingBlob:blob,duration:Date.now()-recordingStarted}});
    };
    mediaRecorder.start();
    state.toast="Recording… tap the red button to stop.";
    render();
    setTimeout(()=>{
      const btn=document.querySelector('[data-action="stop-recording"]');
    },0);
    const stop=document.createElement("button");stop.className="toast";stop.textContent="● Stop recording";stop.onclick=()=>mediaRecorder.stop();document.body.appendChild(stop);
    const obs=setInterval(()=>{if(!mediaRecorder||mediaRecorder.state==="inactive"){clearInterval(obs);stop.remove()}},250);
  }catch(err){notify("Microphone access was blocked. Browsers do enjoy making permission settings a scavenger hunt.")}
}
async function serialize(){
  const d=await data();
  const captures=[];
  for(const c of d.captures){
    const clone={...c,attachments:[]};
    for(const a of c.attachments||[]){
      let dataUrl=null;
      if(a.blob) dataUrl=await new Promise(res=>{const r=new FileReader();r.onload=()=>res(r.result);r.readAsDataURL(a.blob)});
      clone.attachments.push({...a,blob:undefined,dataUrl});
    }
    captures.push(clone);
  }
  return {app:"BrainDock",version:APP_VERSION,exportedAt:now(),projects:d.projects,captures,settings:d.settings};
}
async function backup(){
  const payload=await serialize();const blob=new Blob([JSON.stringify(payload,null,2)],{type:"application/json"});
  const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=`BrainDock-${new Date().toISOString().replace(/[:.]/g,"-")}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);notify("Backup created.");
}
$("#restore-file").addEventListener("change",async e=>{
  const file=e.target.files[0]; if(!file)return;
  try{
    const payload=JSON.parse(await file.text());
    if(!payload.projects||!payload.captures)throw new Error("Invalid backup");
    if(state.restoreMode==="replace"){for(const s of ["projects","captures","settings"])await clear(s)}
    const decode=async dataUrl=>{const r=await fetch(dataUrl);return r.blob()};
    for(const p of payload.projects) if(state.restoreMode==="replace"||!(await get("projects",p.id))) await put("projects",p);
    for(const c0 of payload.captures){
      if(state.restoreMode==="merge"&&(await get("captures",c0.id)))continue;
      const c={...c0,attachments:[]};
      for(const a of c0.attachments||[]) c.attachments.push({...a,blob:a.dataUrl?await decode(a.dataUrl):null,dataUrl:undefined});
      await put("captures",c);
    }
    for(const s of payload.settings||[]) await put("settings",s);
    state.modal=null;state.restoreMode=null;notify(`Backup ${state.restoreMode==="replace"?"replaced":"merged"}.`);
  }catch(err){notify("That file is not a valid BrainDock backup.");}
  e.target.value="";
});

async function boot(){
  db=await openDB();await seed();await purgeTrash();
  if("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(()=>{});
  render();
}
boot().catch(err=>{
  console.error(err);
  $("#app").innerHTML=`<div style="max-width:700px;margin:50px auto;padding:25px;font-family:system-ui"><h1>BrainDock could not start.</h1><p>${esc(err.message)}</p></div>`;
});
})();
