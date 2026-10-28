// Web Push delivery within the D-0016 limits (Deno, service role). Used by the notify function.
import webpush from "npm:web-push@3.6.7";
import type { Db } from "./clients.ts";
import { decidePush, type InsightKind, pushText } from "./notify_policy.ts";

export interface PushOutcome {
  insight_id: string;
  result: "sent" | "skipped" | "failed" | "deferred" | "already";
  reason?: string;
  until?: string;
}

const PENDING_DAYS = 7;

let vapidReady: boolean | null = null;
function vapid(): boolean {
  if (vapidReady != null) return vapidReady;
  const pub = Deno.env.get("VAPID_PUBLIC_KEY");
  const priv = Deno.env.get("VAPID_PRIVATE_KEY");
  const subject = Deno.env.get("VAPID_SUBJECT");
  vapidReady = !!(pub && priv && subject);
  if (vapidReady) webpush.setVapidDetails(subject!, pub!, priv!);
  return vapidReady;
}

interface InsightRow {
  id: string;
  user_id: string;
  kind: InsightKind;
  metrics: { material?: boolean; anomaly_kind?: string } | null;
  pushed_at: string | null;
  read_at: string | null;
  dismissed_at: string | null;
}

/** Push one insight, or (flush) every pending pushable insight deferred by quiet hours. */
export async function deliver(svc: Db, opts: { insightId?: string; flush?: boolean }, now = new Date()): Promise<PushOutcome[] | { error: string }> {
  if (!vapid()) return { error: "push_unconfigured" };
  let q = svc.from("insights").select("id, user_id, kind, metrics, pushed_at, read_at, dismissed_at");
  if (opts.insightId) q = q.eq("id", opts.insightId);
  else
    q = q.is("pushed_at", null).is("dismissed_at", null).is("read_at", null).in("kind", ["weekly", "alert"])
      .gte("created_at", new Date(now.getTime() - PENDING_DAYS * 86_400_000).toISOString()).order("created_at").limit(200);
  const { data, error } = await q;
  if (error) throw new Error(error.message);

  const out: PushOutcome[] = [];
  for (const ins of (data ?? []) as InsightRow[]) out.push(await deliverOne(svc, ins, now));
  return out;
}

async function deliverOne(svc: Db, ins: InsightRow, now: Date): Promise<PushOutcome> {
  if (ins.pushed_at) return { insight_id: ins.id, result: "already" };
  const { count: logged } = await svc.from("notification_log").select("id", { count: "exact", head: true }).eq("insight_id", ins.id);
  if ((logged ?? 0) > 0) return { insight_id: ins.id, result: "already" };
  const log = (status: "sent" | "skipped" | "failed", reason?: string) =>
    svc.from("notification_log").insert({ user_id: ins.user_id, insight_id: ins.id, channel: "push", status, reason: reason ?? null });

  if (ins.dismissed_at || ins.read_at) {
    await log("skipped", "already_seen");
    return { insight_id: ins.id, result: "skipped", reason: "already_seen" };
  }

  const { data: p } = await svc.from("profiles")
    .select("push_enabled, timezone, push_quiet_start, push_quiet_end, push_max_per_week").eq("user_id", ins.user_id).maybeSingle();
  const { count: sent } = await svc.from("notification_log").select("id", { count: "exact", head: true })
    .eq("user_id", ins.user_id).eq("status", "sent").gte("sent_at", new Date(now.getTime() - 7 * 86_400_000).toISOString());

  const decision = decidePush(
    { kind: ins.kind, material: ins.metrics?.material === true },
    {
      pushEnabled: p?.push_enabled === true,
      timezone: p?.timezone ?? "Asia/Manila",
      quietStart: p?.push_quiet_start ?? "22:00",
      quietEnd: p?.push_quiet_end ?? "07:00",
      maxPerWeek: p?.push_max_per_week ?? 3,
    },
    sent ?? 0,
    now,
  );
  if (decision.action === "defer") return { insight_id: ins.id, result: "deferred", reason: decision.reason, until: decision.until.toISOString() };
  if (decision.action === "skip") {
    await log("skipped", decision.reason);
    return { insight_id: ins.id, result: "skipped", reason: decision.reason };
  }

  const { data: subs } = await svc.from("push_subscriptions").select("id, endpoint, p256dh, auth").eq("user_id", ins.user_id);
  if (!subs?.length) {
    await log("skipped", "no_subscription");
    return { insight_id: ins.id, result: "skipped", reason: "no_subscription" };
  }
  const text = pushText(ins.kind, ins.metrics?.anomaly_kind);
  const payload = JSON.stringify({ ...text, insight_id: ins.id, url: "/" });
  let ok = 0;
  const errors: string[] = [];
  for (const s of subs) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 24 * 3600, urgency: "normal" });
      ok++;
      await svc.from("push_subscriptions").update({ last_used_at: now.toISOString() }).eq("id", s.id);
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) await svc.from("push_subscriptions").delete().eq("id", s.id);
      errors.push(String(status ?? (e as Error).message));
    }
  }
  if (ok) {
    await log("sent");
    await svc.from("insights").update({ pushed_at: now.toISOString() }).eq("id", ins.id);
    return { insight_id: ins.id, result: "sent" };
  }
  await log("failed", errors.join(",").slice(0, 200));
  return { insight_id: ins.id, result: "failed", reason: errors.join(",") };
}
