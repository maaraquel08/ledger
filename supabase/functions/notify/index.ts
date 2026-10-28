// POST /notify (internal, service role) — Web Push within D-0016 limits.
// {insight_id: uuid} pushes one insight; {flush: true} retries pushes deferred by quiet hours.
import { isServiceRole, serviceClient } from "../_shared/clients.ts";
import { body, error, guard, json, UUID_RE } from "../_shared/http.ts";
import { deliver } from "../_shared/push.ts";

Deno.serve(async (req) => {
  const early = guard(req);
  if (early) return early;
  if (!isServiceRole(req)) return error(401, "unauthorized");

  const b = await body<{ insight_id?: string; flush?: boolean }>(req);
  if (!b || (!b.flush && !(typeof b.insight_id === "string" && UUID_RE.test(b.insight_id)))) {
    return error(400, "bad_request", { detail: "give insight_id or flush: true" });
  }
  try {
    const out = await deliver(serviceClient(), b.flush ? { flush: true } : { insightId: b.insight_id });
    if ("error" in out) return error(503, out.error);
    return json({ results: out });
  } catch (e) {
    console.error("notify failed", e);
    return error(500, "internal");
  }
});
