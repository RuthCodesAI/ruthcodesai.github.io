import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { claimNext, markSent, retryLater, markForReview } from "./outbox.mjs";

function database(t) {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  sqlite.exec("PRAGMA foreign_keys = ON");
  for (const name of ["0001_waitlist.sql", "0002_notification_outbox.sql"]) {
    sqlite.exec(readFileSync(new URL("./migrations/" + name, import.meta.url), "utf8"));
  }
  function prepare(sql, values = []) {
    return {
      bind: (...args) => prepare(sql, args),
      run: () => {
        const results = sqlite.prepare(sql).all(...values);
        const { changes } = sqlite.prepare("SELECT changes() AS changes").get();
        return { success: true, results, meta: { changes } };
      }
    };
  }
  const db = {
    prepare,
    batch(statements) {
      sqlite.exec("BEGIN");
      try {
        const results = statements.map(statement => statement.run());
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    }
  };
  const seed = email => sqlite.prepare(`INSERT INTO waitlist_signups (email, consent_version, consent_text)
    VALUES (?, 'v1', 'Local fixture')`).run(email);
  const row = () => sqlite.prepare("SELECT * FROM waitlist_notification_outbox").get();
  return { db, sqlite, seed, row };
}

test("overlapping claims give a single dispatcher ownership and record provider acceptance once", async t => {
  const { db, seed, row } = database(t);
  seed("one@example.test");
  const claims = await Promise.all([claimNext(db), claimNext(db)]);
  assert.equal(claims.filter(Boolean).length, 1);
  const event = claims.find(Boolean);
  assert.equal(event.signup_email, "one@example.test");
  assert.equal(event.attempts, 1);
  assert.match(event.lease_token, /^[0-9a-f-]{36}$/);
  assert.equal(event.lease_until, event.first_attempt_at + 120);
  assert.equal(await markSent(db, { ...event, lease_token: "stale" }, "bad"), false);
  assert.equal(await markSent(db, event, "provider-42"), true);
  assert.equal(await markForReview(db, event), false);
  assert.equal(await markSent(db, event, "provider-duplicate"), false);
  assert.equal(row().provider_message_id, "provider-42");
  assert.ok(row().sent_at >= event.first_attempt_at);
  assert.equal(row().lease_token, null);
  assert.equal(await claimNext(db), null);
});

test("a crashed dispatch is quarantined on expiry and later calls cannot resend it", async t => {
  const { db, sqlite, seed, row } = database(t);
  seed("crash@example.test");
  const event = await claimNext(db);
  sqlite.exec("UPDATE waitlist_notification_outbox SET lease_until = unixepoch()");
  assert.equal(await markSent(db, event, "late"), false);
  assert.equal(await retryLater(db, event, { confirmedNotDispatched: true }), false);
  assert.equal(await claimNext(db), null);
  assert.equal(row().state, "review");
  assert.equal(row().attempts, 1);
  assert.equal(row().lease_token, null);
  assert.equal(row().lease_until, null);
  assert.equal(await claimNext(db), null);
});

test("only a confirmed pre-dispatch failure can requeue, the new attempt gets a new token", async t => {
  const { db, sqlite, seed, row } = database(t);
  seed("retry@example.test");
  const first = await claimNext(db, { leaseSeconds: 240 });
  await assert.rejects(retryLater(db, first), /confirmation/);
  assert.equal(row().state, "leased");
  assert.equal(await retryLater(db, first, { confirmedNotDispatched: true, delaySeconds: 300 }), true);
  assert.equal(row().state, "pending");
  assert.equal(row().lease_token, null);
  assert.ok(row().next_attempt_at >= first.first_attempt_at + 300);
  assert.equal(await claimNext(db), null);
  sqlite.exec("UPDATE waitlist_notification_outbox SET next_attempt_at = unixepoch() - 1");
  const second = await claimNext(db);
  assert.equal(first.event_id, second.event_id);
  assert.notEqual(first.lease_token, second.lease_token);
  assert.equal(second.attempts, 2);
  assert.equal(second.first_attempt_at, first.first_attempt_at);
  assert.equal(await retryLater(db, first, { confirmedNotDispatched: true }), false);
  assert.equal(await markSent(db, first, "old"), false);
  assert.equal(await markForReview(db, first), false);
  assert.equal(await markForReview(db, second), true);
  assert.equal(row().state, "review");
  assert.equal(await claimNext(db), null);
});

test("an expired lease does not block another due signup", async t => {
  const { db, sqlite, seed } = database(t);
  seed("first@example.test");
  const expired = await claimNext(db);
  sqlite.exec("UPDATE waitlist_notification_outbox SET lease_until = unixepoch() - 1");
  seed("new@example.test");
  const next = await claimNext(db);
  assert.equal(next.signup_email, "new@example.test");
  assert.equal(sqlite.prepare("SELECT state FROM waitlist_notification_outbox WHERE event_id = ?")
    .get(expired.event_id).state, "review");
});
