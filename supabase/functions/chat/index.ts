// POST /chat — M8 answers a question with read-only tools over the ledger.
// Request {messages: {role, text}[], tz} → the client's `Answer` (src/screens/chat.tsx).
// Every number in the answer is a fact rendered by the server; prose with a digit that did not
// come from a fact is re-asked once, then replaced by a deterministic template.
import { type Answer, buildAnswer, fallbackAnswer, type ModelAnswer } from "../_shared/answer.ts";
import { CHAT_TOOLS, chatTurns, type LedgerReader, runTool } from "../_shared/chat_tools.ts";
import { AiError, aiClient, aiFailure, call, type MessageParam, MODEL, parseJson, system, type ToolParam } from "../_shared/claude.ts";
import { type Db, rpc, userClient, userId } from "../_shared/clients.ts";
import { FactRegistry, userNumbers } from "../_shared/facts.ts";
import { body, error, guard, json, validTz } from "../_shared/http.ts";
import { CHAT_SYSTEM } from "../_shared/prompts.ts";
import { CHAT_ANSWER_SCHEMA } from "../_shared/schemas.ts";
import { localIso, localParts } from "../_shared/time.ts";

interface ChatBody {
  /** {role, text}; `content` (string) is accepted too, see chatTurns */
  messages: unknown;
  tz: string;
}

/** Server-side daily cap on questions (D-0016: a cost guard, not UI scarcity). */
const DAILY_LIMIT = Number(Deno.env.get("CHAT_DAILY_LIMIT") ?? "100");
const MAX_TURNS = 12;
const MAX_TOOL_ROUNDS = 6;
const MAX_TEXT = 2000;

Deno.serve(async (req) => {
  const early = guard(req);
  if (early) return early;

  // authenticate first: an unauthenticated caller learns nothing about the configuration
  const db = userClient(req);
  const uid = db ? await userId(db) : null;
  if (!db || !uid) return error(401, "unauthorized");

  const claude = aiClient();
  if (!claude) return error(503, "ai_unconfigured");

  const b = await body<ChatBody>(req);
  const turns = chatTurns(b?.messages, MAX_TURNS);
  if (!turns.length || turns.at(-1)!.role !== "user") return error(400, "bad_request", { detail: "messages must end with a user message" });
  const tz = validTz(b!.tz) ?? "Asia/Manila";
  const now = new Date();

  const quota = await rpc<{ allowed: boolean; used: number; limit: number }>(db, "chat_quota_take", { p_limit: DAILY_LIMIT });
  if (!quota.allowed) return error(429, "daily_limit", { limit: quota.limit });

  const reg = new FactRegistry(tz);
  const question = turns.at(-1)!.text.slice(0, MAX_TEXT);
  const asked = userNumbers(question, reg);
  const year = localParts(now, tz).year;

  // history: alternating turns, first one from the user
  while (turns.length && turns[0].role !== "user") turns.shift();
  const messages: MessageParam[] = turns.slice(0, -1).map((t) => ({ role: t.role, content: t.text.slice(0, MAX_TEXT) }));
  const askedNote = asked.length ? `\nnumbers in this question: ${asked.map((id) => `${id} = ${reg.display(id)}`).join(", ")}` : "";
  messages.push({
    role: "user",
    content: `<context>\nnow: ${localIso(now, tz)}\ntimezone: ${tz}${askedNote}\n</context>\n${question}`,
  });

  const reader = ledgerReader(db);
  const tools = CHAT_TOOLS as unknown as ToolParam[];
  try {
    let model = await converse(messages, { db: reader, reg, tz, now, tools });
    let built = buildAnswer(model, reg, { year });
    if (built.violations.length) {
      console.warn("chat: re-asking after validator", built.violations);
      messages.push({
        role: "user",
        content: `Your answer broke the number rule: ${built.violations.slice(0, 5).join("; ")}. Rewrite it. Every number must be a {{fN}} placeholder for a fact from the tool results; type no digits yourself.`,
      });
      model = await converse(messages, { db: reader, reg, tz, now, tools });
      built = buildAnswer(model, reg, { year });
    }
    const answer: Answer = built.violations.length ? fallbackAnswer(reg, { year }) : built.answer;
    if (built.violations.length) console.warn("chat: fell back to the template", built.violations);
    return json(answer);
  } catch (e) {
    console.error("chat failed", e);
    if (e instanceof AiError && e.code !== "refused") return json(fallbackAnswer(reg, { year }));
    const f = aiFailure(e);
    return error(f.status, f.code);
  }

  async function converse(
    msgs: MessageParam[],
    c: { db: LedgerReader; reg: FactRegistry; tz: string; now: Date; tools: ToolParam[] },
  ): Promise<ModelAnswer> {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const m = await call(claude!, {
        model: MODEL.chat,
        system: system(CHAT_SYSTEM),
        messages: msgs,
        tools: c.tools,
        schema: CHAT_ANSWER_SCHEMA,
        effort: "medium",
        maxTokens: 12000,
      });
      msgs.push({ role: "assistant", content: m.content });
      if (m.stop_reason !== "tool_use") return parseJson<ModelAnswer>(m);
      const results = [];
      for (const block of m.content) {
        if (block.type !== "tool_use") continue;
        try {
          const out = await runTool(block.name, (block.input ?? {}) as Record<string, unknown>, c);
          results.push({ type: "tool_result" as const, tool_use_id: block.id, content: JSON.stringify(out) });
        } catch (err) {
          results.push({ type: "tool_result" as const, tool_use_id: block.id, is_error: true, content: (err as Error).message.slice(0, 300) });
        }
      }
      msgs.push({ role: "user", content: results });
    }
    throw new AiError("no_output", "too many tool rounds");
  }
});

function ledgerReader(db: Db): LedgerReader {
  return {
    rpc: (name, args) => rpc(db, name, args),
    async accounts() {
      const [bal, nw, rec] = await Promise.all([
        db.from("account_balances").select("account_id, name, type, balance, entry_count, last_entry_at, archived_at").is("archived_at", null),
        db.from("net_worth").select("cash, invested, credit_owed, total").maybeSingle(),
        db.from("reconciliation").select("account_id, name, as_of, reported, derived, gap"),
      ]);
      for (const r of [bal, nw, rec]) if (r.error) throw new Error(r.error.message);
      return {
        balances: (bal.data ?? []) as Record<string, unknown>[],
        netWorth: (nw.data ?? null) as Record<string, unknown> | null,
        reconciliation: ((rec.data ?? []) as Record<string, unknown>[]).filter((r) => r.as_of != null),
      };
    },
  };
}
