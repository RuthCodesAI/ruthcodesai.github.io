import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import worker from "./worker.mjs";

const migration = readFileSync(new URL("./migrations/0001_waitlist.sql", import.meta.url), "utf8");
const address = "reader+release@example.test";
const consent = "By joining, you agree to receive Ruth launch updates by email.";
const origins = ["https://ruth.codes", "https://ruthcodesai.github.io"];

function setup(t) {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  db.exec(migration);
  const env = {
    DB: {
      prepare: sql => ({
        bind: (...values) => ({
          run: async () => {
            db.prepare(sql).run(...values);
            return { success: true };
          }
        })
      })
    },
    SIGNUP_LIMITER: { limit: async () => ({ success: true }) }
  };
  return { db, env };
}

function post(env, data = { email: address, consent: true }, headers = {}) {
  return worker.fetch(new Request("https://api.example.test/waitlist", {
    method: "POST",
    headers: { Origin: origins[0], "Content-Type": "application/json", ...headers },
    body: JSON.stringify(data)
  }), env);
}

test("accepted signup stores the first agreement, preserving it under concurrent retries and mixed case", async t => {
  const { db, env } = setup(t);
  const first = await post(env, { email: " Reader+Release@EXAMPLE.TEST ", consent: true });
  assert.equal(first.status, 200);
  assert.equal(first.headers.get("Access-Control-Allow-Origin"), origins[0]);
  assert.deepEqual(await first.json(), { ok: true });
  const stored = db.prepare("SELECT * FROM waitlist_signups").get();
  assert.equal(stored.email, "Reader+Release@example.test");
  assert.match(stored.joined_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.equal(stored.consent_version, "launch-updates-v1");
  assert.equal(stored.consent_text, consent);
  const retries = await Promise.all([post(env), post(env), post(env)]);
  for (const res of retries) {
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
  }
  assert.deepEqual(db.prepare("SELECT * FROM waitlist_signups").all(), [stored]);
});

test("CORS authorizes the two sites and permits only JSON POST preflight", async t => {
  const { db, env } = setup(t);
  async function preflight(origin, method, headers) {
    return worker.fetch(new Request("https://api.example.test/waitlist", {
      method: "OPTIONS",
      headers: { Origin: origin, "Access-Control-Request-Method": method, "Access-Control-Request-Headers": headers }
    }), env);
  }
  for (const origin of origins) {
    const res = await preflight(origin, "POST", "Content-Type");
    assert.equal(res.status, 204);
    assert.equal(res.headers.get("Access-Control-Allow-Origin"), origin);
    assert.equal(res.headers.get("Access-Control-Allow-Methods"), "POST");
    assert.equal(res.headers.get("Access-Control-Allow-Headers"), "Content-Type");
    assert.match(res.headers.get("Vary"), /Origin/);
    assert.equal(await res.text(), "");
  }
  assert.equal((await preflight(origins[0], "GET", "")).status, 403);
  assert.equal((await preflight(origins[0], "POST", "Content-Type, Authorization")).status, 403);
  for (const origin of ["https://ruth.codes.evil.test", "https://preview.ruth.codes", "null", ""]) {
    const res = await post(env, undefined, { Origin: origin });
    assert.equal(res.status, 403);
    assert.equal(res.headers.get("Access-Control-Allow-Origin"), null);
  }
  assert.equal(db.prepare("SELECT count(*) FROM waitlist_signups").get()["count(*)"], 0);
});

test("email length, address syntax, exact JSON shape and boolean consent are enforced", async t => {
  const { db, env } = setup(t);
  for (const email of ["", "local", "a@b@c", ".a@example.test", "a..b@example.test", "a@-example.test",
    "a@bad_.test", "a @example.test", "a\n@example.test", "a@bad-.test", "a".repeat(65) + "@example.test",
    "a".repeat(63) + "@" + ("d".repeat(63) + ".").repeat(2) + "e".repeat(63), null]) {
    const res = await post(env, { email, consent: true });
    assert.equal(res.status, 400, String(email));
    assert.equal((await res.json()).error, "invalid_email");
  }
  for (const badConsent of [false, 1, "true", null]) {
    const res = await post(env, { email: address, consent: badConsent });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, "invalid_consent");
  }
  for (const data of [null, [], {}, { email: address }, { consent: true },
    { email: address, consent: true, name: "extra" }]) {
    assert.equal((await (await post(env, data)).json()).error, "invalid_request");
  }
  const maxEmail = "a".repeat(62) + "@" + ("d".repeat(63) + ".").repeat(2) + "e".repeat(63);
  assert.equal(maxEmail.length, 254);
  assert.equal((await post(env, { email: maxEmail, consent: true })).status, 200);
  assert.equal(db.prepare("SELECT count(*) FROM waitlist_signups").get()["count(*)"], 1);
});

test("malformed, oversize and unsupported payloads cannot insert", async t => {
  const { env } = setup(t);
  for (const [body, extra, status] of [
    ["{", {}, 400], [null, {}, 400], ["", { "Content-Length": "5000" }, 413],
    ["x".repeat(3000), {}, 413], ["{}", { "Content-Type": "text/plain" }, 415]
  ]) {
    const res = await worker.fetch(new Request("https://api.example.test/waitlist", {
      method: "POST", headers: { Origin: origins[0], "Content-Type": "application/json", ...extra }, body
    }), env);
    assert.equal(res.status, status);
  }
});

test("public reads and unrelated paths cannot return stored signups", async t => {
  const { env } = setup(t);
  await post(env);
  for (const path of ["/waitlist", "/", "/waitlist/entries", "/admin"]) {
    const res = await worker.fetch(new Request("https://api.example.test" + path, {
      headers: { Origin: origins[0] }
    }), env);
    assert.equal(res.status, path === "/waitlist" ? 405 : 404);
    assert.ok(!(await res.text()).includes(address));
    assert.equal(res.headers.get("Cache-Control"), "no-store");
  }
});

test("rate limits and binding failures return retryable errors without exposing submitted data", async t => {
  const { db, env } = setup(t);
  env.SIGNUP_LIMITER.limit = async ({ key }) => {
    assert.equal(key, "192.0.2.31");
    return { success: false };
  };
  const limited = await post(env, undefined, { "CF-Connecting-IP": "192.0.2.31" });
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get("Retry-After"), "60");
  assert.equal((await limited.json()).error, "rate_limited");
  assert.equal(db.prepare("SELECT count(*) FROM waitlist_signups").get()["count(*)"], 0);
  env.SIGNUP_LIMITER.limit = async () => ({ success: true });
  env.DB.prepare = () => { throw new Error("private data"); };
  const failed = await post(env);
  assert.equal(failed.status, 503);
  assert.deepEqual(await failed.json(), { ok: false, error: "unavailable" });
});
