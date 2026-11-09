'use strict';
/* Quest editing, external data sources, and autocomplete. */
/* ---------- changing quests ---------- */
/* mutate(): every edit goes through here. It saves in the browser (instant), then calls
   markUp(id) to queue the quest for the database. Because all edits share this one path,
   syncing could be added without touching the many individual buttons. */
function mutate(id,fn,opts){
  var cur=quests.get(id);if(!cur)return;
  var before=totalXp(), q=clone(cur);fn(q);quests.set(id,q);
  var after=totalXp();saveLocal();markUp(id);renderAll();
  feedback(before,after,opts?{completed:opts.completed,q:q}:null);
}
function addQuest(p){
  var title=String(p.title||'').trim();if(!title)return;
  var dup=null;quests.forEach(function(q){if(q.status!=='done'&&q.title.toLowerCase()===title.toLowerCase())dup=q});
  if(dup){openId=dup.id;tab='active';filter='all';$('#addInput').value='';closeAc();renderAll();flash('Already on your list.');return}
  var id='q'+Date.now().toString(36)+Math.random().toString(36).slice(2,6);
  var q=normalize({title:title,sub:p.sub||'',kind:p.kind||'task',auto:!!p.auto,verified:!!p.verified,src:p.src||'',srcId:p.srcId||'',img:safeImg(p.img),url:safeUrl(p.url),status:'active',created:Date.now(),updates:[],highlights:[],facts:[],effort:'standard',cover:null,blurb:''},id);
  quests.set(id,q);saveLocal();markUp(id);openId=id;tab='active';filter='all';
  $('#addInput').value='';closeAc();renderAll();
  if(q.src)loadDetails(id);
  else if(q.kind!=='task'||q.auto)lookupBest(id,false);
}
function feedback(before,after,o){
  var lb=levelInfo(before).n, la=levelInfo(after).n;
  if(o&&o.completed&&after>before){showCelebrate({type:'complete',title:o.q.title,before:before,after:after,q:o.q})}
  else if(la>lb){showCelebrate({type:'level',title:'Level up',before:before,after:after})}
  else if(after>before){floatXp(after-before)}
}
function floatXp(n){
  var el=document.createElement('span');el.className='float-xp';el.textContent='+'+n+' XP';
  $('#score').appendChild(el);setTimeout(function(){el.remove()},1500);
}

