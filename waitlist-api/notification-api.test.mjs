import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { handleNotificationRequest } from "./notification-api.mjs";

const origin = "https://notifier.example.invalid";
const prefix = "/internal/notifications/";

function client() {
  const key = randomBytes(32).toString("base64url");
  const env = { NOTIFICATION_KEY_SHA256: createHash("sha256").update(key).digest("hex") };
  async function call(action, { method = "POST", json, raw, headers = {}, url = origin + prefix + action } = {}) {
    const request = new Request(url, {
      method,
      headers: { Authorization: "Bearer " + key, ...(json === undefined ? {} : { "Content-Type": "application/json" }), ...headers },
      body: raw ?? JSON.stringify(json)
    });
    const res = await handleNotificationRequest(request, env);
    assert.equal(res.headers.get("Cache-Control"), "no-store");
    assert.equal(res.headers.has("Access-Control-Allow-Origin"), false);
    return { status: res.status, body: await res.json(), headers: res.headers };
  }
  return { call, env };
}

function database(t) {
  const { call, env } = client();
  const sql = new DatabaseSync(":memory:");
  t.after(() => sql.close());
  for (const file of ["0001_waitlist.sql", "0002_notification_outbox.sql", "0003_notifier_status.sql"]) {
    sql.exec(readFileSync(new URL("./migrations/" + file, import.meta.url), "utf8"));
  }
  function prepare(text, values = []) {
    return {
      bind: (...args) => prepare(text, args),
      run() {
        const results = sql.prepare(text).all(...values);
        return { success: true, results, meta: sql.prepare("SELECT changes() AS changes").get() };
      }
    };
  }
  env.DB = {
    prepare,
    batch(statements) {
      sql.exec("BEGIN");
      try {
        const result = statements.map(s => s.run());
        sql.exec("COMMIT");
        return result;
      } catch (error) {
        sql.exec("ROLLBACK");
        throw error;
      }
    }
  };
  const seed = address => sql.prepare("INSERT INTO waitlist_signups(email,consent_version,consent_text) VALUES (?,'v','fixture')").run(address);
  return { call, sql, seed };
}

test("only a valid TLS bearer can reach health or a notification operation", async () => {
  const { call, env } = client();
  let reads = 0;
  Object.defineProperty(env, "DB", { get() { reads++; throw Error("private diagnostic"); } });
  for (const value of ["", "Basic bad", "Bearer short", "Bearer " + "!".repeat(43), "Bearer " + randomBytes(32).toString("base64url")]) {
    for (const action of ["health", "claim", "sent", "retry", "review"]) {
      const response = await call(action, { method: action === "health" ? "GET" : "POST", headers: { Authorization: value } });
      assert.equal(response.status, 401);
      assert.deepEqual(response.body, { ok: false, error: "unauthorized" });
    }
  }
  assert.equal((await call("health", { method: "GET", url: "http://notifier.example.invalid" + prefix + "health" })).status, 403);
  for (const headers of [{ Origin: "https://ruth.codes" }, { Origin: "null" }, { "Sec-Fetch-Site": "cross-site" },
                         { "Sec-Fetch-Site": "same-site" }]) {
    assert.equal((await call("claim", { json: {}, headers })).status, 403);
  }
  assert.equal((await call("claim", { method: "OPTIONS", headers: { Origin: "https://ruth.codes" } })).status, 403);
  for (const digest of [undefined, "", "xyz"]) {
    env.NOTIFICATION_KEY_SHA256 = digest;
    assert.equal((await call("health", { method: "GET" })).status, 401);
  }
  assert.equal(reads, 0);
});

test("health only checks the migrated schema, and verbs and paths are explicit", async t => {
  const { call, sql, seed } = database(t);
  seed("health@example.invalid");
  const health = await call("health", { method: "GET" });
  assert.deepEqual([health.status, health.body], [200, { ok: true }]);
  assert.equal(sql.prepare("SELECT state FROM waitlist_notification_outbox").get().state, "pending");
  assert.equal(sql.prepare("SELECT count(*) AS n FROM waitlist_notifier_status").get().n, 0);
  for (const path of ["", "health/", "subscribers", "claim/extra"]) {
    assert.equal((await call(path, { method: "GET" })).status, 404);
  }
  for (const [action, method, allowed] of [["health", "POST", "GET"], ["claim", "GET", "POST"], ["sent", "PUT", "POST"]]) {
    const denied = await call(action, { method });
    assert.equal(denied.status, 405);
    assert.equal(denied.headers.get("Allow"), allowed);
  }
});

