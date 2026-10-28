import { afterEach, describe, expect, test, vi } from "vitest";
import { captureEntries, captureError, retryAt } from "../../src/lib/cloud/api";
import { backoff, nextDay, Outbox, overlay, parkedEntry, readLocally, type Command } from "../../src/lib/cloud/outbox";
import { reducer } from "../../src/lib/store";
import { EMPTY_STATE } from "../../src/lib/seed";
import type { Account } from "../../src/lib/types";

/** a Storage two Outbox instances can share, like two tabs on one origin */
class MemoryStorage implements Storage {
  private m = new Map<string, string>();
  get length() {
    return this.m.size;
  }
  clear() {
    this.m.clear();
  }
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  key(i: number) {
    return [...this.m.keys()][i] ?? null;
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
}

const NOW = new Date(2026, 9, 29, 15, 0).getTime();

function cmd(id: string, over: Partial<Command> = {}): Command {
  return {
    id,
    at: NOW,
    action: { type: "report-balance", id, accountId: "a1", reported: 100 },
    calls: [{ kind: "rpc", fn: "report_balance", args: { p_id: id } }],
    done: 0,
    tries: 0,
    ...over,
  };
}
const capture = (id: string, text = "grab 248 gcash", over: Partial<Command> = {}): Command =>
  cmd(id, { action: { type: "queue-capture", id, text }, calls: [{ kind: "capture", body: { client_id: id, kind: "text", text } }], ...over });

const GCASH: Account = { id: "a1", name: "GCash", provider: "gcash", providerLabel: "GCash", type: "ewallet", kind: "", balance: 0 } as Account;

afterEach(() => vi.unstubAllGlobals());

describe("capture retry classification", () => {
  const kind = (status: number, error?: string) => {
    const e = captureError(status, error ? { error } : null, NOW);
    return e.permanent ? "permanent" : e.fallback ? "fallback" : e.retryAt != null ? "tomorrow" : "retry";
  };

  test("only a bad request or a reused client id is permanent", () => {
    expect(kind(400, "bad_request")).toBe("permanent");
    expect(kind(409, "client_id_in_use")).toBe("permanent");
    expect(kind(404, "clip_not_found")).toBe("permanent");
  });

  test("busy, unreachable, 5xx, in_progress and auth are retried", () => {
    expect(kind(503, "ai_busy")).toBe("retry");
    expect(kind(503, "ai_unreachable")).toBe("retry");
    expect(kind(502, "ai_unreachable")).toBe("retry");
    expect(kind(500)).toBe("retry");
    expect(kind(409, "in_progress")).toBe("retry");
    expect(kind(401, "unauthorized")).toBe("retry");
  });

  test("no AI on the server (or no function) falls back to the phone's parser", () => {
    expect(kind(503, "ai_unconfigured")).toBe("fallback");
    expect(kind(503, "stt_unconfigured")).toBe("fallback");
    expect(kind(404)).toBe("fallback");
  });

  test("the daily limit waits for the next day; others back off", () => {
    const e = captureError(429, { error: "daily_limit", limit: 100 }, NOW);
    expect(kind(429, "daily_limit")).toBe("tomorrow");
    expect(retryAt(e, 1, NOW)).toBe(nextDay(NOW));
    expect(new Date(nextDay(NOW)).getDate()).toBe(30);
    expect(retryAt(captureError(503, { error: "ai_busy" }), 3, NOW)).toBe(NOW + backoff(3));
    expect(backoff(20)).toBe(60_000);
  });

  test("capture entries keep their review status and question", () => {
    const entries = captureEntries({
      gate: { passed: false, question: "Which purchase was this refund for?" },
      entries: [
        { id: "e1", amount: 500, desc: "Refund", accountId: null, category: null, date: "2026-10-29T00:00:00Z", status: "review" },
        { id: "e2", amount: -80, desc: "Coffee", accountId: "a1", category: "Food & drink", date: "2026-10-29T00:00:00Z", status: "review", reviewQuestion: "Is ₱80 right?" },
        { id: "e3", amount: -50, desc: "Jeep", accountId: "a1", category: "Transport", date: "2026-10-29T00:00:00Z" },
      ],
    });
    expect(entries.map((e) => [e.status, e.reviewQuestion])).toEqual([
      ["review", "Which purchase was this refund for?"],
      ["review", "Is ₱80 right?"],
      ["posted", undefined],
    ]);
  });
});

describe("outbox order", () => {
  test("first in, first out", () => {
    const o = new Outbox("u", new MemoryStorage());
    o.push(cmd("1"));
    o.push(cmd("2"));
    expect(o.next(NOW)?.id).toBe("1");
    o.remove("1");
    expect(o.next(NOW)?.id).toBe("2");
  });

  test("a waiting command holds the queue; a waiting capture doesn't", () => {
    const o = new Outbox("u", new MemoryStorage());
    o.push(capture("c", "x", { wait: { until: NOW + 5000, why: "daily_limit" } }));
    o.push(cmd("1"));
    o.push(cmd("2"));
    expect(o.next(NOW)?.id).toBe("1");
    o.update("1", { wait: { until: NOW + 2000, why: "backoff" } });
    expect(o.next(NOW)).toBeUndefined();
    expect(o.nextWake()).toBe(NOW + 2000);
    expect(o.next(NOW + 2000)?.id).toBe("1");
  });

  test("waking ends backoffs but not the daily limit", () => {
    const o = new Outbox("u", new MemoryStorage());
    o.push(capture("c", "x", { wait: { until: NOW + 5000, why: "daily_limit" } }));
    o.push(cmd("1", { wait: { until: NOW + 2000, why: "backoff" } }));
    o.wake();
    expect(o.get("1")?.wait).toBeUndefined();
    expect(o.get("c")?.wait?.why).toBe("daily_limit");
  });

  test("parked captures are skipped and don't count as unsent balance changes", () => {
    const o = new Outbox("u", new MemoryStorage());
    const c = capture("c", "something");
    o.push({ ...c, parked: { reason: "refused", entry: parkedEntry(c, "How much was it?") } });
    o.push(cmd("1"));
    expect(o.next(NOW)?.id).toBe("1");
    expect(o.unsent).toBe(1);
    expect(o.size).toBe(2);
  });
});

describe("outbox across tabs", () => {
  test("two instances on one storage merge by command id", () => {
    const store = new MemoryStorage();
    const a = new Outbox("u", store);
    const b = new Outbox("u", store);
    a.push(cmd("1"));
    b.push(cmd("2")); // b never saw "1" in memory; it must not overwrite it
    expect(a.all.map((c) => c.id)).toEqual(["1", "2"]);
    a.push(cmd("2")); // the same command twice is one command
    expect(b.size).toBe(2);
  });

  test("a command another tab finished is not resurrected", () => {
    const store = new MemoryStorage();
    const a = new Outbox("u", store);
    const b = new Outbox("u", store);
    a.push(cmd("1"));
    a.push(cmd("2"));
    expect(b.next(NOW)?.id).toBe("1");
    a.remove("1"); // tab a sent it
    b.update("1", { done: 1 }); // tab b's late progress on it
    expect(b.all.map((c) => c.id)).toEqual(["2"]);
    expect(b.next(NOW)?.id).toBe("2");
  });

  test("storage failing keeps the queue in memory", () => {
    const store = new MemoryStorage();
    store.setItem = () => {
      throw new Error("quota");
    };
    const o = new Outbox("u", store);
    o.push(cmd("1"));
    o.push(cmd("2"));
    expect(o.all.map((c) => c.id)).toEqual(["1", "2"]);
  });

  test("draining runs under the ledger-outbox Web Lock, one at a time", async () => {
    const held: string[] = [];
    let tail = Promise.resolve<unknown>(undefined);
    const request = vi.fn((name: string, f: () => Promise<unknown>) => {
      held.push(name);
      const run = tail.then(f);
      tail = run.catch(() => undefined);
      return run;
    });
    vi.stubGlobal("navigator", { locks: { request } });
    const o = new Outbox("u", new MemoryStorage());
    const order: string[] = [];
    const job = (n: string) => () =>
      new Promise<string>((r) =>
        setTimeout(() => {
          order.push(n);
          r(n);
        }, n === "a" ? 20 : 0),
      );
    expect(await Promise.all([o.exclusive(job("a")), o.exclusive(job("b"))])).toEqual(["a", "b"]);
    expect(order).toEqual(["a", "b"]);
    expect(held).toEqual(["ledger-outbox", "ledger-outbox"]);
  });

  test("without Web Locks it still runs", async () => {
    vi.stubGlobal("navigator", {});
    const o = new Outbox("u", new MemoryStorage());
    expect(await o.exclusive(async () => 7)).toBe(7);
  });
});

describe("a capture the server won't file is never dropped", () => {
  test("the phone reads it when it can", () => {
    const entries = readLocally(capture("c", "grab 248 gcash"), [GCASH]);
    expect(entries).toHaveLength(1);
    expect(entries![0]).toMatchObject({ amount: -248, accountId: "a1", raw: "grab 248 gcash", date: new Date(NOW).toISOString() });
  });

  test("refused captures go to Review with the question", () => {
    const entries = readLocally(capture("c", "grab 248 gcash"), [GCASH], "Check it");
    expect(entries![0]).toMatchObject({ status: "review", reviewQuestion: "Check it" });
  });

  test("no amount: parked in Review as words", () => {
    const c = capture("c", "lunch with Ana");
    expect(readLocally(c, [GCASH])).toBeNull();
    const parked = { ...c, parked: { reason: "refused", entry: parkedEntry(c, "How much was it?") } };
    const s = overlay({ ...EMPTY_STATE }, [parked], reducer);
    expect(s.entries).toHaveLength(1);
    expect(s.entries[0]).toMatchObject({ id: "c", raw: "lunch with Ana", status: "review", reviewQuestion: "How much was it?" });
    // a capture still on its way shows nothing
    expect(overlay({ ...EMPTY_STATE }, [c], reducer).entries).toHaveLength(0);
  });
});
