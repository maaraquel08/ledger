// POST /insights-run (cron, service role) — {kind: "daily"|"weekly"|"monthly"|"alerts"}.
// Called by private.invoke_insights (20261029000800_cron.sql): POST, JSON body {"kind": …},
// Authorization: Bearer <service_role_key from Vault>. Runs once for every owner in profiles.
// Deterministic triggers decide whether anything is worth saying; only then is Claude called.
import { type Anthropic, anthropic, call, MODEL, parseJson, type MessageParam, system } from "../_shared/claude.ts";
import { type Db, isServiceRole, rpc, serviceClient } from "../_shared/clients.ts";
import { factify, FactRegistry, renderProse, tidy } from "../_shared/facts.ts";
import { body, error, guard, json } from "../_shared/http.ts";
import { alertTemplate, dailyTemplate, type Narrative, reviewTemplate } from "../_shared/narrate.ts";
import { INSIGHT_SYSTEM } from "../_shared/prompts.ts";
import { INSIGHT_SCHEMA } from "../_shared/schemas.ts";
import { localDate } from "../_shared/time.ts";
import {
  type Anomaly, dailyWorthIt, type ExistingInsight, headline, type InsightKind, isMaterial, isQuiet, type PeriodCompare,
  reviewNotables, type RunKind, shouldWrite,
} from "../_shared/triggers.ts";

const KINDS: RunKind[] = ["daily", "weekly", "monthly", "alerts"];
type PB = { start: string; end: string };

interface Outcome {
  user_id: string;
  kind: InsightKind;
  fingerprint?: string;
  result: "written" | "skipped" | "error";
  reason?: string;
  insight_id?: string;
}

Deno.serve(async (req) => {
  const early = guard(req);
  if (early) return early;
  if (!isServiceRole(req)) return error(401, "unauthorized");
  const b = await body<{ kind?: string }>(req);
  const kind = KINDS.find((k) => k === b?.kind);
  if (!kind) return error(400, "bad_request", { detail: "kind must be daily, weekly, monthly or alerts" });

  const svc = serviceClient();
  const claude = anthropic();
  const now = new Date();
  const { data: owners, error: ownersErr } = await svc.from("profiles").select("user_id, timezone");
  if (ownersErr) return error(500, "internal", { detail: ownersErr.message });

  const outcomes: Outcome[] = [];
  for (const o of owners ?? []) {
    try {
      outcomes.push(...(await runFor(svc, claude, kind, o.user_id, o.timezone ?? "Asia/Manila", now)));
    } catch (e) {
      console.error(`insights-run ${kind} failed for an owner`, e);
      outcomes.push({ user_id: o.user_id, kind: kind === "alerts" ? "alert" : kind, result: "error", reason: (e as Error).message.slice(0, 200) });
    }
  }

  // push what D-0016 allows; the hourly alerts run also retries pushes deferred by quiet hours
  const pushes: unknown[] = [];
  for (const o of outcomes) {
    if (o.result === "written" && o.insight_id && (o.kind === "weekly" || o.kind === "monthly" || o.kind === "alert")) {
      pushes.push(await notify({ insight_id: o.insight_id }));
    }
  }
  if (kind === "alerts") pushes.push(await notify({ flush: true }));

  return json({ kind, owners: owners?.length ?? 0, outcomes, pushes });
});