/* ---------- data sources: TMDB, RAWG, Wikipedia, Wikivoyage ---------- */
var WIKI='https://en.wikipedia.org/w/api.php?action=query&format=json&origin=*&redirects=1';
async function wikiSearch(q,o){
  var url=WIKI+'&prop=pageimages%7Cdescription&piprop=thumbnail&pithumbsize=400'+(o.prefix?'&generator=prefixsearch&gpssearch='+enc(q)+'&gpslimit=8':'&generator=search&gsrsearch='+enc(q)+'&gsrlimit=8');
  var d=await jget(url,o.sig);
  var pages=Object.values((d.query&&d.query.pages)||{}).sort(function(a,b){return (a.index||0)-(b.index||0)});
  return pages.map(function(p){return {title:p.title,sub:p.description||'',img:p.thumbnail?p.thumbnail.source:null,src:'wiki',srcId:p.title,url:'https://en.wikipedia.org/wiki/'+enc(p.title.replace(/ /g,'_'))}});
}
async function searchMovies(q,sig){
  if(TMDB_KEY){
    var d=await jget('https://api.themoviedb.org/3/search/movie?include_adult=false&api_key='+enc(TMDB_KEY)+'&query='+enc(q),sig);
    return (d.results||[]).slice(0,6).map(function(m){return {kind:'movie',title:m.title,sub:(m.release_date||'').slice(0,4),img:m.poster_path?'https://image.tmdb.org/t/p/w342'+m.poster_path:null,src:'tmdb',srcId:String(m.id),url:'https://www.themoviedb.org/movie/'+m.id}});
  }
  var r=await wikiSearch(q+' film',{sig:sig});
  return r.filter(function(x){return /film/i.test(x.sub)}).map(function(x){x.kind='movie';return x});
}
async function searchGames(q,sig){
  if(RAWG_KEY){
    var d=await jget('https://api.rawg.io/api/games?key='+enc(RAWG_KEY)+'&page_size=6&search='+enc(q),sig);
    return (d.results||[]).slice(0,6).map(function(g){
      var yr=(g.released||'').slice(0,4), gen=(g.genres&&g.genres[0])?g.genres[0].name:'';
      return {kind:'game',title:g.name,sub:[yr,gen].filter(Boolean).join(' · '),img:g.background_image||null,src:'rawg',srcId:String(g.id),url:g.slug?'https://rawg.io/games/'+g.slug:null};
    });
  }
  var r=await wikiSearch(q+' video game',{sig:sig});
  return r.filter(function(x){return /video game/i.test(x.sub)}).map(function(x){x.kind='game';return x});
}
async function searchPlaces(q,sig){
  var a=await wikiSearch(q,{prefix:true,sig:sig}), keep=function(x){return PLACE_RE.test(x.sub)&&!NOT_PLACE_RE.test(x.sub)};
  var out=a.filter(keep);
  if(out.length<3){
    try{var b=await wikiSearch(q,{sig:sig});b.filter(keep).forEach(function(x){if(!out.some(function(y){return y.title===x.title}))out.push(x)})}catch(e){if(e&&e.name==='AbortError')throw e}
  }
  return out.slice(0,6).map(function(x){x.kind='place';return x});
}
async function searchAll(q,kind,sig){
  var jobs=kind==='movie'?[searchMovies]:kind==='game'?[searchGames]:kind==='place'?[searchPlaces]:[searchMovies,searchGames,searchPlaces];
  var res=await Promise.allSettled(jobs.map(function(f){return f(q,sig)}));
  if(sig&&sig.aborted){var e=new Error('aborted');e.name='AbortError';throw e}
  var ok=res.filter(function(r){return r.status==='fulfilled'});
  if(!ok.length)throw new Error('all sources failed');
  var lists=ok.map(function(r){return r.value});
  if(kind==='auto')lists=lists.map(function(l){return l.slice(0,3)});
  return [].concat.apply([],lists).slice(0,8);
}
async function voyageSights(title){
  try{
    var d=await jget('https://en.wikivoyage.org/w/api.php?action=parse&format=json&origin=*&redirects=1&prop=wikitext&page='+enc(title));
    var wt=(d.parse&&d.parse.wikitext&&d.parse.wikitext['*'])||'';
    var m=wt.match(/\n==\s*See\s*==[ \t]*\n([\s\S]*?)(?=\n==[^=]|$)/);
    if(!m)return [];
    var sec=m[1], names=[], x;
    var re=/\|\s*name\s*=\s*([^|\n}]+)/g;
    while((x=re.exec(sec)))names.push(x[1]);
    if(!names.length){var re2=/^\*+\s*'*\[\[([^\]|#]+)(?:\|([^\]]+))?\]\]/gm;while((x=re2.exec(sec)))names.push(x[2]||x[1])}
    var seen={}, out=[];
    names.forEach(function(n){n=n.replace(/\[\[|\]\]|'''?|<[^>]+>/g,'').replace(/\s+/g,' ').trim();var k=n.toLowerCase();if(n&&!seen[k]){seen[k]=1;out.push(n)}});
    return out.slice(0,7);
  }catch(e){return []}
}
async function fetchDetails(q){
  if(q.src==='tmdb'){
    var d=await jget('https://api.themoviedb.org/3/movie/'+enc(q.srcId)+'?append_to_response=credits&api_key='+enc(TMDB_KEY));
    var crew=(d.credits&&d.credits.crew)||[], cast=(d.credits&&d.credits.cast)||[];
    var dir=crew.filter(function(c){return c.job==='Director'}).map(function(c){return c.name}).slice(0,2).join(', ');
    var lead=cast.slice(0,3).map(function(c){return c.name}).join(', ');
    var gen=(d.genres||[]).map(function(g){return g.name}).slice(0,3).join(', ');
    var rt=d.runtime||0;
    return {
      sub:[(d.release_date||'').slice(0,4),dir].filter(Boolean).join(' · '),
      blurb:trimText(d.overview,420),
      facts:[dir&&{k:'Director',v:dir},rt&&{k:'Runtime',v:Math.floor(rt/60)+'h '+(rt%60)+'m'},gen&&{k:'Genre',v:gen},lead&&{k:'Lead cast',v:lead}].filter(Boolean),
      highlights:[],effort:(rt&&rt<=110)?'quick':'standard',
      img:d.poster_path?'https://image.tmdb.org/t/p/w342'+d.poster_path:null
    };
  }
  if(q.src==='rawg'){
    var g=await jget('https://api.rawg.io/api/games/'+enc(q.srcId)+'?key='+enc(RAWG_KEY));
    var devs=(g.developers||[]).map(function(x){return x.name}).slice(0,2).join(', ');
    var plats=(g.platforms||[]).map(function(p){return p.platform.name}).slice(0,4).join(', ');
    var gens=(g.genres||[]).map(function(x){return x.name}).slice(0,3).join(', ');
    var pt=g.playtime||0;
    return {
      sub:[(g.released||'').slice(0,4),devs].filter(Boolean).join(' · '),
      blurb:trimText(g.description_raw,420),
      facts:[devs&&{k:'Developer',v:devs},plats&&{k:'Platforms',v:plats},gens&&{k:'Genre',v:gens},pt&&{k:'Time to beat',v:'about '+pt+' hours'}].filter(Boolean),
      highlights:[],effort:pt&&pt<=3?'quick':(pt>30?'epic':'standard'),
      img:g.background_image||null
    };
  }
  var w=await jget(WIKI+'&prop=extracts%7Cdescription%7Cpageimages&exintro=1&explaintext=1&exsentences=3&piprop=thumbnail&pithumbsize=500&titles='+enc(q.srcId));
  var p=Object.values((w.query&&w.query.pages)||{})[0];
  if(!p||p.missing!==undefined)throw new Error('missing');
  return {
    blurb:trimText(p.extract,420),
    facts:[p.description&&{k:'About',v:p.description}].filter(Boolean),
    highlights:q.kind==='place'?await voyageSights(p.title):[],
    effort:'standard',img:p.thumbnail?p.thumbnail.source:null,
    url:'https://en.wikipedia.org/wiki/'+enc(p.title.replace(/ /g,'_'))
  };
}
function applyDetails(q,r){
  q.verified=true;
  if(typeof r.sub==='string'&&r.sub)q.sub=r.sub;
  if(r.blurb)q.blurb=r.blurb;
  if(r.facts&&r.facts.length)q.facts=r.facts;
  if(r.highlights&&r.highlights.length&&!q.highlights.length)q.highlights=r.highlights.map(function(t){return {t:t,done:false}});
  if(EFFORT[r.effort]&&q.status==='active'&&!q.effortSet)q.effort=r.effort;
  if(safeImg(r.img)&&!q.img)q.img=r.img;
  if(safeUrl(r.url)&&!q.url)q.url=r.url;
}
async function loadDetails(id){
  var q0=quests.get(id);if(!q0)return;
  detailState[id]='loading';renderDetail();
  var r;
  try{r=await fetchDetails(q0)}catch(e){detailState[id]='error';renderDetail();return}
  delete detailState[id];
  if(!quests.get(id))return;
  mutate(id,function(q){applyDetails(q,r)});
}
async function lookupBest(id,force){
  var q0=quests.get(id);if(!q0)return;
  detailState[id]='loading';renderDetail();
  var items;
  try{items=await searchAll(q0.title,q0.auto?'auto':q0.kind)}catch(e){detailState[id]='error';renderDetail();return}
  var pick=items.filter(function(x){return norm(x.title)===norm(q0.title)})[0]||(force?items[0]:null);
  if(!pick){detailState[id]='none';renderDetail();return}
  if(!quests.get(id))return;
  mutate(id,function(q){
    q.kind=pick.kind||q.kind;q.auto=false;q.src=pick.src;q.srcId=pick.srcId;q.title=pick.title;q.sub=pick.sub||q.sub;
    if(safeImg(pick.img))q.img=pick.img;if(safeUrl(pick.url))q.url=pick.url;
  });
  loadDetails(id);
}

/* ---------- autocomplete ---------- */
function setHint(){
  var parts=['Pick a type, then start typing. Posters and details come from TMDB'+(RAWG_KEY?', RAWG':'')+' and Wikipedia.'];
  if(!RAWG_KEY)parts.push('Game search uses Wikipedia until a RAWG key is added in the settings at the top of the script.');
  $('#hint').textContent=parts.join(' ');
  var c='Movie data and posters from <a href="https://www.themoviedb.org" target="_blank" rel="noopener">TMDB</a>. This product uses the TMDB API but is not endorsed or certified by TMDB. ';
  if(RAWG_KEY)c+='Game data from <a href="https://rawg.io" target="_blank" rel="noopener">RAWG</a>. ';
  c+='Places and summaries from <a href="https://en.wikipedia.org" target="_blank" rel="noopener">Wikipedia</a> and <a href="https://en.wikivoyage.org" target="_blank" rel="noopener">Wikivoyage</a> (CC BY-SA).';
  $('#credits').innerHTML=c;
}
async function suggest(v){
  if(acCtl)acCtl.abort();
  acCtl=new AbortController();var ctl=acCtl;
  ac.status='loading';ac.open=true;renderAc();
  try{
    var items=await searchAll(v,addKind,ctl.signal);
    if(ctl!==acCtl)return;
    ac.items=items;ac.index=-1;ac.status=items.length?'':'none';
  }catch(e){
    if(ctl!==acCtl||(e&&e.name==='AbortError'))return;
    ac.items=[];ac.status='error';
  }
  renderAc();
}
