import { describe, expect, test, vi } from "vitest";
import { aiConfig, ANTHROPIC_MODELS, resolveProvider, sttConfig } from "../../supabase/functions/_shared/ai_config";
import {
  AiError,
  type AMessage,
  compatCall,
  type CompatClient,
  compatText,
  FINAL_JSON_NUDGE,
  flattenToolHistory,
  fromOpenAi,
  normaliseNulls,
  ProviderError,
  providerFailure,
  strictify,
  toOpenAiMessages,
  toOpenAiTools,
  validate,
} from "../../supabase/functions/_shared/openai_compat";
import { CHAT_TOOLS } from "../../supabase/functions/_shared/chat_tools";
import { CHAT_ANSWER_SCHEMA, INSIGHT_SCHEMA, PARSE_SCHEMA } from "../../supabase/functions/_shared/schemas";

// ---- provider selection ----------------------------------------------------------------------

describe("provider selection", () => {
  test("anthropic key wins by default; AI_API_KEY alone → openai_compat; neither → null", () => {
    expect(resolveProvider({ ANTHROPIC_API_KEY: "sk-ant", AI_API_KEY: "gsk" })).toBe("anthropic");
    expect(resolveProvider({ AI_API_KEY: "gsk" })).toBe("openai_compat");
    expect(resolveProvider({})).toBeNull();
    expect(resolveProvider({ ANTHROPIC_API_KEY: "  " })).toBeNull();
  });

  test("explicit AI_PROVIDER needs its own key; unknown values are unconfigured", () => {
    expect(resolveProvider({ AI_PROVIDER: "openai_compat", ANTHROPIC_API_KEY: "a", AI_API_KEY: "g" })).toBe("openai_compat");
    expect(resolveProvider({ AI_PROVIDER: "openai_compat", ANTHROPIC_API_KEY: "a" })).toBeNull();
    expect(resolveProvider({ AI_PROVIDER: "anthropic", AI_API_KEY: "g" })).toBeNull();
    expect(resolveProvider({ AI_PROVIDER: "gemini", AI_API_KEY: "g" })).toBeNull();
  });

  test("anthropic config keeps the Claude models per job", () => {
    expect(aiConfig({ ANTHROPIC_API_KEY: "a" })).toEqual({ provider: "anthropic", apiKey: "a", models: ANTHROPIC_MODELS });
  });

  test("openai_compat defaults to Groq and maps jobs onto roles", () => {
    const c = aiConfig({ AI_API_KEY: "gsk" });
    expect(c).toMatchObject({ provider: "openai_compat", baseUrl: "https://api.groq.com/openai/v1", apiKey: "gsk", maxCompletionTokens: 4096 });
    expect(c!.models).toEqual({
      parseText: "openai/gpt-oss-20b",
      parsePhoto: "qwen/qwen3.8-27b",
      chat: "openai/gpt-oss-120b",
      daily: "openai/gpt-oss-120b",
      alert: "openai/gpt-oss-120b",
      review: "openai/gpt-oss-120b",
    });
  });

  test("per-role overrides, base URL and token cap", () => {
    const c = aiConfig({
      AI_PROVIDER: "openai_compat", AI_API_KEY: "k", AI_BASE_URL: "https://example.test/v1/",
      AI_MODEL_PARSE: "p", AI_MODEL_VISION: "v", AI_MODEL_CHAT: "c", AI_MODEL_SUMMARY: "s", AI_MAX_TOKENS: "2000",
    });
    expect(c).toMatchObject({ baseUrl: "https://example.test/v1", maxCompletionTokens: 2000 });
    expect(c!.models).toEqual({ parseText: "p", parsePhoto: "v", chat: "c", daily: "s", alert: "s", review: "s" });
  });

  test("speech to text follows the provider, with overrides", () => {
    expect(sttConfig({ AI_API_KEY: "gsk" })).toEqual({ baseUrl: "https://api.groq.com/openai/v1", apiKey: "gsk", model: "whisper-large-v3" });
    expect(sttConfig({ ANTHROPIC_API_KEY: "a", OPENAI_API_KEY: "sk" })).toEqual({ baseUrl: "https://api.openai.com/v1", apiKey: "sk", model: "gpt-4o-mini-transcribe" });
    // anthropic for text, but an AI_API_KEY is around: STT stays on OpenAI with the OpenAI key
    expect(sttConfig({ ANTHROPIC_API_KEY: "a", AI_API_KEY: "gsk" })).toBeNull();
    expect(sttConfig({ ANTHROPIC_API_KEY: "a", AI_API_KEY: "gsk", STT_BASE_URL: "https://api.groq.com/openai/v1" }))
      .toEqual({ baseUrl: "https://api.groq.com/openai/v1", apiKey: "gsk", model: "whisper-large-v3" });
    expect(sttConfig({ AI_API_KEY: "gsk", STT_API_KEY: "x", STT_MODEL: "whisper-large-v3-turbo" }))
      .toEqual({ baseUrl: "https://api.groq.com/openai/v1", apiKey: "x", model: "whisper-large-v3-turbo" });
    expect(sttConfig({})).toBeNull();
  });
});

