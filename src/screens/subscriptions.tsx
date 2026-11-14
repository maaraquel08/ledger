import * as React from "react";
import { PickField } from "@/components/ledger/entry-draft";
import { ActionButton, BackBar, Cta, Eyebrow, PageTitle, Pill, ProviderMark, Screen, Segmented, Sheet } from "@/components/ledger/primitives";
import { cn } from "@/lib/cn";
import { MAX_AMOUNT, localDay, monthShort, parseWholePesos, peso } from "@/lib/format";
import { spendCategories } from "@/lib/categories";
import { back, navigate } from "@/lib/router";
import { accountLabel } from "@/lib/selectors";
import { dueWithin, firstDue, parseDay, payments, upcoming, type Upcoming } from "@/lib/subscriptions";
import { newId, useLedger } from "@/lib/store";
import type { Account, Entry, Subscription } from "@/lib/types";
import { TransferSheet } from "@/screens/accounts";

const FIELD = "h-11 w-full rounded-md border border-line-strong bg-bg px-3 text-[16px] text-fg outline-none placeholder:text-fg-subtle focus:border-accent";

type Item = Upcoming;

const dueLabel = (d: Date) => `${d.getDate()} ${monthShort(d)}`.toUpperCase();

/** Day of month as typed: a whole number 1–31, else null. */
const parseDayOfMonth = (s: string) => {
  const t = s.trim();
  if (!/^\d{1,2}$/.test(t)) return null;
  const n = Number(t);
  return n >= 1 && n <= 31 ? n : null;
};

/* ====================================================================== */
/*  Rows + the sheets they open                                            */
/* ====================================================================== */

/** Which sheet a row's action opens; one owner per screen so sheets mount once. */
function useBills() {
  const { state } = useLedger();
  const [paying, setPaying] = React.useState<Item | null>(null);
  const [card, setCard] = React.useState<Item | null>(null);
  const [editing, setEditing] = React.useState<Subscription | "new" | null>(null);
  const [reminder, setReminder] = React.useState<Account | null>(null);

  // the card is paid from the first bank, wallet or cash account that isn't the card itself
  const payer = (c: Item) => state.accounts.find((a) => a.type !== "credit" && a.type !== "investments") ?? state.accounts.find((a) => a.id !== c.id);
  const payFrom = card ? payer(card) : undefined;

  const sheets = (
    <>
      <SubscriptionSheet open={editing !== null} onOpenChange={(o) => !o && setEditing(null)} sub={editing === "new" ? null : editing} />
      <MarkPaidSheet open={paying !== null} onOpenChange={(o) => !o && setPaying(null)} item={paying} />
      {payFrom ? (
        // the Owner decides how much: the amount opens blank, paying in full is one tap
        <TransferSheet
          open={card !== null}
          onOpenChange={(o) => !o && setCard(null)}
          from={payFrom}
          to={card?.id}
          suggest={card?.kind === "card" ? { label: "Pay in full", amount: card.owed } : undefined}
        />
      ) : null}
      <ReminderSheet open={reminder !== null} onOpenChange={(o) => !o && setReminder(null)} card={reminder} />
    </>
  );
  return {
    sheets,
    markPaid: setPaying,
    payCard: setCard,
    edit: setEditing,
    editReminder: setReminder,
  };
}

