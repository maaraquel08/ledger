import * as React from "react";
import { ArrowUpIcon, ChevronLeft, ChevronRight, CloseIcon, MicIcon, MoreIcon, Sparkle } from "@/components/ledger/icons";
import { AiSummaryLabel, AiSummaryText } from "@/components/ui/ai-summary/ai-summary";
import { AiEyebrow, AiMark, AiPanel, Cta, ProviderMark, Eyebrow, EntryRow, Screen, Sheet } from "@/components/ledger/primitives";
import { cn } from "@/lib/cn";
import { addDays, compact, goalLabel, goalMonth, localDay, monthName, monthShort, peso, sameDay, startOfDay } from "@/lib/format";
import { back, navigate, query } from "@/lib/router";
import { byCategory, inRange, isIncome, isSpend, monthBounds, netWorth, priorPeriod, spendParts, totals, verdict, weekBounds } from "@/lib/selectors";
import { newId, useLedger } from "@/lib/store";
import { todayBudget } from "@/lib/today";
import { useVoice } from "@/lib/voice";
import type { Category, Entry, LedgerState } from "@/lib/types";
import { callFunction, timezone } from "@/lib/cloud/api";
import { cloud } from "@/lib/supabase";
import { useCloud } from "@/lib/cloud/provider";
import { chatKey } from "@/lib/chat-history";

/* ---------- the local responder (no network) -------------------------- */

export interface Answer {
  read: number; // entries read
  matched: { n: number; label: string };
  compareYear: number;
  text: string;
  /** phrases of `text` that carry the finding — highlighted once streamed */
  marks?: string[];
  bars?: { title: string; kind: "months" | "share"; items: { label: string; value: number; display: string }[] };
  compare?: { title: string; now: number; after: number; unit: string };
  ask?: string;
  offer?: { label: string; name: string; target: number; by: string };
  sources: string[];
  followups: string[];
}

const DISCRETIONARY: Category[] = ["Food & drink", "Shopping", "Transport", "Subscriptions", "Gifts", "Other"];

/** Words people use for a category. */
const CATEGORY_WORDS: [RegExp, Category][] = [
  [/food|drink|eating|meals?\b/, "Food & drink"],
  [/grocer/, "Groceries"],
  [/transport|commute|grab|taxi|fare/, "Transport"],
  [/shopping|shopee|lazada/, "Shopping"],
  [/rent|bills?\b|utilit/, "Rent & bills"],
  [/subscription/, "Subscriptions"],
  [/gifts?\b/, "Gifts"],
  [/household/, "Household"],
  [/health|medic|pharma/, "Health"],
];

/** The period a question is about: last month, this week, this year, or (by default) this month. */
function periodOf(lower: string, today: Date) {
  if (/\btoday\b|\btonight\b/.test(lower)) {
    const from = startOfDay(today);
    return { from, to: addDays(from, 1), label: "today", current: true };
  }
  if (/\byesterday\b/.test(lower)) {
    const to = startOfDay(today);
    return { from: addDays(to, -1), to, label: "yesterday", current: false };
  }
  if (/last week/.test(lower)) {
    const [from] = weekBounds(today);
    return { from: addDays(from, -7), to: from, label: "last week", current: false };
  }
  if (/last month/.test(lower)) {
    const ref = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const [from, to] = monthBounds(ref);
    return { from, to, label: `in ${monthName(ref)}`, current: false };
  }
  if (/\bweek\b/.test(lower)) {
    const [from, to] = weekBounds(today);
    return { from, to, label: "this week", current: true };
  }
  if (/\byear\b/.test(lower)) return { from: new Date(today.getFullYear(), 0, 1), to: new Date(today.getFullYear() + 1, 0, 1), label: "this year", current: true };
  const [from, to] = monthBounds(today);
  return { from, to, label: "this month", current: true };
}

/** "Am I on track for <goal>?" for the Owner's first goal; nothing when there are no goals. */
const goalQuestion = (s: LedgerState) => (s.profile.goals[0] ? [`Am I on track for ${s.profile.goals[0].name}?`] : []);

/** Goals the question names (any word of 4+ letters from the goal's name). */
const goalsNamed = (s: LedgerState, lower: string) =>
  s.profile.goals.filter((g) => g.name.toLowerCase().split(/[^a-z0-9]+/).some((w) => w.length >= 4 && lower.includes(w)));

/** What to suggest in an empty chat: built from what this ledger actually has. */
export function suggestionsFor(s: LedgerState): string[] {
  const out: string[] = [];
  if (s.entries.some(isIncome)) out.push("Where does my salary actually go?");
  out.push(...goalQuestion(s));
  if (s.entries.some(isSpend)) out.push("What should I cut first?", "How much did I spend this week?");
  if (s.profile.monthlyBudget > 0 || s.profile.income > 0) out.push("Am I over budget?");
  if (out.length < 2) out.push("How much did I spend today?");
  return out.slice(0, 3);
}

const entriesWord = (n: number) => `${n} ${n === 1 ? "entry" : "entries"}`;

