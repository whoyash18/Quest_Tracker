-- Sith schema baseline, verified against the supplied Supabase schema exports.
-- FOR A NEW LOCAL OR STAGING DATABASE ONLY.
-- Do not apply this baseline to the existing Project-Delta database.

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  username text,
  avatar text,
  updated_at timestamptz not null default now(),
  constraint username_format check (username is null or username ~ '^[a-z0-9_]{3,20}$'),
  constraint name_len check (full_name is null or char_length(full_name) <= 40),
  constraint avatar_size check (avatar is null or char_length(avatar) <= 150000)
);

create unique index profiles_username_key on public.profiles(username);

alter table public.profiles enable row level security;

create policy "own profile" on public.profiles
  for all to public
  using (auth.uid() = id)
  with check (auth.uid() = id);

create table public.quests (
  id text primary key,
  user_id uuid default auth.uid() references auth.users(id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.quests enable row level security;

create policy "own rows only" on public.quests
  for all to public
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
