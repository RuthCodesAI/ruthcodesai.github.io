import { readJsonBody } from "./request-body.mjs";
import { handleNotificationRequest } from "./notification-api.mjs";

const allowedOrigins = new Set(["https://ruth.codes", "https://ruthcodesai.github.io"]);
const consentVersion = "launch-updates-v1";
const consentNotice = "By joining, you agree to receive Ruth launch updates by email.";

function respond(origin, status, error, extraHeaders) {
  const headers = new Headers({
    "Cache-Control": "no-store",
    Vary: "Origin, Access-Control-Request-Method, Access-Control-Request-Headers",
    ...extraHeaders
  });
  if (allowedOrigins.has(origin)) headers.set("Access-Control-Allow-Origin", origin);
  if (status === 204) return new Response(null, { status, headers });
  return Response.json(error ? { ok: false, error } : { ok: true }, { status, headers });
}

function preflight(request, origin) {
  const requestedHeaders = (request.headers.get("Access-Control-Request-Headers") || "")
    .toLowerCase().split(",").map(name => name.trim()).filter(Boolean);
  if (request.headers.get("Access-Control-Request-Method") !== "POST" ||
      requestedHeaders.some(name => name !== "content-type")) {
    return respond(origin, 403, "forbidden");
  }
  return respond(origin, 204, null, {
    "Access-Control-Allow-Methods": "POST",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "600"
  });
}

function emailAddress(value) {
  if (typeof value !== "string") return null;
  const email = value.trim();
  if (email.length > 254) return null;
  const [local, domain, extra] = email.split("@");
  if (!local || !domain || extra !== undefined || local.length > 64) return null;
  const atom = /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+$/i;
  const label = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
  if (!local.split(".").every(part => atom.test(part)) ||
      !domain.split(".").every(part => label.test(part))) return null;
  return local + "@" + domain.toLowerCase();
}

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (path.startsWith("/internal/notifications/")) return handleNotificationRequest(request, env);
    const origin = request.headers.get("Origin");
    if (path !== "/waitlist") return respond(origin, 404, "not_found");
    if (!allowedOrigins.has(origin)) return respond(origin, 403, "forbidden");
    if (request.method === "OPTIONS") return preflight(request, origin);
    if (request.method !== "POST") {
      return respond(origin, 405, "method_not_allowed", { Allow: "POST, OPTIONS" });
    }
    if (request.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
      return respond(origin, 415, "unsupported_media_type");
    }

    try {
      // At the Cloudflare edge the connecting-IP header is supplied by the platform.
      // This anonymous throttle key is never written to the signup database.
      const key = request.headers.get("CF-Connecting-IP") || "unknown";
      const rate = await env.SIGNUP_LIMITER.limit({ key });
      if (!rate.success) return respond(origin, 429, "rate_limited", { "Retry-After": "60" });

      const { data, status, error } = await readJsonBody(request);
      if (error) return respond(origin, status, error);
      if (!data || typeof data !== "object" || Array.isArray(data) ||
          Object.keys(data).length !== 2 || !Object.hasOwn(data, "email") || !Object.hasOwn(data, "consent")) {
        return respond(origin, 400, "invalid_request");
      }
      const email = emailAddress(data.email);
      if (!email) return respond(origin, 400, "invalid_email");
      if (data.consent !== true) return respond(origin, 400, "invalid_consent");

      const result = await env.DB.prepare(
        `INSERT INTO waitlist_signups (email, consent_version, consent_text) VALUES (?1, ?2, ?3)
         ON CONFLICT(email) DO NOTHING`
      ).bind(email, consentVersion, consentNotice).run();
      if (!result.success) return respond(origin, 503, "unavailable");
      return respond(origin, 200);
    } catch {
      return respond(origin, 503, "unavailable");
    }
  }
};
