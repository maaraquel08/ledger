-- Private buckets for captured receipts and voice clips.
-- Object names must start with the owner's user id: '<auth.uid()>/<anything>'.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('receipts', 'receipts', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/heic']),
  ('voice',    'voice',    false, 26214400, array['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/wav', 'audio/x-m4a'])
on conflict (id) do nothing;

create policy ledger_owner_select on storage.objects for select to authenticated
  using (bucket_id in ('receipts', 'voice') and (storage.foldername(name))[1] = (select auth.uid()::text));

create policy ledger_owner_insert on storage.objects for insert to authenticated
  with check (bucket_id in ('receipts', 'voice') and (storage.foldername(name))[1] = (select auth.uid()::text));

create policy ledger_owner_update on storage.objects for update to authenticated
  using (bucket_id in ('receipts', 'voice') and (storage.foldername(name))[1] = (select auth.uid()::text))
  with check (bucket_id in ('receipts', 'voice') and (storage.foldername(name))[1] = (select auth.uid()::text));

create policy ledger_owner_delete on storage.objects for delete to authenticated
  using (bucket_id in ('receipts', 'voice') and (storage.foldername(name))[1] = (select auth.uid()::text));
