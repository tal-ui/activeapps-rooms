-- ============================================================================
-- ActiveApps Rooms — Sprint 0 / Migration 5: CRM RLS hardening  (spec §5.3)
--
-- WHY THIS EXISTS
--   Every CRM table today has policies of the form
--     FOR SELECT TO authenticated USING (true)
--   A client who signs in to a Room with a magic link *is* `authenticated`, so
--   without this migration they could read accounts, invoices, time entries and
--   integrations through /rest/v1. This migration makes internal staff the only
--   `authenticated` users who can touch CRM tables.
--
-- WHAT IT DOES
--   For every public table that is NOT a room_* table, every policy granted to
--   `authenticated` (or public) gets an additional `public.is_internal()`
--   conjunct in both USING and WITH CHECK. Existing intent is preserved exactly
--   (own-rows-only policies stay own-rows-only), just scoped to staff.
--   service_role policies are left untouched.
--
-- SAFETY
--   * Idempotent: policies already containing is_internal() are skipped.
--   * Reversible: the original expressions are recorded in
--     public.crm_policy_backup so `select * from crm_policy_backup` shows
--     exactly what to restore.
--   * MUST be applied after 20260920000150_room_helpers.sql (needs is_internal()).
--
-- APPLY WITH CARE: run scripts/rls-check.ts afterwards, then Security Advisors.
-- ============================================================================

-- never wait forever for a lock on a live table
set lock_timeout = '15s';

create table if not exists public.crm_policy_backup (
  id           bigserial primary key,
  tablename    text not null,
  policyname   text not null,
  cmd          text,
  roles        text[],
  permissive   text,
  qual         text,
  with_check   text,
  backed_up_at timestamptz not null default now()
);
alter table public.crm_policy_backup enable row level security;
revoke all on public.crm_policy_backup from anon, authenticated;

do $$
declare
  p          record;
  v_using    text;
  v_check    text;
  v_roles    text;
begin
  for p in
    select pol.schemaname, pol.tablename, pol.policyname, pol.cmd, pol.roles, pol.permissive, pol.qual, pol.with_check
      from pg_policies pol
     where pol.schemaname = 'public'
       and pol.tablename not like 'room\_%'
       and pol.tablename <> 'rooms'
       and pol.tablename <> 'crm_policy_backup'
       and (pol.roles::text[] && array['authenticated','public'])
  loop
    -- skip policies that are already scoped
    if coalesce(p.qual, '') ilike '%is_internal()%' or coalesce(p.with_check, '') ilike '%is_internal()%' then
      continue;
    end if;

    insert into public.crm_policy_backup (tablename, policyname, cmd, roles, permissive, qual, with_check)
    values (p.tablename, p.policyname, p.cmd, p.roles::text[], p.permissive, p.qual, p.with_check);

    v_roles := array_to_string(array(select quote_ident(r) from unnest(p.roles::text[]) r), ', ');

    v_using := case when p.qual is null then null
                    else format('(public.is_internal() and (%s))', p.qual) end;
    -- an UPDATE/ALL policy without WITH CHECK implicitly reuses USING; keep that
    v_check := case when p.with_check is not null then format('(public.is_internal() and (%s))', p.with_check)
                    when p.cmd in ('UPDATE','ALL') then v_using
                    else null end;

    execute format('drop policy %I on public.%I', p.policyname, p.tablename);

    execute format('create policy %I on public.%I as %s for %s to %s %s %s',
      p.policyname, p.tablename,
      p.permissive,
      p.cmd,
      v_roles,
      case when v_using is not null then 'using ' || v_using
           when p.cmd in ('INSERT') then ''
           else 'using (public.is_internal())' end,
      case when v_check is not null then 'with check ' || v_check
           when p.cmd in ('SELECT','DELETE') then ''
           else 'with check (public.is_internal())' end);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Storage: the CRM buckets (attachments, documents, …) have "TO authenticated
