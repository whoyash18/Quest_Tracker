'use strict';
/* Application startup. Loaded after all feature scripts. */
/* ---------- start ----------
   Order: load what is stored in this browser, draw the app (still hidden), set the sign-in
   card to its default mode, then ask Supabase who is signed in. initAuth() ends up in
   handleSession(), which reveals either the app or the sign-in card. */
setHint();loadLocal();loadPending();renderSeg();renderAll();setAuthMode('signin');initAuth();
