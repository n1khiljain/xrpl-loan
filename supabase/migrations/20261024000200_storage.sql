-- Private bucket for receipts and invoices. storage.objects has row level security on and we add no policies, so
-- only the service role can read or write. Functions hand out short-lived signed URLs after checking access.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'receipts',
  'receipts',
  false,
  10485760,
  array['application/pdf', 'image/png', 'image/jpeg', 'image/heic', 'image/webp']
);
