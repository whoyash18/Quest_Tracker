'use strict';
/* Rendering, event handlers, and responsive navigation. */
/* ---------- rendering ---------- */
function progress(q){
  var n=q.highlights.length;if(!n)return null;
  var d=q.highlights.filter(function(h){return h.done}).length;
  return {d:d,n:n,pct:Math.round(d/n*100)};
}
function lastAct(q){var m=q.created;q.updates.forEach(function(u){if(u.ts>m)m=u.ts});return m}
function visibleQuests(){
  var arr=Array.from(quests.values()).filter(function(q){return (tab==='active')===(q.status!=='done')}).filter(function(q){return filter==='all'||q.kind===filter});
  arr.sort(function(a,b){return tab==='active'?lastAct(b)-lastAct(a):(b.completed||0)-(a.completed||0)});
  return arr;
}
function renderHud(){
  var xp=totalXp(), L=levelInfo(xp);
  $('#lvNum').textContent=L.n;$('#rank').textContent=rankName(L.n);
  $('#xpFill').style.width=L.pct+'%';$('#xpBar').setAttribute('aria-valuenow',L.pct);
  $('#xpNow').textContent=xp+' XP';$('#xpNext').textContent=(L.next-xp)+' XP to level '+(L.n+1);
  var done=0,ups=0;quests.forEach(function(q){if(q.status==='done')done++;ups+=q.updates.length});
  $('#tally').innerHTML='<span><b>'+done+'</b> quests completed</span><span><b>'+ups+'</b> updates logged</span><span><b>'+(quests.size-done)+'</b> in progress</span>';
}
function renderSeg(){
  $('#seg').innerHTML=SEG.map(function(k){return '<button type="button" role="radio" aria-checked="'+(k===addKind)+'" data-act="seg" data-k="'+k+'">'+SEG_LABEL[k]+'</button>'}).join('');
}
function renderTabs(){
  var a=0,d=0;quests.forEach(function(q){if(q.status==='done')d++;else a++});
  $('#tabs').innerHTML='<button type="button" role="tab" aria-selected="'+(tab==='active')+'" data-act="tab" data-t="active">Active<span class="n">'+a+'</span></button><button type="button" role="tab" aria-selected="'+(tab==='done')+'" data-act="tab" data-t="done">History<span class="n">'+d+'</span></button>';
  var f=['all','movie','game','place','task'];
  $('#chips').innerHTML=f.map(function(k){return '<button type="button" aria-pressed="'+(k===filter)+'" data-act="filter" data-k="'+k+'">'+(k==='all'?'All':SEG_LABEL[k])+'</button>'}).join('');
}
function rowHtml(q){
  var p=progress(q), sub;
  if(q.status==='done')sub='<span class="row-p"><span>Completed '+fmtDate(q.completed||q.created)+'</span></span>';
  else if(p)sub='<span class="row-p"><span class="bar teal thin"><i style="width:'+p.pct+'%"></i></span><span>'+p.d+'/'+p.n+'</span></span>';
  else sub='<span class="row-p"><span>'+(q.updates.length?plural(q.updates.length,'update'):'Not started')+'</span></span>';
  return '<button type="button" class="row'+(q.id===openId?' on':'')+'" data-act="open" data-id="'+q.id+'">'+thumb(q)+'<span class="row-b"><span class="row-t">'+esc(q.title)+'</span><span class="row-s">'+KINDS[q.kind]+(q.sub?' · '+esc(q.sub):'')+'</span>'+sub+'</span><span class="xpchip mono">'+qXp(q)+' XP</span></button>';
}
function ghostHtml(){
  var g={id:'ghost',title:'Interstellar',kind:'movie'};
  return '<div class="ghost"><span class="tagx">EXAMPLE</span><div class="row">'+thumb(g)+'<span class="row-b"><span class="row-t">Interstellar</span><span class="row-s">Movie · 2014 · Christopher Nolan</span><span class="row-p"><span class="bar teal thin"><i style="width:50%"></i></span><span>2/4</span></span></span><span class="xpchip mono">35 XP</span></div></div>';
}
function renderList(){
  var el=$('#list'), arr=visibleQuests();
  if(!arr.length){
    if(tab==='done'){el.innerHTML='<div class="empty"><h3>Nothing finished yet</h3><p class="note" style="margin:0">Complete a quest and it lands here with the date and the XP it earned.</p></div>';return}
    var anyActive=Array.from(quests.values()).some(function(q){return q.status!=='done'});
    if(anyActive){el.innerHTML='<div class="empty"><p class="note" style="margin:0">No active quests of this type.</p></div>';return}
    el.innerHTML='<div class="empty"><h3>Your ledger is empty</h3><p style="margin:0">Add something above. Each update you log earns XP, and finishing it earns more.</p>'+ghostHtml()+'<div class="starters">'+STARTERS.map(function(s){return '<button type="button" class="btn quiet" data-act="starter" data-t="'+esc(s.t)+'" data-k="'+s.k+'">'+kindIcon(s.k,16)+esc(s.t)+'</button>'}).join('')+'</div></div>';
    return;
  }
  var html='',lastMonth='';
  arr.forEach(function(q){
    if(tab==='done'){
      var m=new Date(q.completed||q.created).toLocaleDateString(undefined,{month:'long',year:'numeric'});
      if(m!==lastMonth){html+='<div class="month">'+esc(m)+'</div>';lastMonth=m}
    }
    html+=rowHtml(q);
  });
  el.innerHTML=html;
}
function stepsLabel(k){return k==='place'?'Places to see':(k==='game'?'Milestones':'Steps')}
function detailHtml(q){
  var st=detailState[q.id], active=q.status!=='done', p=progress(q), h='';
  h+='<button type="button" class="btn quiet only-narrow" data-act="back" style="justify-self:start">← All quests</button>';
  h+='<div class="d-head">'+thumb(q,true)+'<div class="d-meta"><h2>'+esc(q.title)+'</h2><div class="d-sub">'+KINDS[q.kind]+(q.sub?' · '+esc(q.sub):'')+'</div>';
  h+=q.kind==='task'&&!q.auto?'<span class="badge">Your own task</span>':(q.verified?'<span class="badge ok">✓ Matched on '+(SRC_LABEL[q.src]||'the web')+'</span>':'<span class="badge">Custom entry</span>');
  if(active){
    h+='<div class="effort" role="group" aria-label="Effort">'+Object.keys(EFFORT).map(function(k){return '<button type="button" data-act="effort" data-e="'+k+'" aria-pressed="'+(q.effort===k)+'">'+EFFORT_LABEL[k]+'<span>'+EFFORT[k]+' XP</span></button>'}).join('')+'</div>';
  }else h+='<span class="badge">'+EFFORT_LABEL[q.effort]+' · '+EFFORT[q.effort]+' XP on completion</span>';
  h+='</div></div>';

  if(q.kind!=='task'||q.auto){
    h+='<div class="sec">';
    if(st==='loading')h+='<div class="skel" style="width:92%"></div><div class="skel" style="width:78%"></div><div class="skel" style="width:60%"></div><p class="note">Looking this up…</p>';
    else if(q.blurb)h+='<p class="blurb">'+esc(q.blurb)+'</p>';
    else h+='<p class="note">No details yet.</p>';
    if(st==='error')h+='<p class="note err">Could not reach the data source. Check your connection and try again.</p>';
    if(st==='none')h+='<p class="note">No exact match found. It stays a custom entry. You can pick the closest result instead.</p>';
    if(st!=='loading')h+='<button type="button" class="btn quiet small" data-act="details" style="margin-top:8px">'+(q.src?'Refresh details':'Find details')+'</button>';
    if(q.facts.length)h+='<dl class="facts">'+q.facts.map(function(f){return '<dt>'+esc(f.k)+'</dt><dd>'+esc(f.v)+'</dd>'}).join('')+'</dl>';
    var u=safeUrl(q.url);if(u)h+='<p class="note" style="margin-top:10px"><a href="'+esc(u)+'" target="_blank" rel="noopener">Read more on '+(SRC_LABEL[q.src]||'the web')+' ↗</a></p>';
    h+='</div>';
  }

  h+='<div class="sec"><h3>'+stepsLabel(q.kind)+(p?' · '+p.d+'/'+p.n:'')+'</h3>';
  if(p)h+='<div class="bar teal thin" style="margin-bottom:8px"><i style="width:'+p.pct+'%"></i></div>';
  if(q.highlights.length)h+='<ul class="steps">'+q.highlights.map(function(s,i){return '<li class="'+(s.done?'done':'')+'"><input type="checkbox" id="st'+i+'" data-act="step" data-i="'+i+'"'+(s.done?' checked':'')+'><label for="st'+i+'">'+esc(s.t)+'</label></li>'}).join('')+'</ul>';
  else h+='<p class="note">Break it into steps to see progress. Each step you tick is +'+STEP_XP+' XP.</p>';
  h+='<form class="addstep" data-form="step"><input id="stepInput" type="text" placeholder="Add a step" aria-label="Add a step" value="'+esc(stepDrafts[q.id]||'')+'"><button class="btn" type="submit">Add</button></form></div>';

  h+='<div class="sec"><h3>Updates · '+q.updates.length+'</h3>';
  h+='<textarea id="updText" placeholder="What did you do or find out? e.g. Finished act two, the soundtrack is wild." aria-label="Progress update">'+esc(drafts[q.id]||'')+'</textarea>';
  h+='<div class="post-row"><span class="note">'+(q.updates.length<UPDATE_CAP?'+'+UPDATE_XP+' XP per update, up to '+UPDATE_CAP+' per quest':'XP for updates is capped on this quest')+'</span><button type="button" class="btn primary" data-act="post">Post update</button></div>';
  if(q.updates.length)h+='<ul class="timeline">'+q.updates.slice().reverse().map(function(u){return '<li><time>'+fmtStamp(u.ts)+'</time><p>'+esc(u.t)+'</p></li>'}).join('')+'</ul>';
  h+='</div>';

  h+='<div class="sec"><h3>Cover</h3><div class="cover-tools"><label for="coverFile">Use your own image</label><input type="file" id="coverFile" accept="image/*">'+(q.cover?'<button type="button" class="btn quiet small" data-act="cover-remove">Remove image</button>':'')+'</div></div>';

  h+='<div class="actions">';
  if(active)h+='<button type="button" class="btn gold" data-act="complete">Complete quest · +'+EFFORT[q.effort]+' XP</button>';
  else h+='<span class="note">Completed '+fmtDate(q.completed||q.created)+'</span><button type="button" class="btn quiet" data-act="reopen">Reopen</button>';
  h+='<button type="button" class="btn quiet danger" data-act="delete">'+(confirmDel===q.id?'Click again to delete':'Delete')+'</button></div>';
  return h;
}
function renderDetail(){
  var el=$('#detail'), q=openId&&quests.get(openId);
  var ae=document.activeElement, aid=ae&&ae.id, ss=ae&&ae.selectionStart, se=ae&&ae.selectionEnd;
  if(!q){
    el.hidden=true;
    el.innerHTML='<div class="empty"><h3>Pick a quest</h3><p style="margin:0">Details, steps and your update log show up here.</p></div>';
    $('#split').setAttribute('data-view','list');return;
  }
  el.hidden=false;
  el.innerHTML='<div class="panel">'+detailHtml(q)+'</div>';
  $('#split').setAttribute('data-view',view);
  if(aid){var n=document.getElementById(aid);if(n){n.focus();try{if(ss!=null)n.setSelectionRange(ss,se)}catch(e){}}}
}
function renderAc(){
  var ul=$('#acList'), inp=$('#addInput'), typed=inp.value.trim();
  if(!ac.open||!typed||addKind==='task'){ul.hidden=true;inp.setAttribute('aria-expanded','false');return}
  var h='';
  if(ac.status==='loading')h+='<li class="state" role="presentation">Searching…</li>';
  ac.items.forEach(function(it,i){
    h+='<li class="ac-row" role="presentation"><button type="button" role="option" class="ac-option" id="ac'+i+'" data-act="pick" data-i="'+i+'" tabindex="-1" aria-selected="'+(i===ac.index)+'">'+thumb({id:'s'+i,title:it.title,kind:it.kind,img:it.img},false,true)+'<span class="grow"><span class="t">'+esc(it.title)+'</span><span class="s">'+KINDS[it.kind]+(it.sub?' · '+esc(it.sub):'')+'</span></span><span class="btn quiet small ac-add">Add to My List</span></button></li>';
  });
  var cu=ac.items.length;
  if(ac.status==='none')h+='<li class="state" role="presentation">No match found.</li>';
  if(ac.status==='error')h+='<li class="state" role="presentation">Could not reach the search sources.</li>';
  h+='<li class="ac-row" role="presentation"><button type="button" role="option" class="ac-option" id="ac'+cu+'" data-act="pick" data-i="'+cu+'" tabindex="-1" aria-selected="'+(ac.index===cu)+'"><span class="grow"><span class="t">Add “'+esc(typed)+'” as typed</span><span class="s">Custom entry</span></span><span class="btn quiet small ac-add">Add to My List</span></button></li>';
  ul.innerHTML=h;ul.hidden=false;inp.setAttribute('aria-expanded','true');
  inp.setAttribute('aria-activedescendant',ac.index>=0?'ac'+ac.index:'');
}
function closeAc(){ac.open=false;ac.items=[];ac.index=-1;ac.status='';if(acCtl)acCtl.abort();clearTimeout(acTimer);renderAc()}
function renderAll(){renderHud();renderTabs();renderList();renderDetail()}