export function respond(q: string, s: LedgerState, today = new Date()): Answer {
  const lower = q.toLowerCase();
  const year = today.getFullYear();
  const yearEntries = inRange(s.entries, new Date(year, 0, 1), new Date(year + 1, 0, 1));
  const elapsed = today.getMonth() + today.getDate() / 30; // months of data this year
  const t = totals(yearEntries);
  const avgSpend = t.out / Math.max(1, elapsed);
  const base = { read: s.entries.length, compareYear: year - 1, sources: [] as string[], followups: [] as string[] };
  const spend = yearEntries.filter(isSpend);
  const ids = (es: Entry[]) => es.map((e) => e.id);

  if (/coffee|starbucks|tim hortons|cafe|café/.test(lower)) {
    const m = spend.filter((e) => /starbucks|tim hortons|coffee|cafe|café/i.test(e.desc));
    const sum = m.reduce((a, e) => a - e.amount, 0);
    const months = Array.from({ length: today.getMonth() + 1 }, (_, i) => {
      const value = m.filter((e) => new Date(e.date).getMonth() === i).reduce((a, e) => a - e.amount, 0);
      return { label: monthShort(new Date(year, i, 1)).toUpperCase(), value, display: peso(value) };
    });
    return {
      ...base,
      matched: { n: m.length, label: "coffee purchases" },
      text: m.length
        ? `You’ve spent ${peso(sum)} on coffee so far this year across ${m.length} visits. That’s about ${peso(sum / m.length)} a visit and ${peso(sum / Math.max(1, elapsed))} a month.`
        : "I don’t see any coffee purchases this year yet.",
      marks: m.length ? [`${peso(sum)} on coffee`] : undefined,
      bars: m.length ? { title: "COFFEE BY MONTH", kind: "months", items: months } : undefined,
      sources: ids(m),
      followups: ["Skip eating out?", "What should I cut first?"],
    };
  }

  const tonight = /(tonight|today|dinner|lunch|eat out|out now)/.test(lower) && !/\d/.test(lower);
  if (/afford|can i (get|have|go|buy|eat)/.test(lower) && tonight) {
    const tb = todayBudget(s, today);
    const weekFood = spend.filter(
      (e) => e.category === "Food & drink" && new Date(e.date) >= weekBounds(today)[0] && /dinner|lunch|resto|jollibee|out/i.test(e.desc),
    );
    const times = ["once", "twice", "three times", "four times", "five times"][weekFood.length - 1] ?? `${weekFood.length} times`;
    if (!tb.hasBudget) return { ...base, matched: { n: 0, label: "" }, text: "Set a budget first and I’ll tell you what tonight can cost.", followups: [] };
    const room = Math.max(0, Math.floor(tb.left / 50) * 50);
    return {
      ...base,
      matched: { n: weekFood.length, label: "meals out this week" },
      text:
        tb.left > 0
          ? `Yes, up to ${peso(tb.left)}. Anything more comes out of tomorrow, which drops to ${peso(tb.tomorrow)}.`
          : `Not tonight. You’re already ${peso(tb.left)} over today, and tomorrow drops to ${peso(tb.tomorrow)} to cover it.`,
      marks: [tb.left > 0 ? `up to ${peso(tb.left)}` : `${peso(tb.left)} over today`],
      ask:
        tb.left > 0
          ? `${weekFood.length ? `You’ve eaten out ${times} this week already. ` : ""}A ${peso(room)} dinner keeps you on track for the month.`
          : undefined,
      offer: tb.left > 0 && room > 0 ? { label: `Set ${peso(room)} aside`, name: "Dinner out", target: room, by: localDay(today).slice(0, 7) } : undefined,
      sources: ids(weekFood),
      followups: ["Show the math"],
    };
  }

  if (/afford|laptop|buy|purchase/.test(lower)) {
    const found = lower.match(/(\d[\d,]*)\s*(k?)/);
    const parsed = found ? parseFloat(found[1].replace(/,/g, "")) * (found[2] ? 1000 : 1) : 0;
    if (parsed < 1000)
      return {
        ...base,
        matched: { n: 0, label: "" },
        text: "How much is it? Ask me again with the price, like “Can I afford a ₱65,000 laptop?”",
        followups: [],
      };
    const price = parsed;
    const noun = lower.match(/laptop|phone|bike|car|trip|tv|camera|console/)?.[0];
    const cash = netWorth(s.accounts).cash;
    const v = verdict(s, today);
    const nowMo = cash / Math.max(1, avgSpend);
    const afterMo = Math.max(0, (cash - price) / Math.max(1, avgSpend));
    const lead = cash < price ? "Not yet." : afterMo >= 3 ? "Yes, comfortably." : "Yes, but it eats into your buffer.";
    const by = localDay(new Date(today.getFullYear(), today.getMonth() + 1, 1)).slice(0, 7);
    return {
      ...base,
      matched: { n: spend.length, label: "spending entries" },
      text: `${lead} A ${peso(price)} purchase against ${v.left >= 0 ? `${peso(v.left)} left in` : `${peso(v.left)} over`} this month’s budget and ${peso(cash)} in cash. It takes your buffer from ${nowMo.toFixed(1)} to ${afterMo.toFixed(1)} months of expenses${afterMo < 3 ? ", below your 3-month rule" : ""}.`,
      marks: [`${afterMo.toFixed(1)} months of expenses`],
      compare: { title: "IF YOU BUY IT", now: nowMo, after: afterMo, unit: "mo" },
      ask: `Want me to set aside ${peso(price / 4)}/week for four weeks instead?`,
      offer: { label: "Yes, set it up", name: noun ? noun[0].toUpperCase() + noun.slice(1) : "Purchase", target: price, by },
      followups: ["What should I cut first?", ...goalQuestion(s)],
    };
  }

  if (/compar|versus|\bvs\b|than last month|against last month/.test(lower)) {
    const [f, to] = monthBounds(today);
    // like for like: this month so far against the same days of last month
    const prior = priorPeriod("month", f, to, today);
    const cur = inRange(s.entries, f, to).filter(isSpend);
    const prev = inRange(s.entries, prior.from, prior.to).filter(isSpend);
    const curOut = cur.reduce((a, e) => a - e.amount, 0);
    const prevOut = prev.reduce((a, e) => a - e.amount, 0);
    const last = monthName(prior.from);
    const span = prior.partial ? `the same days of ${last}` : last;
    if (!prevOut)
      return {
        ...base,
        matched: { n: cur.length, label: `${monthName(today)} entries` },
        text: `You’ve spent ${peso(curOut)} this month. Nothing was spent in ${span}, so there’s nothing to compare with yet.`,
        sources: ids(cur),
        followups: ["What’s my biggest category?"],
      };
    const ch = Math.round(((curOut - prevOut) / prevOut) * 100);
    const prevBy = new Map(byCategory(prev));
    const mover = byCategory(cur)
      .map(([c, v]) => ({ c, d: v - (prevBy.get(c) ?? 0) }))
      .concat([...prevBy.keys()].filter((c) => !cur.some((e) => spendParts(e).some((p) => p.category === c))).map((c) => ({ c, d: -(prevBy.get(c) ?? 0) })))
      .sort((a, b) => Math.abs(b.d) - Math.abs(a.d))[0];
    const headline = ch === 0 ? "the same as" : `${Math.abs(ch)}% ${ch > 0 ? "more" : "less"} than`;
    return {
      ...base,
      matched: { n: cur.length + prev.length, label: "entries in both months" },
      text: `So far this month you’ve spent ${peso(curOut)}, ${headline} the ${peso(prevOut)} you spent in ${span}.${mover && mover.d !== 0 ? ` The biggest change is ${mover.c.toLowerCase()}, ${mover.d > 0 ? "up" : "down"} ${peso(mover.d)}.` : ""}`,
      marks: [`${headline} the ${peso(prevOut)}`],
      bars: {
        title: prior.partial ? "SPENT · SAME DAYS" : "SPENT",
        kind: "share",
        items: [
          { label: monthShort(prior.from), value: prevOut, display: compact(prevOut) },
          { label: monthShort(today), value: curOut, display: compact(curOut) },
        ],
      },
      sources: ids(cur),
      followups: ["What’s my biggest category?", "How much did I spend this month?"],
    };
  }

  if (/(biggest|largest|top|most)\b.*(categor|spend|spent|expense|money)|categor.*(biggest|largest|most|top)/.test(lower)) {
    const p = periodOf(lower, today);
    const inPeriod = inRange(s.entries, p.from, p.to).filter(isSpend);
    const cats = byCategory(inPeriod);
    if (!cats.length) return { ...base, matched: { n: 0, label: "" }, text: `No spending logged ${p.label} yet.`, followups: [] };
    const total = cats.reduce((a, [, v]) => a + v, 0);
    const pct = (v: number) => Math.round((v / total) * 100);
    const [c, v] = cats[0];
    const m = inPeriod.filter((e) => spendParts(e).some((x) => x.category === c));
    return {
      ...base,
      matched: { n: inPeriod.length, label: "spending entries" },
      text: `${c} is your biggest category ${p.label}: ${peso(v)}, ${pct(v)}% of the ${peso(total)} you spent.${cats[1] ? ` Next is ${cats[1][0].toLowerCase()} at ${peso(cats[1][1])}.` : ""}`,
      marks: [`${c} is your biggest category`],
      bars: { title: "BY CATEGORY", kind: "share", items: cats.slice(0, 5).map(([label, value]) => ({ label, value, display: `${pct(value)}%` })) },
      sources: ids(m),
      followups: ["Compare to last month", "What should I cut first?"],
    };
  }

  if (/spen[dt]|spending/.test(lower) && /how much|what did i|total|so far/.test(lower)) {
    const p = periodOf(lower, today);
    const cat = CATEGORY_WORDS.find(([re]) => re.test(lower))?.[1];
    const inPeriod = inRange(s.entries, p.from, p.to).filter(isSpend);
    const m = cat ? inPeriod.filter((e) => spendParts(e).some((x) => x.category === cat)) : inPeriod;
    const sum = cat ? m.flatMap(spendParts).filter((x) => x.category === cat).reduce((a, x) => a + x.amount, 0) : m.reduce((a, e) => a - e.amount, 0);
    const on = cat ? ` on ${cat.toLowerCase()}` : "";
    const lead = p.current ? `You’ve spent ${peso(sum)}${on} ${p.label}` : `You spent ${peso(sum)}${on} ${p.label}`;
    const tb = todayBudget(s, today);
    const ofBudget = !cat && p.label === "this month" && tb.hasBudget ? ` That’s ${Math.round((sum / tb.budget) * 100)}% of your ${peso(tb.budget)} budget.` : "";
    return {
      ...base,
      matched: { n: m.length, label: cat ? `${cat.toLowerCase()} entries` : "spending entries" },
      text: m.length ? `${lead}, across ${entriesWord(m.length)}.${ofBudget}` : `Nothing spent${on} ${p.label} yet.`,
      marks: m.length ? [`${peso(sum)}${on}`] : undefined,
      sources: ids(m),
      followups: ["Compare to last month", "What’s my biggest category?"],
    };
  }

  if (/skip|eating out|dining|restaurant|food/.test(lower)) {
    const f = spend.filter((e) => e.category === "Food & drink");
    const sum = f.reduce((a, e) => a - e.amount, 0);
    const monthly = sum / Math.max(1, elapsed);
    return {
      ...base,
      matched: { n: f.length, label: "food & drink entries" },
      text: `Food & drink averages ${peso(monthly)} a month for you. Cutting it in half would free up ${peso(monthly / 2)} a month, or about ${peso((monthly / 2) * 12)} over a year.`,
      marks: [`${peso(monthly / 2)} a month`],
      sources: ids(f),
      followups: ["What should I cut first?", "How much did I spend on coffee?"],
    };
  }

  if (/salary|income|where does|go\b|paycheck/.test(lower)) {
    const inc = yearEntries.filter(isIncome);
    const earned = inc.reduce((a, e) => a + e.amount, 0);
    const invested = yearEntries.filter((e) => e.category === "Investments" && e.amount < 0).reduce((a, e) => a - e.amount, 0);
    const rows = [...byCategory(yearEntries).map(([c, v]) => ({ label: c as string, v })), ...(invested ? [{ label: "Investments", v: invested }] : [])]
      .sort((a, b) => b.v - a.v)
      .slice(0, 5);
    const pct = (v: number) => (earned ? Math.round((v / earned) * 100) : 0);
    return {
      ...base,
      matched: { n: inc.length, label: "income deposits" },
      text: earned
        ? `Of every ₱100 you earn, ${rows.slice(0, 3).map((r) => `${peso(pct(r.v))} goes to ${r.label.toLowerCase()}`).join(", ")}. You’ve earned ${peso(earned)} this year.`
        : "I don’t see any income logged this year yet.",
      marks: earned && rows[0] ? [`${peso(pct(rows[0].v))} goes to ${rows[0].label.toLowerCase()}`] : undefined,
      bars: earned ? { title: "WHERE IT GOES", kind: "share", items: rows.map((r) => ({ label: r.label, value: r.v, display: `${pct(r.v)}%` })) } : undefined,
      sources: ids(inc),
      followups: ["What should I cut first?", "Skip eating out?"],
    };
  }

  const named = goalsNamed(s, lower);
  if (/goal|on track|trip|saving for/.test(lower) || named.length) {
    const goals = named.length ? named : s.profile.goals;
    const capacity = Math.max(0, t.net / Math.max(1, elapsed));
    if (!goals.length)
      return { ...base, matched: { n: 0, label: "" }, text: "You haven’t set a matching goal yet. Add one from Insights and I’ll check your pace.", followups: ["What should I cut first?"] };
    const dated = goals.flatMap((g) => {
      const by = goalMonth(g.by);
      if (!by) return [];
      const monthsLeft = Math.max(1, (by.getFullYear() - today.getFullYear()) * 12 + by.getMonth() - today.getMonth());
      return [{ g, need: Math.max(0, g.target - g.saved) / monthsLeft, monthsLeft }];
    });
    const undated = goals.filter((g) => !goalMonth(g.by));
    const skipped = undated.map((g) => `${g.name} has no date, so I left it out.`).join(" ");
    if (!dated.length)
      return {
        ...base,
        matched: { n: goals.length, label: goals.length === 1 ? "goal" : "goals" },
        text: `${skipped} Add a date in Budgets and I’ll check your pace.`,
        followups: ["What should I cut first?"],
      };
    const lines = dated;
    const need = lines.reduce((a, l) => a + l.need, 0);
    const on = capacity >= need;
    return {
      ...base,
      matched: { n: goals.length, label: goals.length === 1 ? "goal" : "goals" },
      text: `${on ? "Yes, you’re on track." : "Not quite yet."} ${lines
        .map((l) => `${l.g.name}: ${peso(l.g.saved)} of ${peso(l.g.target)}, needs ${peso(l.need)} a month for ${l.monthsLeft} month${l.monthsLeft === 1 ? "" : "s"}`)
        .join("; ")}. You’re setting aside about ${peso(capacity)} a month${on ? "." : `, so you’re ${peso(need - capacity)} a month short.`}${skipped ? ` ${skipped}` : ""}`,
      marks: [on ? "Yes, you’re on track." : `${peso(need - capacity)} a month short`],
      followups: ["What should I cut first?", "Skip eating out?"],
    };
  }

  if (/cut|trim|reduce|save more|spend less/.test(lower)) {
    const ranked = byCategory(yearEntries).filter(([c]) => DISCRETIONARY.includes(c));
    if (!ranked.length) return { ...base, matched: { n: 0, label: "" }, text: "I need a few more logged purchases before I can say what to cut.", followups: [] };
    const [c, v] = ranked[0];
    const m = spend.filter((e) => e.category === c);
    const monthly = v / Math.max(1, elapsed);
    return {
      ...base,
      matched: { n: m.length, label: `${c.toLowerCase()} entries` },
      text: `Your biggest flexible category is ${c}: ${peso(monthly)} a month. Trimming a quarter of it saves ${peso(monthly / 4)} a month. Rent and bills aren’t worth chasing.`,
      marks: [`${c}: ${peso(monthly)} a month`],
      sources: ids(m),
      followups: ["Skip eating out?", ...goalQuestion(s)],
    };
  }

  if (/math|daily|per day|a day|worked out|budget/.test(lower)) {
    const tb = todayBudget(s, today);
    if (!tb.hasBudget) return { ...base, matched: { n: 0, label: "" }, text: "Set a budget first and I’ll show you the daily math.", followups: [] };
    const [f, to] = monthBounds(today);
    const month = inRange(s.entries, f, to).filter(isSpend);
    const over = tb.spentMonth - tb.budget;
    if (tb.budget - tb.spentBefore <= 0 || over > 0) {
      // over budget: there is no daily allowance to spread, so no per-day line (QA F)
      const lead = `You’re ${peso(Math.max(0, over))} over this month’s budget`;
      return {
        ...base,
        matched: { n: month.length, label: `${monthName(today)} entries` },
        text: `${lead}. You’ve spent ${peso(tb.spentMonth)} against ${peso(tb.budget)}${tb.spentToday ? `, ${peso(tb.spentToday)} of it today on day-to-day things` : ""}.`,
        marks: [lead],
        sources: ids(month),
        followups: ["What should I cut first?", "What’s my biggest category?"],
      };
    }
    const end = tb.left >= 0 ? `${peso(tb.left)} is left today` : `you’re ${peso(tb.left)} over today; tomorrow drops to ${peso(tb.tomorrow)}`;
    return {
      ...base,
      matched: { n: month.length, label: `${monthName(today)} entries` },
      text: `${/over budget|within budget|on budget/.test(lower) ? "No, you’re within budget. " : ""}Your ${monthName(today)} budget is ${peso(tb.budget)}. Before today you’d spent ${peso(tb.spentBefore)}, leaving ${peso(tb.budget - tb.spentBefore)} over ${tb.daysLeft} days, about ${peso(tb.allowance)} a day. Today you’ve spent ${peso(tb.spentToday)} on day-to-day things, so ${end}.`,
      marks: [end],
      sources: ids(month),
      followups: ["What should I cut first?"],
    };
  }

  return {
    ...base,
    matched: { n: 0, label: "" },
    text: "I’m not sure I can answer that yet. I can tell you what you’ve spent this month, compare it with last month, find your biggest category, look at coffee and food spending, check whether you can afford a purchase, where your salary goes, whether you’re on track for a goal, and what to cut first.",
    followups: ["How much did I spend this month?", "Compare to last month", "What’s my biggest category?"],
  };
}

