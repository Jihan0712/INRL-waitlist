// GET /api/health: checks the three settings without a visitor, a bot check, or writing to the Sheet.
// Reports pass/fail per check only; never echoes a value.
//
//   settings ─► Turnstile secret valid? ─► Apps Script reachable + shared secret matches?
//
// The Apps Script check sends the real shared secret with action "check". Code.gs checks the secret first
// (wrong = "forbidden"), then reports which spreadsheet and tabs it sees, without writing.
// An older Code.gs ignores the action and answers "bad_request" (empty email): secret OK, tab unchecked.
const TIMEOUT_MS = 15_000;
const TURNSTILE_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const SETTINGS = ["TURNSTILE_SECRET", "APPS_SCRIPT_URL", "SHEET_SHARED_SECRET"];

export async function onRequestGet({ env }) {
  const missing = SETTINGS.filter((name) => !env[name]);
  const checks = { settings: missing.length === 0 ? "ok" : `missing: ${missing.join(", ")}` };
  for (const name of missing) checks[name] = diagnoseMissing(env, name);

  if (env.TURNSTILE_SECRET) checks.turnstile_secret = await checkTurnstile(env.TURNSTILE_SECRET);
  if (env.APPS_SCRIPT_URL && env.SHEET_SHARED_SECRET) Object.assign(checks, await checkAppsScript(env));

  // Only these are pass/fail; apps_script_sees and the per-setting explanations are information.
  const ok = missing.length === 0 && ["settings", "turnstile_secret", "apps_script"].every((key) => checks[key] === "ok");
  return new Response(JSON.stringify({ ok, checks }, null, 2), {
    status: ok ? 200 : 500,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

// Explains why a setting is missing using names only: empty value, or a near-miss name (stray space, wrong case).
function diagnoseMissing(env, name) {
  if (name in env) return "present but empty: paste the value again";
  const squash = (s) => s.replace(/[^a-z0-9]/gi, "").toUpperCase();
  const lookalikes = Object.keys(env).filter((key) => squash(key) === squash(name));
  if (lookalikes.length > 0) {
    return `not found, but a similar name exists: ${lookalikes.map((k) => JSON.stringify(k)).join(", ")}; rename it to exactly "${name}"`;
  }
  return "not found on this deployment: add it for Production, then Retry deployment";
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
      body: JSON.stringify({ secret: env.SHEET_SHARED_SECRET, action: "check", email: "" }),
      redirect: "follow",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = await res.text();
    let result;
    try {
      result = JSON.parse(text);
    } catch {
      return { apps_script: `wrong: got a web page (status ${res.status}), not the script; check the URL ends in /exec and access is Anyone` };
    }
    if (result.check) {
      const sees = { spreadsheet: result.spreadsheet, tabs: result.tabs };
      if (!result.spreadsheet) {
        return { apps_script: "wrong: the script isn't attached to a spreadsheet; create it from the Sheet via Extensions > Apps Script", apps_script_sees: sees };
      }
      if (!result.signupsTab) {
        return { apps_script: `wrong: spreadsheet "${result.spreadsheet}" has no "Signups" tab; rename the tab, or the script is attached to a different spreadsheet`, apps_script_sees: sees };
      }
      return { apps_script: "ok", apps_script_sees: sees };
    }
    if (result.error === "bad_request") {
      return { apps_script: "partly checked: shared secret matches, but the deployed Code.gs is an older version so the Signups tab can't be checked; paste the latest Code.gs and deploy a new version" };
    }
    if (result.error === "forbidden") return { apps_script: "wrong: shared secret doesn't match SHARED_SECRET in Script properties" };
    return { apps_script: `unexpected reply: ${String(result.error ?? JSON.stringify(result)).slice(0, 60)}` };
  } catch (err) {
    return { apps_script: err?.name === "TimeoutError" ? "timeout: Apps Script didn't answer in 15 s" : "unreachable: bad APPS_SCRIPT_URL or Google unreachable" };
  }
}
