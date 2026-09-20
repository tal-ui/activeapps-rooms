-- ============================================================================
-- ActiveApps Rooms — Sprint 4 / Migration 8: notifications, CRM sync, cron
--
--   room_settings            key/value config (internal-only): function URL/key,
--                            CRM stage mapping, app URL, slack channel key
--   room_events → room-notify  pg_net POST on every event (same pattern as the
--                            CRM's notify_slack trigger); the function decides
--                            e-mail / Slack / in-app per rules and member prefs
--   engagement status → CRM  trigger updates opportunities.stage on agreed /
--                            signed (spec §4.11) — a trigger rather than an
--                            HTTP hop so it holds for any client
--   access state RPCs        room_access_state(slug) → ok | expired | none,
--                            room_request_renewal(slug)
--   in-app notifications     room_mark_notifications_read(ids)
--   pg_cron                  room-digest at 05:00 and 06:00 UTC; the function
--                            only sends when it is 08:00 in Asia/Jerusalem
-- ============================================================================

create table if not exists public.room_settings (
  key         text primary key,
  value       text,
  description text,
  updated_at  timestamptz not null default now()
);
alter table public.room_settings enable row level security;
revoke all on public.room_settings from anon;
drop policy if exists room_settings_internal_all on public.room_settings;
create policy room_settings_internal_all on public.room_settings
  for all to authenticated using (public.is_internal()) with check (public.is_internal());

insert into public.room_settings (key, value, description) values
  ('app_url', 'https://rooms.activeapps.io', 'Public URL of the Rooms app (links in e-mails and Slack)'),
  ('functions_url', '', 'Base URL of Edge Functions, e.g. https://<ref>.supabase.co/functions/v1 — empty disables the event webhook'),
  ('functions_key', '', 'Publishable anon key sent as Bearer to Edge Functions (functions verify the JWT)'),
  ('crm_stage_on_agreed', 'negotiation', 'opportunities.stage to set when an engagement is agreed'),
  ('crm_stage_on_signed', 'closed_won', 'opportunities.stage to set when an engagement is signed'),
  ('slack_channel_key', 'rooms', 'integrations.slack config.channels key used for room notifications')
on conflict (key) do nothing;

create or replace function public.room_setting(p_key text)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select value from public.room_settings where key = p_key;
$$;
revoke execute on function public.room_setting(text) from public, anon, authenticated;
grant execute on function public.room_setting(text) to service_role;

-- ---------------------------------------------------------------------------
-- room_events → room-notify (pg_net). Skips view events (handled by digest
-- logic / first-view-of-day is computed inside the function for room_viewed).
-- ---------------------------------------------------------------------------
create or replace function public.room_event_notify()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_url text := public.room_setting('functions_url');
  v_key text := public.room_setting('functions_key');
begin
  if coalesce(v_url, '') = '' then
    return new;
  end if;
  if new.type in ('document_viewed','block_viewed') then
    return new;
  end if;
  perform net.http_post(
    url := rtrim(v_url, '/') || '/room-notify',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || coalesce(v_key, '')
    ),
    body := jsonb_build_object('type', 'INSERT', 'table', 'room_events', 'record', to_jsonb(new)),
    timeout_milliseconds := 5000
  );
  return new;
end;
$$;
drop trigger if exists room_events_notify on public.room_events;
create trigger room_events_notify after insert on public.room_events
  for each row execute function public.room_event_notify();

-- ---------------------------------------------------------------------------
-- Engagement status → CRM Opportunity (spec §4.11)
-- ---------------------------------------------------------------------------
create or replace function public.room_engagement_crm_sync()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_stage text;
  v_now_ms bigint := (extract(epoch from now()) * 1000)::bigint;
