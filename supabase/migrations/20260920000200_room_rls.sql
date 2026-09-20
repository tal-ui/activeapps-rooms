-- ============================================================================
-- ActiveApps Rooms — Sprint 0 / Migration 3: Row Level Security for room_*
--
-- Rules (spec §5.3):
--   ActiveApps (is_internal())  -> everything.
--   Client member               -> SELECT scoped by is_room_member(room_id), minus
--                                  internal_only comments, draft blocks, confidential
--                                  documents without NDA, and non client_visible events.
--                                  INSERT only comments / questions / events / block
--                                  views, and only as themselves, never internal_only.
--                                  UPDATE only their own comments / questions and their
--                                  own member row (guarded to notification_prefs & co).
--   Clients never read room_blocks directly — they read published snapshots
--   (room_document_versions) through room_document_view(). This keeps unpublished
--   edits invisible even to a client calling the REST API by hand.
--   service_role bypasses RLS (Edge Functions only).
-- ============================================================================

alter table public.rooms                  enable row level security;
alter table public.room_members           enable row level security;
alter table public.room_engagements       enable row level security;
alter table public.room_documents         enable row level security;
alter table public.room_blocks            enable row level security;
alter table public.room_document_versions enable row level security;
alter table public.room_comments          enable row level security;
alter table public.room_questions         enable row level security;
alter table public.room_decisions         enable row level security;
alter table public.room_events            enable row level security;
alter table public.room_notifications     enable row level security;
alter table public.room_templates         enable row level security;
alter table public.room_block_views       enable row level security;

-- Belt and braces: anon never touches these tables at all.
revoke all on public.rooms, public.room_members, public.room_engagements, public.room_documents,
  public.room_blocks, public.room_document_versions, public.room_comments, public.room_questions,
  public.room_decisions, public.room_events, public.room_notifications, public.room_templates,
  public.room_block_views from anon;

