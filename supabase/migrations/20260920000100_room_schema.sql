-- ============================================================================
-- ActiveApps Rooms — Sprint 0 / Migration 1: room_* schema
--
-- Conventions (documented in README.md):
--   * All ids are uuid (gen_random_uuid()).
--   * Timestamps are timestamptz — a deliberate departure from the CRM's
--     bigint-ms convention. Rooms is a new codebase with its own tables; the
--     two never sort or filter across each other. Foreign keys into the CRM
--     (accounts, opportunities) keep the CRM's `character varying` id type.
--   * org_id on every table (single-tenant in v1, product-ready by design).
--   * snake_case, `updated_at` maintained by trigger.
-- ============================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- updated_at trigger
-- ---------------------------------------------------------------------------
create or replace function public.room_touch_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- rooms — one per client account
-- ---------------------------------------------------------------------------
create table if not exists public.rooms (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null default '00000000-0000-0000-0000-000000000001',
  account_id            character varying references public.accounts(id) on delete set null,
  slug                  text not null unique,
  name                  text not null,
  client_name           text not null,
  client_logo_path      text,
  language              text not null default 'he' check (language in ('he','en')),
  phase                 text not null default 'prospect'
                          check (phase in ('prospect','active','retainer','dormant','closed')),
  status_note           text,
  next_milestone_label  text,
  next_milestone_date   date,
  welcome_message       text,
  welcome_video_url     text,
  nda_required          boolean not null default false,
  response_sla_hours    integer not null default 24,
  created_by            uuid references public.profiles(id) on delete set null,
  deleted_at            timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index if not exists rooms_account_idx on public.rooms(account_id);
create index if not exists rooms_org_idx on public.rooms(org_id);

-- ---------------------------------------------------------------------------
-- room_members — both sides; clients are linked to auth.users on first visit
-- ---------------------------------------------------------------------------
create table if not exists public.room_members (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null default '00000000-0000-0000-0000-000000000001',
  room_id             uuid not null references public.rooms(id) on delete cascade,
  user_id             uuid references auth.users(id) on delete set null,
  email               text not null,
  full_name           text not null default '',
  title               text,
  side                text not null check (side in ('activeapps','client')),
  role                text not null
                        check (role in ('admin','member','owner','approver','commenter','viewer')),
  status              text not null default 'invited' check (status in ('invited','active','revoked')),
  invited_by          uuid references public.room_members(id) on delete set null,
  joined_at           timestamptz,
  last_seen_at        timestamptz,
  previous_seen_at    timestamptz,     -- start of the previous visit; "what changed" is computed against this
  expires_at          timestamptz,
  nda_accepted_at     timestamptz,
  notification_prefs  jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint room_members_side_role_chk check (
    (side = 'activeapps' and role in ('admin','member')) or
    (side = 'client'     and role in ('owner','approver','commenter','viewer'))
  )
);
create unique index if not exists room_members_room_email_uq on public.room_members(room_id, lower(email));
create index if not exists room_members_room_idx on public.room_members(room_id);
create index if not exists room_members_user_idx on public.room_members(user_id);

-- ---------------------------------------------------------------------------
-- room_engagements — commercial units inside a room (offer -> project -> retainer)
-- ---------------------------------------------------------------------------
create table if not exists public.room_engagements (
  id                               uuid primary key default gen_random_uuid(),
  org_id                           uuid not null default '00000000-0000-0000-0000-000000000001',
  room_id                          uuid not null references public.rooms(id) on delete cascade,
  opportunity_id                   character varying references public.opportunities(id) on delete set null,
  project_id                       character varying references public.projects(id) on delete set null,
  type                             text not null default 'custom'
                                     check (type in ('foundation','transformation_90d','retainer','custom')),
  name                             text not null,
  status                           text not null default 'draft'
                                     check (status in ('draft','shared','agreed','signed','active','completed','cancelled')),
  currency                         text not null default 'ILS',
  offer_valid_until                date,
  selected_pricing_option_block_id uuid,
  agreed_at                        timestamptz,
  agreed_by_member_id              uuid references public.room_members(id) on delete set null,
  agreed_version_id                uuid,
  agreement_record                 jsonb,
  signed_at                        timestamptz,
  kickoff_date                     date,
  sort_order                       integer not null default 0,
  created_at                       timestamptz not null default now(),
  updated_at                       timestamptz not null default now()
);
create index if not exists room_engagements_room_idx on public.room_engagements(room_id);
create index if not exists room_engagements_opportunity_idx on public.room_engagements(opportunity_id);

-- ---------------------------------------------------------------------------
-- room_documents — block documents or uploaded files
-- ---------------------------------------------------------------------------
create table if not exists public.room_documents (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null default '00000000-0000-0000-0000-000000000001',
  room_id          uuid not null references public.rooms(id) on delete cascade,
  engagement_id    uuid references public.room_engagements(id) on delete set null,
  kind             text not null
                     check (kind in ('sow','offer','msa','dpa','nda','discovery','plan','file')),
  title            text not null,
  status           text not null default 'draft' check (status in ('draft','published','archived')),
  current_version  integer not null default 0,
  confidential     boolean not null default false,
  storage_path     text,
  file_name        text,
  file_size        bigint,
  mime_type        text,
  sort_order       integer not null default 0,
  created_by       uuid references public.room_members(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists room_documents_room_idx on public.room_documents(room_id);
create index if not exists room_documents_engagement_idx on public.room_documents(engagement_id);

-- ---------------------------------------------------------------------------
-- room_blocks — the unit of content and of approval
-- ---------------------------------------------------------------------------
create table if not exists public.room_blocks (
  id                   uuid primary key default gen_random_uuid(),
  org_id               uuid not null default '00000000-0000-0000-0000-000000000001',
  room_id              uuid not null references public.rooms(id) on delete cascade,
  document_id          uuid not null references public.room_documents(id) on delete cascade,
  parent_block_id      uuid references public.room_blocks(id) on delete cascade,
  sort_order           integer not null default 0,
  type                 text not null check (type in (
                         'heading','text','deliverable','assumption','milestone',
                         'pricing_option','pricing_line','callout','file','image','table','divider')),
  content              jsonb not null default '{}'::jsonb,
  status               text not null default 'draft'
                         check (status in ('draft','in_review','agreed','changed')),
  content_hash         text,
  approved_by_member_id uuid references public.room_members(id) on delete set null,
  approved_at          timestamptz,
  approved_version     integer,
  approved_content_hash text,          -- hash of the published content the approver actually saw
  published_version    integer,          -- first version this block appeared in
  deleted_at           timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index if not exists room_blocks_document_sort_idx on public.room_blocks(document_id, sort_order);
create index if not exists room_blocks_room_idx on public.room_blocks(room_id);

alter table public.room_engagements
  drop constraint if exists room_engagements_selected_pricing_fk;
alter table public.room_engagements
  add constraint room_engagements_selected_pricing_fk
  foreign key (selected_pricing_option_block_id) references public.room_blocks(id) on delete set null;

-- ---------------------------------------------------------------------------
-- room_document_versions — immutable snapshots
-- ---------------------------------------------------------------------------
create table if not exists public.room_document_versions (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null default '00000000-0000-0000-0000-000000000001',
  room_id         uuid not null references public.rooms(id) on delete cascade,
  document_id     uuid not null references public.room_documents(id) on delete cascade,
  version         integer not null,
  snapshot        jsonb not null,
  change_summary  text,
  content_hash    text,
  published_by    uuid references public.room_members(id) on delete set null,
  published_at    timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (document_id, version)
);
create index if not exists room_document_versions_room_idx on public.room_document_versions(room_id);

alter table public.room_engagements
  drop constraint if exists room_engagements_agreed_version_fk;
alter table public.room_engagements
  add constraint room_engagements_agreed_version_fk
  foreign key (agreed_version_id) references public.room_document_versions(id) on delete set null;

-- ---------------------------------------------------------------------------
-- room_comments — anchored to block (default), document, or room
-- ---------------------------------------------------------------------------
create table if not exists public.room_comments (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null default '00000000-0000-0000-0000-000000000001',
  room_id           uuid not null references public.rooms(id) on delete cascade,
  document_id       uuid references public.room_documents(id) on delete cascade,
  block_id          uuid references public.room_blocks(id) on delete cascade,
  version           integer,
  parent_id         uuid references public.room_comments(id) on delete cascade,
  author_member_id  uuid not null references public.room_members(id) on delete cascade,
  body              text not null,
  mentions          uuid[] not null default '{}',
  internal_only     boolean not null default false,
  resolved_at       timestamptz,
  resolved_by       uuid references public.room_members(id) on delete set null,
  deleted_at        timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists room_comments_room_idx on public.room_comments(room_id);
create index if not exists room_comments_block_idx on public.room_comments(block_id);
create index if not exists room_comments_document_idx on public.room_comments(document_id);

-- ---------------------------------------------------------------------------
-- room_questions / room_decisions — first-class objects, not comments
-- ---------------------------------------------------------------------------
create table if not exists public.room_questions (
  id                   uuid primary key default gen_random_uuid(),
  org_id               uuid not null default '00000000-0000-0000-0000-000000000001',
  room_id              uuid not null references public.rooms(id) on delete cascade,
  document_id          uuid references public.room_documents(id) on delete set null,
  block_id             uuid references public.room_blocks(id) on delete set null,
  title                text not null,
  body                 text,
  asked_by_member_id   uuid not null references public.room_members(id) on delete cascade,
  owner_member_id      uuid references public.room_members(id) on delete set null,
  due_date             date,
  status               text not null default 'open' check (status in ('open','answered','closed')),
  answer               text,
  answered_by_member_id uuid references public.room_members(id) on delete set null,
  answered_at          timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index if not exists room_questions_room_idx on public.room_questions(room_id);
create index if not exists room_questions_owner_idx on public.room_questions(owner_member_id, status);

create table if not exists public.room_decisions (
  id                   uuid primary key default gen_random_uuid(),
  org_id               uuid not null default '00000000-0000-0000-0000-000000000001',
  room_id              uuid not null references public.rooms(id) on delete cascade,
  question_id          uuid references public.room_questions(id) on delete set null,
  block_id             uuid references public.room_blocks(id) on delete set null,
  text                 text not null,
  decided_by_member_id uuid references public.room_members(id) on delete set null,
  decided_at           timestamptz not null default now(),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index if not exists room_decisions_room_idx on public.room_decisions(room_id, decided_at desc);

-- ---------------------------------------------------------------------------
-- room_events — everything that happens; feeds activity, notifications, analytics
-- ---------------------------------------------------------------------------
create table if not exists public.room_events (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null default '00000000-0000-0000-0000-000000000001',
  room_id          uuid not null references public.rooms(id) on delete cascade,
  actor_member_id  uuid references public.room_members(id) on delete set null,
  type             text not null,
  entity_type      text,
  entity_id        uuid,
  payload          jsonb not null default '{}'::jsonb,
  client_visible   boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists room_events_room_created_idx on public.room_events(room_id, created_at desc);
create index if not exists room_events_type_idx on public.room_events(room_id, type);

-- ---------------------------------------------------------------------------
-- room_notifications — one row per member per channel per event
-- ---------------------------------------------------------------------------
create table if not exists public.room_notifications (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null default '00000000-0000-0000-0000-000000000001',
  room_id        uuid not null references public.rooms(id) on delete cascade,
  member_id      uuid not null references public.room_members(id) on delete cascade,
  event_id       uuid references public.room_events(id) on delete set null,
  channel        text not null check (channel in ('email','slack','in_app')),
  status         text not null default 'pending' check (status in ('pending','sent','failed','read')),
  scheduled_for  timestamptz,
  sent_at        timestamptz,
  read_at        timestamptz,
  payload        jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists room_notifications_member_status_idx on public.room_notifications(member_id, status);
create index if not exists room_notifications_room_idx on public.room_notifications(room_id);

-- ---------------------------------------------------------------------------
-- room_templates — engagement blueprints (documents + blocks)
-- ---------------------------------------------------------------------------
create table if not exists public.room_templates (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null default '00000000-0000-0000-0000-000000000001',
  name             text not null,
  engagement_type  text not null check (engagement_type in ('foundation','transformation_90d','retainer','custom')),
  language         text not null default 'he' check (language in ('he','en')),
  blueprint        jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- room_block_views — per-member dwell tracking (v1 analytics)
-- ---------------------------------------------------------------------------
create table if not exists public.room_block_views (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null default '00000000-0000-0000-0000-000000000001',
  room_id      uuid not null references public.rooms(id) on delete cascade,
  member_id    uuid not null references public.room_members(id) on delete cascade,
  block_id     uuid not null references public.room_blocks(id) on delete cascade,
  dwell_ms     integer not null default 0,
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (member_id, block_id)
);
create index if not exists room_block_views_room_idx on public.room_block_views(room_id);

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'rooms','room_members','room_engagements','room_documents','room_blocks',
    'room_document_versions','room_comments','room_questions','room_decisions',
    'room_events','room_notifications','room_templates','room_block_views'
  ] loop
    execute format('drop trigger if exists %I_touch on public.%I', t, t);
    execute format('create trigger %I_touch before update on public.%I for each row execute function public.room_touch_updated_at()', t, t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Block lifecycle: an agreed block that is edited flips to `changed`
-- ---------------------------------------------------------------------------
create or replace function public.room_block_content_changed()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.content_hash := md5(new.type || ':' || new.content::text);
  if tg_op = 'UPDATE' and old.status = 'agreed' and new.content_hash is distinct from old.content_hash then
    new.status := 'changed';
  end if;
  return new;
end;
$$;
drop trigger if exists room_blocks_content_hash on public.room_blocks;
create trigger room_blocks_content_hash
  before insert or update of type, content on public.room_blocks
  for each row execute function public.room_block_content_changed();

-- ---------------------------------------------------------------------------
-- Room phase follows its engagements (spec §3)
-- ---------------------------------------------------------------------------
create or replace function public.room_recompute_phase(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_phase text := 'prospect';
begin
  select case
    when exists (select 1 from public.room_engagements e where e.room_id = p_room_id and e.type = 'retainer' and e.status = 'active') then 'retainer'
    when exists (select 1 from public.room_engagements e where e.room_id = p_room_id and e.status = 'active') then 'active'
    when exists (select 1 from public.room_engagements e where e.room_id = p_room_id and e.status in ('draft','shared','agreed','signed')) then 'prospect'
    when exists (select 1 from public.room_engagements e where e.room_id = p_room_id and e.status = 'completed') then 'dormant'
    else 'prospect' end
  into v_phase;
  update public.rooms set phase = v_phase where id = p_room_id and phase not in ('closed') and phase is distinct from v_phase;
end;
$$;
-- only the engagement trigger (SECURITY DEFINER, runs as owner) calls this
revoke execute on function public.room_recompute_phase(uuid) from public, anon, authenticated;

create or replace function public.room_engagement_status_changed()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.room_recompute_phase(coalesce(new.room_id, old.room_id));
  return coalesce(new, old);
end;
$$;
drop trigger if exists room_engagements_phase on public.room_engagements;
create trigger room_engagements_phase
  after insert or update of status, type or delete on public.room_engagements
  for each row execute function public.room_engagement_status_changed();

-- ---------------------------------------------------------------------------
-- Link a member to auth.users on first sign-in (called by the app)
-- ---------------------------------------------------------------------------
create or replace function public.room_claim_membership()
returns setof public.room_members
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if auth.uid() is null or v_email = '' then
    return;
  end if;
  perform set_config('room.bypass_member_guard', 'on', true);
  return query
    update public.room_members m
       set user_id = auth.uid(),
           status = case when m.status = 'invited' then 'active' else m.status end,
           joined_at = coalesce(m.joined_at, now())
     where lower(m.email) = v_email
       and (m.user_id is null or m.user_id = auth.uid())
       and m.status in ('invited','active')
     returning m.*;
  perform set_config('room.bypass_member_guard', '', true);
  return;
end;
$$;
revoke execute on function public.room_claim_membership() from public, anon;
grant execute on function public.room_claim_membership() to authenticated;

-- Visit bookkeeping. A visit that starts more than 30 minutes after the last
-- touch is a new visit: previous_seen_at moves to the old last_seen_at, so
-- "new since your last visit" stays stable for the whole session instead of
-- collapsing to "now" on the first page load.
create or replace function public.room_touch_last_seen(p_room_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_last   timestamptz;
  v_prev   timestamptz;
  v_member uuid := public.current_member_id(p_room_id);
begin
  if v_member is null then return null; end if;
  select last_seen_at, previous_seen_at into v_last, v_prev from public.room_members where id = v_member;
  perform set_config('room.bypass_member_guard', 'on', true);
  if v_last is null or v_last < now() - interval '30 minutes' then
    update public.room_members set previous_seen_at = v_last, last_seen_at = now() where id = v_member;
    v_prev := v_last;
  else
    update public.room_members set last_seen_at = now() where id = v_member;
  end if;
  perform set_config('room.bypass_member_guard', '', true);
  return v_prev;
end;
$$;
revoke execute on function public.room_touch_last_seen(uuid) from public, anon;
grant execute on function public.room_touch_last_seen(uuid) to authenticated;
