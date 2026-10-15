import { afterEach, describe, expect, it, vi } from "vitest";
import { onRequestGet } from "../functions/api/health.js";

const env = {
  TURNSTILE_SECRET: "turnstile-secret",
  APPS_SCRIPT_URL: " https://script.google.com/macros/s/test/exec\n",
  SHEET_SHARED_SECRET: "sheet-secret",
};

function mockUpstreams({ turnstileCodes = ["invalid-input-response"], sheet = { ok: false, error: "bad_request" }, sheetText, sheetThrows } = {}) {
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
  it("passes when the Turnstile secret is valid and the shared secret matches, sending no email", async () => {
    const calls = mockUpstreams();
    const res = await onRequestGet({ env });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, checks: { settings: "ok", turnstile_secret: "ok", apps_script: "ok" } });
    expect(calls.sheet[0].url).toBe("https://script.google.com/macros/s/test/exec");
    expect(calls.sheet[0].body).toEqual({ secret: "sheet-secret", email: "" });
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
    expect(body.checks).toEqual({ settings: "missing: APPS_SCRIPT_URL, SHEET_SHARED_SECRET", turnstile_secret: "ok" });
  });

  it("never echoes a secret value", async () => {
    const { body } = await check({ sheet: { ok: false, error: "forbidden" } });
    const text = JSON.stringify(body);
    expect(text).not.toContain("sheet-secret");
    expect(text).not.toContain("turnstile-secret");
  });
});
