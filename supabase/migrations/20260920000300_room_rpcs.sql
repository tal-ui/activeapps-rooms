-- ============================================================================
-- ActiveApps Rooms — Sprint 0 / Migration 4: RPC layer
--
-- Every state transition a client can trigger is a SECURITY DEFINER function
-- with its own permission check, so the rules live in one place and hold
-- regardless of which client (web app, curl, Edge Function) calls them.
--
--   room_document_view(document_id, version)   -> what the viewer renders
--   room_publish_version(document_id, summary) -> internal: snapshot + diff
--   room_approve_block(block_id)               -> client owner/approver
--   room_approve_sow(engagement_id, ua)        -> client owner/approver
--   room_select_pricing_option(engagement, blk)-> client owner/approver
--   room_accept_nda(room_id)                   -> any client member
--   room_answer_question(q, answer, decision)  -> owner of the question / internal
--   room_invite_member(room, email, name, ...) -> internal, or client owner
--   room_emit_event(...)                       -> internal helper used above
-- ============================================================================

create or replace function public.room_emit_event(
  p_room_id uuid,
  p_type text,
  p_entity_type text default null,
  p_entity_id uuid default null,
  p_payload jsonb default '{}'::jsonb,
  p_client_visible boolean default true,
  p_actor_member_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_id uuid;
begin
  insert into public.room_events (room_id, actor_member_id, type, entity_type, entity_id, payload, client_visible)
  values (p_room_id, coalesce(p_actor_member_id, public.current_member_id(p_room_id)), p_type, p_entity_type, p_entity_id, coalesce(p_payload, '{}'::jsonb), p_client_visible)
  returning id into v_id;
  return v_id;
end;
$$;
revoke execute on function public.room_emit_event(uuid, text, text, uuid, jsonb, boolean, uuid) from public, anon, authenticated;
grant execute on function public.room_emit_event(uuid, text, text, uuid, jsonb, boolean, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Approvable block types (the ones "Approve the SOW" waits for)
-- ---------------------------------------------------------------------------
create or replace function public.room_block_is_approvable(p_type text)
returns boolean
language sql
immutable
as $$
  select p_type in ('deliverable','assumption','milestone','pricing_line','table');
$$;

-- ---------------------------------------------------------------------------
-- room_document_view — a single payload for the viewer
--   content   from the requested (or latest) published snapshot
--   status    live approval state per block (agreed overrides the snapshot)
--   counters  open comments / open questions per block
--   diff      vs previous version: added / removed / changed block ids
-- Internal users may also ask for version 0 = the live working copy.
-- ---------------------------------------------------------------------------
create or replace function public.room_document_view(p_document_id uuid, p_version integer default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_doc          public.room_documents%rowtype;
  v_version      integer;
  v_snapshot     jsonb;
  v_prev         jsonb;
  v_blocks       jsonb;
  v_versions     jsonb;
  v_is_internal  boolean := public.is_internal();
  v_member       uuid;
  v_last_seen    timestamptz;
begin
  select * into v_doc from public.room_documents where id = p_document_id;
  if v_doc.id is null then
    raise exception 'document not found' using errcode = 'P0002';
  end if;
  if not v_is_internal and not public.room_document_visible(p_document_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  v_member := public.current_member_id(v_doc.room_id);
  select previous_seen_at into v_last_seen from public.room_members where id = v_member;

  v_version := coalesce(p_version, v_doc.current_version);

  if v_version = 0 then
    if not v_is_internal then
      raise exception 'not allowed' using errcode = '42501';
    end if;
    -- live working copy
    select coalesce(jsonb_agg(jsonb_build_object(
        'id', b.id, 'type', b.type, 'content', b.content, 'sort_order', b.sort_order,
        'parent_block_id', b.parent_block_id, 'content_hash', b.content_hash,
        'status', b.status, 'published_version', b.published_version
      ) order by b.sort_order), '[]'::jsonb)
      into v_snapshot
      from public.room_blocks b
     where b.document_id = p_document_id and b.deleted_at is null;
  else
    select v.snapshot into v_snapshot
      from public.room_document_versions v
     where v.document_id = p_document_id and v.version = v_version;
    if v_snapshot is null then
      v_snapshot := '[]'::jsonb;
    end if;
  end if;

  if v_version > 1 then
    select v.snapshot into v_prev
      from public.room_document_versions v
     where v.document_id = p_document_id and v.version = v_version - 1;
  end if;
  v_prev := coalesce(v_prev, '[]'::jsonb);

  -- merge live status / counters into the snapshot
  select coalesce(jsonb_agg(
      s || jsonb_build_object(
        'live_status', coalesce(b.status, s->>'status'),
        'display_status', case
            when b.approved_content_hash is not null and b.approved_content_hash = s->>'content_hash' then 'agreed'
            when b.approved_content_hash is not null then 'changed'
            else coalesce(nullif(s->>'status', 'agreed'), 'in_review') end,
        'approved_at', b.approved_at,
        'approved_by_member_id', b.approved_by_member_id,
        'approved_version', b.approved_version,
        'comment_count', (select count(*) from public.room_comments c
                            where c.block_id = (s->>'id')::uuid and c.deleted_at is null
                              and c.resolved_at is null and (v_is_internal or c.internal_only = false)),
        'open_question_count', (select count(*) from public.room_questions q
                            where q.block_id = (s->>'id')::uuid and q.status = 'open'),
        'diff', case
            when not exists (select 1 from jsonb_array_elements(v_prev) p where p->>'id' = s->>'id') and v_version > 1 then 'added'
            when exists (select 1 from jsonb_array_elements(v_prev) p where p->>'id' = s->>'id' and p->>'content_hash' is distinct from s->>'content_hash') then 'changed'
            else null end,
        'is_new_since_visit', (v_last_seen is not null and v_version > 0 and exists (
            select 1 from public.room_document_versions vv
             where vv.document_id = p_document_id and vv.version = v_version and vv.published_at > v_last_seen))
      ) order by (s->>'sort_order')::int), '[]'::jsonb)
    into v_blocks
    from jsonb_array_elements(v_snapshot) s
    left join public.room_blocks b on b.id = (s->>'id')::uuid;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', v.id, 'version', v.version, 'change_summary', v.change_summary,
      'published_at', v.published_at, 'published_by', v.published_by
    ) order by v.version desc), '[]'::jsonb)
    into v_versions
    from public.room_document_versions v where v.document_id = p_document_id;

  return jsonb_build_object(
    'document', jsonb_build_object(
      'id', v_doc.id, 'room_id', v_doc.room_id, 'engagement_id', v_doc.engagement_id,
      'kind', v_doc.kind, 'title', v_doc.title, 'status', v_doc.status,
      'current_version', v_doc.current_version, 'confidential', v_doc.confidential),
    'version', v_version,
    'blocks', v_blocks,
    'removed_since_previous', (
      select coalesce(jsonb_agg(p), '[]'::jsonb) from jsonb_array_elements(v_prev) p
       where not exists (select 1 from jsonb_array_elements(v_snapshot) s where s->>'id' = p->>'id')),
    'versions', v_versions,
    'viewer', jsonb_build_object('member_id', v_member, 'is_internal', v_is_internal,
                                 'role', public.room_member_role(v_doc.room_id))
  );
end;
$$;
revoke execute on function public.room_document_view(uuid, integer) from public, anon;
grant execute on function public.room_document_view(uuid, integer) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- room_publish_version — internal only
-- ---------------------------------------------------------------------------
create or replace function public.room_publish_version(p_document_id uuid, p_change_summary text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_doc       public.room_documents%rowtype;
  v_next      integer;
  v_snapshot  jsonb;
  v_prev      jsonb := '[]'::jsonb;
  v_added     integer := 0;
  v_changed   integer := 0;
  v_removed   integer := 0;
  v_summary   text;
  v_version_id uuid;
  v_member    uuid;
begin
  if not public.is_internal() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select * into v_doc from public.room_documents where id = p_document_id for update;
  if v_doc.id is null then raise exception 'document not found' using errcode = 'P0002'; end if;
  if v_doc.kind = 'file' then raise exception 'files have no versions' using errcode = '22023'; end if;

  v_next := v_doc.current_version + 1;
  v_member := public.current_member_id(v_doc.room_id);

  -- status transitions on the working copy
  update public.room_blocks
     set status = case when status = 'draft' then 'in_review' else status end,
         published_version = coalesce(published_version, v_next)
   where document_id = p_document_id and deleted_at is null;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', b.id, 'type', b.type, 'content', b.content, 'sort_order', b.sort_order,
      'parent_block_id', b.parent_block_id, 'content_hash', b.content_hash,
      'status', b.status, 'published_version', b.published_version
    ) order by b.sort_order), '[]'::jsonb)
    into v_snapshot
    from public.room_blocks b
   where b.document_id = p_document_id and b.deleted_at is null;

  if v_next > 1 then
    select snapshot into v_prev from public.room_document_versions
     where document_id = p_document_id and version = v_next - 1;
    v_prev := coalesce(v_prev, '[]'::jsonb);
  end if;

  select
    count(*) filter (where not exists (select 1 from jsonb_array_elements(v_prev) p where p->>'id' = s->>'id')),
    count(*) filter (where exists (select 1 from jsonb_array_elements(v_prev) p where p->>'id' = s->>'id' and p->>'content_hash' is distinct from s->>'content_hash'))
    into v_added, v_changed
    from jsonb_array_elements(v_snapshot) s;
  select count(*) into v_removed
    from jsonb_array_elements(v_prev) p
   where not exists (select 1 from jsonb_array_elements(v_snapshot) s where s->>'id' = p->>'id');

  v_summary := coalesce(nullif(trim(p_change_summary), ''),
    case when v_next = 1 then 'First published version'
         else format('%s added, %s changed, %s removed', v_added, v_changed, v_removed) end);

  insert into public.room_document_versions (room_id, document_id, version, snapshot, change_summary, content_hash, published_by)
  values (v_doc.room_id, p_document_id, v_next, v_snapshot, v_summary, md5(v_snapshot::text), v_member)
  returning id into v_version_id;

  update public.room_documents
     set current_version = v_next, status = 'published'
   where id = p_document_id;

  -- shared engagement once its SOW / offer is out (not for NDA, plan, …)
  if v_doc.kind in ('sow','offer') then
    update public.room_engagements
       set status = 'shared'
     where id = v_doc.engagement_id and status = 'draft';
  end if;

  perform public.room_emit_event(v_doc.room_id, 'version_published', 'document', p_document_id,
    jsonb_build_object('version', v_next, 'change_summary', v_summary,
                       'added', v_added, 'changed', v_changed, 'removed', v_removed,
                       'title', v_doc.title, 'version_id', v_version_id),
    true, v_member);

  return jsonb_build_object('version', v_next, 'version_id', v_version_id, 'change_summary', v_summary,
                            'added', v_added, 'changed', v_changed, 'removed', v_removed);
