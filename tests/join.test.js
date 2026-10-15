import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { onRequestGet, onRequestPost, validate } from "../functions/api/join.js";

const env = {
  TURNSTILE_SECRET: "turnstile-secret",
  APPS_SCRIPT_URL: "https://script.google.com/macros/s/test/exec",
  SHEET_SHARED_SECRET: "sheet-secret",
};

const validBody = {
  firstName: "  Ada  ",
  lastName: "Lovelace",
  country: "dk",
  email: "  Ada@Example.COM ",
  company: "",
  turnstileToken: "token-123",
  source: "Instagram Story!",
};

function post(body, { raw } = {}) {
  return new Request("https://waitlist.inrl.co/api/join", {
    method: "POST",
    headers: { "Content-Type": "application/json", "CF-Connecting-IP": "203.0.113.7" },
    body: raw ?? JSON.stringify(body),
  });
}

// Routes fetch calls to fake Turnstile and Apps Script responses.
function mockUpstreams({ turnstile = { success: true }, sheet = { ok: true }, sheetThrows, sheetText } = {}) {
  const calls = { turnstile: [], sheet: [] };
  vi.stubGlobal("fetch", vi.fn(async (url, init) => {
    if (String(url).includes("turnstile")) {
      calls.turnstile.push(init);
      return Response.json(turnstile);
    }
    calls.sheet.push(init);
    if (sheetThrows) throw sheetThrows;
    return new Response(sheetText ?? JSON.stringify(sheet));
  }));
  return calls;
}

beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => {}));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("POST /api/join", () => {
  it("forwards a valid sign-up to the Sheet with cleaned values and the shared secret", async () => {
    const calls = mockUpstreams();
    const res = await onRequestPost({ request: post(validBody), env });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(calls.sheet).toHaveLength(1);
    expect(JSON.parse(calls.sheet[0].body)).toEqual({
      secret: "sheet-secret",
      firstName: "Ada",
      lastName: "Lovelace",
      countryCode: "DK",
      country: "Denmark",
      email: "ada@example.com",
      source: "instagramstory",
    });
    const sent = calls.turnstile[0].body;
    expect(sent.get("response")).toBe("token-123");
    expect(sent.get("remoteip")).toBe("203.0.113.7");
  });

  it("silently accepts and drops a filled honeypot without calling Turnstile or the Sheet", async () => {
    const calls = mockUpstreams();
    const res = await onRequestPost({ request: post({ ...validBody, company: "Acme" }), env });

    expect(res.status).toBe(200);
    expect(calls.turnstile).toHaveLength(0);
    expect(calls.sheet).toHaveLength(0);
  });

  it("returns every invalid field name and writes nothing", async () => {
    const calls = mockUpstreams();
    const res = await onRequestPost({
      request: post({ ...validBody, firstName: " ", lastName: "x".repeat(81), country: "ZZ", email: "abc@" }),
      env,
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: "invalid", fields: ["firstName", "lastName", "country", "email"] });
    expect(calls.sheet).toHaveLength(0);
  });

  it("rejects a failed or missing Turnstile check before touching the Sheet", async () => {
    const calls = mockUpstreams({ turnstile: { success: false } });
    const failed = await onRequestPost({ request: post(validBody), env });
    const missing = await onRequestPost({ request: post({ ...validBody, turnstileToken: "" }), env });

    expect(failed.status).toBe(400);
    expect(await failed.json()).toEqual({ ok: false, error: "verification" });
    expect(missing.status).toBe(400);
    expect(calls.sheet).toHaveLength(0);
  });

  it.each([
    ["Apps Script refuses (wrong secret)", { sheet: { ok: false, error: "forbidden" } }, "apps_script_forbidden"],
    ["the Signups tab is missing", { sheet: { ok: false, error: "no_sheet" } }, "apps_script_no_sheet"],
    ["Apps Script returns an HTML page", { sheetText: "<html>Sign in</html>" }, "apps_script_not_json_200"],
    ["Apps Script times out", { sheetThrows: new DOMException("timed out", "TimeoutError") }, "apps_script_timeout"],
    ["Apps Script can't be reached", { sheetThrows: new TypeError("fetch failed") }, "apps_script_unreachable"],
  ])("returns 502 with a reason code when %s", async (_label, upstream, reason) => {
    mockUpstreams(upstream);
    const res = await onRequestPost({ request: post(validBody), env });

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ ok: false, error: "unavailable", reason });
  });

  it("returns 500 without calling anything when secrets are not configured", async () => {
    const calls = mockUpstreams();
    const res = await onRequestPost({ request: post(validBody), env: { ...env, APPS_SCRIPT_URL: "" } });

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ ok: false, error: "unavailable", missing: ["APPS_SCRIPT_URL"] });
    expect(calls.turnstile).toHaveLength(0);
  });

  it.each([
    ["malformed JSON", "{not json", 400],
    ["a JSON array", "[1,2]", 400],
    ["a body over 10 KB", JSON.stringify({ ...validBody, firstName: "a".repeat(11_000) }), 413],
  ])("rejects %s", async (_label, raw, status) => {
    const calls = mockUpstreams();
    const res = await onRequestPost({ request: post(null, { raw }), env });

    expect(res.status).toBe(status);
    expect(calls.sheet).toHaveLength(0);
  });
});

describe("GET /api/join", () => {
  it("answers 405 instead of falling through to the homepage", async () => {
    const res = onRequestGet();
    expect(res.status).toBe(405);
    expect(res.headers.get("Allow")).toBe("POST");
    expect(await res.json()).toEqual({ ok: false, error: "method_not_allowed" });
  });
});

describe("validate", () => {
  it("collapses whitespace and strips control characters in names", () => {
    const { values, fields } = validate({ ...validBody, firstName: "Ana\u0000  Maria\n", lastName: "Sø\tby" });
    expect(fields).toEqual([]);
    expect(values.firstName).toBe("Ana Maria");
    expect(values.lastName).toBe("Sø by");
  });

  it("treats non-string fields as missing instead of throwing", () => {
    const { fields } = validate({ firstName: 42, lastName: null, country: ["DK"], email: {} });
    expect(fields).toEqual(["firstName", "lastName", "country", "email"]);
  });
});