// ---- schemas -----------------------------------------------------------------------------------

describe("strict schemas", () => {
  const loose = {
    type: "object",
    properties: {
      name: { type: "string" },
      note: { type: "string", description: "optional" },
      size: { type: "string", enum: ["s", "m"] },
      tags: { type: "array", items: { type: "object", properties: { k: { type: "string" }, v: { type: "number" } }, required: ["k"] } },
      ref: { anyOf: [{ type: "string" }, { type: "number" }] },
    },
    required: ["name", "tags"],
  };

  test("every object lists all properties, forbids extras, optional → nullable", () => {
    const s = strictify(loose) as any;
    expect(s.required).toEqual(["name", "note", "size", "tags", "ref"]);
    expect(s.additionalProperties).toBe(false);
    expect(s.properties.name).toEqual({ type: "string" });
    expect(s.properties.note).toEqual({ type: ["string", "null"], description: "optional" });
    expect(s.properties.size).toEqual({ type: ["string", "null"], enum: ["s", "m", null] });
    expect(s.properties.ref.anyOf).toEqual([{ type: "string" }, { type: "number" }, { type: "null" }]);
    expect(s.properties.tags.items).toMatchObject({ required: ["k", "v"], additionalProperties: false, properties: { v: { type: ["number", "null"] } } });
    expect(loose.required).toEqual(["name", "tags"]); // input untouched
  });

  test("already-strict app schemas are unchanged", () => {
    for (const s of [PARSE_SCHEMA, CHAT_ANSWER_SCHEMA, INSIGHT_SCHEMA]) expect(strictify(s)).toEqual(s);
  });

  test("validator accepts good output and names what is wrong", () => {
    const s = strictify(loose);
    expect(validate(s, { name: "a", note: null, size: "m", tags: [{ k: "x", v: null }], ref: 3 })).toEqual([]);
    expect(validate(s, { name: "a", note: null, size: "xl", tags: [], ref: null })).toEqual(["$.size: not one of the allowed values"]);
    expect(validate(s, { name: 1, note: null, size: null, tags: [], ref: null, extra: 1 })).toEqual(["$.name: expected string, got integer", "$.extra: not allowed"]);
    expect(validate(s, { name: "a" })).toContain("$.tags: missing");
    expect(validate(PARSE_SCHEMA, { entries: [], receipt: null })).toEqual([]);
  });

  test("nulls for originally-optional fields go back to undefined; required nullables stay null", () => {
    const out = normaliseNulls(loose, { name: "a", note: null, size: null, tags: [{ k: "x", v: null }], ref: null });
    expect(out).toEqual({ name: "a", tags: [{ k: "x" }] });
    expect("note" in out).toBe(false);
    const chat = { text: "t", marks: [], matched_label: "", matched_fact: null, bars: null, compare: null, ask: null, offer: null, source_facts: [], followups: [] };
    expect(normaliseNulls(CHAT_ANSWER_SCHEMA, chat)).toEqual(chat);
  });
});

