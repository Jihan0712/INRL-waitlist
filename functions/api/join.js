// POST /api/join: validate a waitlist sign-up, check Turnstile, forward it to the Apps Script that writes the Sheet.
//
//   body ─► size/JSON checks ─► honeypot? ─► validate ─► Turnstile ─► Apps Script ─► {ok:true}
//              400/413          200 (drop)     400 fields   400 verif.   500 unavailable
import { COUNTRY_NAMES } from "../../public/countries.js";

const MAX_BODY_BYTES = 10_000;
const NAME_MAX = 80;
const EMAIL_MAX = 254;
const SOURCE_MAX = 60;
// Apps Script cold starts that open the spreadsheet regularly take 10-15 s; leave headroom.
const APPS_SCRIPT_TIMEOUT_MS = 25_000;
const TURNSTILE_TIMEOUT_MS = 8_000;
const TURNSTILE_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export async function onRequestPost({ request, env }) {
  // Names only, never values, so a misconfigured deploy can be diagnosed from the response.
  const missing = ["TURNSTILE_SECRET", "APPS_SCRIPT_URL", "SHEET_SHARED_SECRET"].filter((name) => !env[name]);
  if (missing.length > 0) {
    console.error("join: missing settings", missing.join(", "));
    return json(500, { ok: false, error: "unavailable", missing });
  }

  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) {
    return json(413, { ok: false, error: "invalid" });
  }
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return json(400, { ok: false, error: "invalid" });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json(400, { ok: false, error: "invalid" });
  }

  // Bots fill the hidden field. Pretend it worked so they don't adapt.
  if (typeof body.company === "string" && body.company.trim() !== "") {
    return json(200, { ok: true });
  }

  const { values, fields } = validate(body);
  if (fields.length > 0) {
    return json(400, { ok: false, error: "invalid", fields });
  }

  const ip = request.headers.get("CF-Connecting-IP") ?? "";
  const human = await verifyTurnstile(env.TURNSTILE_SECRET, body.turnstileToken, ip);
  if (!human) {
    return json(400, { ok: false, error: "verification" });
  }

  const sheet = await forwardToSheet(env, values);
  if (!sheet.ok) {
    // `reason` is a short code (never a secret) so a failed sign-up can be diagnosed from the browser.
    // 500, not 502: Cloudflare swaps 502 responses for its own HTML error page, which hides the reason.
    return json(500, { ok: false, error: "unavailable", reason: sheet.reason });
  }
  return json(200, { ok: true });
}

// A browser visit is a GET. Answer it here so it doesn't fall through to the static site.
export function onRequestGet() {
  return new Response(JSON.stringify({ ok: false, error: "method_not_allowed" }), {
    status: 405,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", Allow: "POST" },
  });
}

export function validate(body) {
  const fields = [];
  const firstName = cleanName(body.firstName);
  const lastName = cleanName(body.lastName);
  const countryCode = typeof body.country === "string" ? body.country.trim().toUpperCase() : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";

  if (!firstName || firstName.length > NAME_MAX) fields.push("firstName");
  if (!lastName || lastName.length > NAME_MAX) fields.push("lastName");
  if (!COUNTRY_NAMES.has(countryCode)) fields.push("country");
  if (email.length > EMAIL_MAX || !EMAIL_PATTERN.test(email)) fields.push("email");

  return {
    fields,
    values: {
      firstName,
      lastName,
      countryCode,
      country: COUNTRY_NAMES.get(countryCode) ?? "",
      email,
      source: cleanSource(body.source),
    },
  };
}

function cleanName(value) {
  if (typeof value !== "string") return "";
  // Drop control characters, collapse runs of whitespace.
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
}

function cleanSource(value) {
  if (typeof value !== "string") return "";
  return value.toLowerCase().replace(/[^a-z0-9._-]/g, "").slice(0, SOURCE_MAX);
}

async function verifyTurnstile(secret, token, ip) {
  if (typeof token !== "string" || token === "") return false;
  const form = new FormData();
  form.append("secret", secret);
  form.append("response", token);
  if (ip) form.append("remoteip", ip);
  try {
    const res = await fetch(TURNSTILE_URL, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(TURNSTILE_TIMEOUT_MS),
    });
    const result = await res.json();
    return result.success === true;
  } catch (err) {
    console.error("join: turnstile verify failed", err);
    return false;
  }
}

async function forwardToSheet(env, values) {
  try {
    // Apps Script answers with a 302 to googleusercontent.com; fetch follows it.
    const res = await fetch(env.APPS_SCRIPT_URL.trim(), {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ secret: env.SHEET_SHARED_SECRET, ...values }),
      redirect: "follow",
      signal: AbortSignal.timeout(APPS_SCRIPT_TIMEOUT_MS),
    });
    const text = await res.text();
    let result;
    try {
      result = JSON.parse(text);
    } catch {
      // Usually a Google sign-in or error page: the deployment isn't "Who has access: Anyone", or the URL is wrong.
      console.error("join: apps script returned non-JSON", res.status, text.slice(0, 200));
      return { ok: false, reason: `apps_script_not_json_${res.status}` };
    }
    if (result.ok !== true) {
      console.error("join: apps script refused", result.error);
      return { ok: false, reason: `apps_script_${String(result.error ?? "refused").replace(/[^a-z_]/gi, "").slice(0, 30)}` };
    }
    return { ok: true };
  } catch (err) {
    console.error("join: apps script request failed", err);
    return { ok: false, reason: err?.name === "TimeoutError" ? "apps_script_timeout" : "apps_script_unreachable" };
  }
}

function json(status, data) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
