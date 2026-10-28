// Supabase clients (Deno).
//  - userClient: acts as the caller (their JWT), so RLS and the security-invoker RPCs apply.
//  - serviceClient: service role, only for cron (insights-run) and notify.
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2.86.0";

const env = (k: string) => Deno.env.get(k) ?? "";

export type Db = SupabaseClient;

export function userClient(req: Request): Db | null {
  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  return createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function serviceClient(): Db {
  return createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** The signed-in user's id, or null when the JWT is missing or invalid. */
export async function userId(db: Db): Promise<string | null> {
  const { data, error } = await db.auth.getUser();
  return error || !data.user ? null : data.user.id;
}

/** True when the request carries the service role key as its bearer (as the cron sends it). */
export function isServiceRole(req: Request): boolean {
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  const auth = req.headers.get("Authorization") ?? "";
  if (!key || !auth.startsWith("Bearer ")) return false;
  const got = new TextEncoder().encode(auth.slice(7));
  const want = new TextEncoder().encode(key);
  if (got.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got[i] ^ want[i];
  return diff === 0;
}

/** rpc that throws with the SQLSTATE code on error. */
export async function rpc<T = unknown>(db: Db, name: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await db.rpc(name, args);
  if (error) throw Object.assign(new Error(`${name}: ${error.message}`), { code: error.code });
  return data as T;
}
