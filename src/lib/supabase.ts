import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Cloud mode switch (D-0012). With VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY set the app
 * signs in and keeps the ledger in Supabase; without them it runs in local mode exactly as
 * before (localStorage, regex parsers, canned chat, demo persona).
 */
const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim() || "";
const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim() || "";

export const SUPABASE_URL = url;
export const SUPABASE_ANON_KEY = anonKey;

export const supabase: SupabaseClient | null =
  url && anonKey
    ? createClient(url, anonKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: "ledger:auth" },
      })
    : null;

/** true in cloud mode */
export const cloud = supabase != null;

/** The cloud client; only call in cloud-mode code paths. */
export function sb(): SupabaseClient {
  if (!supabase) throw new Error("Supabase is not configured (local mode)");
  return supabase;
}

export const VAPID_PUBLIC_KEY = ((import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined) ?? "").trim();