test("invalid or oversized input never claims an event or records a poll", async t => {
  const { call, sql, seed } = database(t);
  seed("must-stay-pending@example.invalid");
  for (const json of [false, null, [], "address", { email: "private@example.invalid" }]) {
    const response = await call("claim", { json });
    assert.deepEqual([response.status, response.body], [400, { ok: false, error: "invalid_request" }]);
  }
  assert.equal((await call("claim", { raw: "{}", headers: { "Content-Type": "text/plain" } })).status, 415);
  const jsonHeader = { "Content-Type": "application/json" };
  assert.equal((await call("claim", { raw: "{", headers: jsonHeader })).status, 400);
  assert.equal((await call("claim", { raw: " ".repeat(2050), headers: jsonHeader })).status, 413);
  const pair = { event_id: "a".repeat(32), lease_token: randomUUID() };
  for (const action of ["sent", "retry", "review"]) {
    for (const json of [{}, { event_id: pair.event_id }, { ...pair, email: "private@example.invalid" },
                         { ...pair, lease_token: null }, { ...pair, event_id: [pair.event_id] }]) {
      assert.deepEqual((await call(action, { json })).body, { ok: false, error: "invalid_request" });
    }
  }
  assert.equal(sql.prepare("SELECT state FROM waitlist_notification_outbox").get().state, "pending");
  assert.equal(sql.prepare("SELECT count(*) AS n FROM waitlist_notifier_status").get().n, 0);
});

test("authenticated polling throttles the heartbeat and returns only the three required fields", async t => {
  const { call, sql, seed } = database(t);
  assert.deepEqual((await call("claim", { json: {} })).body, { event: null });
  sql.exec(`CREATE TABLE poll_updates(x INTEGER);
            CREATE TRIGGER count_poll_updates AFTER UPDATE ON waitlist_notifier_status
            BEGIN INSERT INTO poll_updates(x) VALUES (1); END;`);
  seed("reader@example.invalid");
  const claim = await call("claim", { json: {} });
  assert.equal(claim.status, 200);
  assert.deepEqual(Object.keys(claim.body), ["event"]);
  assert.deepEqual(Object.keys(claim.body.event).sort(), ["event_id", "lease_token", "signup_email"]);
  assert.equal(claim.body.event.signup_email, "reader@example.invalid");
  assert.equal(sql.prepare("SELECT lease_until - first_attempt_at AS duration FROM waitlist_notification_outbox").get().duration, 180);
  assert.equal(sql.prepare("SELECT count(*) AS n FROM poll_updates").get().n, 0);
  sql.exec("UPDATE waitlist_notifier_status SET last_poll_at = unixepoch() - 301");
  assert.deepEqual((await call("claim", { json: {} })).body, { event: null });
  assert.equal(sql.prepare("SELECT count(*) AS n FROM poll_updates").get().n, 2);
  assert.equal(sql.prepare("SELECT id FROM waitlist_notifier_status").get().id, 1);
});

test("acknowledgements enforce the lease and fix the retry interval", async t => {
  const { call, sql, seed } = database(t);
  seed("claim-and-retry@example.invalid");
  const claim = async () => {
    const { event_id, lease_token } = (await call("claim", { json: {} })).body.event;
    return { event_id, lease_token };
  };
  const lease = await claim();
  const stale = await call("sent", { json: { ...lease, lease_token: randomUUID() } });
  assert.deepEqual([stale.status, stale.body], [409, { ok: false, error: "stale_lease" }]);
  assert.deepEqual((await call("retry", { json: lease })).body, { ok: true });
  const retry = sql.prepare("SELECT state, next_attempt_at - unixepoch() AS delay FROM waitlist_notification_outbox").get();
  assert.equal(retry.state, "pending");
  assert.ok(retry.delay >= 59 && retry.delay <= 60);
  sql.exec("UPDATE waitlist_notification_outbox SET next_attempt_at = unixepoch()");
  const again = await claim();
  assert.notEqual(again.lease_token, lease.lease_token);
  assert.deepEqual((await call("sent", { json: again })).body, { ok: true });
  assert.equal((await call("retry", { json: lease })).status, 409);
  seed("needs-review@example.invalid");
  const review = await claim();
  assert.deepEqual((await call("review", { json: review })).body, { ok: true });
  assert.equal((await call("sent", { json: review })).status, 409);
  assert.deepEqual(sql.prepare("SELECT state FROM waitlist_notification_outbox ORDER BY signup_email").all().map(r => r.state), ["sent", "review"]);
});

test("unavailable internal storage yields a generic retryable response", async t => {
  const { call, sql } = database(t);
  sql.exec("DROP TABLE waitlist_notification_outbox");
  for (const [action, options] of [["health", { method: "GET" }], ["claim", { json: {} }],
                                  ["sent", { json: { event_id: "a".repeat(32), lease_token: randomUUID() } }]]) {
    const response = await call(action, options);
    assert.deepEqual([response.status, response.body], [503, { ok: false, error: "unavailable" }]);
  }
});