end;
$$;
revoke execute on function public.room_publish_version(uuid, text) from public, anon;
grant execute on function public.room_publish_version(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- room_approve_block — client owner / approver
-- ---------------------------------------------------------------------------
create or replace function public.room_approve_block(p_block_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_block  public.room_blocks%rowtype;
  v_doc    public.room_documents%rowtype;
  v_member uuid;
  v_role   text;
  v_snapshot_hash text;
  v_new_status text;
begin
  select * into v_block from public.room_blocks where id = p_block_id and deleted_at is null for update;
  if v_block.id is null then raise exception 'block not found' using errcode = 'P0002'; end if;
  select * into v_doc from public.room_documents where id = v_block.document_id;

  v_member := public.current_member_id(v_block.room_id);
  v_role   := public.room_member_role(v_block.room_id);
  if v_member is null or v_role not in ('owner','approver') then
    raise exception 'only a client owner or approver can approve blocks' using errcode = '42501';
  end if;
  if not public.room_document_visible(v_block.document_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if not public.room_block_is_approvable(v_block.type) then
    raise exception 'this block type is not approvable' using errcode = '22023';
  end if;
  -- the approver approves what was published: take the hash from the current snapshot
  select s->>'content_hash' into v_snapshot_hash
    from public.room_document_versions v, jsonb_array_elements(v.snapshot) s
   where v.document_id = v_doc.id and v.version = v_doc.current_version and s->>'id' = p_block_id::text;
  if v_snapshot_hash is null then
    raise exception 'block is not part of the published version' using errcode = '22023';
  end if;

  update public.room_blocks
     set status = case when content_hash = v_snapshot_hash then 'agreed' else 'changed' end,
         approved_by_member_id = v_member,
         approved_at = now(),
         approved_version = v_doc.current_version,
         approved_content_hash = v_snapshot_hash
   where id = p_block_id
   returning status into v_new_status;

  perform public.room_emit_event(v_block.room_id, 'block_approved', 'block', p_block_id,
    jsonb_build_object('document_id', v_block.document_id, 'version', v_doc.current_version,
                       'block_type', v_block.type, 'title', coalesce(v_block.content->>'title', v_block.content->>'text', v_block.content->>'label')),
    true, v_member);

  -- 'changed' here means: the published content is approved, but the working
  -- copy already differs — the next publish will ask for re-approval.
  return jsonb_build_object('ok', true, 'status', v_new_status, 'approved_at', now(), 'version', v_doc.current_version);
end;
$$;
revoke execute on function public.room_approve_block(uuid) from public, anon;
grant execute on function public.room_approve_block(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- room_sow_readiness — how many approvable blocks are still pending
-- ---------------------------------------------------------------------------
create or replace function public.room_sow_readiness(p_engagement_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_room uuid;
begin
  select room_id into v_room from public.room_engagements where id = p_engagement_id;
  if v_room is null then return null; end if;
  if not public.is_internal() and not public.is_room_member(v_room) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return (
    with sow as (
      select d.* from public.room_documents d
       where d.engagement_id = p_engagement_id and d.kind = 'sow' and d.status = 'published'
       order by d.created_at limit 1
    ),
    snap as (
      select (s->>'id')::uuid as id, s->>'type' as type, s->>'content_hash' as content_hash
        from public.room_document_versions v join sow on sow.id = v.document_id and v.version = sow.current_version,
             jsonb_array_elements(v.snapshot) s
    ),
    blocks as (
      select snap.id, (b.approved_content_hash is not null and b.approved_content_hash = snap.content_hash) as agreed
        from snap join public.room_blocks b on b.id = snap.id
       where public.room_block_is_approvable(snap.type)
    )
    select jsonb_build_object(
      'sow_document_id', (select id from sow),
      'version', (select current_version from sow),
      'total', (select count(*) from blocks),
      'agreed', (select count(*) from blocks where agreed),
      'pending', (select count(*) from blocks where not agreed),
      'ready', (select count(*) from blocks) > 0 and (select count(*) from blocks where not agreed) = 0,
      'pending_block_ids', (select coalesce(jsonb_agg(id), '[]'::jsonb) from blocks where not agreed)
    )
  );
end;
$$;
revoke execute on function public.room_sow_readiness(uuid) from public, anon;
grant execute on function public.room_sow_readiness(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- room_approve_sow — commercial approval of the scope (not an e-signature)
-- ---------------------------------------------------------------------------
create or replace function public.room_approve_sow(p_engagement_id uuid, p_user_agent text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_eng      public.room_engagements%rowtype;
  v_member   public.room_members%rowtype;
  v_ready    jsonb;
  v_version  public.room_document_versions%rowtype;
  v_record   jsonb;
begin
  select * into v_eng from public.room_engagements where id = p_engagement_id for update;
  if v_eng.id is null then raise exception 'engagement not found' using errcode = 'P0002'; end if;

  select * into v_member from public.room_members where id = public.current_member_id(v_eng.room_id);
  if v_member.id is null or v_member.role not in ('owner','approver') then
    raise exception 'only a client owner or approver can approve the SOW' using errcode = '42501';
  end if;
  if v_eng.status not in ('shared') then
    raise exception 'engagement is not awaiting approval (status %)', v_eng.status using errcode = '22023';
  end if;

  if v_eng.offer_valid_until is not null and v_eng.offer_valid_until < current_date then
    raise exception 'the offer expired on %', v_eng.offer_valid_until using errcode = '22023';
  end if;

  v_ready := public.room_sow_readiness(p_engagement_id);
  if not (v_ready->>'ready')::boolean then
    raise exception '% block(s) still need approval', v_ready->>'pending' using errcode = '22023';
  end if;

  select * into v_version from public.room_document_versions
   where document_id = (v_ready->>'sow_document_id')::uuid
     and version = (v_ready->>'version')::int;

  -- when the published SOW offers pricing options, one must be chosen (and be in the snapshot)
  if exists (select 1 from jsonb_array_elements(v_version.snapshot) s where s->>'type' = 'pricing_option') then
    if v_eng.selected_pricing_option_block_id is null
       or not exists (select 1 from jsonb_array_elements(v_version.snapshot) s
                       where s->>'id' = v_eng.selected_pricing_option_block_id::text) then
      raise exception 'choose a pricing option before approving the SOW' using errcode = '22023';
    end if;
  end if;

  v_record := jsonb_build_object(
    'member_id', v_member.id,
    'full_name', v_member.full_name,
    'email', v_member.email,
    'title', v_member.title,
    'approved_at', now(),
    'document_id', v_version.document_id,
    'version', v_version.version,
    'version_id', v_version.id,
    'content_hash', v_version.content_hash,
    'user_agent', p_user_agent,
    'selected_pricing_option_block_id', v_eng.selected_pricing_option_block_id
  );

  update public.room_engagements
     set status = 'agreed',
         agreed_at = now(),
         agreed_by_member_id = v_member.id,
         agreed_version_id = v_version.id,
         agreement_record = v_record
   where id = p_engagement_id;

  perform public.room_emit_event(v_eng.room_id, 'sow_approved', 'engagement', p_engagement_id,
    jsonb_build_object('engagement_name', v_eng.name, 'version', v_version.version,
                       'document_id', v_version.document_id, 'by', v_member.full_name),
    true, v_member.id);

  return jsonb_build_object('ok', true, 'status', 'agreed', 'agreement_record', v_record);
end;
$$;
revoke execute on function public.room_approve_sow(uuid, text) from public, anon;
grant execute on function public.room_approve_sow(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- room_select_pricing_option
-- ---------------------------------------------------------------------------
create or replace function public.room_select_pricing_option(p_engagement_id uuid, p_block_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_eng    public.room_engagements%rowtype;
  v_block  public.room_blocks%rowtype;
  v_member uuid;
  v_role   text;
begin
  select * into v_eng from public.room_engagements where id = p_engagement_id for update;
  if v_eng.id is null then raise exception 'engagement not found' using errcode = 'P0002'; end if;
  v_member := public.current_member_id(v_eng.room_id);
  v_role := public.room_member_role(v_eng.room_id);
  if not public.is_internal() and (v_member is null or v_role not in ('owner','approver')) then
    raise exception 'only a client owner or approver can choose a pricing option' using errcode = '42501';
  end if;
  if v_eng.status not in ('draft','shared') then
    raise exception 'pricing is locked once the engagement is agreed' using errcode = '22023';
  end if;

  select * into v_block from public.room_blocks b
   where b.id = p_block_id and b.type = 'pricing_option' and b.deleted_at is null
     and exists (select 1 from public.room_documents d where d.id = b.document_id and d.engagement_id = p_engagement_id);
  if v_block.id is null then raise exception 'pricing option not found in this engagement' using errcode = 'P0002'; end if;
  if v_block.status = 'draft' and not public.is_internal() then
    raise exception 'option is not published yet' using errcode = '22023';
  end if;
  if not public.is_internal() and not public.room_document_visible(v_block.document_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  update public.room_engagements set selected_pricing_option_block_id = p_block_id where id = p_engagement_id;

  perform public.room_emit_event(v_eng.room_id, 'pricing_option_selected', 'block', p_block_id,
    jsonb_build_object('engagement_id', p_engagement_id, 'engagement_name', v_eng.name,
                       'option_name', v_block.content->>'name', 'document_id', v_block.document_id),
    true, v_member);
  return jsonb_build_object('ok', true, 'selected_pricing_option_block_id', p_block_id);
end;
$$;
revoke execute on function public.room_select_pricing_option(uuid, uuid) from public, anon;
grant execute on function public.room_select_pricing_option(uuid, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- room_accept_nda
-- ---------------------------------------------------------------------------
create or replace function public.room_accept_nda(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_member uuid := public.current_member_id(p_room_id);
  v_already timestamptz;
begin
  if v_member is null then raise exception 'not a member' using errcode = '42501'; end if;
  select nda_accepted_at into v_already from public.room_members where id = v_member;
  if v_already is not null then
    return jsonb_build_object('ok', true, 'nda_accepted_at', v_already, 'already', true);
  end if;
  perform set_config('room.bypass_member_guard', 'on', true);
  update public.room_members set nda_accepted_at = now() where id = v_member;
  perform set_config('room.bypass_member_guard', '', true);
  perform public.room_emit_event(p_room_id, 'nda_accepted', 'member', v_member, '{}'::jsonb, true, v_member);
  return jsonb_build_object('ok', true, 'nda_accepted_at', now());
end;
$$;
revoke execute on function public.room_accept_nda(uuid) from public, anon;
grant execute on function public.room_accept_nda(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- room_answer_question — answering always records a Decision
-- ---------------------------------------------------------------------------
create or replace function public.room_answer_question(p_question_id uuid, p_answer text, p_decision_text text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_q      public.room_questions%rowtype;
  v_member uuid;
  v_dec    uuid;
begin
  select * into v_q from public.room_questions where id = p_question_id for update;
  if v_q.id is null then raise exception 'question not found' using errcode = 'P0002'; end if;
  v_member := public.current_member_id(v_q.room_id);
  if not public.is_internal()
     and (v_member is null or v_q.owner_member_id is null or v_member <> v_q.owner_member_id) then
    raise exception 'only the owner of the question (or ActiveApps) can answer it' using errcode = '42501';
  end if;
  if v_q.status <> 'open' then
    raise exception 'question is already answered' using errcode = '22023';
  end if;
  if nullif(trim(p_answer), '') is null then
    raise exception 'answer is required' using errcode = '22023';
  end if;

  update public.room_questions
     set status = 'answered', answer = p_answer, answered_by_member_id = v_member, answered_at = now()
   where id = p_question_id;

  insert into public.room_decisions (room_id, question_id, block_id, text, decided_by_member_id)
  values (v_q.room_id, p_question_id, v_q.block_id, coalesce(nullif(trim(p_decision_text), ''), p_answer), v_member)
  returning id into v_dec;

  perform public.room_emit_event(v_q.room_id, 'question_answered', 'question', p_question_id,
    jsonb_build_object('title', v_q.title, 'answer', p_answer, 'decision_id', v_dec,
                       'asked_by_member_id', v_q.asked_by_member_id, 'block_id', v_q.block_id),
    true, v_member);
  return jsonb_build_object('ok', true, 'decision_id', v_dec);
end;
$$;
revoke execute on function public.room_answer_question(uuid, text, text) from public, anon;
grant execute on function public.room_answer_question(uuid, text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- room_invite_member — internal, or a client owner inviting colleagues
-- ---------------------------------------------------------------------------
create or replace function public.room_invite_member(
  p_room_id uuid, p_email text, p_full_name text, p_title text default null,
  p_role text default 'commenter', p_side text default 'client', p_expires_at timestamptz default null)
returns public.room_members
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_inviter  uuid := public.current_member_id(p_room_id);
  v_role     text := public.room_member_role(p_room_id);
  v_row      public.room_members%rowtype;
  v_existing public.room_members%rowtype;
begin
  if public.is_internal() then
    if not public.is_internal_writer() then
      raise exception 'read-only staff cannot invite' using errcode = '42501';
    end if;
  elsif v_role = 'owner' then
    if p_side <> 'client' or p_role not in ('approver','commenter','viewer') then
      raise exception 'a client owner can invite approvers, commenters or viewers on the client side' using errcode = '42501';
    end if;
  else
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'invalid e-mail' using errcode = '22023';
  end if;
  -- A staff e-mail on the client side would strip that person of is_internal()
  -- (and thereby of all CRM access). Refuse for every caller; the trigger
  -- room_members_guard_staff_email enforces the same rule on any write path.
  if p_side = 'client' and public.is_staff_email(p_email) then
    raise exception 'this e-mail belongs to an ActiveApps staff profile; invite them on the ActiveApps side' using errcode = '42501';
  end if;

  select * into v_existing from public.room_members
   where room_id = p_room_id and lower(email) = lower(trim(p_email));

  if v_existing.id is not null then
    if not public.is_internal() then
      -- a client owner may only re-send an outstanding client invitation
      if v_existing.side = 'client' and v_existing.status = 'invited' then
        return v_existing;
      end if;
      raise exception 'this person is already a member of the room' using errcode = '23505';
    end if;
    -- staff: update role / details, reinstate if revoked
    perform set_config('room.bypass_member_guard', 'on', true);
    update public.room_members
       set status = case when status = 'revoked' then 'invited' else status end,
           side = p_side, role = p_role,
           full_name = coalesce(nullif(p_full_name, ''), full_name),
           title = coalesce(p_title, title),
           expires_at = p_expires_at
     where id = v_existing.id
     returning * into v_row;
    perform set_config('room.bypass_member_guard', '', true);
    if v_existing.status = 'revoked' then
      perform public.room_emit_event(p_room_id, 'member_invited', 'member', v_row.id,
        jsonb_build_object('email', v_row.email, 'full_name', v_row.full_name, 'role', v_row.role, 'side', v_row.side, 'reinstated', true),
        true, v_inviter);
    end if;
    return v_row;
  end if;

  perform set_config('room.bypass_member_guard', 'on', true);
  insert into public.room_members (room_id, email, full_name, title, side, role, status, invited_by, expires_at)
  values (p_room_id, lower(trim(p_email)), coalesce(p_full_name, ''), p_title, p_side, p_role, 'invited', v_inviter, p_expires_at)
  returning * into v_row;
  perform set_config('room.bypass_member_guard', '', true);

  perform public.room_emit_event(p_room_id, 'member_invited', 'member', v_row.id,
    jsonb_build_object('email', v_row.email, 'full_name', v_row.full_name, 'role', v_row.role, 'side', v_row.side),
    true, v_inviter);
  return v_row;
end;
$$;
revoke execute on function public.room_invite_member(uuid, text, text, text, text, text, timestamptz) from public, anon;
grant execute on function public.room_invite_member(uuid, text, text, text, text, text, timestamptz) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- room_published_blocks — blocks as the client sees them: from the current
-- published snapshot of each visible document (confidential ⇒ NDA), with the
-- live approval state resolved against the snapshot hash.
-- ---------------------------------------------------------------------------
create or replace function public.room_published_blocks(p_room_id uuid)
returns table (id uuid, document_id uuid, type text, content jsonb, sort_order int, status text, content_hash text, agreed boolean, title text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select (s->>'id')::uuid, d.id, s->>'type', s->'content', (s->>'sort_order')::int, s->>'status', s->>'content_hash',
         (b.approved_content_hash is not null and b.approved_content_hash = s->>'content_hash'),
         coalesce(s->'content'->>'title', s->'content'->>'label', s->'content'->>'name', s->'content'->>'text')
    from public.room_documents d
    join public.room_document_versions v on v.document_id = d.id and v.version = d.current_version,
         jsonb_array_elements(v.snapshot) s
    left join public.room_blocks b on b.id = (s->>'id')::uuid
   where d.room_id = p_room_id and d.status = 'published' and d.kind <> 'file'
     and (public.is_internal() or public.is_room_member(p_room_id))
     and (not d.confidential or public.is_internal() or public.has_accepted_nda(p_room_id));
$$;
revoke execute on function public.room_published_blocks(uuid) from public, anon;
grant execute on function public.room_published_blocks(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- room_home — one round-trip for the room home page
-- ---------------------------------------------------------------------------
create or replace function public.room_home(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_room     public.rooms%rowtype;
  v_member   public.room_members%rowtype;
  v_internal boolean := public.is_internal();
  v_eng      public.room_engagements%rowtype;
begin
  select * into v_room from public.rooms where slug = p_slug and deleted_at is null;
  if v_room.id is null then return null; end if;
  if not v_internal and not public.is_room_member(v_room.id) then return null; end if;

  select * into v_member from public.room_members where id = public.current_member_id(v_room.id);

  -- current engagement: most recently updated that is not cancelled/completed
  select * into v_eng from public.room_engagements e
   where e.room_id = v_room.id and e.status not in ('cancelled','completed')
     and (v_internal or e.status <> 'draft')
   order by e.updated_at desc limit 1;

  return jsonb_build_object(
    'room', to_jsonb(v_room),
    'me', case when v_member.id is null then null else to_jsonb(v_member) - 'notification_prefs' end,
    'is_internal', v_internal,
    'current_engagement', case when v_eng.id is null then null else to_jsonb(v_eng) end,
    'sow', case when v_eng.id is null then null else (
        select jsonb_build_object('id', d.id, 'title', d.title, 'current_version', d.current_version, 'status', d.status)
          from public.room_documents d where d.engagement_id = v_eng.id and d.kind = 'sow'
           and (v_internal or d.status = 'published') order by d.created_at limit 1) end,
    'readiness', case when v_eng.id is null then null else public.room_sow_readiness(v_eng.id) end,
    'open_questions', (select count(*) from public.room_questions q where q.room_id = v_room.id and q.status = 'open'),
    'my_questions', (select coalesce(jsonb_agg(jsonb_build_object('id', q.id, 'title', q.title, 'due_date', q.due_date, 'block_id', q.block_id, 'document_id', q.document_id) order by q.due_date nulls last, q.created_at), '[]'::jsonb)
                       from public.room_questions q where q.room_id = v_room.id and q.status = 'open' and q.owner_member_id = v_member.id),
    'my_pending_blocks', case when v_member.role in ('owner','approver') then (
        select coalesce(jsonb_agg(jsonb_build_object('id', pb.id, 'document_id', pb.document_id, 'type', pb.type, 'title', pb.title) order by pb.sort_order), '[]'::jsonb)
          from public.room_published_blocks(v_room.id) pb
         where public.room_block_is_approvable(pb.type) and not pb.agreed) else '[]'::jsonb end,
    'my_mentions', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'block_id', c.block_id, 'document_id', c.document_id, 'body', left(c.body, 140), 'created_at', c.created_at) order by c.created_at desc), '[]'::jsonb)
                      from public.room_comments c where c.room_id = v_room.id and c.deleted_at is null and c.resolved_at is null
                       and v_member.id = any(c.mentions) and (v_internal or c.internal_only = false)
                       and (v_member.previous_seen_at is null or c.created_at > v_member.previous_seen_at)),
    'changes_since_visit', case when v_member.previous_seen_at is null then '[]'::jsonb else (
        select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'type', e.type, 'entity_type', e.entity_type, 'entity_id', e.entity_id, 'payload', e.payload, 'created_at', e.created_at, 'actor_member_id', e.actor_member_id) order by e.created_at desc), '[]'::jsonb)
          from public.room_events e where e.room_id = v_room.id and e.created_at > v_member.previous_seen_at
           and e.client_visible and e.type in ('version_published','question_answered','comment_added','block_approved','sow_approved')
           and (e.actor_member_id is distinct from v_member.id)) end,
    'engagements', (select coalesce(jsonb_agg(to_jsonb(e) order by e.sort_order, e.created_at), '[]'::jsonb)
                      from public.room_engagements e where e.room_id = v_room.id and (v_internal or e.status <> 'draft')),
    'documents', (select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'engagement_id', d.engagement_id, 'kind', d.kind, 'title', d.title,
                    'status', d.status, 'current_version', d.current_version, 'confidential', d.confidential, 'file_name', d.file_name,
                    'mime_type', d.mime_type, 'file_size', d.file_size, 'updated_at', d.updated_at,
                    'locked', d.confidential and not public.has_accepted_nda(v_room.id)) order by d.sort_order, d.created_at), '[]'::jsonb)
                    from public.room_documents d where d.room_id = v_room.id and (v_internal or d.status = 'published')),
    'members', (select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'full_name', m.full_name, 'title', m.title, 'email', m.email,
                  'side', m.side, 'role', m.role, 'status', m.status, 'last_seen_at', m.last_seen_at, 'nda_accepted_at', m.nda_accepted_at) order by m.side, m.created_at), '[]'::jsonb)
                  from public.room_members m where m.room_id = v_room.id and m.status <> 'revoked'),
    'milestones', (select coalesce(jsonb_agg(jsonb_build_object('id', pb.id, 'document_id', pb.document_id, 'content', pb.content, 'status', case when pb.agreed then 'agreed' else pb.status end) order by (pb.content->>'target_date') nulls last), '[]'::jsonb)
                     from public.room_published_blocks(v_room.id) pb where pb.type = 'milestone'),
    'recent_events', (select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'type', e.type, 'entity_type', e.entity_type, 'entity_id', e.entity_id, 'payload', e.payload, 'created_at', e.created_at, 'actor_member_id', e.actor_member_id) order by e.created_at desc), '[]'::jsonb)
                        from (select * from public.room_events e where e.room_id = v_room.id and (v_internal or e.client_visible)
                               and e.type not in ('room_viewed','document_viewed','block_viewed') order by e.created_at desc limit 12) e)
  );
end;
$$;
revoke execute on function public.room_home(text) from public, anon;
grant execute on function public.room_home(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Events for rows clients insert directly (comments, questions) are emitted by
-- triggers so notifications fire regardless of which client wrote the row.
-- ---------------------------------------------------------------------------
create or replace function public.room_comment_inserted()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.room_emit_event(new.room_id, 'comment_added', 'comment', new.id,
    jsonb_build_object('document_id', new.document_id, 'block_id', new.block_id, 'parent_id', new.parent_id,
                       'excerpt', left(new.body, 200), 'mentions', to_jsonb(new.mentions), 'internal_only', new.internal_only),
    not new.internal_only, new.author_member_id);
  return new;
end;
$$;
drop trigger if exists room_comments_event on public.room_comments;
create trigger room_comments_event after insert on public.room_comments
  for each row execute function public.room_comment_inserted();

create or replace function public.room_question_inserted()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.room_emit_event(new.room_id, 'question_asked', 'question', new.id,
    jsonb_build_object('document_id', new.document_id, 'block_id', new.block_id, 'title', new.title,
                       'owner_member_id', new.owner_member_id, 'due_date', new.due_date),
    true, new.asked_by_member_id);
  return new;
end;
$$;
drop trigger if exists room_questions_event on public.room_questions;
create trigger room_questions_event after insert on public.room_questions
  for each row execute function public.room_question_inserted();

-- member joined (first claim) — emitted from room_claim_membership's update
create or replace function public.room_member_joined()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.status = 'invited' and new.status = 'active' then
    perform public.room_emit_event(new.room_id, 'member_joined', 'member', new.id,
      jsonb_build_object('full_name', new.full_name, 'email', new.email, 'side', new.side), true, new.id);
  end if;
  return new;
end;
$$;
drop trigger if exists room_members_joined on public.room_members;
create trigger room_members_joined after update of status on public.room_members
  for each row execute function public.room_member_joined();
