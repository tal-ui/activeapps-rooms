-- ============================================================================
-- ActiveApps Rooms — Sprint 0 / Migration 6: Storage bucket `room-files`
--
-- Object path convention:  <room_id>/<document_id>/<file name>
-- All access is via short-lived signed URLs; the bucket is private.
-- Clients may read files of documents they can see; only internal staff upload.
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('room-files', 'room-files', false, 52428800,
        array['application/pdf','image/png','image/jpeg','image/webp','image/svg+xml',
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
              'application/vnd.openxmlformats-officedocument.presentationml.presentation',
              'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
              'text/plain','text/csv'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- first path segment is the room id
create or replace function public.room_storage_room_id(p_name text)
returns uuid
language sql
immutable
as $$
  select case when split_part(p_name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              then split_part(p_name, '/', 1)::uuid else null end;
$$;

drop policy if exists room_files_internal_all on storage.objects;
create policy room_files_internal_all on storage.objects
  for all to authenticated
  using (bucket_id = 'room-files' and public.is_internal())
  with check (bucket_id = 'room-files' and public.is_internal());

drop policy if exists room_files_client_select on storage.objects;
create policy room_files_client_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'room-files'
    and public.is_room_member(public.room_storage_room_id(name))
    and exists (
      select 1 from public.room_documents d
       where d.storage_path = name
         and d.status = 'published'
         and (not d.confidential or public.has_accepted_nda(d.room_id))
    )
  );

-- Client logos live in the same bucket under <room_id>/logo/<file>; readable by members.
drop policy if exists room_files_client_logo_select on storage.objects;
create policy room_files_client_logo_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'room-files'
    and split_part(name, '/', 2) = 'logo'
    and public.is_room_member(public.room_storage_room_id(name))
  );
