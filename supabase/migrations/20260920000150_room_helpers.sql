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

-- A user is internal only if ALL of the following hold:
--   * they hold an active CRM profile in a staff role,
--   * their JWT was not minted for a room client (app_metadata.kind, which only
--     the Auth admin API can set — room-invite sets it on every invited client),
--   * they are not a client-side member of any room (matched by user id OR
--     e-mail, so the invited-but-not-yet-claimed window is covered too).
-- The last two rules exist because the CRM's handle_new_user() trigger creates
-- a profiles row for every new auth user; a profile alone must never grant
-- staff access.
create or replace function public.is_internal()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null
    and coalesce(auth.jwt() -> 'app_metadata' ->> 'kind', '') <> 'room_client'
    and coalesce(
      (select p.is_active and p.role in ('super_admin','admin','manager','standard','member','read_only')
         from public.profiles p
        where p.auth_user_id = auth.uid()
        limit 1),
      false)
    and not exists (
      select 1 from public.room_members m
       where m.side = 'client'
         and (m.user_id = auth.uid()
              or lower(m.email) = lower(coalesce(auth.jwt() ->> 'email', '')))
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
     and (m.expires_at is null or m.expires_at > now())
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

-- Internal AND allowed to write: CRM read_only users may look at rooms but
-- may not edit, publish, invite or create.
create or replace function public.is_internal_writer()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.is_internal()
     and coalesce((select p.role <> 'read_only' from public.profiles p where p.auth_user_id = auth.uid() limit 1), false);
$$;
revoke execute on function public.is_internal_writer() from public, anon;
grant execute on function public.is_internal_writer() to authenticated, service_role;

-- Is this block part of that document? (policies cannot see room_blocks as a client)
create or replace function public.room_block_in_document(p_block_id uuid, p_document_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.room_blocks b where b.id = p_block_id and b.document_id = p_document_id);
$$;
revoke execute on function public.room_block_in_document(uuid, uuid) from public, anon;
grant execute on function public.room_block_in_document(uuid, uuid) to authenticated, service_role;

-- Does this e-mail belong to an active CRM staff profile? Used to keep staff
-- off the client side of any room (see room_members_guard_staff_email).
create or replace function public.is_staff_email(p_email text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.profiles p
     where lower(p.email) = lower(trim(p_email))
       and p.is_active
       and p.role in ('super_admin','admin','manager','standard','member','read_only')
  );
$$;
revoke execute on function public.is_staff_email(text) from public, anon;
grant execute on function public.is_staff_email(text) to authenticated, service_role;

-- Only signed-in users may call these; anon gets nothing.
-- is_internal() is referenced by every CRM policy; anon must be able to
-- evaluate it (it returns false for anon) rather than hit "permission denied".
revoke execute on function public.is_internal() from public;
revoke execute on function public.is_room_member(uuid) from public, anon;
revoke execute on function public.current_member_id(uuid) from public, anon;
revoke execute on function public.room_member_role(uuid) from public, anon;
revoke execute on function public.room_member_side(uuid) from public, anon;
revoke execute on function public.has_accepted_nda(uuid) from public, anon;
grant execute on function public.is_internal() to anon, authenticated, service_role;
grant execute on function public.is_room_member(uuid) to authenticated, service_role;
grant execute on function public.current_member_id(uuid) to authenticated, service_role;
grant execute on function public.room_member_role(uuid) to authenticated, service_role;
grant execute on function public.room_member_side(uuid) to authenticated, service_role;
grant execute on function public.has_accepted_nda(uuid) to authenticated, service_role;
