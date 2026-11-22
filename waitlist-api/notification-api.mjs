import { claimNext, markSent, retryLater, markForReview } from "./outbox.mjs";
import { readJsonBody } from "./request-body.mjs";

function reply(status, body, headers = {}) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

function reject(status, error, headers) {
  return reply(status, { ok: false, error }, headers);
}

async function authorized(request, expectedHex) {
  const bearer = /^Bearer ([a-z0-9_-]{43})$/i.exec(request.headers.get("Authorization") ?? "");
  if (!bearer || typeof expectedHex !== "string" || !/^[0-9a-f]{64}$/i.test(expectedHex)) return false;
  const actual = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(bearer[1])));
  const expected = Uint8Array.from(expectedHex.match(/../g), byte => Number.parseInt(byte, 16));
  if (typeof crypto.subtle.timingSafeEqual === "function") return crypto.subtle.timingSafeEqual(actual, expected);
  // Standard Web Crypto runtimes lack workerd's timingSafeEqual extension.
  let difference = 0;
  for (let i = 0; i < actual.length; i++) difference |= actual[i] ^ expected[i];
  return difference === 0;
}

function isLease(data) {
  return Object.keys(data).length === 2 && typeof data.event_id === "string" && /^[0-9a-f]{32}$/.test(data.event_id) &&
    typeof data.lease_token === "string" && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(data.lease_token);
}

export async function handleNotificationRequest(request, env) {
  const url = new URL(request.url);
  const match = /^\/internal\/notifications\/(health|claim|sent|retry|review)$/.exec(url.pathname);
  if (!match) return reject(404, "not_found");
  const origin = request.headers.get("Origin");
  const fetchSite = request.headers.get("Sec-Fetch-Site");
  if (url.protocol !== "https:" || (origin !== null && origin !== url.origin) ||
      fetchSite === "cross-site" || fetchSite === "same-site") return reject(403, "forbidden");

  try {
    if (!await authorized(request, env.NOTIFICATION_KEY_SHA256)) return reject(401, "unauthorized");
    const action = match[1];
    const method = action === "health" ? "GET" : "POST";
    if (request.method !== method) return reject(405, "method_not_allowed", { Allow: method });

    if (action === "health") {
      // Compile a query against both required tables without reading a subscriber row.
      const result = await env.DB.prepare(`SELECT o.event_id, s.last_poll_at
        FROM waitlist_notification_outbox AS o, waitlist_notifier_status AS s LIMIT 0`).run();
      return result.success ? reply(200, { ok: true }) : reject(503, "unavailable");
    }

    if (request.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
      return reject(415, "unsupported_media_type");
    }
    const { data, status, error } = await readJsonBody(request);
    if (error) return reject(status, error);
    if (!data || typeof data !== "object" || Array.isArray(data)) return reject(400, "invalid_request");

    if (action === "claim") {
      if (Object.keys(data).length) return reject(400, "invalid_request");
      const heartbeat = await env.DB.prepare(`INSERT INTO waitlist_notifier_status(id, last_poll_at)
        VALUES (1, unixepoch()) ON CONFLICT(id) DO UPDATE SET last_poll_at = excluded.last_poll_at
        WHERE waitlist_notifier_status.last_poll_at <= excluded.last_poll_at - 300`).run();
      if (!heartbeat.success) return reject(503, "unavailable");
      const event = await claimNext(env.DB, { leaseSeconds: 180 });
      if (!event) return reply(200, { event: null });
      const { event_id, lease_token, signup_email } = event;
      return reply(200, { event: { event_id, lease_token, signup_email } });
    }

    if (!isLease(data)) return reject(400, "invalid_request");
    let changed;
    if (action === "sent") changed = await markSent(env.DB, data);
    if (action === "review") changed = await markForReview(env.DB, data);
    if (action === "retry") changed = await retryLater(env.DB, data, { delaySeconds: 60, confirmedNotDispatched: true });
    return changed ? reply(200, { ok: true }) : reject(409, "stale_lease");
  } catch {
    return reject(503, "unavailable");
  }
}