// ---- translation -------------------------------------------------------------------------------

describe("message and tool translation", () => {
  const sys = [{ type: "text" as const, text: "rules" }, { type: "text" as const, text: "kb", cache_control: { type: "ephemeral" } }];

  test("system blocks join; images become data URLs; text-only content is a string", () => {
    const out = toOpenAiMessages(sys, [
      { role: "user", content: "hi" },
      { role: "user", content: [{ type: "image", source: { type: "base64", media_type: "image/jpeg", data: "QUJD" } }, { type: "text", text: "receipt" }] } as AMessage,
    ]);
    expect(out[0]).toEqual({ role: "system", content: "rules\n\nkb" });
    expect(out[1]).toEqual({ role: "user", content: "hi" });
    expect(out[2]).toEqual({ role: "user", content: [{ type: "image_url", image_url: { url: "data:image/jpeg;base64,QUJD" } }, { type: "text", text: "receipt" }] });
  });

  test("tool definitions become function tools", () => {
    const [t] = toOpenAiTools(CHAT_TOOLS as never);
    expect(t).toEqual({ type: "function", function: { name: "period_summary", description: CHAT_TOOLS[0].description, parameters: CHAT_TOOLS[0].input_schema } });
  });

  test("tool_calls → tool_use → tool_calls round-trips with ids; tool_result → role tool", () => {
    const res = {
      id: "r1",
      choices: [{ finish_reason: "tool_calls", message: { content: null, tool_calls: [{ id: "call_1", type: "function" as const, function: { name: "today_budget", arguments: "{}" } }, { id: "call_2", type: "function" as const, function: { name: "what_if_purchase", arguments: '{"amount":5000}' } }] } }],
    };
    const m = fromOpenAi(res, "openai/gpt-oss-120b");
    expect(m.stop_reason).toBe("tool_use");
    expect(m.content).toEqual([
      { type: "tool_use", id: "call_1", name: "today_budget", input: {} },
      { type: "tool_use", id: "call_2", name: "what_if_purchase", input: { amount: 5000 } },
    ]);
    const back = toOpenAiMessages([], [
      { role: "assistant", content: m.content },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "call_1", content: '{"left":1}' }, { type: "tool_result", tool_use_id: "call_2", is_error: true, content: "bad amount" }] } as AMessage,
    ]);
    expect(back).toEqual([
      { role: "assistant", content: null, tool_calls: res.choices[0].message.tool_calls },
      { role: "tool", tool_call_id: "call_1", content: '{"left":1}' },
      { role: "tool", tool_call_id: "call_2", content: "ERROR: bad amount" },
    ]);
  });

  test("stop reasons: length → max_tokens, refusal → refusal, think tags stripped", () => {
    expect(fromOpenAi({ choices: [{ finish_reason: "length", message: { content: "{" } }] }, "m").stop_reason).toBe("max_tokens");
    expect(fromOpenAi({ choices: [{ finish_reason: "stop", message: { content: "", refusal: "no" } }] }, "m").stop_reason).toBe("refusal");
    expect(fromOpenAi({ choices: [{ finish_reason: "stop", message: { content: "<think>hm</think>{}" } }] }, "m").content).toEqual([{ type: "text", text: "{}" }]);
    expect(() => fromOpenAi({ choices: [{ message: { tool_calls: [{ id: "c", type: "function", function: { name: "x", arguments: "{oops" } }] } }] }, "m")).toThrow(AiError);
  });

  test("tool history flattens to text for the final structured call", () => {
    const flat = flattenToolHistory([
      { role: "assistant", content: [{ type: "tool_use", id: "c1", name: "today_budget", input: {} }] } as AMessage,
      { role: "user", content: [{ type: "tool_result", tool_use_id: "c1", content: '{"left":1}' }] } as AMessage,
    ]);
    expect(toOpenAiMessages([], flat)).toEqual([
      { role: "assistant", content: "[called tool today_budget with {}]" },
      { role: "user", content: '<tool_result tool="today_budget">\n{"left":1}\n</tool_result>' },
    ]);
  });
});

