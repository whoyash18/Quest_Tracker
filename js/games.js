'use strict';
/* Year-based IGDB catalog. Requests go through a Supabase Edge Function so
   Twitch/IGDB application credentials never appear in browser code. */
var gamesYear=0, gamesOffset=0, gamesPageSize=24, gamesItems=[];
function initGamesCatalog(){
  var select=$('#gamesYear'), current=new Date().getFullYear();
  for(var y=current;y>=1970;y--){var o=document.createElement('option');o.value=String(y);o.textContent=String(y);select.appendChild(o)}
  gamesYear=current;
  select.addEventListener('change',function(){gamesYear=Number(this.value);gamesOffset=0;loadGamesCatalog()});
  $('#gamesPrev').addEventListener('click',function(){if(gamesOffset>=gamesPageSize){gamesOffset-=gamesPageSize;loadGamesCatalog()}});
  $('#gamesNext').addEventListener('click',function(){gamesOffset+=gamesPageSize;loadGamesCatalog()});
  $('#gamesGrid').addEventListener('click',function(e){
    var b=e.target.closest('[data-add-game]');if(!b)return;
    var g=gamesItems.find(function(x){return String(x.id)===b.getAttribute('data-add-game')});if(!g)return;
    addQuest({title:g.name,kind:'game',sub:String(g.year),img:g.image,skipLookup:true});
    b.disabled=true;b.textContent='Added to My List';
  });
}
function renderGamesCatalog(){
  var grid=$('#gamesGrid');
  if(!gamesItems.length){grid.innerHTML='<div class="catalog-empty">No games found for '+gamesYear+'. Try another year.</div>';return}
  grid.innerHTML=gamesItems.map(function(g){return '<article class="catalog-card">'+(g.image?'<img src="'+esc(g.image)+'" alt="" loading="lazy">':'<div class="catalog-card-art" aria-hidden="true">'+esc(g.name.slice(0,1))+'</div>')+'<div class="catalog-card-body"><h2 class="catalog-card-title">'+esc(g.name)+'</h2><p class="catalog-card-year">'+g.year+'</p><button class="btn primary small" type="button" data-add-game="'+esc(g.id)+'">Add to My List</button></div></article>'}).join('');
}
async function loadGamesCatalog(){
  var status=$('#gamesStatus');
  if(!user||!sb){status.textContent='Sign in to browse games.';return}
  status.textContent='Loading games for '+gamesYear+'…';
  $('#gamesPrev').disabled=gamesOffset===0;
  try{
    var result=await sb.functions.invoke('igdb-catalog',{body:{year:gamesYear,offset:gamesOffset,limit:gamesPageSize}});
    if(result.error)throw result.error;
    gamesItems=(result.data&&result.data.games)||[];
    renderGamesCatalog();
    status.textContent=gamesItems.length?'Showing games released in '+gamesYear+'.':'';
    $('#gamesNext').disabled=gamesItems.length<gamesPageSize;
  }catch(e){
    gamesItems=[];$('#gamesGrid').innerHTML='';
    status.textContent='The Games catalog is not connected yet. The secure IGDB function and its server-side credentials need to be configured in Supabase.';
    $('#gamesNext').disabled=true;
  }
}
initGamesCatalog();
