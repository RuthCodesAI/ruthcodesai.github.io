const table = "waitlist_notification_outbox";

function positiveSeconds(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 2147483647) {
    throw new RangeError("Expected a positive number of seconds");
  }
  return value;
}

export async function claimNext(db, { leaseSeconds = 120 } = {}) {
  const token = crypto.randomUUID();
  // A previous dispatcher could have reached the provider before it disappeared.
  // Keep these rows for reconciliation. Only pending rows are eligible for delivery.
  const sweep = db.prepare(`UPDATE ${table}
    SET state = 'review', next_attempt_at = NULL, lease_token = NULL, lease_until = NULL
    WHERE state = 'leased' AND lease_until <= unixepoch()`);
  const claim = db.prepare(`UPDATE ${table}
    SET state = 'leased', lease_token = ?1, lease_until = unixepoch() + ?2,
        next_attempt_at = NULL, attempts = attempts + 1,
        first_attempt_at = coalesce(first_attempt_at, unixepoch())
    WHERE event_id = (
      SELECT event_id FROM ${table}
      WHERE state = 'pending' AND next_attempt_at <= unixepoch()
      ORDER BY next_attempt_at, event_id LIMIT 1
    )
    RETURNING event_id, signup_email, lease_token, lease_until, attempts, first_attempt_at`)
    .bind(token, positiveSeconds(leaseSeconds));
  const [, claimed] = await db.batch([sweep, claim]);
  return claimed.results[0] ?? null;
}

export async function markSent(db, event, providerId = null) {
  const result = await db.prepare(`UPDATE ${table}
    SET state = 'sent', sent_at = unixepoch(), provider_message_id = ?3,
        lease_token = NULL, lease_until = NULL
    WHERE event_id = ?1 AND state = 'leased' AND lease_token = ?2 AND lease_until > unixepoch()`)
    .bind(event.event_id, event.lease_token, providerId).run();
  return result.meta.changes === 1;
}

export async function retryLater(db, event, { confirmedNotDispatched, delaySeconds = 60 } = {}) {
  if (confirmedNotDispatched !== true) {
    throw new TypeError("Retry requires confirmation that dispatch never started");
  }
  const result = await db.prepare(`UPDATE ${table}
    SET state = 'pending', next_attempt_at = unixepoch() + ?3, lease_token = NULL, lease_until = NULL
    WHERE event_id = ?1 AND state = 'leased' AND lease_token = ?2 AND lease_until > unixepoch()`)
    .bind(event.event_id, event.lease_token, positiveSeconds(delaySeconds)).run();
  return result.meta.changes === 1;
}

export async function markForReview(db, event) {
  const result = await db.prepare(`UPDATE ${table}
    SET state = 'review', next_attempt_at = NULL, lease_token = NULL, lease_until = NULL
    WHERE event_id = ?1 AND state = 'leased' AND lease_token = ?2`)
    .bind(event.event_id, event.lease_token).run();
  return result.meta.changes === 1;
}
