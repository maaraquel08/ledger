// Loads every supabase/migrations/*.sql into an in-memory PGlite (Postgres in WASM)
// on top of a minimal stub of what Supabase provides: auth schema with auth.uid(),
// roles anon/authenticated/service_role, Supabase-style default grants, and a
// storage schema. Docker isn't available here, so this is how the SQL is tested.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";

const MIGRATIONS = join(import.meta.dirname, "../../supabase/migrations");

const SUPABASE_STUB = /* sql */ `
create schema auth;
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
create function auth.role() returns text language sql stable as $$
  select nullif(current_setting('request.jwt.claim.role', true), '')
$$;

create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema extensions;
grant usage on schema public, auth, extensions to anon, authenticated, service_role;
grant execute on all functions in schema auth to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

create schema storage;
grant usage on schema storage to anon, authenticated, service_role;
create table storage.buckets (
  id text primary key, name text not null, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[], created_at timestamptz default now()
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets (id),
  name text not null, owner uuid default auth.uid(), metadata jsonb, created_at timestamptz default now()
);
alter table storage.objects enable row level security;
grant all on storage.objects to anon, authenticated, service_role;
grant select on storage.buckets to anon, authenticated, service_role;
create function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]
$$;
grant execute on function storage.foldername(text) to anon, authenticated, service_role;
`;

/** Lines PGlite cannot run: extensions that only exist on a hosted Supabase project. */
const UNSUPPORTED = /^\s*create extension[^;]*\b(pg_cron|pg_net|pgsodium|supabase_vault)\b[^;]*;/gim;

export function migrationFiles() {
  return readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
}

export const U1 = "11111111-1111-4111-8111-111111111111";
export const U2 = "22222222-2222-4222-8222-222222222222";

export type Db = PGlite & {
  /** run as a signed-in user (role authenticated, auth.uid() = uid) */
  as(uid: string): Promise<void>;
  /** back to the migration owner (superuser, RLS bypassed), no auth.uid() */
  asAdmin(): Promise<void>;
  /** call a function and return its single value */
  one<T = any>(sql: string, params?: unknown[]): Promise<T>;
  rows<T = any>(sql: string, params?: unknown[]): Promise<T[]>;
};

export async function createDb(): Promise<Db> {
  const pg = new PGlite({ extensions: { pg_trgm } });
  await pg.exec(SUPABASE_STUB);
  for (const f of migrationFiles()) {
    const sql = readFileSync(join(MIGRATIONS, f), "utf8").replace(UNSUPPORTED, "-- skipped in PGlite");
    try {
      await pg.exec(sql);
    } catch (e) {
      throw new Error(`migration ${f} failed: ${(e as Error).message}`);
    }
  }
  // the sign-up allowlist (20261029001500) admits only listed emails: list the test users first
  await pg.exec(`insert into private.allowed_emails (email) values ('one@example.com'), ('two@example.com')`);
  await pg.exec(`insert into auth.users (id, email) values ('${U1}', 'one@example.com'), ('${U2}', 'two@example.com')`);

  const db = pg as Db;
  db.as = async (uid) => {
    await pg.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid}', false); set role authenticated;`);
  };
  db.asAdmin = async () => {
    await pg.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
  };
  db.rows = async (sql, params) => (await pg.query(sql, params)).rows as any[];
  db.one = async (sql, params) => {
    const r = await pg.query(sql, params);
    const row = r.rows[0] as Record<string, unknown> | undefined;
    return (row ? Object.values(row)[0] : undefined) as any;
  };
  return db;
}

/** jsonb numbers come back as JS numbers; numeric columns come back as strings. */
export const num = (v: unknown) => Number(v);