-- USING (bucket_id = '…')" policies. Wrap them the same way. Rooms' own bucket
-- policies (room_files_*) are created by the next migration and are skipped.
-- ---------------------------------------------------------------------------
do $$
declare
  p          record;
  v_using    text;
  v_check    text;
  v_roles    text;
begin
  for p in
    select pol.policyname, pol.cmd, pol.roles, pol.permissive, pol.qual, pol.with_check
      from pg_policies pol
     where pol.schemaname = 'storage' and pol.tablename = 'objects'
       and pol.policyname not like 'room\_files\_%'
       and (pol.roles::text[] && array['authenticated','public'])
  loop
    if coalesce(p.qual, '') ilike '%is_internal()%' or coalesce(p.with_check, '') ilike '%is_internal()%' then
      continue;
    end if;
    insert into public.crm_policy_backup (tablename, policyname, cmd, roles, permissive, qual, with_check)
    values ('storage.objects', p.policyname, p.cmd, p.roles::text[], p.permissive, p.qual, p.with_check);

    v_roles := array_to_string(array(select quote_ident(r) from unnest(p.roles::text[]) r), ', ');
    v_using := case when p.qual is null then null else format('(public.is_internal() and (%s))', p.qual) end;
    v_check := case when p.with_check is not null then format('(public.is_internal() and (%s))', p.with_check)
                    when p.cmd in ('UPDATE','ALL') then v_using
                    else null end;

    execute format('drop policy %I on storage.objects', p.policyname);
    execute format('create policy %I on storage.objects as %s for %s to %s %s %s',
      p.policyname, p.permissive, p.cmd, v_roles,
      case when v_using is not null then 'using ' || v_using
           when p.cmd in ('INSERT') then ''
           else 'using (public.is_internal())' end,
      case when v_check is not null then 'with check ' || v_check
           when p.cmd in ('SELECT','DELETE') then ''
           else 'with check (public.is_internal())' end);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- handle_new_user(): the CRM creates a profiles row for every new auth user.
-- (Body below = the production function as read on 2026-09-20 via pg_get_functiondef,
-- plus the two guards; public.epoch_ms() and the profiles columns exist in production.)
--   * Room clients (app_metadata.kind = 'room_client', or already invited on a
--     room's client side) get no CRM profile at all.
--   * A seeded staff profile is linked by e-mail exactly as before.
--   * Anyone else — which, while public e-mail sign-ups are enabled on the Auth
--     project, means *any* stranger — now gets an INACTIVE profile. is_internal()
--     requires is_active, so a self-signed-up user can no longer read the CRM;
--     an admin activates genuine new staff from Users & Roles. (Also disable
--     public sign-ups in Auth → Providers → Email.)
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname = 'handle_new_user') then
    execute $fn$
      create or replace function public.handle_new_user()
      returns trigger
      language plpgsql
      security definer
      set search_path to 'public'
      as $body$
      begin
        if coalesce(new.raw_app_meta_data ->> 'kind', '') = 'room_client' then
          return new;
        end if;
        if exists (select 1 from public.room_members m where m.side = 'client' and lower(m.email) = lower(new.email)) then
          return new;
        end if;
        update public.profiles
           set auth_user_id = new.id, updated_at = public.epoch_ms()
         where lower(email) = lower(new.email) and auth_user_id is null;
        if not found then
          insert into public.profiles (auth_user_id, email, full_name, role, is_active)
          values (new.id, new.email,
                  coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1)),
                  'member', false);
        end if;
        return new;
      end $body$;
    $fn$;
  end if;
end $$;

-- profiles: internal staff need to read the directory; clients must not.
-- (the loop above already rewrote profiles_read to is_internal() and (true))

-- Lock down the functions the CRM audit flagged as anon-executable (§6 of the
-- CRM builder notes). Verified 2026-09-20: the CRM frontend calls none of them
-- via supabase.rpc(); Edge Functions use the service key.
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('generate_invoice_from_summary','generate_recurring_invoice','run_automations','notify_slack','rls_auto_enable','handle_new_user')
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $$;