/* ---------- cloud: the chat function ----------------------------------- */

const NO_ANSWER: Answer = { read: 0, matched: { n: 0, label: "" }, compareYear: 0, text: "", sources: [], followups: [] };

type CloudReply = { kind: "answer"; ans: Answer } | { kind: "local" } | { kind: "error"; text: string };

/**
 * The chat function's request turns ({role, text}, supabase/functions/README.md). Only answered
 * exchanges are history: a reply that failed or was stopped (no answer) is never sent as an
 * assistant turn, and the question it left unanswered is dropped with it. The last question is
 * always kept.
 */
export function chatMessages(history: Pick<Msg, "role" | "text" | "ans">[]): { role: "user" | "assistant"; text: string }[] {
  const out: { role: "user" | "assistant"; text: string }[] = [];
  history.forEach((m, i) => {
    if (m.role !== "user" || !m.text?.trim()) return;
    const reply = history[i + 1];
    const last = i === history.length - 1;
    const answer = reply?.role === "ai" ? reply.ans?.text?.trim() : undefined;
    if (!last && !answer) return;
    out.push({ role: "user", text: m.text });
    if (!last && answer) out.push({ role: "assistant", text: answer });
  });
  return out.slice(-12);
}

async function askCloud(history: Msg[]): Promise<CloudReply> {
  const messages = chatMessages(history);
  if (!navigator.onLine) return { kind: "local" };
  let res;
  try {
    res = await callFunction("chat", { messages, tz: timezone() });
  } catch {
    return { kind: "local" };
  }
  if (res.status === 503 || res.status === 404) return { kind: "local" };
  const d = (res.data ?? {}) as Partial<Answer> & { error?: string; message?: string };
  if (res.status === 429)
    return { kind: "error", text: typeof d.message === "string" && d.message ? d.message : "You’ve asked me a lot today. I can answer again tomorrow; everything you log still saves." };
  if (!res.ok || typeof d.text !== "string")
    return { kind: "error", text: "I couldn’t answer just now. Try again in a moment." };
  return {
    kind: "answer",
    ans: {
      ...NO_ANSWER,
      ...d,
      matched: d.matched ?? NO_ANSWER.matched,
      sources: Array.isArray(d.sources) ? d.sources : [],
      followups: Array.isArray(d.followups) ? d.followups : [],
    } as Answer,
  };
}