// ---- the client against a mocked fetch -----------------------------------------------------------

type Reply = { status?: number; body: unknown; headers?: Record<string, string> } | Error;
function mockClient(replies: Reply[]) {
  const bodies: any[] = [];
  const fetch = vi.fn(async (_url: string, init: RequestInit) => {
    bodies.push(JSON.parse(String(init.body)));
    const r = replies.shift();
    if (!r) throw new Error("no more replies");
    if (r instanceof Error) throw r;
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: r.headers });
  });
  const client: CompatClient = { baseUrl: "https://api.groq.com/openai/v1", apiKey: "gsk", maxCompletionTokens: 4096, fetch: fetch as never, sleep: async () => {} };
  return { client, fetch, bodies };
}
const text = (content: string) => ({ body: { choices: [{ finish_reason: "stop", message: { content } }] } });
const answer = { text: "You have {{f1}} left.", marks: [], matched_label: "Today", matched_fact: "f1", bars: null, compare: null, ask: null, offer: null, source_facts: ["f1"], followups: [] };
const chatOpts = (messages: AMessage[]) => ({
  model: "openai/gpt-oss-120b",
  system: [{ type: "text" as const, text: "be M8" }],
  messages,
  schema: CHAT_ANSWER_SCHEMA,
  effort: "medium" as const,
  maxTokens: 12000,
  tools: CHAT_TOOLS as never,
});

describe("chat two-phase flow", () => {
  test("tool call → tool result → prose → final strict JSON with no tools", async () => {
    const { client, bodies } = mockClient([
      { body: { choices: [{ finish_reason: "tool_calls", message: { content: null, tool_calls: [{ id: "call_9", type: "function", function: { name: "today_budget", arguments: "{}" } }] } }] } },
      text("You have 500 left today."),
      text(JSON.stringify(answer)),
    ]);
    const msgs: AMessage[] = [{ role: "user", content: "how much can I spend today?" }];

    // round 1: the model asks for a tool (same loop as chat/index.ts converse())
    const m1 = await compatCall(client, chatOpts(msgs));
    expect(m1.stop_reason).toBe("tool_use");
    expect(bodies[0]).toMatchObject({ model: "openai/gpt-oss-120b", tool_choice: "auto", max_completion_tokens: 4096, reasoning_effort: "medium", include_reasoning: false });
    expect(bodies[0].response_format).toBeUndefined();
    expect(bodies[0].tools).toHaveLength(CHAT_TOOLS.length);
    msgs.push({ role: "assistant", content: m1.content });
    msgs.push({ role: "user", content: [{ type: "tool_result", tool_use_id: "call_9", content: '{"left":"{{f1}}"}' }] } as AMessage);

    // round 2: prose answer, then the final structured call
    const m2 = await compatCall(client, chatOpts(msgs));
    expect(bodies[1].messages.slice(-2)).toEqual([
      { role: "assistant", content: null, tool_calls: [{ id: "call_9", type: "function", function: { name: "today_budget", arguments: "{}" } }] },
      { role: "tool", tool_call_id: "call_9", content: '{"left":"{{f1}}"}' },
    ]);
    const final = bodies[2];
    expect(final.tools).toBeUndefined();
    expect(final.response_format).toMatchObject({ type: "json_schema", json_schema: { strict: true, schema: CHAT_ANSWER_SCHEMA } });
    expect(final.messages.some((x: any) => x.role === "tool" || x.tool_calls)).toBe(false);
    expect(final.messages.at(-2)).toEqual({ role: "assistant", content: "You have 500 left today." });
    expect(final.messages.at(-1)).toEqual({ role: "user", content: FINAL_JSON_NUDGE });
    expect(m2.stop_reason).toBe("end_turn");
    expect(JSON.parse((m2.content[0] as { text: string }).text)).toEqual(answer);
  });

  test("a first-round answer that already validates skips the second call", async () => {
    const { client, fetch } = mockClient([text(JSON.stringify(answer))]);
    const m = await compatCall(client, chatOpts([{ role: "user", content: "hi" }]));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse((m.content[0] as { text: string }).text)).toEqual(answer);
  });
});

