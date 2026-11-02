import { beforeAll, describe, expect, test } from "vitest";
import { createDb, num, U1, U2, type Db } from "./harness";

let db: Db;
let t1: string;
let t2: string;

beforeAll(async () => {
  db = await createDb();
  await db.as(U1);
  t1 = (await db.rows("insert into public.chat_threads (title) values ('How much on food?') returning id"))[0].id;
  await db.query("insert into public.chat_messages (thread_id, role, text) values ($1, 'user', 'How much on food?')", [t1]);
  await db.query("insert into public.chat_messages (thread_id, role, text, answer) values ($1, 'assistant', 'You spent a lot.', $2::jsonb)", [t1, JSON.stringify({ text: "You spent a lot." })]);
  await db.as(U2);
  t2 = (await db.rows("insert into public.chat_threads (title) values ('Mine') returning id"))[0].id;
  await db.query("insert into public.chat_messages (thread_id, role, text) values ($1, 'user', 'Mine')", [t2]);
});

describe("chat_threads / chat_messages", () => {
  test("an Owner sees only their own threads and messages", async () => {
    await db.as(U1);
    expect((await db.rows("select id from public.chat_threads")).map((r) => r.id)).toEqual([t1]);
    expect(num(await db.one("select count(*) from public.chat_messages"))).toBe(2);
    await db.as(U2);
    expect((await db.rows("select id from public.chat_threads")).map((r) => r.id)).toEqual([t2]);
    expect(num(await db.one("select count(*) from public.chat_messages"))).toBe(1);
  });

  test("user_id defaults to the caller; another Owner's thread cannot be written to or changed", async () => {
    await db.as(U1);
    expect((await db.rows("select user_id from public.chat_threads"))[0].user_id).toBe(U1);
    await expect(db.query("insert into public.chat_messages (thread_id, role, text) values ($1, 'user', 'sneaky')", [t2])).rejects.toThrow(/row-level security/);
    await expect(db.query("insert into public.chat_threads (user_id, title) values ($1, 'x')", [U2])).rejects.toThrow(/row-level security/);
    await db.query("update public.chat_threads set title = 'hijack' where id = $1", [t2]);
    await db.query("delete from public.chat_threads where id = $1", [t2]);
    await db.asAdmin();
    expect(await db.one("select title from public.chat_threads where id = $1", [t2])).toBe("Mine");
  });

  test("role is user or assistant", async () => {
    await db.as(U1);
    await expect(db.query("insert into public.chat_messages (thread_id, role, text) values ($1, 'system', 'x')", [t1])).rejects.toThrow(/check/);
  });

  test("updating a thread bumps updated_at", async () => {
    await db.asAdmin();
    await db.query("update public.chat_threads set updated_at = '2020-01-01' where id = $1", [t1]);
    await db.as(U1);
    await db.query("update public.chat_threads set title = 'Food spending' where id = $1", [t1]);
    expect(await db.one("select updated_at > now() - interval '1 minute' from public.chat_threads where id = $1", [t1])).toBe(true);
  });

  test("deleting a thread deletes its messages", async () => {
    await db.as(U1);
    await db.query("delete from public.chat_threads where id = $1", [t1]);
    await db.asAdmin();
    expect(num(await db.one("select count(*) from public.chat_messages where thread_id = $1", [t1]))).toBe(0);
    expect(num(await db.one("select count(*) from public.chat_messages where thread_id = $1", [t2]))).toBe(1);
  });

  test("erase_my_data removes the caller's chat and leaves everyone else's", async () => {
    await db.as(U1);
    const t = (await db.rows("insert into public.chat_threads (title) values ('again') returning id"))[0].id;
    await db.query("insert into public.chat_messages (thread_id, role, text) values ($1, 'user', 'again')", [t]);
    const res = await db.one("select public.erase_my_data()");
    expect(res.deleted.chat_threads).toBe(1);
    expect(res.deleted.chat_messages).toBe(1);
    await db.asAdmin();
    expect(num(await db.one("select count(*) from public.chat_threads where user_id = $1", [U1]))).toBe(0);
    expect(num(await db.one("select count(*) from public.chat_messages where user_id = $1", [U1]))).toBe(0);
    expect(num(await db.one("select count(*) from public.chat_threads where user_id = $1", [U2]))).toBe(1);
  });
});