/* ---------- messages --------------------------------------------------- */

interface Msg {
  id: string;
  role: "user" | "ai";
  at?: number; // sent time
  via?: "voice" | "text";
  text?: string; // user text or plain ai text
  q?: string; // the question an ai message answers
  status?: "loading" | "streaming" | "done";
  t0?: number;
  words?: number;
  ans?: Answer;
  offerDone?: boolean;
}

const MAX = 500;
const STREAM_AT = 1200;
const WORD_MS = 40;

const wordsOf = (a: Answer) => a.text.split(" ");

function load(key: string): Msg[] {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return [];
    return (JSON.parse(raw) as Msg[]).map((m) =>
      m.status === "loading" || m.status === "streaming" ? { ...m, status: "done", words: m.ans ? wordsOf(m.ans).length : 0 } : m,
    );
  } catch {
    return [];
  }
}

const CHIPS = ["How much did I spend today?", "Am I over budget?", "Where does my salary go?"];

export function Chat({ path }: { path: string }) {
  const { state, dispatch } = useLedger();
  // cloud: one conversation per signed-in user; erase and sign-out clear it (lib/chat-history)
  const store = chatKey(useCloud()?.uid);
  const [msgs, setMsgs] = React.useState<Msg[]>(() => load(store));
  const [text, setText] = React.useState("");
  const [focused, setFocused] = React.useState(false);
  const [menu, setMenu] = React.useState(false);
  const [confirmClear, setConfirmClear] = React.useState(false);
  const menuRef = React.useRef<HTMLDivElement>(null);
  const [sources, setSources] = React.useState<string[] | null>(null);
  const [copied, setCopied] = React.useState<string | null>(null);
  const endRef = React.useRef<HTMLDivElement>(null);
  const taRef = React.useRef<HTMLTextAreaElement>(null);
  const sentQ = React.useRef(false);

  React.useEffect(() => {
    try {
      sessionStorage.setItem(store, JSON.stringify(msgs));
    } catch {
      /* ignore */
    }
  }, [msgs, store]);

  // close the More menu on Escape or a tap outside it
  React.useEffect(() => {
    if (!menu) return;
    const close = () => {
      setMenu(false);
      setConfirmClear(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    const onDown = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) close();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [menu]);

  const tb = todayBudget(state);
  const [listening, setListening] = React.useState(false);
  const voice = useVoice({
    onDone: (t) => {
      setListening(false);
      send(t, "voice");
    },
    onError: () => setListening(false),
  });

  // Entries logged by voice today sit in the thread, in time order (v15).
  const voiceToday = state.entries.filter((e) => e.source === "voice" && sameDay(new Date(e.date), new Date()));
  const thread = [
    ...voiceToday.map((e) => ({ t: new Date(e.date).getTime(), entry: e as Entry | undefined, msg: undefined as Msg | undefined })),
    // a message without a time (an answer) stays right after the one before it
    ...msgs.reduce<{ t: number; entry: Entry | undefined; msg: Msg | undefined }[]>((out, m) => {
      out.push({ t: m.at ?? out.at(-1)?.t ?? 0, entry: undefined, msg: m });
      return out;
    }, []),
  ].sort((a, b) => a.t - b.t);

  const active = msgs.find((m) => m.status === "loading" || m.status === "streaming");
  const lastDone = [...msgs].reverse().find((m) => m.role === "ai" && m.status === "done");

  // Drive the answer lifecycle from elapsed time: steps, then word-by-word.
  const activeId = active?.id;
  React.useEffect(() => {
    if (!activeId) return;
    const id = setInterval(() => {
      setMsgs((ms) =>
        ms.map((m) => {
          if (m.id !== activeId || !m.ans || !m.t0) return m;
          const el = Date.now() - m.t0;
          // force a re-render during the step phase so the steps tick forward
          if (el < STREAM_AT) return { ...m };
          const total = wordsOf(m.ans).length;
          const words = Math.min(total, Math.floor((el - STREAM_AT) / WORD_MS) + 1);
          return { ...m, status: words >= total ? "done" : "streaming", words };
        }),
      );
    }, 50);
    return () => clearInterval(id);
  }, [activeId]);

  // keep the newest message in view
  React.useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    endRef.current?.scrollIntoView({ block: "end", behavior: reduce ? "auto" : "smooth" });
  }, [msgs.length, active?.status, active?.words]);

  React.useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 144)}px`;
  }, [text]);

  const run = (question: string, via: "voice" | "text" = "text") => {
    const user: Msg = { id: newId("m"), role: "user", text: question, at: Date.now(), via };
    dispatch({ type: "ask" });
    if (!cloud) {
      const ai: Msg = { id: newId("m"), role: "ai", q: question, status: "loading", t0: Date.now(), words: 0, ans: respond(question, state) };
      setMsgs((ms) => [...ms, user, ai]);
      return;
    }
    // cloud: Claude answers server-side (D-0013); no AI on the server or no connection → the local answer
    const ai: Msg = { id: newId("m"), role: "ai", q: question, status: "loading", t0: Date.now(), words: 0 };
    setMsgs((ms) => [...ms, user, ai]);
    const snapshot = state;
    askCloud([...msgs, user]).then((r) =>
      setMsgs((ms) =>
        ms.map((m) => {
          if (m.id !== ai.id || m.status !== "loading") return m; // stopped meanwhile
          if (r.kind === "error") return { ...m, status: "done", text: r.text };
          // skip the reading steps: the server already read
          return { ...m, ans: r.kind === "answer" ? r.ans : respond(question, snapshot), t0: Date.now() - STREAM_AT };
        }),
      ),
    );
  };

  const send = (raw: string, via: "voice" | "text" = "text") => {
    const q = raw.trim().slice(0, MAX);
    if (!q || active) return;
    run(q, via);
    setText("");
  };

  // "/chat?q=…" from a link: ask once on mount, then clean the URL.
  React.useEffect(() => {
    if (sentQ.current) return;
    sentQ.current = true;
    const q = query(path).get("q");
    if (q) {
      send(q, query(path).get("via") === "voice" ? "voice" : "text");
      navigate("/chat", { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stop = () => setMsgs((ms) => ms.map((m) => (m.id === activeId ? { ...m, status: "done", words: m.status === "loading" ? 0 : m.words } : m)));

  const addGoal = (m: Msg) => {
    const o = m.ans?.offer;
    if (!o || m.offerDone) return;
    dispatch({
      type: "update-profile",
      patch: { goals: [...state.profile.goals, { id: newId("g"), name: o.name, saved: 0, target: o.target, by: o.by }] },
    });
    setMsgs((ms) => [
      ...ms.map((x) => (x.id === m.id ? { ...x, offerDone: true } : x)),
      {
        id: newId("m"),
        role: "ai",
        status: "done",
        text: `Done. I added “${o.name}” as a goal of ${peso(o.target)}, by ${goalLabel(o.by)}. I haven’t moved any money.`,
      },
    ]);
  };

  const copy = (m: Msg) => {
    navigator.clipboard?.writeText(m.ans?.text ?? m.text ?? "").catch(() => {});
    setCopied(m.id);
    setTimeout(() => setCopied(null), 1600);
  };

  const showCounter = text.includes("\n") || text.length >= 80;
  const placeholder =
    active?.status === "loading"
      ? "Reading your entries…"
      : active
        ? "Answering…"
        : listening
          ? "Listening… release to send"
          : "Reply or hold to talk…";

  const sourceEntries = (sources ?? []).map((id) => state.entries.find((e) => e.id === id)).filter((e): e is Entry => !!e);

  return (
    <Screen>
      {/* header */}
      <div className="sticky top-0 z-10 bg-bg/95 backdrop-blur-sm">
        <div className="grid grid-cols-[1fr_auto_1fr] items-center px-4 pt-3 pb-2">
          <button
            type="button"
            onClick={() => back("/today")}
            className="-ml-1 flex h-11 items-center gap-0.5 justify-self-start rounded-md pr-2 text-[14px] text-fg-subtle active:opacity-60"
          >
            <ChevronLeft size={18} />
            Today
          </button>
          <span className="eyebrow">{tb.hasBudget ? (tb.left >= 0 ? `${peso(tb.left)} left today` : `${peso(tb.left)} over today`) : "M8"}</span>
          <div ref={menuRef} className="relative justify-self-end">
            <button type="button" aria-label="More" aria-expanded={menu} onClick={() => { setMenu((x) => !x); setConfirmClear(false); }} className="flex size-11 items-center justify-center rounded-full active:bg-surface">
              <MoreIcon />
            </button>
            {menu ? (
              <div className="absolute right-0 z-20 mt-1 w-52 rounded-md border border-line bg-bg p-1 shadow-overlay">
                {confirmClear ? (
                  <div role="alertdialog" aria-label="Confirm clear conversation" className="flex flex-col gap-1">
                    <button
                      type="button"
                      autoFocus
                      onClick={() => {
                        setConfirmClear(false);
                        setMenu(false);
                      }}
                      className="flex h-11 w-full items-center rounded-sm px-3 text-left text-[14px] active:bg-surface"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setMsgs([]);
                        setConfirmClear(false);
                        setMenu(false);
                      }}
                      className="flex h-11 w-full items-center rounded-sm px-3 text-left text-[14px] font-semibold text-danger active:bg-surface"
                    >
                      Clear conversation
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmClear(true)}
                    className="flex h-11 w-full items-center rounded-sm px-3 text-left text-[14px] active:bg-surface"
                  >
                    Clear conversation
                  </button>
                )}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <p role="status" className="sr-only">
        {active ? "M8 is typing" : (lastDone?.ans?.text ?? lastDone?.text ?? "")}
      </p>

      {/* thread */}
      <div className={cn("flex-1 px-6 pt-2 pb-6", thread.length > 0 && "flex flex-col justify-end")}>
        {thread.length === 0 ? (
          <div className="pt-10">
            <div className="mx-auto flex size-12 items-center justify-center rounded-full border border-line-strong font-mono text-[18px] text-fg-muted">?</div>
            <h1 className="mt-4 text-center text-[20px] font-semibold tracking-[-0.01em]">Ask anything about your money</h1>
            <p className="mx-auto mt-2 max-w-[300px] text-center text-[13.5px] leading-[1.5] text-fg-muted">
              I can see your entries, budgets, goals and holdings. I never move money.
            </p>
            <Eyebrow className="mt-9">TRY ONE OF THESE</Eyebrow>
            <ul className="mt-2 flex flex-col gap-1">
              {suggestionsFor(state).map((s) => (
                <li key={s}>
                  <button type="button" onClick={() => send(s)} className="flex min-h-12 w-full items-center justify-between gap-3 py-3 text-left text-[14.5px] active:opacity-60">
                    {s}
                    <ChevronRight size={16} className="flex-none text-fg-subtle" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <>
            <div className="mb-[22px] text-center font-mono text-[9.5px] font-medium tracking-[0.14em] text-fg-subtle">TODAY</div>
            <div className="flex flex-col gap-[22px]">
              {thread.map(({ entry, msg }) => {
                if (entry) {
                  const a = state.accounts.find((x) => x.id === entry.accountId);
                  return (
                    <button
                      key={entry.id}
                      type="button"
                      onClick={() => navigate(`/activity/${entry.id}`)}
                      className="flex items-center gap-2.5 self-end rounded-[14px] border border-line px-3 py-2.5 text-left active:bg-surface"
                    >
                      <ProviderMark provider={a?.provider ?? null} size={28} radius={8} />
                      <span>
                        <span className="block text-[13px] font-medium">
                          {entry.desc} · {entry.amount < 0 ? "−" : "+"}
                          {peso(entry.amount)}
                        </span>
                        <span className="mt-0.5 block font-mono text-[9.5px] font-medium text-fg-subtle">LOGGED BY VOICE · {clock(entry.date)}</span>
                      </span>
                    </button>
                  );
                }
                const m = msg!;
                return m.role === "user" ? (
                  <div key={m.id} className="flex max-w-[80%] flex-col items-end gap-[5px] self-end">
                    <p className="rounded-[18px_18px_4px_18px] bg-accent px-[15px] py-[11px] text-[14.5px] leading-[1.4] break-words whitespace-pre-wrap text-accent-fg">
                      {m.text}
                    </p>
                    {m.at ? (
                      <span className="flex items-center gap-1 font-mono text-[9.5px] font-medium text-fg-subtle">
                        {m.via === "voice" ? <MicIcon size={10} /> : null}
                        {m.via === "voice" ? "VOICE · " : ""}
                        {clock(m.at)}
                      </span>
                    ) : null}
                  </div>
                ) : (
                  <AiMessage
                    key={m.id}
                    m={m}
                    copied={copied === m.id}
                    onCopy={() => copy(m)}
                    onSources={() => setSources(m.ans?.sources ?? [])}
                    onOffer={() => addGoal(m)}
                    onFollow={send}
                    busy={!!active}
                  />
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* composer */}
      <div className="sticky bottom-0 z-10 border-t border-line bg-bg px-4 pt-2.5 pb-[max(12px,env(safe-area-inset-bottom))]">
        {focused && !text && !active && !lastDone?.ans?.followups.length ? (
          <div className="no-scrollbar -mx-4 mb-2.5 flex gap-1.5 overflow-x-auto px-4" onPointerDown={(e) => e.preventDefault()}>
            {CHIPS.map((c) => (
              <button key={c} type="button" onClick={() => send(c)} className="h-11 rounded-[22px] border border-line-strong px-3 text-[12px] whitespace-nowrap active:bg-surface">
                {c}
              </button>
            ))}
          </div>
        ) : null}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(text);
          }}
          className={cn("flex items-end gap-2 rounded-[27px] border py-1.5 pr-1.5 pl-4", focused ? "border-accent" : "border-line-strong")}
        >
          <textarea
            ref={taRef}
            rows={1}
            value={text}
            maxLength={MAX}
            placeholder={placeholder}
            aria-label="Ask M8"
            enterKeyHint="send"
            onChange={(e) => setText(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(text);
              }
            }}
            className="max-h-36 min-h-10 min-w-0 flex-1 resize-none bg-transparent py-2 text-[16px] leading-[1.4] outline-none placeholder:text-mute"
          />
          {text && !active ? (
            <button
              type="button"
              aria-label="Clear"
              onClick={() => {
                setText("");
                taRef.current?.focus();
              }}
              className="hit flex size-10 flex-none items-center justify-center text-fg-subtle active:opacity-60"
            >
              <CloseIcon size={14} />
            </button>
          ) : null}
          {active ? (
            <button type="button" aria-label="Stop answering" onClick={stop} className="hit flex size-10 flex-none items-center justify-center rounded-full bg-accent text-accent-fg active:bg-accent-hover">
              <span className="size-3 rounded-[2px] bg-current" />
            </button>
          ) : !text.trim() ? (
            <button
              type="button"
              aria-label="Hold to talk"
              onPointerDown={(e) => {
                e.preventDefault();
                (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
                setListening(true);
                voice.start();
              }}
              onPointerUp={() => voice.finish()}
              onPointerCancel={() => {
                voice.cancel();
                setListening(false);
              }}
              onKeyDown={(e) => {
                if ((e.key === " " || e.key === "Enter") && !e.repeat) {
                  e.preventDefault();
                  setListening(true);
                  voice.start();
                }
              }}
              onKeyUp={(e) => {
                if (e.key === " " || e.key === "Enter") voice.finish();
              }}
              onContextMenu={(e) => e.preventDefault()}
              className={cn(
                "hit flex size-10 flex-none touch-none items-center justify-center rounded-full bg-highlight text-highlight-fg select-none [-webkit-touch-callout:none]",
                listening && "shadow-[0_0_0_6px_color-mix(in_oklab,var(--color-highlight)_30%,var(--color-bg))]",
              )}
            >
              <MicIcon size={18} />
            </button>
          ) : (
            <button
              type="submit"
              aria-label="Send"
              disabled={!text.trim()}
              className="hit flex size-10 flex-none items-center justify-center rounded-full bg-accent text-accent-fg active:bg-accent-hover disabled:bg-fill disabled:text-fg-subtle"
            >
              <ArrowUpIcon />
            </button>
          )}
        </form>
        {showCounter ? <p className="tnum mt-1.5 pr-3 text-right font-mono text-[10.5px] text-fg-subtle">{text.length} / {MAX}</p> : null}
        {listening && voice.heard ? <p className="mt-1.5 px-3 text-[13px] text-fg-muted">{voice.heard}</p> : null}
      </div>

      <Sheet open={sources !== null} onOpenChange={(o) => !o && setSources(null)} title={<AiEyebrow>SOURCES · {sourceEntries.length}</AiEyebrow>}>
        <div className="flex flex-col gap-4 pt-5">
          {sourceEntries.slice(0, 60).map((e) => (
            <EntryRow
              key={e.id}
              entry={e}
              account={state.accounts.find((a) => a.id === e.accountId)}
              onClick={() => {
                setSources(null);
                navigate(`/activity/${e.id}`);
              }}
            />
          ))}
          {sourceEntries.length > 60 ? <p className="text-[12.5px] text-fg-muted">Showing the 60 most recent of {sourceEntries.length}.</p> : null}
        </div>
        <Cta className="mt-5" variant="secondary" onClick={() => setSources(null)}>
          Close
        </Cta>
      </Sheet>
      <div ref={endRef} />
    </Screen>
  );
}

const clock = (t: string | number) => new Date(t).toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" });

/** Wrap each mark phrase found in `text` in an AiMark. */
function withMarks(text: string, marks: string[] = []): React.ReactNode {
  const found = marks.filter((m) => m && text.includes(m));
  if (!found.length) return text;
  const re = new RegExp(`(${found.map((m) => m.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`);
  return text.split(re).map((part, i) => (found.includes(part) ? <AiMark key={i}>{part}</AiMark> : part));
}

function AiMessage({
  m,
  copied,
  onCopy,
  onSources,
  onOffer,
  onFollow,
  busy,
}: {
  m: Msg;
  copied: boolean;
  onCopy: () => void;
  onSources: () => void;
  onOffer: () => void;
  onFollow: (q: string) => void;
  busy: boolean;
}) {
  if (!m.ans && m.status !== "loading") return <p className="text-[14.5px] leading-[1.55]">{m.text}</p>;

  const loading = m.status === "loading";
  const a = m.ans ?? NO_ANSWER; // cloud: waiting for the server, the loading state below shows
  const words = wordsOf(a);
  const shown = m.words ?? 0;
  const complete = m.status === "done" && shown >= words.length;
  const max = Math.max(...(a.bars?.items.map((x) => x.value) ?? [1]), 1);

  if (loading || (m.status === "streaming" && shown === 0))
    return (
      <div className="flex flex-col gap-2.5">
        <div className="flex items-center gap-[7px]">
          <Sparkle size={12} />
          <span className="eyebrow !text-gold-ink">M8</span>
        </div>
        <div className="flex gap-[5px] py-1">
          {[100, 60, 30].map((o, i) => (
            <span
              key={i}
              className="block size-[7px] rounded-full bg-warning motion-safe:animate-pulse"
              style={{ opacity: o / 100, animationDelay: `${i * 180}ms` }}
            />
          ))}
        </div>
      </div>
    );

  return (
    <div>
      <AiPanel label="M8">
        {shown > 0 ? (
          <AiSummaryText className="mt-2.5 text-[15px]/[1.6]">
            {complete ? withMarks(a.text, a.marks) : words.slice(0, shown).join(" ")}
            {m.status === "streaming" ? <span className="ml-0.5 inline-block h-[1em] w-px translate-y-[2px] bg-bg motion-safe:animate-pulse" /> : null}
          </AiSummaryText>
        ) : null}

        {complete && a.compare ? (
          <div className="mt-4 rounded-md border border-bg/15 p-4">
            <AiSummaryLabel>{a.compare.title}</AiSummaryLabel>
            {[
              { k: "NOW", v: a.compare.now, tone: "bg-success" },
              { k: "AFTER", v: a.compare.after, tone: a.compare.after < 3 ? "bg-danger" : "bg-success" },
            ].map((r) => (
              <div key={r.k} className="mt-3 flex items-center gap-3">
                <span className="w-12 font-mono text-[10px] font-semibold tracking-[0.08em] text-bg/66">{r.k}</span>
                <div className="h-2.5 flex-1 rounded-full bg-bg/15">
                  <div className={cn("h-full rounded-full", r.tone)} style={{ width: `${Math.min(100, (r.v / Math.max(a.compare!.now, 0.1)) * 100)}%` }} />
                </div>
                <span className="tnum w-14 text-right text-[13px] font-semibold text-bg/90">
                  {r.v.toFixed(1)}
                  {a.compare!.unit}
                </span>
              </div>
            ))}
          </div>
        ) : null}

        {complete && a.bars ? (
          <div className="mt-4 rounded-md border border-bg/15 p-4">
            <AiSummaryLabel>{a.bars.title}</AiSummaryLabel>
            {a.bars.kind === "months" ? (
              <div className="mt-3 flex h-24 items-end gap-1.5">
                {a.bars.items.map((b) => (
                  <div key={b.label} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
                    <div className="w-full rounded-t-[3px] bg-highlight" style={{ height: `${Math.max(3, (b.value / max) * 85)}%` }}>
                      <span className="sr-only">{b.label} {b.display}</span>
                    </div>
                    <span aria-hidden className="font-mono text-[9.5px] text-bg/66">{b.label[0]}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-3 flex flex-col gap-2.5">
                {a.bars.items.map((b) => (
                  <div key={b.label} className="flex items-center gap-3 text-[12.5px] text-bg/86">
                    <span className="w-24 break-words">{b.label}</span>
                    <div className="h-2 flex-1 rounded-full bg-bg/15">
                      <div className="h-full rounded-full bg-highlight" style={{ width: `${(b.value / max) * 100}%` }}>
                        <span className="sr-only">{b.label} {b.display}</span>
                      </div>
                    </div>
                    <span className="tnum w-10 text-right font-semibold text-bg">{b.display}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : null}

        {complete && a.ask ? <AiSummaryText className="mt-4 text-[14.5px]/[1.65]">{a.ask}</AiSummaryText> : null}
      </AiPanel>
      {complete && (a.offer || a.followups.length) ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {a.offer ? (
            <button
              type="button"
              disabled={m.offerDone}
              onClick={onOffer}
              className="h-11 rounded-[22px] bg-accent px-4 text-[12.5px] font-semibold text-accent-fg active:bg-accent-hover disabled:bg-fill disabled:text-fg-subtle"
            >
              {m.offerDone ? "Goal added" : a.offer.label}
            </button>
          ) : null}
          {a.followups.map((f) => (
            <button key={f} type="button" disabled={busy} onClick={() => onFollow(f)} className="h-11 rounded-[22px] border border-line-strong px-3.5 text-[12.5px] active:bg-surface disabled:opacity-50">
              {f}
            </button>
          ))}
        </div>
      ) : null}

      {m.status === "done" ? (
        <div className="mt-3 flex flex-wrap items-center gap-x-1 font-mono text-[10px] font-semibold tracking-[0.08em] text-fg-subtle">
          <button type="button" onClick={onCopy} className="h-11 px-1.5 active:opacity-60">
            {copied ? "COPIED" : "COPY"}
          </button>
          {a.sources.length ? (
            <button type="button" onClick={onSources} className="h-11 px-1.5 active:opacity-60">
              SOURCES · {a.sources.length}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