function BillRow({ item, bills }: { item: Item; bills: ReturnType<typeof useBills> }) {
  const { state } = useLedger();
  const account = state.accounts.find((a) => a.id === item.accountId);
  const meta = item.overdue
    ? `OVERDUE · ${item.daysLate} ${item.daysLate === 1 ? "DAY" : "DAYS"}`
    : item.kind === "card"
      ? `DUE ${dueLabel(item.due)}`
      : `DUE ${dueLabel(item.due)}${account ? ` · ${accountLabel(account)}` : ""}`;
  const open = () => (item.kind === "card" ? account && bills.editReminder(account) : bills.edit(item.sub));
  const paidCard = item.kind === "card" && item.paid;
  return (
    <div className="flex min-h-[52px] items-center gap-3">
      <button type="button" onClick={open} className="flex min-w-0 flex-1 items-center gap-3.5 text-left active:opacity-60">
        <ProviderMark provider={account?.provider ?? null} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] leading-[1.3]">{item.name}</div>
          <div className={cn("mt-1.5 truncate font-mono text-[10.5px] font-medium tracking-[0.05em]", item.overdue ? "text-danger" : "text-fg-subtle")}>{meta}</div>
          {/* what the card owes is a hint on its own line, never the amount due */}
          {item.kind === "card" && !item.paid ? (
            <div className="mt-1 truncate font-mono text-[10.5px] font-medium tracking-[0.05em] text-fg-subtle">{item.owed > 0 ? `OWED ${peso(item.owed)}` : "NOTHING OWED"}</div>
          ) : null}
        </div>
        {item.kind === "subscription" ? (
          <div className="tnum flex-none text-[18px] font-semibold tracking-[-0.01em]">{peso(item.amount)}</div>
        ) : paidCard ? null : (
          // a card has no amount due: how much to pay is the Owner's call
          <div className="flex-none text-[13px] text-fg-muted">You decide</div>
        )}
      </button>
      {paidCard ? (
        <span className="w-[76px] flex-none text-center font-mono text-[10.5px] tracking-[0.05em] text-fg-subtle uppercase">Paid</span>
      ) : (
        <ActionButton
          variant="secondary"
          className="min-h-11 w-[76px] flex-none px-0 text-center"
          onClick={() => (item.kind === "card" ? bills.payCard(item) : bills.markPaid(item))}
          aria-label={`${item.kind === "card" ? "Pay" : "Mark paid"} ${item.name}`}
        >
          {item.kind === "card" ? "Pay" : "Mark paid"}
        </ActionButton>
      )}
    </div>
  );
}

/* ====================================================================== */
/*  Money tab: Upcoming                                                    */
/* ====================================================================== */

export function UpcomingSection() {
  const { state } = useLedger();
  const bills = useBills();
  const items = React.useMemo(() => upcoming(state), [state]);
  const total = dueWithin(items, 30);

  if (items.length === 0) {
    return (
      <div className="px-6 pt-6">
        <Eyebrow>UPCOMING</Eyebrow>
        <p className="mt-3 text-[14px] leading-[1.5] text-fg-muted">Nothing due yet. Add a subscription like Netflix, or a reminder to pay a card.</p>
        <ActionButton variant="secondary" className="mt-4 min-h-11" onClick={() => bills.edit("new")}>
          Add
        </ActionButton>
        {bills.sheets}
      </div>
    );
  }

  return (
    <section className="px-6 pt-6 pb-9">
      <div className="mb-4 flex items-center justify-between">
        <Eyebrow>UPCOMING · {peso(total)} SUBSCRIPTIONS, 30 DAYS</Eyebrow>
        <button type="button" onClick={() => navigate("/money/subscriptions")} className="-mr-2 flex h-11 items-center px-2 text-[13px] text-fg-muted active:opacity-60">
          See all
        </button>
      </div>
      <div className="flex flex-col gap-[22px]">
        {items.slice(0, 5).map((it) => (
          <BillRow key={`${it.kind}-${it.id}`} item={it} bills={bills} />
        ))}
      </div>
      {bills.sheets}
    </section>
  );
}

/* ====================================================================== */
/*  /money/subscriptions                                                   */
/* ====================================================================== */

export function SubscriptionsScreen() {
  const { state } = useLedger();
  const bills = useBills();
  const items = React.useMemo(() => upcoming(state), [state]);
  const subs = items.filter((i) => i.kind === "subscription");
  const cards = items.filter((i) => i.kind === "card");

  return (
    <Screen className="pb-[max(32px,env(safe-area-inset-bottom))]">
      <BackBar label="Money" onBack={() => back("/money")} />
      <PageTitle
        right={
          <button type="button" onClick={() => bills.edit("new")} className="-mr-2 flex h-11 items-center px-2 text-[15px] font-medium active:opacity-60">
            Add
          </button>
        }
      >
        Upcoming
      </PageTitle>
      <div className="px-6 pt-6">
        <section className="mb-9">
          <Eyebrow className="mb-4">SUBSCRIPTIONS</Eyebrow>
          {subs.length === 0 ? (
            <>
              <p className="text-[14px] leading-[1.5] text-fg-muted">Bills you pay each month, like Netflix or rent, show up here with their due dates.</p>
              <ActionButton variant="secondary" className="mt-4 min-h-11" onClick={() => bills.edit("new")}>
                Add a subscription
              </ActionButton>
            </>
          ) : (
            <div className="flex flex-col gap-[22px]">
              {subs.map((it) => (
                <BillRow key={it.id} item={it} bills={bills} />
              ))}
            </div>
          )}
        </section>
        <section className="mb-9">
          <Eyebrow className="mb-4">CARD REMINDERS</Eyebrow>
          {cards.length === 0 ? (
            <p className="text-[14px] leading-[1.5] text-fg-muted">No card reminders. Add one for a card you pay each month; you choose how much when you pay.</p>
          ) : (
            <div className="flex flex-col gap-[22px]">
              {cards.map((it) => (
                <BillRow key={it.id} item={it} bills={bills} />
              ))}
            </div>
          )}
        </section>
      </div>
      {bills.sheets}
    </Screen>
  );
}

