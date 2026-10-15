import { afterEach, describe, expect, it, vi } from "vitest";
import { onRequestGet } from "../functions/api/health.js";

const env = {
  TURNSTILE_SECRET: "turnstile-secret",
  APPS_SCRIPT_URL: " https://script.google.com/macros/s/test/exec\n",
  SHEET_SHARED_SECRET: "sheet-secret",
};

const scriptSees = { ok: true, check: true, spreadsheet: "INRL Waitlist", tabs: ["Signups"], signupsTab: true };

function mockUpstreams({ turnstileCodes = ["invalid-input-response"], sheet = scriptSees, sheetText, sheetThrows } = {}) {
  const calls = { sheet: [] };
  vi.stubGlobal("fetch", vi.fn(async (url, init) => {
    if (String(url).includes("turnstile")) return Response.json({ success: false, "error-codes": turnstileCodes });
    calls.sheet.push({ url, body: JSON.parse(init.body) });
    if (sheetThrows) throw sheetThrows;
    return new Response(sheetText ?? JSON.stringify(sheet));
  }));
  return calls;
}

async function check(overrides = {}, e = env) {
  mockUpstreams(overrides);
  const res = await onRequestGet({ env: e });
  return { status: res.status, body: await res.json() };
}

afterEach(() => vi.unstubAllGlobals());

describe("GET /api/health", () => {
  it("passes when the secrets match and the script sees a Signups tab, and shows what it sees", async () => {
    const calls = mockUpstreams();
    const res = await onRequestGet({ env });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      ok: true,
      checks: {
        settings: "ok",
        turnstile_secret: "ok",
        apps_script: "ok",
        apps_script_sees: { spreadsheet: "INRL Waitlist", tabs: ["Signups"] },
      },
    });
    expect(calls.sheet[0].url).toBe("https://script.google.com/macros/s/test/exec");
    expect(calls.sheet[0].body).toEqual({ secret: "sheet-secret", action: "check", email: "" });
  });

  it.each([
    ["a spreadsheet without a Signups tab", { ...scriptSees, spreadsheet: "Copy of INRL Waitlist", tabs: ["Sheet1"], signupsTab: false }, /"Copy of INRL Waitlist" has no "Signups" tab/],
    ["a script not attached to any spreadsheet", { ok: true, check: true, spreadsheet: null, tabs: [], signupsTab: false }, /isn't attached to a spreadsheet/],
    ["an older Code.gs that ignores the check", { ok: false, error: "bad_request" }, /^partly checked: shared secret matches/],
  ])("fails and explains %s", async (_label, sheet, message) => {
    const { status, body } = await check({ sheet });
    expect(status).toBe(500);
    expect(body.ok).toBe(false);
    expect(body.checks.apps_script).toMatch(message);
  });

  it.each([
    ["a shared secret mismatch", { sheet: { ok: false, error: "forbidden" } }, "apps_script", /shared secret doesn't match/],
    ["a Google web page instead of the script", { sheetText: "<html>Sign in</html>" }, "apps_script", /got a web page/],
    ["an Apps Script timeout", { sheetThrows: new DOMException("t", "TimeoutError") }, "apps_script", /^timeout/],
    ["an unreachable Apps Script", { sheetThrows: new TypeError("fetch failed") }, "apps_script", /^unreachable/],
    ["an unknown Turnstile secret", { turnstileCodes: ["invalid-input-secret"] }, "turnstile_secret", /doesn't recognise/],
  ])("reports %s", async (_label, upstream, key, message) => {
    const { status, body } = await check(upstream);
    expect(status).toBe(500);
    expect(body.ok).toBe(false);
    expect(body.checks[key]).toMatch(message);
  });

  it("names missing settings and skips the checks that need them", async () => {
    const { status, body } = await check({}, { TURNSTILE_SECRET: "t" });
    expect(status).toBe(500);
    expect(body.checks).toEqual({
      settings: "missing: APPS_SCRIPT_URL, SHEET_SHARED_SECRET",
      APPS_SCRIPT_URL: expect.stringMatching(/not found/),
      SHEET_SHARED_SECRET: expect.stringMatching(/not found/),
      turnstile_secret: "ok",
    });
  });

  it.each([
    ["an empty value", { SHEET_SHARED_SECRET: "" }, /present but empty/],
    ["a name with a trailing space", { "SHEET_SHARED_SECRET ": "x" }, /similar name exists: "SHEET_SHARED_SECRET "/],
    ["a lower-case name", { sheet_shared_secret: "x" }, /similar name exists: "sheet_shared_secret"/],
    ["no such setting at all", {}, /not found on this deployment/],
  ])("explains a missing setting caused by %s", async (_label, extra, message) => {
    const { SHEET_SHARED_SECRET, ...rest } = env;
    const { body } = await check({}, { ...rest, ...extra });
    expect(body.checks.settings).toBe("missing: SHEET_SHARED_SECRET");
    expect(body.checks.SHEET_SHARED_SECRET).toMatch(message);
    expect(JSON.stringify(body)).not.toContain('"x"');
  });

  it("never echoes a secret value", async () => {
    const { body } = await check({ sheet: { ok: false, error: "forbidden" } });
    const text = JSON.stringify(body);
    expect(text).not.toContain("sheet-secret");
    expect(text).not.toContain("turnstile-secret");
  });
});
