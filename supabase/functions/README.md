# Ledger edge functions

Deno edge functions behind M8 in cloud mode (spec `docs/superpowers/specs/2026-10-29-cfo-agent-design.md`,
decisions D-0013 and D-0016). The database contract they code against is `../CONTRACT.md`.

| function | caller | what it does |
|---|---|---|
| `capture` | the app (Owner's JWT) | text / voice / receipt photo → entries, through the confidence gate |
| `chat` | the app (Owner's JWT) | a question → the client's `Answer`, numbers rendered from facts |
| `insights-run` | `pg_cron` (service role) | daily / weekly / monthly / alerts insights for every owner |
| `notify` | `insights-run` (service role) | Web Push within the D-0016 limits |

User-facing functions create the Supabase client with the caller's `Authorization` header, so RLS
applies and the write RPCs act for that Owner only. Only `insights-run` and `notify` use the service role.

## Layout

- `_shared/*.ts` without Deno globals or `npm:`/`jsr:` imports are **pure** and unit-tested by
  vitest (`tests/functions/`): `gate.ts` (confidence gate), `facts.ts` (fact registry, placeholder
  rendering, digit validator), `answer.ts` (`Answer` assembly + fallback template), `kb.ts`
  (byte-stable knowledge-base block), `capture_core.ts` (parse → `post_entries` payloads, rules,
  exact alias resolution, client `Entry` mapping), `chat_tools.ts` (the nine read-only chat tools),
  `notify_policy.ts`, `triggers.ts`, `narrate.ts`, `schemas.ts`, `prompts.ts`, `time.ts`,
  `ai_config.ts` (provider, models and STT from env), `openai_compat.ts` (the Groq / OpenAI-compatible
  adapter: message and tool translation, strict schemas, validation, retries, error mapping).
- Deno-only: `clients.ts` (Supabase), `claude.ts` (the model facade: `aiClient`, `call`, `structured`,
  `parseJson`, `aiFailure`; Anthropic SDK or the adapter), `stt.ts` (OpenAI-compatible transcription),
  `push.ts` (`npm:web-push`), `http.ts`.
- `_shared/vendor/` is a **generated** copy of `src/lib/{types,providers,parse,receipt}.ts` (Deno needs
  `.ts` import extensions). After changing those files run
  `node supabase/functions/_shared/vendor/sync.mjs`; `tests/functions/vendor.test.ts` fails until you do.
- `deno.json` only sets `nodeModulesDir: "none"` so Deno ignores the app's `node_modules`.
- Migration `20261029001100_function_support.sql` adds `chat_usage` + `chat_quota_take` and
  `capture_checks` (tested in `tests/functions/db_support.test.ts`); `20261029001300_usage_quotas.sql`
  adds `capture_usage` + `capture_quota_take` (tested in `tests/db/hardening.test.ts`).

## Secrets

The model provider is either Anthropic (Claude) or any OpenAI-compatible API, Groq by default. One
Groq key covers parsing, receipt vision, chat, insights and voice transcription.

### Groq (free tier)

1. Create a key at [console.groq.com](https://console.groq.com) → API Keys.
2. In Settings → Data Controls, turn on **Zero Data Retention** (receipts and money questions are
   personal data).
3. Set the secrets:

```sh
supabase secrets set AI_PROVIDER=openai_compat AI_API_KEY=gsk_...
```

### Anthropic

```sh
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...        # capture, chat, insights-run
supabase secrets set OPENAI_API_KEY=sk-...               # voice transcription (capture kind "voice")
```

### Other secrets

```sh
supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:you@example.com
supabase secrets set CHAT_DAILY_LIMIT=100                # optional; default 100 questions per local day
supabase secrets set CAPTURE_DAILY_LIMIT=200             # optional; default 200 captures per local day
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are provided by Supabase.
The Vault secret `service_role_key` used by the cron (see `../README.md` §5) must be the same
service role key: `insights-run` and `notify` compare the bearer with `SUPABASE_SERVICE_ROLE_KEY`.

`capture` and `chat` check the caller's JWT first (`401 unauthorized`), then configuration.
Without a configured provider (see the table below), they answer `503 {"error":"ai_unconfigured"}` (the app
falls back to its local regex parser and canned chat) and `insights-run` writes template notes.
Without VAPID keys `notify` answers `503 {"error":"push_unconfigured"}` and pending pushes wait.

## Deploy

```sh
supabase functions deploy capture
supabase functions deploy chat
supabase functions deploy insights-run
supabase functions deploy notify
```

Keep JWT verification on (the default) for all four. Type-check locally:
`npx -y deno check --config supabase/functions/deno.json supabase/functions/*/index.ts`.

### Provider environment

| variable | default | meaning |
|---|---|---|
| `AI_PROVIDER` | `anthropic` if `ANTHROPIC_API_KEY` is set, else `openai_compat` if `AI_API_KEY` is set, else unconfigured | `anthropic` or `openai_compat`; any other value is unconfigured |
| `ANTHROPIC_API_KEY` | — | Claude key (provider `anthropic`) |
| `AI_BASE_URL` | `https://api.groq.com/openai/v1` | OpenAI-compatible base URL |
| `AI_API_KEY` | — | key for `AI_BASE_URL` |
| `AI_MODEL_PARSE` | `openai/gpt-oss-20b` | text and voice parsing |
| `AI_MODEL_VISION` | `qwen/qwen3.8-27b` | receipt photos |
| `AI_MODEL_CHAT` | `openai/gpt-oss-120b` | chat |
| `AI_MODEL_SUMMARY` | `openai/gpt-oss-120b` | daily one-liner, alert notes, weekly and monthly reviews |
| `AI_MAX_TOKENS` | `4096` | completion cap per call (keeps requests inside Groq's per-minute token budget) |
| `STT_BASE_URL` | Groq when the provider is `openai_compat`, else `https://api.openai.com/v1` | transcription base URL |
| `STT_API_KEY` | `AI_API_KEY` on Groq, `OPENAI_API_KEY` on OpenAI (an explicit `STT_BASE_URL` tries `AI_API_KEY`, then `OPENAI_API_KEY`) | transcription key |
| `STT_MODEL` | `whisper-large-v3` (Groq), `gpt-4o-mini-transcribe` (OpenAI) | transcription model; no `language` is sent (Taglish) |

Without an STT key, voice captures answer `503 stt_unconfigured`.

## Models

### openai_compat (Groq)

Job → role: text/voice parsing → `AI_MODEL_PARSE`; receipt photos → `AI_MODEL_VISION`; chat →
`AI_MODEL_CHAT`; daily, alert and review narratives → `AI_MODEL_SUMMARY` (the Haiku/Sonnet split
becomes a 20b/120b split, with all narratives on the larger model). The adapter keeps the same
`call`/`structured`/`parseJson` interface, so the functions do not know which provider answered:

- System blocks become one system message; cache hints are dropped (no prompt caching).
- Every final answer uses `response_format: json_schema` with `strict: true`. Schemas are made
  strict-compatible (all properties required, optional ones nullable, `additionalProperties:false`),
  the output is validated against the schema in code and re-asked once if invalid, then nulls for
  originally-optional fields are removed.
- Groq does not combine structured outputs with tools, so chat runs its tool loop without
  `response_format`; when the model stops calling tools, a final strict-JSON call with no tools
  (tool history as text) produces the answer, unless the tool-round answer already validates.
- Receipt images go as `image_url` data URLs; at most 3 images and 20MB per request.
- 429 / 498 / 503 → `ai_busy`; network errors, timeouts and other 5xx → `ai_unreachable`; 401/403 →
  `ai_unconfigured`. Short `retry-after` waits (≤ 8 s) and transient errors are retried twice first.
- gpt-oss calls send `reasoning_effort` (the function's effort) with reasoning hidden; Qwen calls
  send `reasoning_format: hidden`.

Trade-offs against Claude: free, but per-model limits are small (on the order of 30 requests and
8K tokens per minute, 1K requests per day; check console.groq.com/settings/limits for your
account), so a burst of captures or a long chat can hit `ai_busy`. No prompt caching, so every
call resends the system prompt and knowledge base. Chat's final answer costs one extra call. Strict
JSON is enforced by Groq and by our validator, but open models follow the number rule (`{{fN}}`
placeholders) less reliably, so more answers fall back to the template, and receipt reading on
Qwen is weaker than Sonnet. Groq's Whisper bills a 10-second minimum per clip.

### anthropic

`claude-haiku-5-5`: text/voice parsing, the daily one-liner, alert notes. `claude-sonnet-5-5`:
receipt vision, chat, weekly and monthly reviews. Every call uses a JSON-schema structured output
(`output_config.format`); Sonnet calls also opt into server-side refusal fallback
(`fallbacks: "default"`, beta `server-side-fallback-2026-07-01`). The system prompt (and, for
capture, the knowledge-base block) is the cached prefix; the date, timezone and captured text come
after it.

## POST /capture

```jsonc
// request
{ "client_id": "uuid",            // becomes raw_inputs.id; re-sending is safe (idempotent)
  "kind": "text" | "voice" | "photo",
  "text": "grab gcash 248",       // kind text
  "storage_path": "<uid>/x.webm", // kind voice (bucket voice) or photo (bucket receipts, ≤ 5 MB)
  "tz": "Asia/Manila",
  "captured_at": "2026-10-29T08:12:00+08:00" } // optional ISO; when the Owner captured it (offline queue)
// 200
{ "raw_input_id": "uuid",
  "outcome": "saved" | "review",
  "entries": [Entry],             // src/lib/types.ts shape; ids are DB uuids, plus
                                  // "status": "posted" | "review" and "reviewQuestion": string (when in Review)
  "gate": { "passed": true } | { "passed": false, "failed_check": "account_alias", "question": "Which account did you pay from?" },
  "undo_event_id": "uuid" }       // when something was written; pass to undo_event
```

Flow: `raw_inputs` row → (voice) download + transcribe → Claude parse with the knowledge base
(accounts, aliases, learned rules, recurring items; sorted, byte-stable) → learned rules enforced in
code → gate → one atomic `post_entries` (failing entries get `status: "review"` and the one question;
transfers and invest are two legs of a move) → `raw_inputs.parsed/gate/model` updated.
Entry and move ids are uuid v5 of `client_id` + entry index + leg, and the parse is saved in
`raw_inputs.parsed` before posting, so a retry after a failure re-posts the same ids (no Claude
call, no second quota use) and `post_entries` returns the rows it already wrote. All of a capture's
entries go in **one** `post_entries` call, so the single `undo_event_id` undoes everything it wrote.

A refund is never applied automatically: nothing is written for it, the outcome is `review` and the
question is "Which purchase was this refund for?" (the Owner marks the purchase refunded).

`captured_at` (optional) is the capture's "now": dates like "yesterday", the default date, the
future-date check and the duplicate window use it. More than 5 minutes in the future or older than
30 days → the server clock is used and every entry goes to Review on `date_valid`
("When did this happen?"). Not an ISO date-time → `400`.

Each new capture counts against `CAPTURE_DAILY_LIMIT` per Owner-local day (`capture_quota_take`);
replays of a finished `client_id` don't.

Gate checks, in order (`_shared/gate.ts`): `amount_literal` (photos: the amount must also equal the
total the app's regex receipt parser reads from the receipt text, else Review), `account_alias` (exact alias, account
name or last four; both accounts for a move), `category_agreed` (learned rule, or Claude = the app's
regex parser), `date_valid` (parses, not in the future), `not_duplicate` and `amount_typical`
(≤ 3× category median; both from `capture_checks`), `unambiguous`.

Errors: `400 bad_request`, `401 unauthorized`, `404 clip_not_found|image_not_found`,
`409 in_progress|client_id_in_use`, `413 image_too_large`, `429 {"error":"daily_limit","limit":200}`, `503 ai_unconfigured|stt_unconfigured|ai_busy|ai_unreachable`,
`502 ai_*`, `500 internal` (with `sqlstate` when the database refused).

## POST /chat

```jsonc
// request
{ "messages": [{ "role": "user", "text": "How much did I spend on coffee?" }], "tz": "Asia/Manila" }
// 200: exactly the `Answer` type of src/screens/chat.tsx
{ "read": 412, "matched": { "n": 23, "label": "coffee purchases" }, "compareYear": 2025,
  "text": "You’ve spent ₱6,240 on coffee this year…", "marks": ["₱6,240 on coffee"],
  "bars": { "title": "COFFEE BY MONTH", "kind": "months", "items": [{ "label": "January", "value": 540, "display": "₱540" }] },
  "sources": ["entry uuid", "…"], "followups": ["What should I cut first?"] }
```

Tools (read-only): `period_summary`, `compare_periods`, `spending_by_category`, `find_entries`,
`monthly_spend`, `goal_progress`, `today_budget`, `accounts_and_net_worth` (balances, net worth,
reconciliation), `what_if_purchase`. Every number a tool returns becomes a fact (`f1`, `f2`…); Claude
writes `{{fN}}`; the server renders (₱, whole pesos, en-PH) and fills `bars`, `compare`, `offer` and
`sources` from facts only. A digit in any prose field that isn't a fact (dates and merchant names
from tool results and "M8" excepted) → re-ask once → deterministic template.
`read` = distinct entries behind the numbers the tools returned.

Errors: `400`, `401`, `429 {"error":"daily_limit","limit":100}`, `503 ai_*`, `502 ai_*`.

## POST /insights-run

Exactly what `private.invoke_insights` sends: `POST`, `Content-Type: application/json`,
`Authorization: Bearer <service_role_key>`, body `{"kind": "daily"|"weekly"|"monthly"|"alerts"}`.
Runs for every row in `profiles`; returns `{kind, owners, outcomes: [{user_id, kind, fingerprint, result, reason?, insight_id?}], pushes}`.

| kind | trigger before any Claude call | fingerprint | model |
|---|---|---|---|
| daily | a budget is set or something was logged today | `daily:YYYY-MM-DD` | haiku |
| weekly | nothing logged or nothing notable → "Nothing to flag" template | `weekly:<monday>` | sonnet |
| monthly | closes last month; nothing logged → template | `monthly:YYYY-MM` | sonnet |
| alerts | each new `detect_anomalies` item; `warn` = material (pushed) | the anomaly's | haiku |

One insight per fingerprint (a dismissed one never returns); alerts cool down a week per subject and
a subject dismissed twice in 90 days is suppressed. Claude sees the last ten headlines and is told
not to repeat them. Then `notify` is called for weekly, monthly and alert insights, and the hourly
alerts run also flushes pushes deferred by quiet hours.

## POST /notify (service role)

`{"insight_id": "uuid"}` or `{"flush": true}` → `{results: [{insight_id, result: sent|skipped|failed|deferred|already, reason?, until?}]}`.
Pushes only the weekly review and material alerts, at most 3 `sent` in any 7 days
(`profiles.push_max_per_week`, capped at 3), only when `push_enabled`, never with a number in the
text (title "M8"), and defers inside quiet hours (default 22:00–07:00 in the Owner's timezone)
instead of dropping. Every final outcome is one `notification_log` row; 404/410 subscriptions are
deleted.