begin
  if tg_op <> 'UPDATE' or new.status is not distinct from old.status or new.opportunity_id is null then
    return new;
  end if;
  if new.status = 'agreed' then
    v_stage := coalesce(public.room_setting('crm_stage_on_agreed'), 'negotiation');
  elsif new.status = 'signed' then
    v_stage := coalesce(public.room_setting('crm_stage_on_signed'), 'closed_won');
    if new.signed_at is null then
      new.signed_at := now();
    end if;
  else
    return new;
  end if;

  update public.opportunities
     set stage = v_stage,
         actual_close_date = case when v_stage = 'closed_won' then coalesce(actual_close_date, v_now_ms) else actual_close_date end,
         updated_at = v_now_ms
   where id = new.opportunity_id
     and stage is distinct from v_stage
     and stage not in ('closed_won','closed_lost');

  perform public.room_emit_event(new.room_id,
    case when new.status = 'signed' then 'engagement_signed' else 'crm_synced' end,
    'engagement', new.id,
    jsonb_build_object('engagement_name', new.name, 'status', new.status, 'opportunity_id', new.opportunity_id, 'stage', v_stage),
    new.status = 'signed', null);
  return new;
end;
$$;
drop trigger if exists room_engagements_crm_sync on public.room_engagements;
create trigger room_engagements_crm_sync before update of status on public.room_engagements
  for each row execute function public.room_engagement_crm_sync();

