-- ============================================================================
-- ActiveApps Rooms — Migration 9: Security / Performance Advisor follow-ups
-- (findings from the Supabase linters after the go-live apply, 2026-09-20)
--
--   * pinned search_path on the two immutable helpers the linter flagged
--   * trigger functions are not an API: no EXECUTE for anon / authenticated
--   * is_internal() back to authenticated-only (no anon-role policies exist)
--   * helpers only ever called from SECURITY DEFINER code lose their grants
--   * crm_policy_backup readable by staff (it had RLS with no policy)
--   * covering indexes for every room_* foreign key the linter listed
-- The CRM's own 24 mutable-search_path functions and its anon-executable
-- helpers (is_admin, current_profile_id, current_user_is_read_only) predate
-- this project and are left for the CRM backlog.
-- ============================================================================

alter function public.room_storage_room_id(text) set search_path = public, pg_temp;
alter function public.room_block_is_approvable(text) set search_path = public, pg_temp;

-- trigger functions: never callable through /rest/v1/rpc
do $$
declare f text;
begin
  foreach f in array array[
    'room_touch_updated_at','room_block_content_changed','room_engagement_status_changed',
    'room_members_guard_client_update','room_members_guard_staff_email','room_questions_guard_client_update',
    'room_comment_inserted','room_question_inserted','room_member_joined',
    'room_event_notify','room_engagement_crm_sync'
  ] loop
    if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = f) then
      execute format('revoke execute on function public.%I() from public, anon, authenticated', f);
    end if;
  end loop;
end $$;

-- is_internal(): evaluated only inside policies for signed-in users
revoke execute on function public.is_internal() from anon;

-- internal-only helpers (called from SECURITY DEFINER functions / service role)
revoke execute on function public.is_staff_email(text) from authenticated;
revoke execute on function public.room_published_blocks(uuid) from authenticated;
revoke execute on function public.room_document_visible(uuid) from anon;

-- policy backup: staff may read it (rollback reference), nobody writes via API
drop policy if exists crm_policy_backup_internal_select on public.crm_policy_backup;
create policy crm_policy_backup_internal_select on public.crm_policy_backup
  for select to authenticated using (public.is_internal());

-- covering indexes for foreign keys
create index if not exists room_block_views_block_idx           on public.room_block_views(block_id);
create index if not exists room_blocks_approved_by_idx          on public.room_blocks(approved_by_member_id);
create index if not exists room_blocks_parent_idx               on public.room_blocks(parent_block_id);
create index if not exists room_comments_author_idx             on public.room_comments(author_member_id);
create index if not exists room_comments_parent_idx             on public.room_comments(parent_id);
create index if not exists room_comments_resolved_by_idx        on public.room_comments(resolved_by);
create index if not exists room_decisions_block_idx             on public.room_decisions(block_id);
create index if not exists room_decisions_decided_by_idx        on public.room_decisions(decided_by_member_id);
create index if not exists room_decisions_question_idx          on public.room_decisions(question_id);
create index if not exists room_document_versions_published_by_idx on public.room_document_versions(published_by);
create index if not exists room_documents_created_by_idx        on public.room_documents(created_by);
create index if not exists room_engagements_agreed_by_idx       on public.room_engagements(agreed_by_member_id);
create index if not exists room_engagements_agreed_version_idx  on public.room_engagements(agreed_version_id);
create index if not exists room_engagements_project_idx         on public.room_engagements(project_id);
create index if not exists room_engagements_selected_pricing_idx on public.room_engagements(selected_pricing_option_block_id);
create index if not exists room_events_actor_idx                on public.room_events(actor_member_id);
create index if not exists room_members_invited_by_idx          on public.room_members(invited_by);
create index if not exists room_notifications_event_idx         on public.room_notifications(event_id);
create index if not exists room_questions_answered_by_idx       on public.room_questions(answered_by_member_id);
create index if not exists room_questions_asked_by_idx          on public.room_questions(asked_by_member_id);
create index if not exists room_questions_block_idx             on public.room_questions(block_id);
create index if not exists room_questions_document_idx          on public.room_questions(document_id);
create index if not exists rooms_created_by_idx                 on public.rooms(created_by);
