'use strict';
/* Supabase authentication and session handling. */
/* ---------- account (Supabase auth) ---------- */
/* adoptUser(): runs when someone signs in. It decides what to do with the quests already
   stored in this browser: upload them if the browser has no owner yet (your existing data
   moves to the account), keep them if it is the same account, or wipe them if a
   different account is signing in (privacy on shared computers). */
function adoptUser(){
  var owner=lsGet(LS_OWNER);
  if(owner&&owner!==user.id){
    /* a different account used this browser before: start clean */
    quests.clear();pending={up:{},del:{}};savePending();saveLocal();openId=null;view='list';
  }else if(!owner){
    /* first sign-in on this browser: upload what is already here */
    quests.forEach(function(q,id){pending.up[id]=1});savePending();
  }
  lsSet(LS_OWNER,user.id);
}
function loginMsg(t,isErr){var el=$('#loginMsg');el.textContent=t||'';el.className='note'+(isErr?' err':'')}
/* authMode = which form the sign-in card is showing.
   recovering = true when the visitor arrived from a "reset password" email link.
   It is read from the URL right now, because Supabase removes that part of the URL once it processes it. */
var authMode='signin', recovering=/type=recovery/.test(location.hash||'');
var AUTH_TITLE={signin:'Sign in',signup:'Create account',forgot:'Reset password',reset:'Set a new password'};
var AUTH_BTN={signin:'Sign in',signup:'Create account',forgot:'Send reset link',reset:'Save new password'};
var AUTH_LINK={signin:'Forgot password?',forgot:'Back to sign in',reset:'Skip for now'};
function updateLoginIntro(){
  var t={
    signin:'Sign in with your email and password. Your quests follow you to every device.',
    signup:'Create your account once. On any other device, just sign in with the same email and password.',
    forgot:'Enter your email and we will send you a link to choose a new password.',
    reset:'Choose a new password for your account.'
  }[authMode];
  if((authMode==='signin'||authMode==='signup')&&quests.size&&!lsGet(LS_OWNER))t+=' The '+plural(quests.size,'quest')+' already saved on this device will be uploaded to your account the first time you sign in.';
  $('#loginIntro').textContent=t;
}
/* setAuthMode(): one function switches the card between modes by showing/hiding fields,
   instead of keeping four separate pages. It also stops any resend countdown and clears old messages. */
function setAuthMode(m){
  authMode=m;
  clearInterval(cooldownTimer);
  $('#loginTitle').textContent=AUTH_TITLE[m];
  $('#authTabs').hidden=(m==='forgot'||m==='reset');
  Array.prototype.forEach.call($('#authTabs').querySelectorAll('button'),function(b){b.setAttribute('aria-checked',String(b.getAttribute('data-auth')===m))});
  $('#emailWrap').hidden=(m==='reset');
  $('#pwWrap').hidden=(m==='forgot');
  $('#pw2Wrap').hidden=!(m==='signup'||m==='reset');
  $('#loginPass').autocomplete=(m==='signin')?'current-password':'new-password';
  $('#loginPass').placeholder=(m==='signin')?'Your password':'At least 8 characters';
  var btn=$('#loginBtn');btn.disabled=false;btn.textContent=AUTH_BTN[m];
  var fb=$('#forgotBtn');fb.hidden=(m==='signup');fb.textContent=AUTH_LINK[m]||'';
  loginMsg('');
  updateLoginIntro();
}
/* handleSession(): the single place that decides what the visitor sees.
   Signed in -> show the app and start syncing. Signed out -> show the sign-in card.
   If they came from a reset link they are technically signed in, but we first make them
   choose a new password. The "same user" check stops repeated sync runs when the browser
   re-announces the same session (for example when you switch back to the tab). */
function handleSession(session){
  $('#boot').hidden=true;
  if(recovering&&session&&session.user){
    /* arrived from a password reset link: ask for the new password first */
    user=null;
    showScreen();
    if(authMode!=='reset')setAuthMode('reset');
    return;
  }
  if(session&&session.user){
    if(user&&user.id===session.user.id)return;
    user=session.user;
    $('#loginPass').value='';$('#loginPass2').value='';
    adoptUser();
    profile=readProfileCache(user.id);profDirty=false;
    showScreen();
    renderAll();renderChrome();loadProfile();
    setSync('Syncing…');
    syncNow();
  }else{
    user=null;
    profile=emptyProfile();
    showScreen();
    updateLoginIntro();
  }
}
/* initAuth(): creates the Supabase client and starts listening for sign-in/sign-out.
   persistSession keeps people signed in after closing the tab; autoRefreshToken renews the
   login quietly; detectSessionInUrl lets the reset-password link sign the visitor in.
   If the library failed to load (offline), we show the sign-in card with an explanation. */
