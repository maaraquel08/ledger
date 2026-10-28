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
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return path;
}

export function navigate(to: string, opts: { replace?: boolean } = {}) {
  const url = `#${to}`;
  if (opts.replace) {
    history.replaceState(null, "", url);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  } else {
    window.location.hash = to;
    window.scrollTo({ top: 0 }); // replace = same screen (e.g. filters) — keep scroll
  }
}

export function back(fallback = "/today") {
  if (history.length > 1) history.back();
  else navigate(fallback, { replace: true });
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
