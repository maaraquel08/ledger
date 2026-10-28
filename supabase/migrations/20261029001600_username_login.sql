-- Username + password login (Owner, 2026-10-29). Supabase Auth only knows emails, so the
-- username "maaraquel24" maps to the never-mailed address maaraquel24@ledger.local
-- (src/lib/cloud/auth.tsx). It is the only address allowed to exist; every other entry in the
-- allowlist is removed. The password lives hashed in Supabase Auth and is set by the Owner.

insert into private.allowed_emails (email) values ('maaraquel24@ledger.local') on conflict do nothing;
delete from private.allowed_emails where email <> 'maaraquel24@ledger.local';