function initAuth(){
  if(!window.supabase||!window.supabase.createClient){
    $('#boot').hidden=true;$('#login').hidden=false;updateLoginIntro();
    loginMsg('Could not load the sign-in service. Check your connection and reload the page.',true);
    return;
  }
  sb=window.supabase.createClient(SUPABASE_URL,SUPABASE_ANON_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
  /* defer work out of the callback: calling Supabase inside it can deadlock */
  sb.auth.onAuthStateChange(function(event,session){
    if(event==='PASSWORD_RECOVERY')recovering=true;
    setTimeout(function(){handleSession(session)},0);
  });
}
/* signOut(): save anything still queued first, warn if that fails, then clear the local copy.
   Clearing matters because the real copy now lives in the account; leaving it behind would
   let the next person on a shared device see these quests. */
async function signOut(){
  if(!sb)return;
  setSync('Signing out…');
  var ok=await flush();
  if(!ok&&!confirm('Some changes have not been saved to your account yet. Sign out anyway and lose them?')){setSync('Synced');return}
  try{await sb.auth.signOut()}catch(e){}
  quests.clear();pending={up:{},del:{}};savePending();saveLocal();lsDel(LS_OWNER);
  openId=null;view='list';tab='active';filter='all';
  user=null;
  profile=emptyProfile();profileMode='unknown';lsDel(LS_PROFILE);
  try{history.replaceState(null,'',location.pathname+location.search)}catch(e){}
  closeDrawer(false);
  renderAll();handleSession(null);
}
var cooldownTimer=null;
/* startCooldown(): disables the button for 60s after sending a reset email, because Supabase
   limits how many emails it will send and repeated clicks would hit that limit. */
function startCooldown(sec){
  var btn=$('#loginBtn'), label=AUTH_BTN[authMode];
  btn.disabled=true;
  clearInterval(cooldownTimer);
  function tick(){
    if(sec<=0){clearInterval(cooldownTimer);btn.disabled=false;btn.textContent=label;return}
    btn.textContent='Send again in '+sec+'s';sec--;
  }
  tick();
  cooldownTimer=setInterval(tick,1000);
}
/* leaveReset(): "Skip for now" on the new-password screen. The reset link already signed
   this device in, so skipping simply continues into the app. */
async function leaveReset(){
  /* skipping the new-password step: the reset link already signed this device in */
  recovering=false;
  setAuthMode('signin');
  if(sb){var s=await sb.auth.getSession();handleSession(s.data&&s.data.session)}
}
/* authError(): turns Supabase's technical error text into plain advice. */
function authError(err,mode){
  var m=String((err&&err.message)||''), st=err&&err.status;
  if(st===429||/rate limit|too many/i.test(m))return 'Too many attempts. Wait a few minutes and try again.';
  if(/invalid login credentials/i.test(m))return 'Wrong email or password. New here? Choose Create account. Forgot it? Use Forgot password.';
  if(/email not confirmed/i.test(m))return 'Confirm your email first. Check your inbox for the confirmation link, then sign in.';
  if(/already registered|already been registered/i.test(m))return 'An account with this email already exists. Sign in instead.';
  if(mode==='reset'&&/session|expired|invalid/i.test(m))return 'This reset link has expired. Choose Skip for now, then request a new link.';
  if(/same.*password|different from the old/i.test(m))return 'Choose a password you have not used on this account before.';
  if(/fetch|network/i.test(m))return 'Could not reach the sign-in service. Check your connection.';
  return m||'Something went wrong. Try again.';
}
/* submitAuth(): handles the form for all four modes.
   1) Check the input in the browser first (valid email, 8+ characters, passwords match) to give instant feedback.
   2) Call the matching Supabase function: signInWithPassword, signUp, resetPasswordForEmail or updateUser.
   3) After a successful sign-in we do nothing more here: the auth listener in initAuth()
      notices the new session and switches to the app.
   Sign-up says "already exists" for a duplicate email so users are pointed to Forgot password. */
async function submitAuth(e){
  e.preventDefault();
  var m=authMode, email=$('#loginEmail').value.trim(), pw=$('#loginPass').value, pw2=$('#loginPass2').value;
  if(m!=='reset'&&!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)){loginMsg('Enter a valid email address.',true);return}
  if(m!=='forgot'){
    if(!pw){loginMsg('Enter your password.',true);return}
    if((m==='signup'||m==='reset')&&pw.length<8){loginMsg('Use a password with at least 8 characters.',true);return}
    if((m==='signup'||m==='reset')&&pw!==pw2){loginMsg('The two passwords do not match.',true);return}
  }
  if(!sb){loginMsg('Sign-in is unavailable right now. Reload the page and try again.',true);return}
  var btn=$('#loginBtn'), keep=false, redirect=location.origin+location.pathname;
  btn.disabled=true;btn.textContent='Please wait…';loginMsg('');
  try{
    if(m==='signin'){
      recovering=false;
      var r1=await sb.auth.signInWithPassword({email:email,password:pw});
      if(r1.error)throw r1.error;
      /* the auth listener now switches to the app */
    }else if(m==='signup'){
      recovering=false;
      var r2=await sb.auth.signUp({email:email,password:pw,options:{emailRedirectTo:redirect}});
      if(r2.error)throw r2.error;
      if(!r2.data.session){
        var exists=!!(r2.data.user&&r2.data.user.identities&&r2.data.user.identities.length===0);
        setAuthMode('signin');
        if(exists)loginMsg('An account with this email already exists. Sign in, or use Forgot password to set a password.',true);
        else loginMsg('Account created. We sent a confirmation link to '+email+'. Open it, then sign in here.');
        return;
      }
    }else if(m==='forgot'){
      recovering=false;
      var r3=await sb.auth.resetPasswordForEmail(email,{redirectTo:redirect});
      if(r3.error)throw r3.error;
      loginMsg('If an account exists for '+email+', a reset link is on its way. It may land in spam.');
      keep=true;startCooldown(60);
    }else{
      var r4=await sb.auth.updateUser({password:pw});
      if(r4.error)throw r4.error;
      recovering=false;
      $('#loginPass').value='';$('#loginPass2').value='';
      setAuthMode('signin');
      var s=await sb.auth.getSession();
      handleSession(s.data&&s.data.session);
      return;
    }
  }catch(err){
    loginMsg(authError(err,m),true);
  }
  if(!keep){btn.disabled=false;btn.textContent=AUTH_BTN[authMode]}
}
