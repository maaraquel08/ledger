import { Cta, Screen } from "@/components/ledger/primitives";
import { cn } from "@/lib/cn";
import * as React from "react";
import { Ctx } from "@/lib/store";
import { cloud } from "@/lib/supabase";
import { navigate } from "@/lib/router";

const TAPE: [string, string, string][] = [
["MON", "Payroll account · salary", "+₱52,000"],
["MON", "grab gcash 248", "−₱248"],
["MON", "Daily wallet · 7-Eleven", "−₱96"],
["MON", "The card · Spotify", "−₱194"],
["TUE", "Daily wallet · lunch", "−₱185"],
["TUE", "The card · Landers", "−₱2,410"],
["TUE", "Payroll · Meralco", "−₱2,860"],
["TUE", "Daily wallet · load", "−₱300"],
["WED", "Emergency fund · transfer", "+₱5,000"],
["WED", "Daily wallet · coffee", "−₱160"],
["WED", "The card · Grab Car", "−₱385"],
["WED", "Pocket cash · palengke", "−₱1,240"],
["THU", "Investments · VOO", "−₱8,000"],
["THU", "Payroll · rent", "−₱18,500"],
["THU", "Daily wallet · Jollibee", "−₱265"],
["THU", "The card · Shopee", "−₱1,678"],
["FRI", "Side income · design retainer", "+₱12,000"],
["FRI", "The card · Shell fuel", "−₱1,900"],
["FRI", "Daily wallet · beer w/ team", "−₱740"],
["FRI", "Payroll · Maynilad", "−₱612"],
["SAT", "Daily wallet · market", "−₱940"],
["SAT", "The card · Watsons", "−₱620"],
["SAT", "Pocket cash · barber", "−₱350"],
["SAT", "GCash · split dinner", "+₱480"],
["SUN", "Daily wallet · transport", "−₱310"],
["SUN", "Refund · Lazada", "+₱1,150"],
["SUN", "The card · Netflix", "−₱549"],
["SUN", "Emergency fund · round-up", "+₱420"],
["MON", "Payroll · PLDT fibr", "−₱2,099"],
["MON", "Daily wallet · pandamart", "−₱528"],
["TUE", "Investments · dividend", "+₱1,340"],
["TUE", "The card · Uniqlo", "−₱1,990"],
];

const FADE = "linear-gradient(#000 0%, #000 34%, rgba(0,0,0,.08) 78%, transparent 100%)";

function TapeRows({ hidden }: { hidden?: boolean }) {
  return (
    <div aria-hidden={hidden || undefined}>
      {TAPE.map(([day, desc, amt], i) => (
        <div key={i} className="flex items-baseline gap-2.5 border-b border-dashed border-line py-[9px]">
          <span className="w-[34px] flex-none font-mono text-[10px] font-medium text-fg-subtle">{day}</span>
          <span className="min-w-0 flex-1 truncate text-[12.5px]">{desc}</span>
          <span className={cn("tnum font-mono text-[12.5px] font-semibold", amt.startsWith("+") ? "text-success" : "text-danger")}>{amt}</span>
        </div>
      ))}
    </div>
  );
}

export function Welcome() {
  // cloud mode shows Welcome signed out, outside any ledger: Sign in is a real sign-in (D-0012)
  const ledger = React.useContext(Ctx);
  return (
    <Screen className="overflow-hidden">
      <div className="relative min-h-[240px] flex-1 overflow-hidden">
        <div className="absolute inset-x-11 top-2 bottom-0 overflow-hidden" style={{ maskImage: FADE, WebkitMaskImage: FADE }}>
          <div data-tape className="will-change-transform" style={{ animation: "ledger-tape 40s linear infinite" }}>
            <TapeRows />
            <TapeRows hidden />
          </div>
        </div>
      </div>
      <div className="relative px-[30px]">
        <h1 className="text-[34px] leading-[1.1] font-semibold tracking-[-0.032em] text-balance">Type it like you’d say it.</h1>
        <p className="mt-3 text-[14px] leading-[1.55] text-fg-muted text-pretty">“grab gcash 248” is a whole entry. Ledger files the rest.</p>
      </div>
      <div className="flex flex-col gap-3.5 px-5 pt-[26px] pb-[max(26px,env(safe-area-inset-bottom))]">
        <Cta
          onClick={() => {
            if (cloud) return navigate("/sign-in");
            ledger?.dispatch({ type: "load-demo" });
            navigate("/today");
          }}
        >
          Sign in
        </Cta>
        {/* cloud mode has one owner whose account already exists: no sign-up */}
        {!cloud && (
          <div className="text-center text-[12px] text-fg-subtle">
            New here?{" "}
            <button type="button" onClick={() => navigate("/onboarding/welcome")} className="-my-3 py-3 font-medium text-fg">
              Create an account
            </button>
          </div>
        )}
      </div>
    </Screen>
  );
}
