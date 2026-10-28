-- Extensions Ledger needs everywhere. pg_cron / pg_net live in the cron migration,
-- guarded, because they only exist on a real Supabase project (not in PGlite tests).
create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;

-- Internal helpers that must never be exposed through the API.
create schema if not exists private;
revoke all on schema private from public;