/* ====================================================================== */
/*  Subscription sheet (add / edit)                                        */
/* ====================================================================== */

const NO_ACCOUNT = "none";

function SubscriptionSheet({ open, onOpenChange, sub }: { open: boolean; onOpenChange: (o: boolean) => void; sub: Subscription | null }) {
  const { state, dispatch } = useLedger();
  const [name, setName] = React.useState("");
  const [amount, setAmount] = React.useState("");
  const [day, setDay] = React.useState("");
  const [accountId, setAccountId] = React.useState(NO_ACCOUNT);
  const [category, setCategory] = React.useState("Subscriptions");
  const [confirm, setConfirm] = React.useState(false);
  const [kind, setKind] = React.useState<AddKind>("Subscription");

  React.useEffect(() => {
    if (!open) return;
    setKind("Subscription");
    setName(sub?.name ?? "");
    setAmount(sub ? String(sub.amount) : "");
    setDay(sub ? String(sub.day) : "");
    setAccountId(sub?.accountId ?? NO_ACCOUNT);
    setCategory(sub?.category ?? "Subscriptions");
    setConfirm(false);
  }, [open, sub]);

  const value = parseWholePesos(amount);
  const dueDay = parseDayOfMonth(day);
  const valid = name.trim() !== "" && value !== null && value <= MAX_AMOUNT && dueDay !== null;

  const paid = React.useMemo(() => {
    if (!sub) return [] as Entry[];
    const list = payments(state.subscriptions ?? [], state.entries).get(sub.id) ?? [];
    return list.slice(-6).reverse();
  }, [sub, state.subscriptions, state.entries]);

  const categories = spendCategories(state);
  const categoryOptions = (categories.includes(category) ? categories : [category, ...categories]).map((c) => ({ value: c, label: c }));

  const save = () => {
    if (!valid || value === null || dueDay === null) return;
    dispatch({
      type: "upsert-subscription",
      sub: {
        id: sub?.id ?? newId("s"),
        name: name.trim(),
        amount: value,
        day: dueDay,
        // starts the next time its day comes round (a payment up to 10 days before still counts);
        // an edit that keeps the day keeps its history, a new day would otherwise count from the old start
        startsOn: sub && sub.day === dueDay ? sub.startsOn : firstDue(dueDay),
        accountId: accountId === NO_ACCOUNT ? null : accountId,
        category,
      },
    });
    onOpenChange(false);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={sub ? "Edit subscription" : kind === "Card reminder" ? "Add card reminder" : "Add subscription"}>
      {sub ? null : (
        <div className="pt-5">
          <Segmented value={kind} options={ADD_KINDS} onChange={setKind} />
        </div>
      )}
      {kind === "Card reminder" ? (
        <ReminderForm card={null} onDone={() => onOpenChange(false)} />
      ) : (
        <form
          className="space-y-5 pt-5 pb-3"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <label className="block">
            <Eyebrow className="mb-2">NAME</Eyebrow>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Netflix" className={FIELD} enterKeyHint="next" />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <Eyebrow className="mb-2">AMOUNT (₱)</Eyebrow>
              <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="numeric" placeholder="549" className={cn(FIELD, "font-mono")} />
            </label>
            <label className="block">
              <Eyebrow className="mb-2">DUE DAY (1–31)</Eyebrow>
              <input value={day} onChange={(e) => setDay(e.target.value.replace(/\D/g, "").slice(0, 2))} inputMode="numeric" placeholder="18" className={cn(FIELD, "font-mono")} />
            </label>
          </div>
          <PickField
            label="Paid from"
            value={accountId}
            onChange={setAccountId}
            options={[
              ...state.accounts.map((a) => ({
                value: a.id,
                label: a.name,
                lead: <ProviderMark provider={a.provider} size={26} radius={7} />,
              })),
              {
                value: NO_ACCOUNT,
                label: "No account",
                lead: <ProviderMark provider={null} size={26} radius={7} />,
              },
            ]}
          />
          <PickField label="Category" value={category} onChange={setCategory} options={categoryOptions} />
          <Cta type="submit" disabled={!valid}>
            {sub ? "Save changes" : "Add subscription"}
          </Cta>

          {sub ? (
            <>
              <div>
                <Eyebrow className="mb-3">PAID WITH</Eyebrow>
                {paid.length === 0 ? (
                  <p className="text-[13.5px] text-fg-muted">No entries yet. Log one with {sub.name} in the description and it counts.</p>
                ) : (
                  <div className="divide-y divide-line rounded-md border border-line">
                    {paid.map((e) => (
                      <button
                        key={e.id}
                        type="button"
                        onClick={() => {
                          onOpenChange(false);
                          navigate(`/activity/${e.id}`);
                        }}
                        className="flex min-h-12 w-full items-center justify-between gap-3 px-3 text-left active:opacity-60"
                      >
                        <span className="min-w-0 flex-1 truncate text-[14px]">{e.desc}</span>
                        <span className="flex-none font-mono text-[10.5px] tracking-[0.05em] text-fg-subtle">{dueLabel(new Date(e.date))}</span>
                        <span className="tnum flex-none text-[14px] font-semibold">{peso(e.amount)}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {confirm ? (
                <div className="rounded-lg border border-danger/50 p-3.5">
                  <p className="text-[13.5px] leading-[1.45]">Delete {sub.name}? Its entries stay in Activity. It just stops showing as due.</p>
                  <div className="mt-3 flex gap-2.5">
                    <ActionButton variant="secondary" className="min-h-11 flex-1" autoFocus onClick={() => setConfirm(false)}>
                      Cancel
                    </ActionButton>
                    <ActionButton
                      className="min-h-11 flex-1 !bg-danger"
                      onClick={() => {
                        dispatch({ type: "remove-subscription", id: sub.id });
                        onOpenChange(false);
                      }}
                    >
                      Delete subscription
                    </ActionButton>
                  </div>
                </div>
              ) : (
                <button type="button" onClick={() => setConfirm(true)} className="flex min-h-11 w-full items-center justify-center text-[14px] text-danger active:opacity-60">
                  Delete subscription
                </button>
              )}
            </>
          ) : null}
        </form>
      )}
    </Sheet>
  );
}

/* ====================================================================== */
/*  Card reminders                                                         */
/* ====================================================================== */

type AddKind = "Subscription" | "Card reminder";
const ADD_KINDS: AddKind[] = ["Subscription", "Card reminder"];

/** Edit or remove a card's reminder (opened from its row). */
function ReminderSheet({ open, onOpenChange, card }: { open: boolean; onOpenChange: (o: boolean) => void; card: Account | null }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Edit reminder">
      {card ? <ReminderForm key={card.id} card={card} onDone={() => onOpenChange(false)} /> : null}
    </Sheet>
  );
}

/**
 * A card reminder is the card's due date (spec 2026-11-14-card-reminders): set it to remind,
 * clear it to stop. No amount is kept; the Owner decides how much when they pay.
 */
function ReminderForm({ card, onDone }: { card: Account | null; onDone: () => void }) {
  const { state, dispatch } = useLedger();
  const credit = state.accounts.filter((a) => a.type === "credit");
  // adding: only cards without a reminder yet
  const choices = card ? [card] : credit.filter((a) => !a.dueDate);
  const [cardId, setCardId] = React.useState<string | null>(card?.id ?? choices[0]?.id ?? null);
  const [day, setDay] = React.useState(card?.dueDate ? String(new Date(card.dueDate).getDate()) : "");

  if (!card && credit.length === 0) return <p className="pt-5 pb-3 text-[14px] text-fg-muted">Add your credit card on Money first.</p>;
  if (!card && choices.length === 0) return <p className="pt-5 pb-3 text-[14px] text-fg-muted">Every card already has a reminder. Tap one in Upcoming to change it.</p>;

  const picked = choices.find((a) => a.id === cardId) ?? null;
  const dueDay = parseDayOfMonth(day);
  const valid = !!picked && dueDay !== null;

  const save = () => {
    if (!picked || dueDay === null) return;
    // same day: keep the date already set; a new day starts the next time it comes round
    const same = picked.dueDate && new Date(picked.dueDate).getDate() === dueDay;
    dispatch({
      type: "upsert-account",
      account: {
        ...picked,
        dueDate: same ? picked.dueDate : parseDay(firstDue(dueDay)).toISOString(),
      },
    });
    onDone();
  };

  return (
    <form
      className="space-y-5 pt-5 pb-3"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      {card ? (
        <div className="flex items-center gap-3">
          <ProviderMark provider={card.provider} size={32} radius={8} />
          <span className="text-[15px]">{card.name}</span>
        </div>
      ) : (
        <div>
          <Eyebrow className="mb-2.5">CARD</Eyebrow>
          <div className="flex flex-wrap gap-2">
            {choices.map((a) => (
              <Pill key={a.id} active={cardId === a.id} className="min-h-10 max-w-full px-3.5 text-[12.5px] whitespace-normal text-start" onClick={() => setCardId(a.id)}>
                {a.name}
              </Pill>
            ))}
          </div>
        </div>
      )}
      <label className="block">
        <Eyebrow className="mb-2">DUE DAY (1–31)</Eyebrow>
        <input value={day} onChange={(e) => setDay(e.target.value.replace(/\D/g, "").slice(0, 2))} inputMode="numeric" placeholder="15" className={cn(FIELD, "font-mono")} />
      </label>
      <p className="text-[13px] leading-[1.45] text-fg-muted">No amount to set. When it's due, you choose how much to pay.</p>
      <Cta type="submit" disabled={!valid}>
        {card ? "Save" : "Remind me"}
      </Cta>
      {card ? (
        <button
          type="button"
          onClick={() => {
            dispatch({
              type: "upsert-account",
              account: { ...card, dueDate: undefined },
            });
            onDone();
          }}
          className="flex min-h-11 w-full items-center justify-center text-[14px] text-danger active:opacity-60"
        >
          Remove reminder
        </button>
      ) : null}
    </form>
  );
}

/* ====================================================================== */
/*  Mark paid                                                              */
/* ====================================================================== */

function MarkPaidSheet({ open, onOpenChange, item }: { open: boolean; onOpenChange: (o: boolean) => void; item: Item | null }) {
  const { state, dispatch } = useLedger();
  const [amount, setAmount] = React.useState("");
  const [accountId, setAccountId] = React.useState<string | null>(null);
  const [date, setDate] = React.useState(localDay());

  React.useEffect(() => {
    if (!open || item?.kind !== "subscription") return;
    setAmount(String(item.amount));
    setAccountId(item.accountId);
    setDate(localDay());
  }, [open, item]);

  const sub = item?.kind === "subscription" ? item.sub : null;
  const value = parseWholePesos(amount);
  const today = localDay();
  const valid = !!sub && value !== null && /^\d{4}-\d{2}-\d{2}$/.test(date) && date <= today;
  const accounts: Account[] = state.accounts.filter((a) => a.type !== "investments");

  const log = () => {
    if (!sub || !valid || value === null) return;
    // today keeps the real time so the entry sorts where it happened; another day is noon that day
    const when = date === today ? new Date() : new Date(parseDay(date).getTime() + 12 * 3_600_000);
    dispatch({
      type: "add-entry",
      entry: {
        id: newId("e"),
        desc: sub.name,
        accountId,
        category: sub.category,
        amount: -value,
        date: when.toISOString(),
        queued: !navigator.onLine,
      },
    });
    onOpenChange(false);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={sub ? `Mark ${sub.name} paid` : "Mark paid"}>
      <form
        className="space-y-5 pt-5 pb-3"
        onSubmit={(e) => {
          e.preventDefault();
          log();
        }}
      >
        <label className="block">
          <Eyebrow className="mb-2">AMOUNT (₱)</Eyebrow>
          <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="numeric" className={cn(FIELD, "font-mono")} />
        </label>
        <div>
          <Eyebrow className="mb-2.5">PAID FROM</Eyebrow>
          <div className="flex flex-wrap gap-2">
            {accounts.map((a) => (
              <Pill key={a.id} active={accountId === a.id} className="min-h-10 max-w-full px-3.5 text-[12.5px] whitespace-normal text-start" onClick={() => setAccountId(a.id)}>
                {a.name}
              </Pill>
            ))}
          </div>
        </div>
        <label className="block">
          <Eyebrow className="mb-2">DATE</Eyebrow>
          <input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} className={cn(FIELD, "font-mono")} />
        </label>
        <Cta type="submit" disabled={!valid}>
          Log {peso(value ?? 0)}
        </Cta>
      </form>
    </Sheet>
  );
}