describe("chat: tool round that fails after tool results (live QA, gpt-oss-120b)", () => {
  const toolUse = { body: { choices: [{ finish_reason: "tool_calls", message: { content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: "today_budget", arguments: "{}" } }] } }] } };
  const jsonTool = { status: 400, body: { error: { message: "Tool call validation failed: attempted to call tool 'json' which was not in request.tools", code: "tool_use_failed" } } };
  const withResults: AMessage[] = [
    { role: "user", content: "how much can I spend today?" },
    { role: "assistant", content: [{ type: "tool_use", id: "call_1", name: "today_budget", input: {} }] } as AMessage,
    { role: "user", content: [{ type: "tool_result", tool_use_id: "call_1", content: '{"left":"{{f1}}"}' }] } as AMessage,
  ];

  test("the model calling a made-up 'json' tool goes straight to the final strict-JSON call", async () => {
    const { client, fetch, bodies } = mockClient([jsonTool, text(JSON.stringify(answer))]);
    const m = await compatCall(client, chatOpts(withResults));
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(bodies[1].tools).toBeUndefined();
    expect(bodies[1].response_format).toMatchObject({ type: "json_schema" });
    expect(bodies[1].messages.at(-1)).toEqual({ role: "user", content: FINAL_JSON_NUDGE });
    expect(JSON.parse((m.content[0] as { text: string }).text)).toEqual(answer);
  });

  test("before any tool ran, a failed round is retried with the tools", async () => {
    const { client, fetch, bodies } = mockClient([jsonTool, toolUse]);
    const m = await compatCall(client, chatOpts([{ role: "user", content: "how much can I spend today?" }]));
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(bodies[1].tools).toHaveLength(CHAT_TOOLS.length);
    expect(m.stop_reason).toBe("tool_use");
  });
});

describe("plain-text calls (receipt reading)", () => {
  test("no response_format, no tools; the text comes back trimmed; truncation throws", async () => {
    const img = { type: "image", source: { type: "base64", media_type: "image/jpeg", data: "QQ==" } };
    const { client, bodies } = mockClient([text("  QA TEST STORE\nTOTAL 5.00 \n")]);
    const o = { model: "qwen/qwen3.8-27b", system: [{ type: "text" as const, text: "read" }], messages: [{ role: "user", content: [img, { type: "text", text: "Transcribe this receipt." }] } as AMessage] };
    expect(await compatText(client, o)).toBe("QA TEST STORE\nTOTAL 5.00");
    expect(bodies[0].response_format).toBeUndefined();
    expect(bodies[0].tools).toBeUndefined();
    expect(bodies[0].messages[1].content[0]).toEqual({ type: "image_url", image_url: { url: "data:image/jpeg;base64,QQ==" } });
    const cut = mockClient([{ body: { choices: [{ finish_reason: "length", message: { content: "QA" } }] } }]);
    await expect(compatText(cut.client, o)).rejects.toMatchObject({ code: "truncated" });
  });
});

