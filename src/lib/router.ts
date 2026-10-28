import * as React from "react";

/**
 * A tiny hash router: routes are "/today", "/activity/e1a", … so the browser
 * back button and swipe-back work on mobile without a router dependency.
 */
export function useRoute() {
  const read = () => (window.location.hash.replace(/^#/, "") || "/");
  const [path, setPath] = React.useState(read);
  React.useEffect(() => {
    const on = () => setPath(read());
    window.addEventListener("hashchange", on);
    window.addEventListener("popstate", on);
    return () => {
      window.removeEventListener("hashchange", on);
      window.removeEventListener("popstate", on);
    };
  }, []);
  return path;
}

/**
 * How many screens deep this history entry is inside the app. Every in-app push
 * stamps history.state with its depth; an entry the app didn't push (a deep link,
 * a fresh tab, a typed URL) has none, so it is depth 0 and Back has nowhere in-app
 * to return to: history.length can't tell, it counts pages from before the app.
 */
export function depthOf(state: unknown): number {
  const d = (state as { ledgerDepth?: unknown } | null)?.ledgerDepth;
  return typeof d === "number" && d > 0 ? d : 0;
}

/** Where a screen's Back goes when there's no in-app history: its parent. */
export function parentOf(path: string): string {
  const base = path.split("?")[0];
  if (base.startsWith("/activity/") || base.startsWith("/money/")) return "/money";
  if (base === "/sign-in") return "/";
  return "/today";
}

/** "history": step back in the browser; otherwise the route to replace the current one with. */
export function backTarget(state: unknown, path: string, fallback?: string): "history" | string {
  return depthOf(state) > 0 ? "history" : (fallback ?? parentOf(path));
}

export function navigate(to: string, opts: { replace?: boolean } = {}) {
  const url = `#${to}`;
  if (`#${window.location.hash.replace(/^#/, "")}` === url && !opts.replace) return;
  const depth = depthOf(history.state);
  if (opts.replace) {
    history.replaceState({ ledgerDepth: depth }, "", url);
  } else {
    history.pushState({ ledgerDepth: depth + 1 }, "", url);
    window.scrollTo({ top: 0 }); // replace = same screen (e.g. filters) — keep scroll
  }
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}

/** In-app Back: the previous in-app screen, or the parent route on a deep link (never out of the app). */
export function back(fallback?: string) {
  const t = backTarget(history.state, window.location.hash.replace(/^#/, "") || "/", fallback);
  if (t === "history") history.back();
  else navigate(t, { replace: true });
}

/** Match "/activity/:id" against a path; returns params or null. */
export function match(pattern: string, path: string): Record<string, string> | null {
  const p = pattern.split("/");
  const s = path.split("?")[0].split("/");
  if (p.length !== s.length) return null;
  const out: Record<string, string> = {};
  for (let i = 0; i < p.length; i++) {
    if (p[i].startsWith(":")) out[p[i].slice(1)] = decodeURIComponent(s[i]);
    else if (p[i] !== s[i]) return null;
  }
  return out;
}

export function query(path: string) {
  return new URLSearchParams(path.split("?")[1] ?? "");
}