async function notify(payload: Record<string, unknown>): Promise<unknown> {
  try {
    const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/notify`, {
      method: "POST",
      headers: { Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return await res.json().catch(() => ({ status: res.status }));
  } catch (e) {
    return { error: (e as Error).message };
  }
}

async function runFor(svc: Db, claude: Anthropic | null, kind: RunKind, user: string, tz: string, now: Date): Promise<Outcome[]> {
  const p_user = user;
  const { data: prior } = await svc.from("insights").select("kind, fingerprint, dismissed_at, created_at, narrative")
    .eq("user_id", user).gte("created_at", new Date(now.getTime() - 120 * 86_400_000).toISOString()).order("created_at", { ascending: false });
  const existing = (prior ?? []) as (ExistingInsight & { narrative: string | null })[];
  const headlines = existing.filter((e) => e.narrative).slice(0, 10).map((e) => headline(e.narrative!));
  const bounds = (period: string, anchor: string | Date) =>
    rpc<PB>(svc, "period_bounds", { p_period: period, p_anchor: typeof anchor === "string" ? anchor : anchor.toISOString(), p_user });
  const before = (iso: string) => new Date(Date.parse(iso) - 1000).toISOString();

  const write = async (k: InsightKind, fingerprint: string, period: PB | null, packet: Record<string, unknown>, n: Narrative, extra: Record<string, unknown> = {}): Promise<Outcome> => {
    const { data, error } = await svc.from("insights").insert({
      user_id: user, kind: k, fingerprint, period_start: period?.start ?? null, period_end: period?.end ?? null,
      metrics: { ...packet, ...extra }, narrative: n.narrative, cited_entry_ids: n.cited_entry_ids.slice(0, 1000),
    }).select("id").maybeSingle();
    if (error?.code === "23505") return { user_id: user, kind: k, fingerprint, result: "skipped", reason: "exists" };
    if (error) throw new Error(error.message);
    return { user_id: user, kind: k, fingerprint, result: "written", insight_id: data?.id };
  };
  const gate = (k: InsightKind, fp: string): Outcome | null => {
    const d = shouldWrite(k, fp, existing, now);
    return d.write ? null : { user_id: user, kind: k, fingerprint: fp, result: "skipped", reason: d.reason };
  };

  if (kind === "daily") {
    const fp = `daily:${localDate(now, tz)}`;
    const skip = gate("daily", fp);
    if (skip) return [skip];
    const day = await bounds("day", now);
    const [tb, today] = await Promise.all([
      rpc<{ has_budget: boolean; left?: Fact; spent_today?: Fact }>(svc, "today_budget", { p_now: now.toISOString(), p_user }),
      rpc<{ spend: Fact; entry_count: Fact }>(svc, "metrics_period", { p_start: day.start, p_end: day.end, p_user }),
    ]);
    if (!dailyWorthIt({ today: tb, entriesToday: Number(today.entry_count.value ?? 0) })) {
      return [{ user_id: user, kind: "daily", fingerprint: fp, result: "skipped", reason: "nothing_to_say" }];
    }
    const packet = { today_budget: tb, today: { spend: today.spend, entry_count: today.entry_count } };
    const n = await narrate(claude, tz, MODEL.daily, "daily", packet, [], headlines, () => dailyTemplate(tb, today));
    return [await write("daily", fp, day, packet, n)];
  }

  if (kind === "weekly" || kind === "monthly") {
    let cur: PB, prev: PB;
    if (kind === "weekly") {
      cur = await bounds("week", now);
      prev = await bounds("week", before(cur.start));
    } else {
      const thisMonth = await bounds("month", now);
      cur = await bounds("month", before(thisMonth.start)); // the month being closed
      prev = await bounds("month", before(cur.start));
    }
    const fp = kind === "weekly" ? `weekly:${localDate(new Date(cur.start), tz)}` : `monthly:${localDate(new Date(cur.start), tz).slice(0, 7)}`;
    const skip = gate(kind, fp);
    if (skip) return [skip];
    const [cmp, anomalies, goals] = await Promise.all([
      rpc<PeriodCompare>(svc, "compare_periods", { p_start: cur.start, p_end: cur.end, p_prev_start: prev.start, p_prev_end: prev.end, p_user }),
      rpc<{ anomalies: Anomaly[] }>(svc, "detect_anomalies", { p_now: now.toISOString(), p_user }),
      rpc<unknown[]>(svc, "goal_progress", { p_user }),
    ]);
    const packet = { period: kind === "weekly" ? "this week" : "last month", compare: cmp, anomalies: anomalies.anomalies, goals };
    const notes = reviewNotables(cmp, anomalies.anomalies);
    const fallback = () => reviewTemplate(kind, cmp);
    // nothing logged, or (weekly) nothing notable: "nothing to flag" without a Claude call
    const n = isQuiet(cmp) || (kind === "weekly" && notes.length === 0)
      ? fallback()
      : await narrate(claude, tz, MODEL.review, kind, packet, notes, headlines, fallback);
    return [await write(kind, fp, cur, packet, n, { notes })];
  }

  // alerts
  const { anomalies } = await rpc<{ anomalies: Anomaly[] }>(svc, "detect_anomalies", { p_now: now.toISOString(), p_user });
  const out: Outcome[] = [];
  for (const a of anomalies) {
    const skip = gate("alert", a.fingerprint);
    if (skip) {
      out.push(skip);
      continue;
    }
    const packet = { anomaly: a };
    const n = await narrate(claude, tz, MODEL.alert, "alert", packet, [a.kind.replace(/_/g, " ")], headlines, () => alertTemplate(a));
    const o = await write("alert", a.fingerprint, null, packet, n, { material: isMaterial(a), anomaly_kind: a.kind });
    existing.unshift({ kind: "alert", fingerprint: a.fingerprint, dismissed_at: null, created_at: now.toISOString(), narrative: n.narrative });
    out.push(o);
  }
  return out;
}

type Fact = { value: number | null; entry_ids: string[] };

/** Claude writes the note with fact placeholders; validator; one re-ask; then the template. */
async function narrate(
  claude: Anthropic | null, tz: string, model: string, kind: string, packet: Record<string, unknown>, notes: string[], headlines: string[],
  fallback: () => Narrative,
): Promise<Narrative> {
  if (!claude) return fallback();
  const reg = new FactRegistry(tz);
  const view = factify(packet, reg);
  const messages: MessageParam[] = [{
    role: "user",
    content: `<kind>${kind}</kind>\n<recent_headlines>\n${headlines.map((h) => `- ${h}`).join("\n") || "(none)"}\n</recent_headlines>\n<notes>\n${notes.map((x) => `- ${x}`).join("\n") || "(none)"}\n</notes>\n<facts>\n${JSON.stringify(view)}\n</facts>`,
  }];
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const m = await call(claude, { model, system: system(INSIGHT_SYSTEM), messages, schema: INSIGHT_SCHEMA, effort: "low", maxTokens: 4000 });
      const out = parseJson<{ narrative: string; cited_facts: string[] }>(m);
      const r = renderProse(out.narrative, reg);
      if (!r.violations.length && r.text.trim()) {
        const cited = [...r.used, ...out.cited_facts.filter((id) => reg.get(id))];
        return { narrative: tidy(r.text), cited_entry_ids: reg.entryIds(cited) };
      }
      messages.push({ role: "assistant", content: m.content });
      messages.push({ role: "user", content: `That broke the number rule: ${r.violations.slice(0, 5).join("; ")}. Rewrite using only {{fN}} placeholders for numbers.` });
    }
  } catch (e) {
    console.warn(`insights-run: Claude failed for ${kind}, using the template`, e);
  }
  return fallback();
}