describe("structured calls", () => {
  const opts = { model: "openai/gpt-oss-120b", system: [{ type: "text" as const, text: "s" }], messages: [{ role: "user" as const, content: "x" }], schema: INSIGHT_SCHEMA, effort: "low" as const };

  test("invalid JSON is retried once, then accepted", async () => {
    const { client, fetch } = mockClient([text('{"narrative": 1}'), text('{"narrative":"ok","cited_facts":[]}')]);
    const m = await compatCall(client, opts);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect((m.content[0] as { text: string }).text).toBe('{"narrative":"ok","cited_facts":[]}');
  });

  test("Groq's json_validate_failed is retried; two bad answers → AiError bad_output", async () => {
    const { client, fetch } = mockClient([
      { status: 400, body: { error: { message: "Generated JSON does not match the expected schema.", code: "json_validate_failed" } } },
      text("not json"),
    ]);
    await expect(compatCall(client, opts)).rejects.toMatchObject({ code: "bad_output" });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  test("vision: more than three images is refused before any request", async () => {
    const { client, fetch } = mockClient([]);
    const img = { type: "image", source: { type: "base64", media_type: "image/jpeg", data: "QQ==" } };
    await expect(compatCall(client, { ...opts, messages: [{ role: "user", content: [img, img, img, img] } as AMessage] })).rejects.toMatchObject({ code: "image_too_large" });
    expect(fetch).not.toHaveBeenCalled();
  });

  test("qwen gets hidden reasoning; gpt-oss gets effort", async () => {
    const { client, bodies } = mockClient([text('{"narrative":"ok","cited_facts":[]}')]);
    await compatCall(client, { ...opts, model: "qwen/qwen3.8-27b" });
    expect(bodies[0]).toMatchObject({ reasoning_format: "hidden" });
    expect(bodies[0].reasoning_effort).toBeUndefined();
  });
});

describe("error mapping", () => {
  test("transient errors are retried, then mapped to the client's codes", async () => {
    const { client, fetch } = mockClient([{ status: 429, body: {}, headers: { "retry-after": "1" } }, text('{"narrative":"ok","cited_facts":[]}')]);
    await compatCall(client, { model: "m", system: [], messages: [{ role: "user", content: "x" }], schema: INSIGHT_SCHEMA });
    expect(fetch).toHaveBeenCalledTimes(2);

    const busy = mockClient([429, 429, 429].map((status) => ({ status, body: { error: { message: "rate" } } })));
    const e = await compatCall(busy.client, { model: "m", system: [], messages: [{ role: "user", content: "x" }], schema: INSIGHT_SCHEMA }).catch((x) => x);
    expect(busy.fetch).toHaveBeenCalledTimes(3);
    expect(providerFailure(e)).toEqual({ status: 503, code: "ai_busy" });

    const long = mockClient([{ status: 429, body: {}, headers: { "retry-after": "60" } }]);
    await expect(compatCall(long.client, { model: "m", system: [], messages: [{ role: "user", content: "x" }], schema: INSIGHT_SCHEMA })).rejects.toBeInstanceOf(ProviderError);
    expect(long.fetch).toHaveBeenCalledTimes(1);

    const down = mockClient([new TypeError("fetch failed"), new TypeError("fetch failed"), new TypeError("fetch failed")]);
    const n = await compatCall(down.client, { model: "m", system: [], messages: [{ role: "user", content: "x" }], schema: INSIGHT_SCHEMA }).catch((x) => x);
    expect(providerFailure(n)).toEqual({ status: 503, code: "ai_unreachable" });
  });

  test("status → code table", () => {
    const code = (s: number) => providerFailure(new ProviderError(s, "x"))!.code;
    expect([0, 401, 403, 429, 498, 503, 500, 502, 400, 413].map(code)).toEqual([
      "ai_unreachable", "ai_unconfigured", "ai_unconfigured", "ai_busy", "ai_busy", "ai_busy", "ai_unreachable", "ai_unreachable", "ai_bad_request", "ai_bad_request",
    ]);
    expect(providerFailure(new AiError("refused"))).toEqual({ status: 502, code: "ai_refused" });
    expect(providerFailure(new AiError("image_too_large"))).toEqual({ status: 413, code: "image_too_large" });
    expect(providerFailure(new Error("x"))).toBeNull();
  });
});