/* ---------- celebration ---------- */
var celReturn=null;
function showCelebrate(o){
  var L0=levelInfo(o.before), L1=levelInfo(o.after), up=L1.n>L0.n, gain=o.after-o.before;
  $('#celKicker').textContent=o.type==='complete'?(up?'Quest complete · level up':'Quest complete'):'Level up';
  $('#celTitle').textContent=o.type==='complete'?o.title:'Level '+L1.n;
  var lv=$('#celLv');lv.className='cel-lv'+(up?' up':'');lv.textContent='Level '+L1.n+' · '+rankName(L1.n);
  $('#celMeta').textContent=(o.type==='complete'&&o.q?plural(o.q.updates.length,'update')+' logged · ':'')+(L1.next-o.after)+' XP to level '+(L1.n+1);
  var bar=$('#celBar');bar.style.transition='none';bar.style.width=(up?0:L0.pct)+'%';
  var xpEl=$('#celXp');xpEl.textContent='+0';
  celReturn=document.activeElement;
  $('#celebrate').hidden=false;$('#celBtn').focus();
  void bar.offsetWidth;bar.style.transition='';
  requestAnimationFrame(function(){bar.style.width=L1.pct+'%'});
  var reduce=window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches;
  if(reduce||gain<=0){xpEl.textContent='+'+gain;return}
  var t0=performance.now();
  (function tick(t){var k=Math.min(1,(t-t0)/700);xpEl.textContent='+'+Math.round(gain*k);if(k<1)requestAnimationFrame(tick)})(t0);
}
function closeCelebrate(){$('#celebrate').hidden=true;if(celReturn&&celReturn.focus)celReturn.focus()}

