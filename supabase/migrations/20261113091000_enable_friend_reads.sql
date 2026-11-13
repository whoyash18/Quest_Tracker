-- Sith friend-readable profiles and quests.
-- DRAFT: apply only after the frontend explicitly scopes its normal sync pull
-- to user_id = auth.uid() and loads friends' visible items separately.

create policy profiles_read_friends
  on public.profiles for select to authenticated
  using (public.are_friends(id));

drop policy if exists "own rows only" on public.quests;

create policy quests_read_owner_or_friend
  on public.quests for select to authenticated
  using (
    auth.uid() = user_id
    or (
      visibility = 'friends'
      and public.are_friends(user_id)
      and (
        data->>'kind' in ('game', 'movie', 'place')
        or data->>'kind' = 'task'
      )
    )
  );

create policy quests_insert_owner
  on public.quests for insert to authenticated
  with check (auth.uid() = user_id);

create policy quests_update_owner
  on public.quests for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy quests_delete_owner
  on public.quests for delete to authenticated
  using (auth.uid() = user_id);
