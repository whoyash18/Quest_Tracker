SideQuest Ledger uses GitHub Pages for the static frontend and Supabase Auth/Postgres for accounts and synced data. See README.md for the current architecture, schema, backup notes, avatar migration plan, and local checks.

Note: avatars are currently stored as resized data URLs in profiles.avatar. Supabase Storage is a future migration, not the current implementation.