-- ---------------------------------------------------------------------------
-- Internal staff: full access on every room table
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'rooms','room_members','room_engagements','room_documents','room_blocks',
    'room_document_versions','room_comments','room_questions','room_decisions',
    'room_events','room_notifications','room_templates','room_block_views'
  ] loop
    execute format('drop policy if exists %I on public.%I', t || '_internal_all', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (public.is_internal()) with check (public.is_internal())',
      t || '_internal_all', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- rooms
-- ---------------------------------------------------------------------------
drop policy if exists rooms_client_select on public.rooms;
create policy rooms_client_select on public.rooms
  for select to authenticated
  using (deleted_at is null and public.is_room_member(id));

-- ---------------------------------------------------------------------------
-- room_members — clients see the whole team of their room, edit only themselves
-- ---------------------------------------------------------------------------
drop policy if exists room_members_client_select on public.room_members;
create policy room_members_client_select on public.room_members
  for select to authenticated
  using (status <> 'revoked' and public.is_room_member(room_id));

drop policy if exists room_members_client_update_self on public.room_members;
create policy room_members_client_update_self on public.room_members
  for update to authenticated
  using (id = public.current_member_id(room_id))
  with check (id = public.current_member_id(room_id));

-- Guard: a client updating their own row may only change the columns below.
create or replace function public.room_members_guard_client_update()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- staff, service role, and the room_* RPCs (which set a transaction-local
  -- flag before updating) bypass the guard; set_config is not reachable via
  -- PostgREST, so a client cannot set the flag themselves.
  if public.is_internal()
     or current_setting('role', true) = 'service_role'
     or current_setting('room.bypass_member_guard', true) = 'on' then
    return new;
  end if;
  new.room_id     := old.room_id;
  new.org_id      := old.org_id;
  new.user_id     := old.user_id;
  new.email       := old.email;
  new.side        := old.side;
  new.role        := old.role;
  new.status      := old.status;
  new.invited_by  := old.invited_by;
  new.joined_at   := old.joined_at;
  new.expires_at  := old.expires_at;
  new.created_at  := old.created_at;
  -- allowed: full_name, title, notification_prefs, nda_accepted_at (set only, never cleared), last_seen_at
  if old.nda_accepted_at is not null then
    new.nda_accepted_at := old.nda_accepted_at;
  end if;
  return new;
end;
$$;
drop trigger if exists room_members_guard_client_update on public.room_members;
create trigger room_members_guard_client_update
  before update on public.room_members
  for each row execute function public.room_members_guard_client_update();

-- ---------------------------------------------------------------------------
-- room_engagements — clients see everything but unshared drafts
-- ---------------------------------------------------------------------------
drop policy if exists room_engagements_client_select on public.room_engagements;
create policy room_engagements_client_select on public.room_engagements
  for select to authenticated
  using (status <> 'draft' and public.is_room_member(room_id));

-- ---------------------------------------------------------------------------
-- room_documents — published only; confidential needs NDA
-- ---------------------------------------------------------------------------
drop policy if exists room_documents_client_select on public.room_documents;
create policy room_documents_client_select on public.room_documents
  for select to authenticated
  using (
    status = 'published'
    and public.is_room_member(room_id)
    and (not confidential or public.has_accepted_nda(room_id))
  );

-- Helper used by several policies: can the current user see this document?
create or replace function public.room_document_visible(p_document_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.is_internal() or exists (
    select 1 from public.room_documents d
     where d.id = p_document_id
       and d.status = 'published'
       and public.is_room_member(d.room_id)
       and (not d.confidential or public.has_accepted_nda(d.room_id))
  );
$$;
revoke execute on function public.room_document_visible(uuid) from public, anon;
grant execute on function public.room_document_visible(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- room_blocks — internal only (clients use room_document_view / versions)
-- (the *_internal_all policy above is the only one)
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- room_document_versions — published snapshots are the client's document
-- ---------------------------------------------------------------------------
drop policy if exists room_document_versions_client_select on public.room_document_versions;
create policy room_document_versions_client_select on public.room_document_versions
  for select to authenticated
  using (public.room_document_visible(document_id));

-- ---------------------------------------------------------------------------
-- room_comments
-- ---------------------------------------------------------------------------
drop policy if exists room_comments_client_select on public.room_comments;
create policy room_comments_client_select on public.room_comments
  for select to authenticated
  using (
    internal_only = false
    and deleted_at is null
    and public.is_room_member(room_id)
    and (document_id is null or public.room_document_visible(document_id))
  );

drop policy if exists room_comments_client_insert on public.room_comments;
create policy room_comments_client_insert on public.room_comments
  for insert to authenticated
  with check (
    internal_only = false
    and author_member_id = public.current_member_id(room_id)
    and public.room_member_role(room_id) in ('owner','approver','commenter')
    and (document_id is null or public.room_document_visible(document_id))
  );

drop policy if exists room_comments_client_update_own on public.room_comments;
create policy room_comments_client_update_own on public.room_comments
  for update to authenticated
  using (author_member_id = public.current_member_id(room_id) and internal_only = false)
  with check (author_member_id = public.current_member_id(room_id) and internal_only = false);

-- ---------------------------------------------------------------------------
-- room_questions / room_decisions
-- ---------------------------------------------------------------------------
drop policy if exists room_questions_client_select on public.room_questions;
create policy room_questions_client_select on public.room_questions
  for select to authenticated
  using (
    public.is_room_member(room_id)
    and (document_id is null or public.room_document_visible(document_id))
  );

drop policy if exists room_questions_client_insert on public.room_questions;
create policy room_questions_client_insert on public.room_questions
  for insert to authenticated
  with check (
    asked_by_member_id = public.current_member_id(room_id)
    and public.room_member_role(room_id) in ('owner','approver','commenter')
    and status = 'open'
    and (document_id is null or public.room_document_visible(document_id))
  );

-- A client may edit a question they asked, or one they own (answering goes
-- through room_answer_question so a Decision is always recorded).
drop policy if exists room_questions_client_update on public.room_questions;
create policy room_questions_client_update on public.room_questions
  for update to authenticated
  using (
    public.current_member_id(room_id) in (asked_by_member_id, owner_member_id)
  )
  with check (
    public.current_member_id(room_id) in (asked_by_member_id, owner_member_id)
  );

drop policy if exists room_decisions_client_select on public.room_decisions;
create policy room_decisions_client_select on public.room_decisions
  for select to authenticated
  using (public.is_room_member(room_id));

-- ---------------------------------------------------------------------------
-- room_events — clients read client_visible; write only as themselves
-- ---------------------------------------------------------------------------
drop policy if exists room_events_client_select on public.room_events;
create policy room_events_client_select on public.room_events
  for select to authenticated
  using (client_visible and public.is_room_member(room_id));

drop policy if exists room_events_client_insert on public.room_events;
create policy room_events_client_insert on public.room_events
  for insert to authenticated
  with check (
    actor_member_id = public.current_member_id(room_id)
    and type in ('room_viewed','document_viewed','block_viewed','file_downloaded','expired_access_requested')
  );

-- ---------------------------------------------------------------------------
-- room_notifications — own rows only; may mark as read
-- ---------------------------------------------------------------------------
drop policy if exists room_notifications_client_select on public.room_notifications;
create policy room_notifications_client_select on public.room_notifications
  for select to authenticated
  using (member_id = public.current_member_id(room_id));

drop policy if exists room_notifications_client_update on public.room_notifications;
create policy room_notifications_client_update on public.room_notifications
  for update to authenticated
  using (member_id = public.current_member_id(room_id))
  with check (member_id = public.current_member_id(room_id));

-- ---------------------------------------------------------------------------
-- room_block_views — own dwell rows
-- ---------------------------------------------------------------------------
drop policy if exists room_block_views_client_all_own on public.room_block_views;
create policy room_block_views_client_all_own on public.room_block_views
  for all to authenticated
  using (member_id = public.current_member_id(room_id))
  with check (member_id = public.current_member_id(room_id));

-- room_templates: internal only (policy above).