/* ---------- own cover upload ---------- */
async function handleCover(file){
  if(!file||!openId)return;
  try{
    var bmp=await createImageBitmap(file), W=270, H=360, c=document.createElement('canvas');
    c.width=W;c.height=H;var x=c.getContext('2d'), s=Math.max(W/bmp.width,H/bmp.height), w=bmp.width*s, h=bmp.height*s;
    x.drawImage(bmp,(W-w)/2,(H-h)/2,w,h);
    var url=c.toDataURL('image/jpeg',0.82);
    mutate(openId,function(q){q.cover=url});
  }catch(e){flash('Could not read that image. Try a JPEG or PNG.')}
}

/* ---------- events ---------- */
function pickAc(i){
  var typed=$('#addInput').value.trim();
  if(i>=0&&i<ac.items.length){
    var it=ac.items[i];
    addQuest({title:it.title,sub:it.sub,kind:it.kind,verified:true,src:it.src,srcId:it.srcId,img:it.img,url:it.url});
    closeSearch();
  }else addCustom(typed);
}
function addCustom(typed){
  if(!typed)return;
  if(addKind==='auto')addQuest({title:typed,kind:'task',auto:true});
  else addQuest({title:typed,kind:addKind});
  closeSearch();
}
function postUpdate(){
  var ta=$('#updText');if(!ta||!openId)return;
  var t=ta.value.trim();if(!t)return;
  drafts[openId]='';
  mutate(openId,function(q){q.updates.push({t:t.slice(0,1000),ts:Date.now()})});
}
var searchReturn=null, searchOldOverflow='';
function openSearch(){
  if(!$('#searchOverlay').hidden)return;
  searchReturn=document.activeElement;searchOldOverflow=document.body.style.overflow;
  $('#searchOverlay').hidden=false;$('#searchOpenBtn').setAttribute('aria-expanded','true');
  document.body.style.overflow='hidden';
  window.setTimeout(function(){$('#addInput').focus()},0);
}
function closeSearch(){
  if($('#searchOverlay').hidden)return;
  closeAc();$('#searchOverlay').hidden=true;$('#searchOpenBtn').setAttribute('aria-expanded','false');
  document.body.style.overflow=searchOldOverflow;
  if(searchReturn&&searchReturn.focus)searchReturn.focus();
  searchReturn=null;
}
$('#searchOpenBtn').addEventListener('click',openSearch);
$('#searchCloseBtn').addEventListener('click',closeSearch);
document.addEventListener('click',function(e){
  var t=e.target.closest('[data-act]');
  if(e.target.closest('[data-search-close]')){closeSearch();return}
  if(!t){if(!e.target.closest('.field'))closeAc();return}
  var a=t.getAttribute('data-act'), id=t.getAttribute('data-id');
  if(a==='seg'){addKind=t.getAttribute('data-k');renderSeg();$('#addInput').placeholder=PLACEHOLDER[addKind];closeAc();
    var v=$('#addInput').value.trim();if(v.length>=2&&addKind!=='task'){ac.open=true;suggest(v)}}
  else if(a==='tab'){tab=t.getAttribute('data-t');view='list';renderTabs();renderList();renderDetail()}
  else if(a==='filter'){filter=t.getAttribute('data-k');renderTabs();renderList()}
  else if(a==='open'){openId=id;view='detail';confirmDel=null;renderList();renderDetail();window.scrollTo(0,0)}
  else if(a==='back'){view='list';renderDetail()}
  else if(a==='pick'){pickAc(+t.getAttribute('data-i'))}
  else if(a==='starter'){addKind=t.getAttribute('data-k');renderSeg();var inp=$('#addInput');inp.placeholder=PLACEHOLDER[addKind];inp.value=t.getAttribute('data-t');openSearch();inp.focus();
    if(addKind!=='task'){ac.open=true;suggest(inp.value.trim())}}
  else if(a==='post'){postUpdate()}
  else if(a==='step'){var i=+t.getAttribute('data-i');mutate(openId,function(q){if(q.highlights[i])q.highlights[i].done=!q.highlights[i].done})}
  else if(a==='effort'){var ef=t.getAttribute('data-e');mutate(openId,function(q){q.effort=ef;q.effortSet=true})}
  else if(a==='complete'){mutate(openId,function(q){q.status='done';q.completed=Date.now()},{completed:true})}
  else if(a==='reopen'){mutate(openId,function(q){q.status='active';q.completed=null})}
  else if(a==='details'){var cq=quests.get(openId);if(cq){if(cq.src)loadDetails(openId);else lookupBest(openId,true)}}
  else if(a==='cover-remove'){mutate(openId,function(q){q.cover=null})}
  else if(a==='delete'){
    if(confirmDel===openId){var did=openId;quests.delete(did);saveLocal();markDel(did);openId=null;view='list';confirmDel=null;renderAll()}
    else{confirmDel=openId;clearTimeout(confirmTimer);confirmTimer=setTimeout(function(){confirmDel=null;renderDetail()},4000);renderDetail()}
  }
});
document.addEventListener('submit',function(e){
  var f=e.target.closest('[data-form="step"]');if(!f)return;
  e.preventDefault();
  var inp=$('#stepInput'), t=inp.value.trim();if(!t||!openId)return;
  stepDrafts[openId]='';
  mutate(openId,function(q){q.highlights.push({t:t.slice(0,140),done:false})});
});
document.addEventListener('input',function(e){
  if(e.target.id==='updText'&&openId)drafts[openId]=e.target.value;
  if(e.target.id==='stepInput'&&openId)stepDrafts[openId]=e.target.value;
});
document.addEventListener('change',function(e){
  if(e.target.id==='coverFile'){handleCover(e.target.files&&e.target.files[0]);e.target.value=''}
  if(e.target.id==='importFile'){importData(e.target.files&&e.target.files[0]);e.target.value=''}
});
document.addEventListener('keydown',function(e){
  if(e.target.id==='updText'&&e.key==='Enter'&&(e.metaKey||e.ctrlKey)){e.preventDefault();postUpdate()}
  if(e.key==='Escape'){if(!$('#celebrate').hidden)closeCelebrate();else if(!$('#searchOverlay').hidden)closeSearch();else if($('#drawer').classList.contains('open'))closeDrawer();else closeAc()}
  if(e.key==='Tab'&&!$('#searchOverlay').hidden){
    var focusable=Array.prototype.slice.call($('#searchOverlay').querySelectorAll('button:not([disabled]),input:not([disabled])'));
    if(!focusable.length)return;
    var first=focusable[0],last=focusable[focusable.length-1];
    if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}
    else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}
  }
});
$('#celBtn').addEventListener('click',closeCelebrate);
$('#celebrate').addEventListener('click',function(e){if(e.target===this)closeCelebrate()});
$('#exportBtn').addEventListener('click',exportData);
/* Sign-in page wiring: form submit, the Sign in / Create account tabs, the Forgot password
   link (its meaning changes per mode: forgot / back / skip), and the show-password tick box. */
