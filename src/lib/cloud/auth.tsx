import * as React from "react";
import type { Session } from "@supabase/supabase-js";
import { sb } from "../supabase";

/**
 * The Owner's session, restored from this browser on load and kept fresh by supabase-js.
 */
export function useSession() {
  const [state, setState] = React.useState<{ loading: boolean; session: Session | null }>({ loading: true, session: null });
  React.useEffect(() => {
    let live = true;
    sb()
      .auth.getSession()
      .then(({ data }) => live && setState({ loading: false, session: data.session }))
      .catch(() => live && setState({ loading: false, session: null }));
    const { data } = sb().auth.onAuthStateChange((_event, session) => {
      if (live) setState({ loading: false, session });
    });
    return () => {
      live = false;
      data.subscription.unsubscribe();
    };
  }, []);
  return state;
}

/**
 * The Owner signs in with a username and password. Supabase Auth only knows emails, so the
 * username maps to a fixed, never-mailed address; the password lives (hashed) in Supabase Auth,
 * never in this code. Only allow-listed addresses can exist (migration 001500/001600).
 */
const USERNAME_DOMAIN = "ledger.local";
export const usernameEmail = (username: string) => `${username.trim().toLowerCase()}@${USERNAME_DOMAIN}`;

export async function signInWithUsername(username: string, password: string) {
  const { error } = await sb().auth.signInWithPassword({ email: usernameEmail(username), password });
  if (error) throw error;
}
