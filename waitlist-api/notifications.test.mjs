import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { promisify } from "node:util";

const initial = readFileSync(new URL("./migrations/0001_waitlist.sql", import.meta.url), "utf8");
const outbox = readFileSync(new URL("./migrations/0002_notification_outbox.sql", import.meta.url), "utf8");
const runNode = promisify(execFile);
const signup = `INSERT INTO waitlist_signups (email, consent_version, consent_text)
                VALUES (?, 'test', 'test') ON CONFLICT(email) DO NOTHING`;
const notices = "SELECT * FROM waitlist_notification_outbox";

function setup(t) {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  db.exec(initial);
  return db;
}

test("only new signups enqueue a due event with a stable opaque ID", t => {
  const db = setup(t);
  const insert = db.prepare(signup);
  insert.run("existing@example.invalid");
  db.exec(outbox);
  insert.run("EXISTING@example.invalid");
  assert.equal(db.prepare(notices).all().length, 0);

  insert.run("New@example.invalid");
  const first = db.prepare(notices).get();
  assert.match(first.event_id, /^[a-f0-9]{32}$/);
  assert.equal(first.signup_email, "New@example.invalid");
  assert.equal(first.state, "pending");
  assert.equal(first.attempts, 0);
  assert.ok(Number.isInteger(first.queued_at));
  assert.equal(first.next_attempt_at, first.queued_at);
  for (const field of ["first_attempt_at", "lease_token", "lease_until", "sent_at", "provider_message_id"]) {
    assert.equal(first[field], null);
  }
  insert.run("new@EXAMPLE.invalid");
  assert.deepEqual(db.prepare(notices).all(), [first]);
  insert.run("second@example.invalid");
  const second = db.prepare(notices + " WHERE signup_email = ?").get("second@example.invalid");
  assert.notEqual(first.event_id, second.event_id);

  db.prepare("DELETE FROM waitlist_signups WHERE email = ?").run(first.signup_email);
  assert.deepEqual(db.prepare(notices).all(), [second]);
});

test("simultaneous connections retrying the same signup create one event", async t => {
  const dir = mkdtempSync(join(tmpdir(), "ruth-outbox-"));
  const path = join(dir, "test.sqlite");
  const db = new DatabaseSync(path);
  t.after(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  db.exec(initial);
  db.exec(outbox);
  const insertInProcess = `
    const { DatabaseSync } = require("node:sqlite");
    const [path, statement, address] = process.argv.slice(1);
    const db = new DatabaseSync(path);
    db.exec("PRAGMA busy_timeout = 5000");
    db.prepare(statement).run(address);
    db.close();`;
  await Promise.all(["Reader", "READER", "reader"].map(name =>
    runNode(process.execPath, ["--input-type=commonjs", "-e", insertInProcess, path, signup, name + "@example.invalid"])
  ));
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM waitlist_signups").get().n, 1);
  assert.equal(db.prepare(notices).all().length, 1);
});

test("a failed notification insert rolls back the new signup", t => {
  const db = setup(t);
  db.exec(outbox);
  db.exec(`CREATE TRIGGER simulate_outbox_failure BEFORE INSERT ON waitlist_notification_outbox
           BEGIN SELECT RAISE(ABORT, 'outbox write failed'); END;`);
  assert.throws(() => db.prepare(signup).run("rollback@example.invalid"), /outbox write failed/);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM waitlist_signups").get().n, 0);
  assert.equal(db.prepare(notices).all().length, 0);
});
