'use strict';
/* Shared state, utilities, quest storage, and Supabase sync. */
/* ---------- constants ---------- */
var KINDS={movie:'Movie',game:'Game',place:'Place',task:'Task'};
var SEG=['auto','movie','game','place','task'];
var SEG_LABEL={auto:'Auto',movie:'Movies',game:'Games',place:'Places',task:'Tasks'};
var PLACEHOLDER={auto:'Add a movie, game, place or task',movie:'Search a movie, e.g. Interstellar',game:'Search a game, e.g. Hollow Knight',place:'Search a city or destination, e.g. Kyoto',task:'Describe the work, e.g. Finish tax filing'};
var SRC_LABEL={tmdb:'TMDB',rawg:'RAWG',wiki:'Wikipedia'};
var EFFORT={quick:40,standard:100,epic:250};
var EFFORT_LABEL={quick:'Quick',standard:'Standard',epic:'Epic'};
var RANKS=['Newcomer','Scout','Explorer','Wanderer','Collector','Trailblazer','Veteran','Master','Legend','Mythic'];
var UPDATE_XP=10, UPDATE_CAP=5, STEP_XP=5;
var LS_KEY='sidequest-ledger-v1';
/* Browser-storage keys used for sync:
   LS_PENDING = changes not yet sent to the database (kept so nothing is lost offline or on reload)
   LS_OWNER   = which account this browser's local copy belongs to (stops one person's quests
                leaking into another account on a shared computer) */
var LS_PENDING='sidequest-ledger-pending';
var LS_OWNER='sidequest-ledger-owner';
var LS_PROFILE='sidequest-ledger-profile';
var ICONS={
  movie:'<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 5v14M17 5v14M3 10h4M3 14h4M17 10h4M17 14h4"/>',
  game:'<path d="M7 8h10a4 4 0 0 1 4 4v1a3 3 0 0 1-5.2 2L14 13h-4l-1.8 2A3 3 0 0 1 3 13v-1a4 4 0 0 1 4-4z"/><path d="M8 10.5v3M6.5 12h3"/>',
  place:'<path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  task:'<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 12.5l3 3 5-6"/>'
};
var STARTERS=[{t:'Interstellar',k:'movie'},{t:'Hollow Knight',k:'game'},{t:'Kyoto',k:'place'},{t:'Finish tax filing',k:'task'}];
var PLACE_RE=/city|town|village|country|island|region|state|province|prefecture|mountain|lake|national park|capital|district|municipality|county|beach|river|valley|archipelago|peninsula|temple|castle|palace|monument|museum|park|falls|canyon|desert|bay|coast|territory|metropolis|commune|borough|neighbourhood|landmark|tourist|resort|cave|reef|heritage|ruins|bridge|tower|fort|garden|shrine|cathedral|waterfall|plateau|glacier|volcano/i;
var NOT_PLACE_RE=/film|album|song|band|video game|novel|television|series|musician|singer|actor|actress|footballer|politician|footballer|company/i;

/* ---------- state ---------- */
var quests=new Map();
var tab='active', filter='all', openId=null, view='list', addKind='auto';
var drafts={}, stepDrafts={}, detailState={};
var confirmDel=null, confirmTimer=null, flashTimer=null;
var ac={items:[],index:-1,open:false,status:''}, acTimer=null, acCtl=null;
/* account and sync state
   sb = the Supabase client, user = who is signed in (null when signed out),
   pending = ids waiting to be saved (up) or removed (del) in the database,
   flushing/syncing = guards so two syncs never run at the same time. */
var sb=null, user=null, syncErrorMessage='';
var pending={up:{},del:{}}, flushing=false, syncing=false, pushTimer=null, retryTimer=null;

