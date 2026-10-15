/**
 * INRL waitlist: receives sign-ups from the Cloudflare function /api/join and appends them to the "Signups" tab.
 *
 * Setup (SETUP.md step 9): paste into Extensions > Apps Script of the "INRL Waitlist" Sheet, add the
 * Script property SHARED_SECRET, then Deploy > New deployment > Web app (Execute as: Me, Access: Anyone).
 *
 *   doPost ─► parse JSON ─► secret matches? ─► lock ─► email already listed? ─► append literal-text row
 *               bad_request     forbidden        busy     ok (duplicate)           ok
 *
 * {action: "check"} (used by /api/health) stops after the secret check and reports which spreadsheet
 * and tabs this script sees, without writing anything.
 */

var SHEET_NAME = 'Signups';
var EMAIL_COLUMN = 5; // A Timestamp, B First name, C Last name, D Country, E Email, F Source
var LOCK_WAIT_MS = 10000;

function doPost(e) {
  var payload;
  try {
    payload = JSON.parse((e && e.postData && e.postData.contents) || '');
  } catch (err) {
    return respond({ ok: false, error: 'bad_request' });
  }
  return respond(handleSignup(payload));
}

// Health check: open the /exec URL in a browser after deploying.
function doGet() {
  return respond({ ok: true, service: 'inrl-waitlist' });
}

function handleSignup(payload) {
  var expected = PropertiesService.getScriptProperties().getProperty('SHARED_SECRET');
  if (!expected || !payload || !safeEqual(String(payload.secret || ''), expected)) {
    return { ok: false, error: 'forbidden' };
  }

  if (payload.action === 'check') return describeSpreadsheet();

  var email = String(payload.email || '').trim().toLowerCase();
  if (!email) return { ok: false, error: 'bad_request' };

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_WAIT_MS)) {
    return { ok: false, error: 'busy' };
  }
  try {
    var sheet = findSignupsSheet(SpreadsheetApp.getActiveSpreadsheet());
    if (!sheet) return { ok: false, error: 'no_sheet' };

    var lastRow = sheet.getLastRow();
    if (lastRow >= 2) {
      var existing = sheet
        .getRange(2, EMAIL_COLUMN, lastRow - 1, 1)
        .createTextFinder(email)
        .matchEntireCell(true)
        .matchCase(false)
        .findNext();
      if (existing) return { ok: true, duplicate: true };
    }

    var row = [
      new Date(),
      escapeCell(payload.firstName),
      escapeCell(payload.lastName),
      escapeCell(payload.country),
      escapeCell(email),
      escapeCell(payload.source),
    ];
    sheet.getRange(lastRow + 1, 1, 1, row.length).setValues([row]);
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

// Exact "Signups" first, then ignoring case and stray spaces ("signups ", " Signups").
function findSignupsSheet(spreadsheet) {
  if (!spreadsheet) return null;
  var exact = spreadsheet.getSheetByName(SHEET_NAME);
  if (exact) return exact;
  var sheets = spreadsheet.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    if (sheets[i].getName().trim().toLowerCase() === SHEET_NAME.toLowerCase()) return sheets[i];
  }
  return null;
}

// Names only (spreadsheet title and tab names), so a wrong binding or tab can be spotted from /api/health.
function describeSpreadsheet() {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) return { ok: true, check: true, spreadsheet: null, tabs: [], signupsTab: false };
  var tabs = spreadsheet.getSheets().map(function (sheet) { return sheet.getName(); });
  return { ok: true, check: true, spreadsheet: spreadsheet.getName(), tabs: tabs, signupsTab: !!findSignupsSheet(spreadsheet) };
}

// Sheets treats values starting with = + - @ as formulas. A leading apostrophe stores them as plain text.
function escapeCell(value) {
  var text = String(value == null ? '' : value);
  return /^[=+\-@\t\r]/.test(text) ? "'" + text : text;
}

// Compares every character so the time taken doesn't reveal how much of the secret matched.
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function respond(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
