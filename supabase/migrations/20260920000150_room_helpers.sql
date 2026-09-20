-- ============================================================================
-- ActiveApps Rooms — Sprint 0 / Migration 2: security helper functions (runs after the schema — SQL-language bodies are validated at CREATE time)
--
-- Context: client users sign in with a magic link and are therefore members of
-- the `authenticated` role, exactly like ActiveApps staff. Every policy in the
-- CRM currently reads `USING (true)` for `authenticated`, so before the first
-- client is invited we need a way to tell the two populations apart.
--
--   is_internal()               -> true for ActiveApps staff (profiles.role in
--                                  the internal set and is_active)
--   is_room_member(room_id)     -> true when auth.uid() is an active member of
--                                  the room (either side)
--   current_member_id(room_id)  -> the room_members.id for auth.uid() in that room
--   room_member_role(room_id)   -> role of the current member ('owner', ...)
--   room_member_side(room_id)   -> 'activeapps' | 'client'
--   has_accepted_nda(room_id)   -> nda_accepted_at is set, or NDA not required
--
-- All are SECURITY DEFINER with a pinned search_path so RLS on room_members /
-- profiles cannot recurse into itself.
-- ============================================================================

create or replace function public.is_internal()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select p.is_active and p.role in ('super_admin','admin','manager','standard','member')
       from public.profiles p
      where p.auth_user_id = auth.uid()
      limit 1),
    false
  );
$$;

-- Room membership is resolved by auth user id once linked, or by e-mail on the
-- very first visit (the app then persists user_id). Comparing e-mail here means a
-- freshly invited person can open their room from the magic link without an
-- extra round-trip.
create or replace function public.is_room_member(p_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.room_members m
     where m.room_id = p_room_id
       and m.status in ('invited','active')
       and (m.expires_at is null or m.expires_at > now())
       and (
         m.user_id = auth.uid()
         or (m.user_id is null and lower(m.email) = lower(coalesce(auth.jwt() ->> 'email', '')))
       )
  );
$$;

create or replace function public.current_member_id(p_room_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select m.id
    from public.room_members m
   where m.room_id = p_room_id
     and m.status in ('invited','active')
     and (
       m.user_id = auth.uid()
       or (m.user_id is null and lower(m.email) = lower(coalesce(auth.jwt() ->> 'email', '')))
     )
   order by (m.user_id = auth.uid()) desc
   limit 1;
$$;

create or replace function public.room_member_role(p_room_id uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select m.role
    from public.room_members m
   where m.id = public.current_member_id(p_room_id);
$$;

create or replace function public.room_member_side(p_room_id uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select m.side
    from public.room_members m
   where m.id = public.current_member_id(p_room_id);
$$;

create or replace function public.has_accepted_nda(p_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select (not r.nda_required) or m.nda_accepted_at is not null
       from public.rooms r
       left join public.room_members m on m.id = public.current_member_id(p_room_id)
      where r.id = p_room_id),
    false
  );
$$;

-- Only signed-in users may call these; anon gets nothing.
revoke execute on function public.is_internal() from public, anon;
revoke execute on function public.is_room_member(uuid) from public, anon;
revoke execute on function public.current_member_id(uuid) from public, anon;
revoke execute on function public.room_member_role(uuid) from public, anon;
revoke execute on function public.room_member_side(uuid) from public, anon;
revoke execute on function public.has_accepted_nda(uuid) from public, anon;
grant execute on function public.is_internal() to authenticated, service_role;
grant execute on function public.is_room_member(uuid) to authenticated, service_role;
grant execute on function public.current_member_id(uuid) to authenticated, service_role;
grant execute on function public.room_member_role(uuid) to authenticated, service_role;
grant execute on function public.room_member_side(uuid) to authenticated, service_role;
grant execute on function public.has_accepted_nda(uuid) to authenticated, service_role;
