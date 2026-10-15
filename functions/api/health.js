// GET /api/health: checks the three settings without a visitor, a bot check, or writing to the Sheet.
// Reports pass/fail per check only; never echoes a value.
//
//   settings ─► Turnstile secret valid? ─► Apps Script reachable + shared secret matches?
//
// The Apps Script check sends the real shared secret with no email. Code.gs checks the secret first:
// a wrong secret answers "forbidden", a right one answers "bad_request" and stops before the Sheet.
const TIMEOUT_MS = 15_000;
const TURNSTILE_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const SETTINGS = ["TURNSTILE_SECRET", "APPS_SCRIPT_URL", "SHEET_SHARED_SECRET"];

export async function onRequestGet({ env }) {
  const missing = SETTINGS.filter((name) => !env[name]);
  const checks = { settings: missing.length === 0 ? "ok" : `missing: ${missing.join(", ")}` };

  if (env.TURNSTILE_SECRET) checks.turnstile_secret = await checkTurnstile(env.TURNSTILE_SECRET);
  if (env.APPS_SCRIPT_URL && env.SHEET_SHARED_SECRET) checks.apps_script = await checkAppsScript(env);

  const ok = Object.values(checks).every((v) => v === "ok");
  return new Response(JSON.stringify({ ok, checks }, null, 2), {
    status: ok ? 200 : 500,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

async function checkTurnstile(secret) {
  const form = new FormData();
  form.append("secret", secret);
  form.append("response", "health-check-not-a-real-token");
  try {
    const res = await fetch(TURNSTILE_URL, { method: "POST", body: form, signal: AbortSignal.timeout(TIMEOUT_MS) });
    const codes = (await res.json())["error-codes"] ?? [];
    if (codes.includes("invalid-input-secret")) return "wrong: Cloudflare doesn't recognise this secret";
    if (codes.includes("missing-input-secret")) return "wrong: empty secret";
    // A valid secret makes Cloudflare reject only the fake token.
    return "ok";
  } catch {
    return "unreachable: couldn't contact Turnstile";
  }
}

async function checkAppsScript(env) {
  try {
    const res = await fetch(env.APPS_SCRIPT_URL.trim(), {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ secret: env.SHEET_SHARED_SECRET, email: "" }),
      redirect: "follow",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = await res.text();
    let result;
    try {
      result = JSON.parse(text);
    } catch {
      return `wrong: got a web page (status ${res.status}), not the script; check the URL ends in /exec and access is Anyone`;
    }
    if (result.error === "bad_request") return "ok";
    if (result.error === "forbidden") return "wrong: shared secret doesn't match SHARED_SECRET in Script properties";
    return `unexpected reply: ${String(result.error ?? JSON.stringify(result)).slice(0, 60)}`;
  } catch (err) {
    return err?.name === "TimeoutError" ? "timeout: Apps Script didn't answer in 15 s" : "unreachable: bad APPS_SCRIPT_URL or Google unreachable";
  }
}