-- ---------------------------------------------------------------------------
-- Access state for the current user (expired members are not "members")
-- ---------------------------------------------------------------------------
create or replace function public.room_access_state(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_room   public.rooms%rowtype;
  v_member public.room_members%rowtype;
  v_email  text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if auth.uid() is null then return jsonb_build_object('state', 'none'); end if;
  select * into v_room from public.rooms where slug = p_slug and deleted_at is null;
  if v_room.id is null then return jsonb_build_object('state', 'none'); end if;
  if public.is_internal() then return jsonb_build_object('state', 'ok', 'room_id', v_room.id); end if;
  select * into v_member from public.room_members m
   where m.room_id = v_room.id and (m.user_id = auth.uid() or (m.user_id is null and lower(m.email) = v_email))
   order by (m.user_id = auth.uid()) desc limit 1;
  if v_member.id is null or v_member.status = 'revoked' then return jsonb_build_object('state', 'none'); end if;
  if v_member.expires_at is not null and v_member.expires_at <= now() then
    return jsonb_build_object('state', 'expired', 'room_id', v_room.id, 'member_id', v_member.id,
                              'expires_at', v_member.expires_at, 'client_name', v_room.client_name, 'language', v_room.language);
  end if;
  return jsonb_build_object('state', 'ok', 'room_id', v_room.id, 'member_id', v_member.id);
end;
$$;
revoke execute on function public.room_access_state(text) from public, anon;
grant execute on function public.room_access_state(text) to authenticated, service_role;

create or replace function public.room_request_renewal(p_slug text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_state jsonb := public.room_access_state(p_slug);
  v_recent int;
begin
  if v_state ->> 'state' <> 'expired' then
    raise exception 'access is not expired' using errcode = '22023';
  end if;
  select count(*) into v_recent from public.room_events
   where room_id = (v_state ->> 'room_id')::uuid and type = 'access_expired_requested'
     and actor_member_id = (v_state ->> 'member_id')::uuid and created_at > now() - interval '1 day';
  if v_recent = 0 then
    perform public.room_emit_event((v_state ->> 'room_id')::uuid, 'access_expired_requested', 'member', (v_state ->> 'member_id')::uuid,
      jsonb_build_object('expires_at', v_state -> 'expires_at'), false, (v_state ->> 'member_id')::uuid);
  end if;
  return jsonb_build_object('ok', true, 'already_requested', v_recent > 0);
end;
$$;
revoke execute on function public.room_request_renewal(text) from public, anon;
grant execute on function public.room_request_renewal(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- In-app notifications: mark read (own rows only; RLS also enforces it)
-- ---------------------------------------------------------------------------
create or replace function public.room_mark_notifications_read(p_ids uuid[] default null, p_room_id uuid default null)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_n integer;
begin
  update public.room_notifications n
     set status = 'read', read_at = now()
   where n.channel = 'in_app' and n.status <> 'read'
     and n.member_id = public.current_member_id(n.room_id)
     and (p_ids is null or n.id = any(p_ids))
     and (p_room_id is null or n.room_id = p_room_id);
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke execute on function public.room_mark_notifications_read(uuid[], uuid) from public, anon;
grant execute on function public.room_mark_notifications_read(uuid[], uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- pg_cron: daily digest. Scheduled at 05:00 and 06:00 UTC so that one of them
-- is 08:00 Asia/Jerusalem in both DST and standard time; the function checks
-- the local hour and exits early otherwise.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname in ('room-digest-0500','room-digest-0600');
    perform cron.schedule('room-digest-0500', '0 5 * * *', $cron$
      select net.http_post(
        url := rtrim(public.room_setting('functions_url'), '/') || '/room-digest',
        headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || coalesce(public.room_setting('functions_key'),'')),
        body := jsonb_build_object('type','CRON'),
        timeout_milliseconds := 30000)
      where coalesce(public.room_setting('functions_url'),'') <> '';
    $cron$);
    perform cron.schedule('room-digest-0600', '0 6 * * *', $cron$
      select net.http_post(
        url := rtrim(public.room_setting('functions_url'), '/') || '/room-digest',
        headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || coalesce(public.room_setting('functions_key'),'')),
        body := jsonb_build_object('type','CRON'),
        timeout_milliseconds := 30000)
      where coalesce(public.room_setting('functions_url'),'') <> '';
    $cron$);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Room widget for the CRM (Account / Opportunity pages): one RPC, internal only
-- ---------------------------------------------------------------------------
create or replace function public.room_crm_widget(p_account_id character varying default null, p_opportunity_id character varying default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_room public.rooms%rowtype;
  v_eng  public.room_engagements%rowtype;
begin
  if not public.is_internal() then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_opportunity_id is not null then
    select e.* into v_eng from public.room_engagements e where e.opportunity_id = p_opportunity_id order by e.updated_at desc limit 1;
    if v_eng.id is not null then
      select * into v_room from public.rooms where id = v_eng.room_id and deleted_at is null;
    end if;
  end if;
  if v_room.id is null and p_account_id is not null then
    select * into v_room from public.rooms where account_id = p_account_id and deleted_at is null order by updated_at desc limit 1;
  end if;
  if v_room.id is null then return jsonb_build_object('room', null); end if;
  if v_eng.id is null then
    select e.* into v_eng from public.room_engagements e where e.room_id = v_room.id and e.status not in ('cancelled','completed') order by e.updated_at desc limit 1;
  end if;
  return jsonb_build_object(
    'room', jsonb_build_object('id', v_room.id, 'slug', v_room.slug, 'name', v_room.name, 'phase', v_room.phase, 'language', v_room.language, 'updated_at', v_room.updated_at),
    'engagement', case when v_eng.id is null then null else jsonb_build_object('id', v_eng.id, 'name', v_eng.name, 'status', v_eng.status, 'agreed_at', v_eng.agreed_at, 'offer_valid_until', v_eng.offer_valid_until) end,
    'sow', (select jsonb_build_object('id', d.id, 'title', d.title, 'current_version', d.current_version, 'status', d.status)
              from public.room_documents d where d.engagement_id = v_eng.id and d.kind = 'sow' order by d.created_at limit 1),
    'readiness', case when v_eng.id is null then null else public.room_sow_readiness(v_eng.id) end,
    'open_questions', (select count(*) from public.room_questions q where q.room_id = v_room.id and q.status = 'open'),
    'members', (select count(*) from public.room_members m where m.room_id = v_room.id and m.side = 'client' and m.status <> 'revoked'),
    'last_client_seen_at', (select max(m.last_seen_at) from public.room_members m where m.room_id = v_room.id and m.side = 'client'),
    'last_event', (select jsonb_build_object('type', e.type, 'created_at', e.created_at, 'payload', e.payload)
                     from public.room_events e where e.room_id = v_room.id and e.type not in ('document_viewed','block_viewed') order by e.created_at desc limit 1)
  );
end;
$$;
revoke execute on function public.room_crm_widget(character varying, character varying) from public, anon;
grant execute on function public.room_crm_widget(character varying, character varying) to authenticated, service_role;
