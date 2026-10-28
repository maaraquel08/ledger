import * as React from "react";
import { cn } from "@/lib/cn";
import { navigate } from "@/lib/router";
import { AccountsIcon, AnalyticsIcon, HomeIcon, PlusIcon, ReviewIcon } from "./icons";

/* ---------- global UI: the add sheet is reachable from every tab ------ */

interface Chrome {
  /** date: "YYYY-MM-DD" to log for a past day */
  openAdd: (opts?: { accountId?: string; text?: string; date?: string }) => void;
}
const ChromeCtx = React.createContext<Chrome>({ openAdd: () => {} });
export const ChromeProvider = ChromeCtx.Provider;
export const useChrome = () => React.useContext(ChromeCtx);

/* ---------- tab bar ---------------------------------------------------- */

const TABS = [
  { path: "/today", label: "Today", Icon: HomeIcon },
  { path: "/money", label: "Money", Icon: AccountsIcon },
  { path: "/analytics", label: "Analytics", Icon: AnalyticsIcon },
  { path: "/review", label: "Review", Icon: ReviewIcon },
] as const;

/**
 * Four tabs (D-0017); adding an entry is the yellow floating action above the
 * nav, bottom right, on every tab. #FCC305 is used nowhere else.
 */
export function TabBar({ path, reviewCount = 0 }: { path: string; reviewCount?: number }) {
  const { openAdd } = useChrome();
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-20 mx-auto w-full max-w-[430px] border-t border-line bg-bg/95 backdrop-blur-sm"
    >
      <button
        type="button"
        aria-label="Add entry"
        onClick={() => openAdd()}
        className="absolute right-5 bottom-[calc(100%+14px)] flex size-[60px] items-center justify-center rounded-full bg-highlight text-highlight-fg shadow-[0_8px_20px_color-mix(in_oklab,var(--color-highlight)_45%,transparent)] transition-transform duration-fast ease-out motion-safe:active:scale-[0.96]"
      >
        <PlusIcon size={26} />
      </button>
      <div className="grid grid-cols-4 px-3 pt-[7px] pb-[max(14px,env(safe-area-inset-bottom))]">
        {TABS.map(({ path: p, label, Icon }) => {
          const active = path === p || path.startsWith(`${p}/`);
          const badge = p === "/review" && reviewCount > 0 ? reviewCount : 0;
          return (
            <button
              key={p}
              type="button"
              aria-label={badge ? `${label}, ${badge} to review` : label}
              aria-current={active ? "page" : undefined}
              onClick={() => (active ? window.scrollTo({ top: 0, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }) : navigate(p))}
              className={cn("flex min-h-11 flex-col items-center gap-[3px] py-1", active ? "text-fg" : "text-fg-subtle")}
            >
              <span className="relative">
                <Icon filled={active} />
                {badge ? (
                  <span className="tnum absolute -top-1.5 left-[calc(100%-7px)] flex h-[17px] min-w-[17px] items-center justify-center rounded-full bg-accent px-1 font-mono text-[9.5px] font-semibold text-accent-fg">
                    {badge > 99 ? "99+" : badge}
                  </span>
                ) : null}
              </span>
              <span className={cn("text-[10.5px] leading-none", active && "font-semibold")}>{label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
