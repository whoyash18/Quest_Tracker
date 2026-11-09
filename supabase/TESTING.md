# Supabase verification checklist

Run these checks only against a local Supabase instance or a staging project with disposable accounts. Do not run destructive tests on Project-Delta or real user accounts. The schema baseline is intended for an empty local/staging database only.

## Two-account isolation

Create disposable accounts A and B. Sign in to each in separate browser profiles so browser local storage and sessions do not overlap.

- [ ] A can create, read, update, complete, and delete A's quest.
- [ ] B can create, read, update, complete, and delete B's quest.
- [ ] A cannot select or modify B's quest, including by guessing its `id` or submitting B's `user_id`.
- [ ] B cannot select or modify A's quest.
- [ ] A can read and update only A's profile; B can read and update only B's profile.
- [ ] Anonymous requests cannot read or write either table.
- [ ] Deleting a disposable auth user cascades only to that user's profile and quest rows.

For cross-user checks, use the authenticated Supabase client or SQL API with each account's own JWT. Do not use the service role key to represent a user; it bypasses RLS.

## App sync and recovery

- [ ] Sign in and confirm only that account's quests render.
- [ ] Create/update/delete a quest online; reload and confirm the change persists.
- [ ] Disconnect the network, make a change, reload while offline, reconnect, and confirm the queued change syncs once.
- [ ] Sign out and sign in as the other account; confirm the first account's local cache is not shown or uploaded.
- [ ] Export a backup, import it in a disposable account, and inspect the restored records.
- [ ] Save profile name/username and verify it after reload.
- [ ] Upload/remove an avatar and verify current behavior. Storage migration tests belong after Storage is implemented.
- [ ] Check browser console and network responses for errors; confirm normal RLS-denied access is surfaced safely.

## Status

The supplied schema and policy exports and the app's query paths have been reviewed. These live behavior checks are pending because no isolated staging project or disposable second account was provided. No production rows have been changed as part of this checklist.
