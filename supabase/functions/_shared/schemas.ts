// JSON schemas for Claude structured outputs (output_config.format). Pure module.
// Structured outputs require every object to list all properties in `required` and set
// additionalProperties: false; optional values are expressed as anyOf [..., null].
import { CATEGORIES } from "./kb.ts";

const str = { type: "string" } as const;
const nullable = (s: Record<string, unknown>) => ({ anyOf: [s, { type: "null" }] });
const obj = (properties: Record<string, unknown>) => ({
  type: "object",
  additionalProperties: false,
  required: Object.keys(properties),
  properties,
});
const category = { type: "string", enum: [...CATEGORIES] };

export const AMBIGUOUS_FIELDS = ["amount", "account", "to_account", "category", "merchant", "occurred_at", "kind"] as const;

export const PARSE_SCHEMA = obj({
  entries: {
    type: "array",
    items: obj({
      amount_span: str,
      amount: { type: "number" },
      sign: { type: "string", enum: ["in", "out"] },
      kind: { type: "string", enum: ["income", "expense", "transfer", "invest", "refund"] },
      account_hint: nullable(str),
      to_account_hint: nullable(str),
      category: nullable(category),
      merchant: nullable(str),
      description: str,
      occurred_at: nullable(str),
      ambiguous_fields: { type: "array", items: { type: "string", enum: [...AMBIGUOUS_FIELDS] } },
    }),
  },
  receipt: nullable(
    obj({
      text: str,
      merchant: nullable(str),
      items: {
        type: "array",
        items: obj({ name: str, amount: { type: "number" }, category: nullable(category), unsure: { type: "boolean" } }),
      },
    }),
  ),
});

export const CHAT_ANSWER_SCHEMA = obj({
  text: str,
  marks: { type: "array", items: str },
  matched_label: str,
  matched_fact: nullable(str),
  bars: nullable(
    obj({
      title: str,
      kind: { type: "string", enum: ["months", "share"] },
      items: { type: "array", items: obj({ label: str, fact: str }) },
    }),
  ),
  compare: nullable(obj({ title: str, now_fact: str, after_fact: str, unit: str })),
  ask: nullable(str),
  offer: nullable(obj({ label: str, name: str, target_fact: str, by: str })),
  source_facts: { type: "array", items: str },
  followups: { type: "array", items: str },
});

export const INSIGHT_SCHEMA = obj({
  narrative: str,
  cited_facts: { type: "array", items: str },
});