function $(s){return document.querySelector(s)}
function enc(s){return encodeURIComponent(s)}
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function clone(o){return JSON.parse(JSON.stringify(o))}
function fmtDate(ts){return new Date(ts).toLocaleDateString(undefined,{day:'numeric',month:'short',year:'numeric'})}
function fmtStamp(ts){return new Date(ts).toLocaleString(undefined,{day:'numeric',month:'short',hour:'numeric',minute:'2-digit'})}
function plural(n,w){return n+' '+w+(n===1?'':'s')}
function trimText(t,max){t=String(t||'').replace(/\s+/g,' ').trim();if(t.length<=max)return t;var cut=t.slice(0,max),i=cut.lastIndexOf('. ');return i>120?cut.slice(0,i+1):cut.replace(/\s+\S*$/,'')+'…'}
function safeImg(u){return typeof u==='string'&&/^https:\/\/(image\.tmdb\.org|media\.rawg\.io|upload\.wikimedia\.org)\//.test(u)?u:null}
function safeUrl(u){return typeof u==='string'&&/^https:\/\/([a-z.]*\.)?(themoviedb\.org|rawg\.io|wikipedia\.org)\//.test(u)?u:null}
function norm(s){return String(s||'').toLowerCase().replace(/^the\s+/,'').replace(/[^a-z0-9]+/g,'')}
function lsGet(k){try{return localStorage.getItem(k)}catch(e){return null}}
function lsSet(k,v){try{localStorage.setItem(k,v)}catch(e){}}
function lsDel(k){try{localStorage.removeItem(k)}catch(e){}}
async function jget(url,sig){
  var r=await fetch(url,sig?{signal:sig}:undefined);
  if(!r.ok)throw new Error('HTTP '+r.status);
  return r.json();
}

/* ---------- XP and levels ---------- */
function qXp(q){
  var u=Math.min(q.updates.length,UPDATE_CAP)*UPDATE_XP;
  var h=q.highlights.filter(function(x){return x.done}).length*STEP_XP;
  var d=q.status==='done'?(EFFORT[q.effort]||100):0;
  return u+h+d;
}
function totalXp(){var t=0;quests.forEach(function(q){t+=qXp(q)});return t}
function levelInfo(xp){
  var n=1;while(xp>=50*(n+1)*n)n++;
  var floor=50*n*(n-1), next=50*(n+1)*n;
  return {n:n,floor:floor,next:next,pct:Math.round((xp-floor)/(next-floor)*100)};
}
function rankName(n){return RANKS[Math.min(n-1,RANKS.length-1)]}

/* ---------- generated cover art (fallback under real images) ---------- */
function hash(s){var h=2166136261;for(var i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)}return h>>>0}
function rng(seed){return function(){seed|=0;seed=seed+0x6D2B79F5|0;var t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
function hsl(h,s,l){
  s/=100;l/=100;var k=function(n){return(n+h/30)%12},a=s*Math.min(l,1-l);
  var f=function(n){var v=l-a*Math.max(-1,Math.min(k(n)-3,Math.min(9-k(n),1)));return Math.round(255*v).toString(16).padStart(2,'0')};
  return '#'+f(0)+f(8)+f(4);
}
function autoColors(title){var r=rng(hash(title));var h=Math.floor(r()*360);return [hsl(h,50,20),hsl((h+40+Math.floor(r()*60))%360,62,40)]}
function coverSvg(q){
  var cols=autoColors(q.title);
  var r=rng(hash(q.title+q.kind)), gid='g'+hash((q.id||'')+q.title+(q.kind||'')), art='', i, j;
  if(q.kind==='movie'){
    art+='<rect width="300" height="44" fill="#000" opacity=".28"/><rect y="356" width="300" height="44" fill="#000" opacity=".28"/>';
    for(i=14;i<400;i+=34){art+='<rect x="10" y="'+i+'" width="12" height="18" rx="3" fill="#fff" opacity=".16"/><rect x="278" y="'+i+'" width="12" height="18" rx="3" fill="#fff" opacity=".16"/>'}
    art+='<circle cx="'+(110+r()*80).toFixed(0)+'" cy="'+(150+r()*60).toFixed(0)+'" r="'+(70+r()*35).toFixed(0)+'" fill="#fff" opacity=".1"/>';
  }else if(q.kind==='game'){
    for(j=0;j<9;j++){for(i=0;i<5;i++){if(r()>.5){var y=60+j*24;art+='<rect x="'+(30+i*24)+'" y="'+y+'" width="22" height="22" fill="#fff" opacity=".2"/><rect x="'+(30+(9-i)*24)+'" y="'+y+'" width="22" height="22" fill="#fff" opacity=".2"/>'}}}
    for(i=0;i<6;i++){art+='<rect x="'+(30+i*24)+'" y="330" width="16" height="16" fill="#fff" opacity="'+(i<3?.35:.12)+'"/>'}
  }else if(q.kind==='place'){
    var cx=120+r()*60, cy=150+r()*100, k=3+Math.floor(r()*3), ph=r()*6.28;
    for(i=1;i<=9;i++){
      var rad=16+i*20, amp=5+i*1.6, d='';
      for(j=0;j<=64;j++){var th=j/64*6.2832, rr=rad+amp*Math.sin(k*th+ph+i*.3);d+=(j?'L':'M')+(cx+rr*Math.cos(th)).toFixed(1)+' '+(cy+rr*Math.sin(th)*1.15).toFixed(1)}
      art+='<path d="'+d+'Z" fill="none" stroke="#fff" stroke-width="1.5" opacity=".22"/>';
    }
    art+='<circle cx="'+cx.toFixed(0)+'" cy="'+cy.toFixed(0)+'" r="5" fill="#fff" opacity=".7"/>';
  }else{
    for(i=64;i<400;i+=30){art+='<line x1="0" x2="300" y1="'+i+'" y2="'+i+'" stroke="#fff" stroke-width="1" opacity=".12"/>'}
    art+='<path d="M70 240L128 298L238 150" fill="none" stroke="#fff" stroke-width="20" stroke-linecap="round" stroke-linejoin="round" opacity=".26"/>';
  }
  return '<svg viewBox="0 0 300 400" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><defs><linearGradient id="'+gid+'" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="'+cols[0]+'"/><stop offset="1" stop-color="'+cols[1]+'"/></linearGradient></defs><rect width="300" height="400" fill="url(#'+gid+')"/>'+art+'</svg>';
}
function kindIcon(k,sz){sz=sz||18;return '<svg width="'+sz+'" height="'+sz+'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+(ICONS[k]||ICONS.task)+'</svg>'}
function thumb(q,big,small){
  var src=(q.cover&&/^data:image\/jpeg;base64,/.test(q.cover))?q.cover:safeImg(q.img);
  var img=src?'<img src="'+esc(src)+'" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">':'';
  return '<span class="cover'+(big?' big':'')+(small?' sm':'')+'">'+coverSvg(q)+img+(big&&!src?'<span class="cover-t">'+esc(q.title)+'</span>':'')+'<span class="cover-k">'+kindIcon(q.kind,big?20:14)+'</span></span>';
}

/* ---------- storage (this browser) ---------- */
function normalize(d,id){
  var q=clone(d);q.id=id;q.title=String(q.title||'Untitled');q.kind=KINDS[q.kind]?q.kind:'task';q.sub=q.sub||'';
  q.status=q.status==='done'?'done':'active';q.created=q.created||Date.now();
  q.updates=Array.isArray(q.updates)?q.updates:[];q.highlights=Array.isArray(q.highlights)?q.highlights:[];q.facts=Array.isArray(q.facts)?q.facts:[];
  q.effort=EFFORT[q.effort]?q.effort:'standard';return q;
}
function flash(msg){var el=$('#flash');el.textContent=msg;clearTimeout(flashTimer);flashTimer=setTimeout(function(){el.textContent=''},5000)}
function setSync(msg){$('#sync').textContent=(user&&user.email?user.email+' · ':'')+msg}
function saveLocal(){
  try{localStorage.setItem(LS_KEY,JSON.stringify(Array.from(quests.values())))}
  catch(e){setSync('Could not save on this device. Use Export backup.')}
}
function loadLocal(){
  try{var raw=localStorage.getItem(LS_KEY);if(raw){JSON.parse(raw).forEach(function(d){if(d&&d.id)quests.set(d.id,normalize(d,d.id))})}}catch(e){}
}
function exportData(){
  var payload={app:'sidequest-ledger',version:1,exported:new Date().toISOString(),quests:Array.from(quests.values())};
  var blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});
  var a=document.createElement('a');a.href=URL.createObjectURL(blob);
  a.download='sidequest-ledger-'+new Date().toISOString().slice(0,10)+'.json';
  document.body.appendChild(a);a.click();a.remove();setTimeout(function(){URL.revokeObjectURL(a.href)},1000);
}
function importData(file){
  if(!file)return;
  file.text().then(function(txt){
    var d=JSON.parse(txt), arr=Array.isArray(d)?d:d.quests, n=0;
    if(!Array.isArray(arr))throw new Error('bad');
    arr.forEach(function(q){if(q&&q.id&&q.title){quests.set(q.id,normalize(q,q.id));markUp(q.id);n++}});
    saveLocal();renderAll();flash('Imported '+plural(n,'quest')+'.');
  }).catch(function(){flash('That file is not a Sidequest backup.')});
}

/* ---------- cloud sync (Supabase) ----------
   Every change is saved in this browser first, then queued in `pending`
   and pushed to the quests table. The queue survives reloads and offline
   periods. After pushing, the app pulls the account's rows so other
   devices' changes show up. */
/* Why a "pending" queue instead of saving straight to the database:
   the app keeps working with a slow or missing connection, and many quick edits
   are sent together in one request instead of one request per keystroke or tick. */
function loadPending(){
  try{var p=JSON.parse(lsGet(LS_PENDING)||'null');if(p&&p.up&&p.del)pending=p}catch(e){}
}
function savePending(){lsSet(LS_PENDING,JSON.stringify(pending))}
function markUp(id){pending.up[id]=1;delete pending.del[id];savePending();schedulePush()}
function markDel(id){delete pending.up[id];pending.del[id]=1;savePending();schedulePush()}
function hasPending(){return Object.keys(pending.up).length>0||Object.keys(pending.del).length>0}
/* Wait 0.7s after the last change before sending, so a burst of edits becomes one save. */
function schedulePush(){
  if(!sb||!user)return;
  clearTimeout(pushTimer);
  pushTimer=setTimeout(function(){syncNow()},700);
}
/* flush(): send queued changes to the database. Returns true on success.
   The ids are taken off the queue BEFORE sending, so an edit made while the request
   is in flight is queued again instead of being wiped. If the request fails, they go
   back on the queue and are retried later. Always send the authenticated owner explicitly;
   relying on a database default is fragile and was the source of the RLS insert failure. */
async function flush(){
  if(!sb||!user)return false;
  if(flushing)return false;
  var up=Object.keys(pending.up), del=Object.keys(pending.del);
  if(!up.length&&!del.length)return true;
  flushing=true;
  up.forEach(function(id){delete pending.up[id]});
  del.forEach(function(id){delete pending.del[id]});
  savePending();
  try{
    var now=new Date().toISOString();
    var ownerId=user.id;
    var rows=up.filter(function(id){return quests.has(id)}).map(function(id){return {id:id,user_id:ownerId,data:quests.get(id),updated_at:now}});
    if(rows.length){var r1=await sb.from('quests').upsert(rows,{onConflict:'id'});if(r1.error)throw r1.error}
    if(del.length){var r2=await sb.from('quests').delete().eq('user_id',ownerId).in('id',del);if(r2.error)throw r2.error}
    flushing=false;
    return true;
  }catch(e){
    syncErrorMessage=(e&&e.message)||String(e)||'Unknown database error';
    up.forEach(function(id){pending.up[id]=1});
    del.forEach(function(id){pending.del[id]=1});
    savePending();
    flushing=false;
    return false;
  }
}
/* pull(): download this account's quests so changes from other devices appear here.
   Anything still waiting in `pending` is skipped, because the local version is newer.
   A quest missing from the database (and not pending) was deleted on another device,
   so it is removed here too. Returns true if something changed, so we only redraw when needed. */
async function pull(){
  var res=await sb.from('quests').select('id,data');
  if(res.error)throw res.error;
  var remote={}, changed=false;
  (res.data||[]).forEach(function(r){
    remote[r.id]=1;
    if(pending.up[r.id]||pending.del[r.id])return;
    var n=normalize(r.data||{},r.id), cur=quests.get(r.id);
    if(!cur||JSON.stringify(cur)!==JSON.stringify(n)){quests.set(r.id,n);changed=true}
  });
  Array.from(quests.keys()).forEach(function(id){
    if(!remote[id]&&!pending.up[id]){
      quests.delete(id);changed=true;
      if(openId===id){openId=null;view='list'}
    }
  });
  return changed;
}
/* syncNow(): the one sync routine. Order matters: push our changes first, then pull,
   otherwise pulling could overwrite edits that have not been uploaded yet.
   If we are offline it just retries after 20 seconds; nothing is lost because the
   data is still saved in the browser. */
async function syncNow(){
  if(!sb||!user||syncing)return;
  syncing=true;
  clearTimeout(retryTimer);
  setSync('Syncing…');
  var ok=false, changed=false;
  syncErrorMessage='';
  try{
    ok=await flush();
    if(ok){changed=await pull()}
  }catch(e){ok=false;syncErrorMessage=(e&&e.message)||String(e)||'Unknown database error'}
  syncing=false;
  if(!ok){
    setSync((syncErrorMessage?'Sync error: '+syncErrorMessage+'. ':'')+'Saved on this device; will retry.');
    retryTimer=setTimeout(function(){syncNow()},20000);
    return;
  }
  if(changed){saveLocal();renderAll()}
  setSync('Synced');
  if(hasPending())schedulePush();
}
