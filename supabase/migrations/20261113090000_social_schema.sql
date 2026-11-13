-- Sith social schema foundation.
-- DRAFT: review against a fresh staging schema before applying anywhere.
-- This migration intentionally does not grant friends access to quest/profile rows.
-- Deploy a client that scopes its sync pull to its own user before applying
-- 20261113091000_enable_friend_reads.sql.

create table public.friend_requests (
  id bigint generated always as identity primary key,
  sender_id uuid not null references auth.users(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  constraint friend_requests_not_self check (sender_id <> recipient_id)
);

create unique index friend_requests_one_pending_pair
  on public.friend_requests (
    (case when sender_id < recipient_id then sender_id else recipient_id end),
    (case when sender_id < recipient_id then recipient_id else sender_id end)
  ) where status = 'pending';

create index friend_requests_inbox_idx
  on public.friend_requests (recipient_id, created_at desc)
  where status = 'pending';

create table public.friendships (
  user_low_id uuid not null references auth.users(id) on delete cascade,
  user_high_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_low_id, user_high_id),
  constraint friendships_ordered_pair check (user_low_id < user_high_id)
);

alter table public.friend_requests enable row level security;
alter table public.friendships enable row level security;

revoke all on public.friend_requests from anon, authenticated;
grant select on public.friend_requests to authenticated;
revoke all on public.friendships from anon, authenticated;
grant select on public.friendships to authenticated;

create policy friend_requests_participant_read
  on public.friend_requests for select to authenticated
  using (auth.uid() = sender_id or auth.uid() = recipient_id);

create policy friendships_member_read
  on public.friendships for select to authenticated
  using (auth.uid() = user_low_id or auth.uid() = user_high_id);

create or replace function public.are_friends(p_other_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and p_other_user_id is not null
    and exists (
      select 1
      from public.friendships f
      where (f.user_low_id = (select auth.uid()) and f.user_high_id = p_other_user_id)
         or (f.user_high_id = (select auth.uid()) and f.user_low_id = p_other_user_id)
    );
$$;

revoke all on function public.are_friends(uuid) from public, anon;
grant execute on function public.are_friends(uuid) to authenticated;

create or replace function public.search_profile_by_username(p_username text)
returns table (
  user_id uuid,
  username text,
  display_name text,
  avatar text
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.username, p.full_name, p.avatar
  from public.profiles p
  where (select auth.uid()) is not null
    and p.username = lower(btrim(p_username))
    and p.id <> (select auth.uid())
  limit 1;
$$;

revoke all on function public.search_profile_by_username(text) from public, anon;
grant execute on function public.search_profile_by_username(text) to authenticated;

create or replace function public.send_friend_request(p_recipient_id uuid)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sender_id uuid := (select auth.uid());
  v_request_id bigint;
  v_pair_key bigint;
begin
  if v_sender_id is null then
    raise exception 'authentication_required';
  end if;
  if p_recipient_id is null or p_recipient_id = v_sender_id then
    raise exception 'invalid_recipient';
  end if;
  if not exists (select 1 from public.profiles p where p.id = p_recipient_id) then
    raise exception 'profile_not_found';
  end if;

  v_pair_key := pg_catalog.hashtextextended(
    least(v_sender_id::text, p_recipient_id::text) || ':' ||
    greatest(v_sender_id::text, p_recipient_id::text), 0
  );
  perform pg_catalog.pg_advisory_xact_lock(v_pair_key);

  if exists (
    select 1 from public.friendships f
    where f.user_low_id = least(v_sender_id, p_recipient_id)
      and f.user_high_id = greatest(v_sender_id, p_recipient_id)
  ) then
    raise exception 'already_friends';
  end if;

  select r.id into v_request_id
  from public.friend_requests r
  where r.sender_id = v_sender_id
    and r.recipient_id = p_recipient_id
    and r.status = 'pending';
  if found then
    return v_request_id;
  end if;

  if exists (
    select 1 from public.friend_requests r
    where r.sender_id = p_recipient_id
      and r.recipient_id = v_sender_id
      and r.status = 'pending'
  ) then
    raise exception 'incoming_request_pending';
  end if;

  insert into public.friend_requests (sender_id, recipient_id)
  values (v_sender_id, p_recipient_id)
  returning id into v_request_id;
  return v_request_id;
end;
$$;

create or replace function public.accept_friend_request(p_request_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_request public.friend_requests%rowtype;
begin
  if v_actor_id is null then
    raise exception 'authentication_required';
  end if;

  select r.* into v_request
  from public.friend_requests r
  where r.id = p_request_id
    and r.recipient_id = v_actor_id
    and r.status = 'pending'
  for update;
  if not found then
    raise exception 'pending_request_not_found';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      least(v_actor_id::text, v_request.sender_id::text) || ':' ||
      greatest(v_actor_id::text, v_request.sender_id::text), 0
    )
  );

  insert into public.friendships (user_low_id, user_high_id)
  values (least(v_actor_id, v_request.sender_id), greatest(v_actor_id, v_request.sender_id))
  on conflict do nothing;

  update public.friend_requests
  set status = 'accepted', responded_at = now()
  where id = p_request_id;
end;
$$;

create or replace function public.decline_friend_request(p_request_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
begin
  if v_actor_id is null then
    raise exception 'authentication_required';
  end if;

  update public.friend_requests
  set status = 'declined', responded_at = now()
  where id = p_request_id
    and recipient_id = v_actor_id
    and status = 'pending';

  if not found then
    raise exception 'pending_request_not_found';
  end if;
end;
$$;

create or replace function public.remove_friend(p_friend_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
begin
  if v_actor_id is null then
    raise exception 'authentication_required';
  end if;
  if p_friend_user_id is null or p_friend_user_id = v_actor_id then
    raise exception 'invalid_friend';
  end if;

  delete from public.friendships f
  where f.user_low_id = least(v_actor_id, p_friend_user_id)
    and f.user_high_id = greatest(v_actor_id, p_friend_user_id);

  if not found then
    raise exception 'friendship_not_found';
  end if;
end;
$$;

revoke all on function public.send_friend_request(uuid) from public, anon;
revoke all on function public.accept_friend_request(bigint) from public, anon;
revoke all on function public.decline_friend_request(bigint) from public, anon;
revoke all on function public.remove_friend(uuid) from public, anon;
grant execute on function public.send_friend_request(uuid) to authenticated;
grant execute on function public.accept_friend_request(bigint) to authenticated;
grant execute on function public.decline_friend_request(bigint) to authenticated;
grant execute on function public.remove_friend(uuid) to authenticated;

-- New records default to private, preventing an older client that omits visibility
-- from accidentally sharing a task. Existing media are backfilled as friend-visible;
-- tasks and unrecognized kinds remain private.
alter table public.quests
  add column visibility text not null default 'private';

update public.quests q
set visibility = case
  when lower(coalesce(q.data->>'kind', '')) in ('movie', 'game', 'place') then 'friends'
  else 'private'
end;

update public.quests q
set data = pg_catalog.jsonb_set(
  q.data,
  '{visibility}',
  pg_catalog.to_jsonb(q.visibility),
  true
);

alter table public.quests
  add constraint quests_visibility_allowed
  check (visibility in ('private', 'friends'));

create index quests_friend_visibility_idx
  on public.quests (user_id, updated_at desc)
  where visibility = 'friends';
