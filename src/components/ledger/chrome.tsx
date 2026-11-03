import * as React from "react";
import { cn } from "@/lib/cn";
import { navigate } from "@/lib/router";
import { AccountsIcon, ActivityIcon, AnalyticsIcon, BudgetIcon, ChatIcon, PlusIcon } from "./icons";

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
  { path: "/today", label: "Chat", Icon: ChatIcon },
  { path: "/activity", label: "Activity", Icon: ActivityIcon },
  { path: "/money", label: "Money", Icon: AccountsIcon },
  { path: "/budget", label: "Budget", Icon: BudgetIcon },
  { path: "/analytics", label: "Analytics", Icon: AnalyticsIcon },
] as const;

/**
 * Five tabs: Chat (home), Activity, Money, Budget, Analytics. Adding an entry is the yellow
 * floating action above the nav on Activity, Money and Analytics. Chat has a + in its header (the FAB
 * would sit on the composer); Budget's one action is its pinned New category button.
 * #FCC305 is used nowhere else.
 */
export function TabBar({ path }: { path: string }) {
  const { openAdd } = useChrome();
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-20 mx-auto w-full max-w-[430px] border-t border-line bg-bg/95 backdrop-blur-sm"
    >
      {path === "/today" || path === "/budget" ? null : (
      <button
        type="button"
        aria-label="Add entry"
        onClick={() => openAdd()}
        className="absolute right-5 bottom-[calc(100%+14px)] flex size-[60px] items-center justify-center rounded-full bg-highlight text-highlight-fg shadow-[0_8px_20px_color-mix(in_oklab,var(--color-highlight)_45%,transparent)] transition-transform duration-fast ease-out motion-safe:active:scale-[0.96]"
      >
        <PlusIcon size={26} />
      </button>
      )}
      <div className="grid grid-cols-5 px-3 pt-[7px] pb-[max(14px,env(safe-area-inset-bottom))]">
        {TABS.map(({ path: p, label, Icon }) => {
          const active = path === p || path.startsWith(`${p}/`);
          return (
            <button
              key={p}
              type="button"
              aria-label={label}
              aria-current={active ? "page" : undefined}
              onClick={() => (active ? window.scrollTo({ top: 0, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }) : navigate(p))}
              className={cn("flex min-h-11 flex-col items-center gap-[3px] py-1", active ? "text-fg" : "text-fg-subtle")}
            >
              <Icon filled={active} />
              <span className={cn("text-[10px] leading-none", active && "font-semibold")}>{label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
