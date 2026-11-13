'use strict';
/* IGDB catalog browsing. IGDB credentials stay in the Supabase Edge Function. */
var gamesYear=0, gamesOffset=0, gamesPageSize=24, gamesItems=[], gamesMode='year';
function initGamesCatalog(){
  var select=$('#gamesYear'), current=new Date().getFullYear();
  for(var y=current;y>=1970;y--){var o=document.createElement('option');o.value=String(y);o.textContent=String(y);select.appendChild(o)}
  gamesYear=current;
  $('#gamesMode').addEventListener('change',function(){gamesMode=this.value;select.hidden=gamesMode!=='year';gamesOffset=0;loadGamesCatalog()});
  select.addEventListener('change',function(){gamesYear=Number(this.value);gamesOffset=0;loadGamesCatalog()});
  $('#gamesSearchOpenBtn').addEventListener('click',function(){openSearch('game')});
  $('#gamesPrev').addEventListener('click',function(){if(gamesOffset>=gamesPageSize){gamesOffset-=gamesPageSize;loadGamesCatalog()}});
  $('#gamesNext').addEventListener('click',function(){gamesOffset+=gamesPageSize;loadGamesCatalog()});
  $('#gamesGrid').addEventListener('click',function(e){
    var b=e.target.closest('[data-game-action]');if(!b)return;
    var g=gamesItems.find(function(x){return String(x.id)===b.getAttribute('data-game-action')});if(!g)return;
    addCatalogGame(g,b.getAttribute('data-completed')==='true');
    renderGamesCatalog();
  });
}
function gameQuest(g){
  var found=null;quests.forEach(function(q){if(!found&&((q.src==='igdb'&&String(q.srcId)===String(g.id))||norm(q.title)===norm(g.name)))found=q});
  return found;
}
function addCatalogGame(g,completed){
  var existing=gameQuest(g);
  if(existing){
    if(completed&&existing.status!=='done')mutate(existing.id,function(q){q.status='done';q.completed=Date.now()},{completed:true});
    openId=existing.id;tab=completed||existing.status==='done'?'done':'active';filter='all';view='list';renderAll();
    if(completed){goHome();flash('Added to History as completed.')}else flash(existing.status==='done'?'This game is already in History.':'This game is already on My List.');
    return;
  }
  addQuest({title:g.name,kind:'game',sub:String(g.year||gamesYear||''),img:g.image,src:'igdb',srcId:String(g.id),url:g.slug?'https://www.igdb.com/games/'+enc(g.slug):null,verified:true,skipLookup:true,status:completed?'done':'active'});
  if(!completed)flash('Added to My List.');
  if(completed){var added=gameQuest(g);if(added){tab='done';openId=added.id;view='list';renderAll()}goHome();flash('Added to History as completed.');}
}
function gameActionHtml(g){
  var q=gameQuest(g), addLabel=q&&q.status==='active'?'On My List':(q&&q.status==='done'?'In History':'Add to My List');
  var doneLabel=q&&q.status==='done'?'Completed':(q&&q.status==='active'?'Mark completed':'Completed');
  return '<div class="catalog-card-actions"><button class="btn primary small" type="button" data-game-action="'+esc(g.id)+'"'+(q&&q.status==='active'?' disabled':'')+'>'+addLabel+'</button><button class="btn quiet small" type="button" data-game-action="'+esc(g.id)+'" data-completed="true"'+(q&&q.status==='done'?' disabled':'')+'>'+doneLabel+'</button></div>';
}
function renderGamesCatalog(){
  var grid=$('#gamesGrid');
  if(!gamesItems.length){grid.innerHTML='<div class="catalog-empty">No games found. Try another search or browse option.</div>';return}
  grid.innerHTML=gamesItems.map(function(g){return '<article class="catalog-card">'+(g.image?'<img src="'+esc(g.image)+'" alt="" loading="lazy">':'<div class="catalog-card-art" aria-hidden="true">'+esc(g.name.slice(0,1))+'</div>')+'<div class="catalog-card-body"><h2 class="catalog-card-title">'+esc(g.name)+'</h2><p class="catalog-card-year">'+esc(g.year||'Release year unknown')+(g.rating?' · ★ '+Number(g.rating).toFixed(0)+'%':'')+'</p>'+gameActionHtml(g)+'</div></article>'}).join('');
}
function loadGamesCatalog(){
  var status=$('#gamesStatus');
  if(!user||!sb){status.textContent='Sign in to browse games.';return}
  status.textContent=gamesMode==='year'?'Loading games released in '+gamesYear+'…':'Loading '+(gamesMode==='popular'?'popular':'top-rated')+' games…';
  $('#gamesPrev').disabled=gamesOffset===0;
  $('#gamesNext').disabled=true;
  sb.functions.invoke('igdb-catalog',{body:{mode:gamesMode,year:gamesYear,offset:gamesOffset,limit:gamesPageSize}}).then(function(result){
    if(result.error)throw result.error;
    gamesItems=(result.data&&result.data.games)||[];
    renderGamesCatalog();
    status.textContent=gamesItems.length?(gamesMode==='year'?'Showing games released in '+gamesYear+'.':gamesMode==='popular'?'Popular games across PC and consoles.':'Top-rated games across PC and consoles.'):'No games found for this selection.';
    $('#gamesPrev').disabled=gamesOffset===0;
    $('#gamesNext').disabled=gamesItems.length<gamesPageSize;
  }).catch(function(){
    gamesItems=[];$('#gamesGrid').innerHTML='';
    status.textContent='Could not load the IGDB catalog. Check your connection and Supabase function logs.';
    $('#gamesNext').disabled=true;
  });
}
initGamesCatalog();
