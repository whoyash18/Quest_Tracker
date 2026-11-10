'use strict';
/* Profile data, sidebar, and profile page behavior. */
/* ---------- profile and side menu ----------
   The profile is one row per account in the `profiles` table (protected by row level security,
   like quests). The picture is stored in that row as a small square JPEG, so no extra storage
   setup is needed. A copy is cached in this browser so the menu shows your name and picture
   straight away. If the table does not exist yet, the profile still works and is saved on this device. */
var profile={name:'',username:'',avatar:''}, profileMode='unknown', profDirty=false, screenKey='', drawerReturn=null, profileChain=Promise.resolve();
function emptyProfile(){return {name:'',username:'',avatar:''}}
function readProfileCache(uid){
  try{var p=JSON.parse(lsGet(LS_PROFILE)||'null');if(p&&p.uid===uid)return {name:p.name||'',username:p.username||'',avatar:p.avatar||''}}catch(e){}
  return emptyProfile();
}
function writeProfileCache(){if(user)lsSet(LS_PROFILE,JSON.stringify({uid:user.id,name:profile.name,username:profile.username,avatar:profile.avatar}))}
function isMissingTable(e){
  return !!e&&(e.code==='42P01'||e.code==='PGRST205'||/does not exist|schema cache|could not find the table/i.test(String(e.message||'')));
}
function profileError(e){
  var m=String((e&&e.message)||'');
  if(e&&e.code==='23505')return 'That username is already taken. Try another.';
  if(e&&e.code==='23514')return 'That name or username is not allowed. Check the length and characters.';
  if(/fetch|network|failed to/i.test(m))return 'Could not reach the server. Check your connection and try again.';
  return m||'Could not save. Try again.';
}
function displayName(){
  if(profile.name)return profile.name;
  if(profile.username)return profile.username;
  var em=(user&&user.email)||'';return em?em.split('@')[0]:'You';
}
function initialsOf(){
  var n=profile.name||profile.username||((user&&user.email)||'?').split('@')[0];
  var parts=n.trim().split(/[\s._-]+/).filter(Boolean);
  var s=parts.length>1?Array.from(parts[0])[0]+Array.from(parts[1])[0]:Array.from(n).slice(0,2).join('');
  return s.toUpperCase();
}
function avatarHtml(size){
  var a=profile.avatar;
  if(a&&/^data:image\/jpeg;base64,/.test(a))return '<span class="avatar '+size+'"><img src="'+esc(a)+'" alt=""></span>';
  var h=hash(user?user.id:'guest')%360;
  return '<span class="avatar '+size+'" style="background:'+hsl(h,45,32)+'" aria-hidden="true">'+esc(initialsOf())+'</span>';
}
function profMsg(t,isErr){var el=$('#profMsg');el.textContent=t||'';el.className='note'+(isErr?' err':'')}
function renderChrome(){
  if(!user)return;
  $('#topAvatar').innerHTML=avatarHtml('lg');
  $('#profAvatar').innerHTML=avatarHtml('xl');
  $('#avatarRemove').hidden=!profile.avatar;
  $('#profNote').hidden=profileMode!=='local';
}
function fillForm(){
  if(!user)return;
  $('#profEmail').value=user.email||'';
  $('#profName').value=profile.name;
  $('#profUser').value=profile.username;
}
async function loadProfile(){
  if(!sb||!user)return;
  var uid=user.id;
  try{
    var res=await sb.from('profiles').select('full_name,username,avatar').eq('id',uid).maybeSingle();
    if(!user||user.id!==uid)return;
    if(res.error)throw res.error;
    profileMode='remote';
    if(res.data){
      profile={name:res.data.full_name||'',username:res.data.username||'',avatar:res.data.avatar||''};
      writeProfileCache();
    }else if(profile.name||profile.username||profile.avatar){
      await saveProfile({});
    }
  }catch(e){
    if(!user||user.id!==uid)return;
    if(isMissingTable(e)){profileMode='local'}
    else {profileMode='error';profMsg('Could not load profile: '+((e&&e.message)||'Database error'),true)}
  }
  renderChrome();
  if(!profDirty)fillForm();
}
/* Saves go through one queue so two quick saves (name and picture) cannot overwrite each other. */
function saveProfile(patch){
  var run=profileChain.then(function(){return doSaveProfile(patch)});
  profileChain=run.catch(function(){});
  return run;
}
async function doSaveProfile(patch){
  if(!user)return {error:{message:'You are signed out.'}};
  var uid=user.id, next=Object.assign({},profile,patch), local=(profileMode==='local');
  if(profileMode==='error')return {error:{message:'Profile table access failed. Check the profiles RLS policies in Supabase.'}};
  try{
    if(!local&&sb){
      var res=await sb.from('profiles').upsert({id:uid,full_name:next.name||null,username:next.username||null,avatar:next.avatar||null,updated_at:new Date().toISOString()},{onConflict:'id'});
      if(res.error){
        if(isMissingTable(res.error)){profileMode='local';local=true}
        else return {error:res.error};
      }else profileMode='remote';
    }
  }catch(e){return {error:e}}
  if(!user||user.id!==uid)return {error:{message:'You are signed out.'}};
  profile=next;writeProfileCache();renderChrome();
  return {ok:true,local:local};
}
async function submitProfile(e){
  e.preventDefault();
  var name=$('#profName').value.replace(/\s+/g,' ').trim();
  var un=$('#profUser').value.trim().replace(/^@/,'').toLowerCase();
  if(name.length>40){profMsg('Keep your name to 40 characters or fewer.',true);return}
  if(un&&!/^[a-z0-9_]{3,20}$/.test(un)){profMsg('Username must be 3 to 20 characters: lowercase letters, numbers or underscores.',true);return}
  var btn=$('#profSave');btn.disabled=true;profMsg('Saving…');
  var r=await saveProfile({name:name,username:un});
  btn.disabled=false;
  if(r.error){profMsg(profileError(r.error),true);return}
  profDirty=false;fillForm();
  profMsg(r.local?'Saved on this device only.':'Saved.');
}
async function resizeAvatar(file){
  var bmp=await createImageBitmap(file), S=256, c=document.createElement('canvas');
  c.width=S;c.height=S;
  var x=c.getContext('2d'), side=Math.min(bmp.width,bmp.height), sx=(bmp.width-side)/2, sy=(bmp.height-side)/2;
  x.fillStyle='#fff';x.fillRect(0,0,S,S);
  x.imageSmoothingQuality='high';
  x.drawImage(bmp,sx,sy,side,side,0,0,S,S);
  if(bmp.close)bmp.close();
  var url='',q=[0.85,0.7,0.55];
  for(var i=0;i<q.length;i++){url=c.toDataURL('image/jpeg',q[i]);if(url.length<=100000)break}
  return url;
}
async function handleAvatar(file){
  if(!file)return;
  if(!/^image\//.test(file.type)){profMsg('Choose an image file (JPEG or PNG).',true);return}
  profMsg('Uploading…');
  var url;
  try{url=await resizeAvatar(file)}catch(e){profMsg('Could not read that image. Try a JPEG or PNG.',true);return}
  var r=await saveProfile({avatar:url});
  if(r.error){profMsg(profileError(r.error),true);return}
  profMsg(r.local?'Picture saved on this device only.':'Picture updated.');
}
var sidebarCollapsed=false;
function applySidebarState(){
  var desktop=window.matchMedia('(min-width:900px)').matches;
  document.body.classList.toggle('sidebar-collapsed',desktop&&sidebarCollapsed);
  var b=$('#sidebarToggle'), label=sidebarCollapsed?'Expand navigation':'Collapse navigation';
  b.setAttribute('aria-pressed',String(sidebarCollapsed));b.setAttribute('aria-label',label);b.title=label;
}
function loadSidebarState(){
  try{sidebarCollapsed=localStorage.getItem('sidequest-ledger-sidebar')==='collapsed'}catch(e){}
  applySidebarState();
}
loadSidebarState();
window.addEventListener('resize',applySidebarState);
$('#sidebarToggle').addEventListener('click',function(){
  sidebarCollapsed=!sidebarCollapsed;
  try{localStorage.setItem('sidequest-ledger-sidebar',sidebarCollapsed?'collapsed':'expanded')}catch(e){}
  applySidebarState();
});function openDrawer(){
  var d=$('#drawer');if(d.classList.contains('open')||window.matchMedia('(min-width:900px)').matches)return;
  drawerReturn=document.activeElement;
  d.setAttribute('role','dialog');d.setAttribute('aria-modal','true');
  d.classList.add('open');$('#scrim').hidden=false;
  $('#menuBtn').setAttribute('aria-expanded','true');
  document.body.style.overflow='hidden';
  $('#drawerClose').focus();
}
function closeDrawer(ret){
  var d=$('#drawer');if(!d.classList.contains('open'))return;
  d.classList.remove('open');d.removeAttribute('role');d.removeAttribute('aria-modal');$('#scrim').hidden=true;
  $('#menuBtn').setAttribute('aria-expanded','false');
  document.body.style.overflow='';
  if(ret!==false&&drawerReturn&&drawerReturn.focus)drawerReturn.focus();
}
function profileHash(){return /^#profile\b/.test(location.hash||'')}
/* showScreen(): one place decides which screen is visible: sign-in, the app, or the profile page. */
function showScreen(){
  var inApp=!!user, prof=inApp&&profileHash();
  var key=inApp?(prof?'profile':'app'):'login';
  $('#login').hidden=inApp;
  $('.app').hidden=key!=='app';
  $('#profilePage').hidden=key!=='profile';
  closeDrawer(false);
  document.title=prof?'Profile · Sidequest Ledger':'Sidequest Ledger';
  if(key!==screenKey){
    var prev=screenKey;screenKey=key;window.scrollTo(0,0);
    if(key==='profile'){profDirty=false;profMsg('');renderChrome();fillForm();if(prev==='app')$('#profTitle').focus()}
    else if(key==='app'&&prev==='profile'){(window.matchMedia('(min-width:900px)').matches?$('#addInput'):$('#menuBtn')).focus()}
  }
}
function goHome(){
  if(profileHash())history.pushState(null,'',location.pathname+location.search);
  showScreen();
}
$('#menuBtn').addEventListener('click',openDrawer);
$('#drawerClose').addEventListener('click',function(){closeDrawer()});
$('#scrim').addEventListener('click',function(){closeDrawer()});
$('#aboutBtn').addEventListener('click',function(){closeDrawer(false);location.hash='profile'});
$('#topProfileBtn').addEventListener('click',function(){location.hash='profile'});
$('#profBack').addEventListener('click',goHome);
$('#profSignOut').addEventListener('click',signOut);
$('#profForm').addEventListener('submit',submitProfile);
$('#profForm').addEventListener('input',function(){profDirty=true;profMsg('')});
$('#avatarPick').addEventListener('click',function(){$('#avatarFile').click()});
$('#avatarFile').addEventListener('change',function(){handleAvatar(this.files&&this.files[0]);this.value=''});
$('#avatarRemove').addEventListener('click',async function(){
  var r=await saveProfile({avatar:''});
  if(r.error)profMsg(profileError(r.error),true);else profMsg('Picture removed.');
});
window.addEventListener('hashchange',function(){if(user)showScreen()});
document.addEventListener('keydown',function(e){
  if(e.key!=='Tab'||!$('#drawer').classList.contains('open'))return;
  var f=Array.prototype.slice.call($('#drawer').querySelectorAll('button:not([disabled]),a[href]'));
  if(!f.length)return;
  var first=f[0], last=f[f.length-1];
  if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}
  else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}
  else if(f.indexOf(document.activeElement)<0){e.preventDefault();first.focus()}
});
