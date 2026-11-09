# SideQuest Ledger

SideQuest Ledger is a static browser app published with GitHub Pages. Supabase provides authentication and the database. The app keeps a browser copy for offline continuity and syncs authenticated users' records to Supabase.

## Project layout

- `index.html` contains the app markup and ordered classic-script includes.
- `css/styles.css` contains the visual design and responsive layout.
- `js/config.js` contains public browser configuration. Supabase anon/publishable keys are intended for browser use when database access is protected by RLS. Never put a Supabase `service_role` or secret key here. Third-party API keys embedded in a static site are also visible to visitors; use a server-side proxy if a provider requires a secret.
- `js/core.js`, `js/auth.js`, `js/profile.js`, `js/quests.js`, `js/ui.js`, and `js/app.js` contain the app logic, loaded in that order.
- `supabase/migrations/` contains a reference baseline migration for a fresh local or staging database.

## Current database model

`public.profiles` stores one profile per authenticated user. `id` references `auth.users(id)`, `avatar` currently stores text (the current app stores a resized image as a data URL), and an RLS policy limits access to the row whose `id` matches `auth.uid()`.

`public.quests` stores each quest as JSONB. `user_id` references `auth.users(id)` and the RLS policy limits access to rows whose `user_id` matches `auth.uid()`.

The verified schema exports showed RLS enabled on both tables. The browser app must continue to use the public anon/publishable key and authenticated sessions; RLS is the access boundary.

## Backups and migrations

Keep a source backup or Git commit before structural changes. The `*.pre-*.bak` files in this working copy are rollback copies. This source folder currently has no Git metadata, so connect/clone the repository before relying on Git history.

The baseline SQL is for a new local/staging database only. Do not run it against the existing Project-Delta database: that project already has these tables and policies. Reconcile any future change against a fresh schema export, review the SQL, then apply it deliberately.

A database schema export is not a data backup. Supabase Free projects do not include automatic downloadable database backups. A full dump requires a configured PostgreSQL dump tool/Supabase CLI and database connection credentials kept out of chat and source control. Supabase database backups also do not include Storage object contents.

## Avatar storage direction

Avatars currently live as data URLs in `profiles.avatar`; there is no evidence that the app uses Supabase Storage for them. Keep the existing field working until a staged migration is ready. The planned migration should create a private user-scoped bucket, apply owner-scoped object policies, upload each existing avatar, verify the object and profile URL/path, switch the UI to the stored path, and only then remove legacy data URLs in a separate reviewed step. Do not delete avatar values during upload or testing.

## Local checks

With Node.js installed, syntax-check each JavaScript file:

```powershell
Get-ChildItem js\*.js | ForEach-Object { node --check $_.FullName }
```

For database behavior, follow `supabase/TESTING.md` using two disposable accounts in a local or staging project. Do not use production accounts for destructive isolation tests.
