-- =====================================================================
-- Migration 5 of 5: private storage bucket for feedback attachments
--
-- Object path convention:  <customer_uid>/<feedback_id>/<random>.<ext>
-- * Only the owning customer may upload, and only into their own folder for
--   one of their own feedback records.
-- * Reads are allowed only to people who may already view that feedback
--   (checked through the feedback_attachments metadata row).
-- * The bucket is PRIVATE: use signed URLs or authenticated downloads.
-- * allowed_mime_types excludes HTML/JS/executables. Keep these limits in
--   step with system_settings (attachment_max_bytes / allowed types).
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('feedback-attachments', 'feedback-attachments', false, 5242880,
        array['image/jpeg', 'image/png', 'application/pdf'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy "customers upload own attachments" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'feedback-attachments'
    and public.is_customer()
    and (storage.foldername(name))[1] = auth.uid()::text
    and exists (select 1 from public.feedback f
                where f.id::text = (storage.foldername(name))[2] and f.customer_id = auth.uid())
  );

create policy "authorised users read attachments" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'feedback-attachments'
    and exists (select 1 from public.feedback_attachments a
                where a.storage_path = name and public.can_view_feedback(a.feedback_id))
  );
-- No UPDATE or DELETE policies: attachments cannot be altered or removed by clients.