$('#loginForm').addEventListener('submit',submitAuth);
$('#authTabs').addEventListener('click',function(e){var b=e.target.closest('[data-auth]');if(b)setAuthMode(b.getAttribute('data-auth'))});
$('#forgotBtn').addEventListener('click',function(){
  if(authMode==='signin')setAuthMode('forgot');
  else if(authMode==='reset')leaveReset();
  else setAuthMode('signin');
});
$('#showPw').addEventListener('change',function(){
  var t=this.checked?'text':'password';$('#loginPass').type=t;$('#loginPass2').type=t;
});
$('#addBtn').addEventListener('click',function(){
  var v=$('#addInput').value.trim();
  if(ac.index>=0&&ac.open)pickAc(ac.index);else addCustom(v);
});
$('#acList').addEventListener('mousedown',function(e){e.preventDefault()});
var addInput=$('#addInput');
addInput.addEventListener('input',function(){
  var v=addInput.value.trim();clearTimeout(acTimer);ac.index=-1;
  if(v.length<2||addKind==='task'){closeAc();return}
  ac.open=true;ac.status='loading';ac.items=[];renderAc();
  acTimer=setTimeout(function(){suggest(v)},350);
});
addInput.addEventListener('keydown',function(e){
  var total=ac.items.length+1;
  if(e.key==='ArrowDown'&&ac.open){e.preventDefault();ac.index=(ac.index+1)%total;renderAc()}
  else if(e.key==='ArrowUp'&&ac.open){e.preventDefault();ac.index=ac.index<=0?total-1:ac.index-1;renderAc()}
  else if(e.key==='Enter'){e.preventDefault();if(ac.open&&ac.index>=0)pickAc(ac.index);else addCustom(addInput.value.trim())}
});
addInput.addEventListener('blur',function(){setTimeout(function(){if(document.activeElement!==addInput){ac.open=false;renderAc()}},120)});
addInput.addEventListener('focus',function(){if(addInput.value.trim().length>=2&&addKind!=='task'&&(ac.items.length||ac.status)){ac.open=true;renderAc()}});
/* pick up changes from other devices when you come back to this tab */
document.addEventListener('visibilitychange',function(){if(document.visibilityState==='visible'&&user)syncNow()});
window.addEventListener('online',function(){if(user)syncNow()});
