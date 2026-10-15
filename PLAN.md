# INRL Waitlist Site: Plan

Review target: this plan (eng review via /plan-eng-review, started 2026-10-15).
Report file: `PLAN.md` in the project folder (user asked for the project to live in `E:\Documents\ONW\code\waitlist INRL`).

## Original request (unchanged copy)

> make this into a live full blown waitlist website using cloudflare (if its possible to not use cloudflare better but I think we need cloudflare for website setup live) and compile the listings on a google excel file

Source design: Figma `INRL - FINAL`, page `SIGNUP · EARLY ACCESS`, section `S · JOIN THE WAITLIST`
(https://www.figma.com/design/RES5XfG4fvECtsvIPV8pZl/INRL---FINAL?node-id=2186-5092).

## What the design specifies (from Figma, read 2026-10-15 as a guest viewer)

- Two states of one page: S-01 desktop 1440 / S-02 mobile 390 (waitlist), S-03 / S-04 (confirmation, "You're in"). 768-1023 uses the mobile layout with 24px margins.
- Order: announcement bar ("A T-shirt. A video you choose.", dismissible) → hero film with one CTA "Join the waitlist" (scrolls to form) → headline "CULTURE MOVES. WHAT WE WEAR SHOULD TOO." + "Why we made InRL" copy → form section with photo → footer.
- Form: First name, Last name, Country, Email. Nothing else. Desktop: name row 272 + 272 with 16px gap, Country and Email 560, button full width, all 44px tall, radius 8. Country should be a select.
- Form copy: "GET FIRST ACCESS." / "Our first drop is coming soon. Join the list and we'll email you when it's ready." Button "Join the waitlist" (teal).
- Confirmation: check icon, "YOU'RE ON THE LIST.", "You're in. We'll email you when the first drop opens.", "Back to the site" button, image beside (desktop) or above (mobile).
- Footer: wordmark + tagline; SHOP (T-shirts); HELP (Track your order, FAQs, Contact us, Returns); CONTACT (email, phone); © 2026 INRL; version line.
- Fonts: Oxanium (display) + Roboto (body). Colours: teal CTA, near-black footer, charcoal text. Exact hex values not readable as a guest; need export from someone with edit access.
- Hero film is not made yet ("HERO FILM · ~15 SEC · MARIOS · PENDING"). Hero headline not approved.
- AR screens S-05 to S-07 are reference copies of the existing camera flow, not part of this page.

## Working plan (proposed by reviewer, pending decisions below)

Static page + one same-origin API endpoint + Google Apps Script bound to the Sheet.

```
 Browser (index.html)
   │  POST /api/join  {firstName,lastName,country,email,turnstileToken,hp}
   ▼
 Cloudflare Pages Function  functions/api/join.js
   ├─ validate + normalise fields (trim, lowercase email, length caps, country in list)
   ├─ honeypot filled? → 200 {ok:true} (silently drop)
   ├─ verify Turnstile token → fail → 400 {error:"verification"}
   └─ fetch Apps Script URL with shared secret (10s timeout)
         ▼
 Google Apps Script web app  apps-script/Code.gs  (runs as sheet owner)
   ├─ secret mismatch → {ok:false,error:"forbidden"}
   ├─ LockService.waitLock(10000)
   ├─ email already in sheet? → {ok:true, duplicate:true}
   └─ appendRow([timestamp, first, last, country, email, source, userAgentHash])
         ▼
 Google Sheet "INRL Waitlist"  tab "Signups"

 Browser on {ok:true} → swap to "YOU'RE ON THE LIST." state (same URL, focus moved to heading)
 Browser on error     → inline message under button, form values kept, button re-enabled
```

Proposed files:

| File | Purpose |
|---|---|
| `public/index.html` | Waitlist + confirmation markup (one page, two states) |
| `public/styles.css` | Layout, tokens, breakpoints 390 / 768 / 1024 / 1440 |
| `public/app.js` | CTA scroll, announcement dismiss, form submit, state swap |
| `public/assets/` | Self-hosted fonts, images, hero video/poster, wordmark SVG |
| `functions/api/join.js` | Validation, honeypot, Turnstile, forward to Apps Script |
| `apps-script/Code.gs` | `doPost`: secret check, lock, dedupe, append |
| `tests/join.test.js` | Unit tests for the function's validation and branches |
| `tests/waitlist.spec.js` | Playwright E2E: submit, errors, mobile layout |
| `package.json` | wrangler (local dev), playwright, vitest |
| `README.md` | Setup: Sheet, Apps Script deploy, secrets, Pages deploy, DNS |

Secrets (never in the repo): `TURNSTILE_SECRET`, `APPS_SCRIPT_URL`, `SHEET_SHARED_SECRET` as Pages environment variables; the same shared secret in Apps Script Script Properties.

<!-- Decision ledger and review findings are appended below. -->

## Scope Challenge

**What already solves each sub-problem**
- Hosting a static page: any static host. Cloudflare is not required to go live. [Layer 1]
- Getting rows into a Google Sheet without a Google Cloud project or service-account key: a Google Apps Script web app bound to the Sheet (`doPost` + `LockService` + `appendRow`). [Layer 1]
- Bot protection without a CAPTCHA puzzle: Cloudflare Turnstile works on any host (it does not need Cloudflare hosting). [Layer 1]
- Existing project code: none. The folder is empty (`ls -la` on 2026-10-15), not a git repo, no TODOS.md.

**Minimum change:** one static page with two states, one small endpoint, one Apps Script. Hero film and exact colours are blocked on assets, not code; build with a poster image and placeholder tokens, swap later.

**Complexity check (estimated, proposed files):** 10 files (`public/index.html`, `public/styles.css`, `public/app.js`, `functions/api/join.js`, `apps-script/Code.gs`, `tests/join.test.js`, `tests/waitlist.spec.js`, `package.json`, `README.md`, plus `public/assets/` counted once). New services: 2 (Pages Function, Apps Script web app). Gate B trips (8+ files, 2+ services).

**Search check**
- Netlify free plan (accounts after Sep 2025): 300 credits/month, bandwidth 20 credits/GB, so about 15 GB/month at most, and when credits run out every site on the team is paused. Third-party sources, official page not reached. A 15-second hero film is several MB per view, so a launch spike can take the site offline. [netli.fyi](https://netli.fyi/blog/netlify-free-plan-limits-2026), [costbench](https://www.costbench.com/software/cloud-infrastructure/netlify/free-plan/)
- Cloudflare Pages: 25 MiB max per file, 20,000 files, 500 builds/month on Free. Bandwidth limit not found in search results (Cloudflare's own marketing says static requests are free and unlimited; not verified here). [developers.cloudflare.com](https://developers.cloudflare.com/pages/platform/limits)
- Apps Script web apps cannot set CORS headers; direct browser POSTs need `no-cors` and then the page cannot read the response, so it cannot tell success from failure. A same-origin proxy fixes this. [splitforms](https://splitforms.com/blog/form-to-google-sheets-without-zapier)
- Vercel Hobby is non-commercial use only, and GitHub Pages terms exclude running an online business, so neither fits a brand waitlist. (In-distribution knowledge, not re-verified.)

**Distribution check:** deploy is `wrangler pages deploy public` or a Git-connected Pages project. No CI exists. The domain/DNS route is open (see R-URL).

**Reality rows**

| premise | claim | receipt | verdict |
|---|---|---|---|
| P1 | Cloudflare is needed to put the site live | Any static host serves HTML; Netlify/GitHub Pages/Vercel all exist | FALSE (not needed, but best free fit, see R1) |
| P2 | "google excel file" means a Google Sheet | user request | unverified (assumed) |
| P3 | A live INRL home page exists to link "Back to the site" to | Figma notes: "lifted from the live home page" | unverified (URL unknown) |
| P4 | Domain is inrl.co | Figma footer shows contact@inrl.co | unverified |
| P5 | Netlify free ≈ 15 GB/month then pauses | netli.fyi 2026 | verified (third-party) |

REALITY: premise-table finding 5 premises, unverified=3, P1 FALSE  PLAN.md:94-98
REALITY: already-done pass empty folder, not a git repo, nothing to re-plan (ls -la on 2026-10-15)  PLAN.md:76
REALITY: surface-check pass wrangler pages deploy, Pages Functions, Turnstile siteverify, Apps Script doPost are documented surfaces; re-run `wrangler --help` at build time  PLAN.md:88
REALITY: binding-decisions pass gstack-decision-search returned no decisions for this project; plan has no Binding decisions yet  PLAN.md:76
REALITY: numbers finding Netlify about 15 GB/month (300 credits / 20 per GB) from third-party pricing page  PLAN.md:83
REALITY: deferred-asks pass request asks for a live site and a Google Sheet; both are in the working plan  PLAN.md:8
REALITY: pr-count pass no git remote or ship-policy; one deploy, default one PR per wave  PLAN.md:51

**Scope record (Gate B):** feature answers: none proposed (no cuts); structure: A Original arrangement (D2, answered 2026-10-15); accepted scope: 10-file layout in Working plan, same features; pending remedies: R1, R2, R3, R4, R5, R6.

### Scope Challenge findings

1. [P1] (confidence: 8/10) PLAN.md:8 — Premise "we need Cloudflare to go live" is false, but the stated preference ("not Cloudflare") conflicts with the hero film: Netlify's free plan caps at about 15 GB/month and pauses every site when it runs out (PLAN.md:83). Reviewer: Claude. Remedy: R1.
2. [P1] (confidence: 8/10) PLAN.md:83 — Posting straight from the browser to Apps Script cannot read the response (no CORS), so the page cannot know whether the row was written. Reviewer: Claude. Remedy: R1.

## Decision ledger

### R1: Hosting and the route from form to Sheet
Finding: 1 and 2, P1, confidence 8/10, PLAN.md:8 and PLAN.md:83, reviewer Claude
Plan baseline: original request PLAN.md:8, "using cloudflare (if its possible to not use cloudflare better)", listings in a Google Sheet; nothing approved yet
Runtime evidence: none, nothing built; pricing/limits from web search (PLAN.md:83-86)
Comparison grid:

| Choice | Current | A | B | C |
|---|---|---|---|---|
| R1 host | unspecified, user leans away from Cloudflare | Cloudflare Pages (free) | Netlify (free, credit-capped) | Any static host (Netlify assumed) |
| R1 form endpoint | unspecified | Same-origin Pages Function `/api/join` | Same-origin Netlify Function `/api/join` | None; browser posts to Apps Script directly |
| R1 Sheet writer | unspecified | Apps Script web app + shared secret | Apps Script web app + shared secret | Apps Script web app, public URL, no shared secret possible |
| R1 success shown to user | unspecified | Only after Sheet write confirmed | Only after Sheet write confirmed | Optimistic; failures invisible |
| R1 bandwidth risk | unspecified | Static bandwidth not metered (unverified) | About 15 GB/month then site paused | Same as chosen host |
| R2 bot protection | pending | pending | pending | pending |
| R3 duplicates | pending | pending | pending | pending |
| R4 consent | pending | pending | pending | pending |
| R5 fonts | pending | pending | pending | pending |
| R6 URL | pending | pending | pending | pending |

Question D3:
D3 — Where should the site run, and how do sign-ups reach the Google Sheet?
Project/branch/task: INRL waitlist (empty folder, no git); the plan must take a form submit and land a row in a Google Sheet.
ELI10: You don't need Cloudflare to go live; any web host works. But the page has a hero video, and Netlify's free plan only covers about 15 GB a month before it switches your site off until next month. Cloudflare Pages doesn't meter static traffic. Separately, the browser can't read replies from Google Apps Script directly, so without a small middle step the page can't tell whether a sign-up was saved. A and B add that middle step; C skips it.
Stakes if we pick wrong: Either the site goes dark during a launch spike (B), or people see "You're on the list" while their row silently never arrived (C).
Recommendation: A because it is free, has no bandwidth cliff for the video, and confirms every sign-up before showing success.
Completeness: A=10/10, B=8/10, C=5/10
Pros / cons:
A) Cloudflare Pages + endpoint + Apps Script (recommended)
  ✅ No bandwidth cap on static files, so the hero video can't knock the site offline
  ✅ Success screen only appears after the row is confirmed written in the Sheet
  ❌ Needs a free Cloudflare account; custom domain DNS gets set up there
B) Netlify + endpoint + Apps Script
  ✅ Avoids Cloudflare as you preferred, same reliable confirmed-write flow
  ✅ Simple drag-and-drop or CLI deploys, friendly dashboard
  ❌ About 15 GB/month free then every site pauses; video makes that reachable
C) Any host, browser posts straight to Apps Script
  ✅ Fewest moving parts: no endpoint file, no hosting functions at all
  ✅ Works on any host including Netlify or GitHub Pages
  ❌ Page can't see failures, so lost sign-ups look successful to the visitor
Effort: A or B (human: ~1 day / CC: ~30 min), C (human: ~6h / CC: ~20 min).
Net: Cloudflare is the safest free home for a video-led launch; avoiding it costs either a bandwidth cliff or blind sign-ups.
Header: D3 hosting
Options:
A) Cloudflare Pages (recommended)
Cloudflare Pages hosts the site free; a Pages Function at /api/join validates and forwards to an Apps Script web app (shared secret) that writes the Sheet. Success shown only after the write is confirmed. R2-R6 stay pending.
B) Netlify, no Cloudflare
Netlify hosts the site on the free plan (about 15 GB/month, then paused); a Netlify Function at /api/join forwards to the same Apps Script with a shared secret. Success shown only after confirmed write. R2-R6 stay pending.
C) Direct to Apps Script
Any static host (Netlify assumed); the browser posts straight to a public Apps Script URL with no-cors, so success is shown optimistically and failures are invisible. R2-R6 stay pending.

State: approved
Actual answer: A) Cloudflare Pages (recommended), D3 answered 2026-10-15
Accepted scope: Cloudflare Pages hosts the site free; a Pages Function at /api/join validates and forwards to an Apps Script web app (shared secret) that writes the Sheet. Success shown only after the write is confirmed. R2-R6 stay pending.
History: none


**Scope Challenge result:** scope accepted as-is (D2 kept the original arrangement; no cuts). Dispositions: finding 1 accepted via R1/D3; finding 2 accepted via R1/D3.

**Necessary implementation of the approved R1 contract (no separate approval, cites D3):**
- Pages Function validates server-side: trimmed first/last name 1-80 chars, email RFC-lite pattern and max 254, country from the same list the select uses; reject anything else with 400 and field names.
- Pages Function calls Apps Script with a 15 s timeout (cold starts take seconds) and maps timeout/5xx/non-JSON to 502 `{error:"unavailable"}`; the page shows a retry message and keeps the values.
- Apps Script writes every user field as literal text (`setNumberFormat("@")` on the row, or a leading `'`), so a name like `=IMPORTXML(...)` can never run as a formula in the Sheet. Writing values safely is part of "writes the Sheet".
- Apps Script uses `LockService.getScriptLock().waitLock(10000)` around read-check-append, releases in `finally`.
- Shared secret compared in Apps Script; mismatch returns `{ok:false,error:"forbidden"}` and writes nothing.

## Section 1: Architecture review

```
 visitor ──► Cloudflare edge (Pages static: index.html, css, js, fonts, video)
               │ POST /api/join (same origin, JSON)
               ▼
            Pages Function join.js ──(Turnstile siteverify, R2 pending)──► challenges.cloudflare.com
               │ POST + shared secret, 15 s timeout
               ▼
            Apps Script web app (deployed "Execute as: me", "Anyone")
               │ lock → (dedupe, R3 pending) → append literal-text row
               ▼
            Google Sheet "INRL Waitlist" / Signups
```

Findings:
1. [P1] (confidence: 7/10) PLAN.md:88 — The site URL is undecided. Cloudflare Pages can attach a subdomain (waitlist.inrl.co) with one CNAME at the current DNS provider, but serving the bare domain needs the domain's nameservers moved to Cloudflare, which touches email (MX) records for contact@inrl.co. The live home page already sits somewhere (P3, P4 unverified). Reviewer: Claude. Remedy: R6.
2. [P2] (confidence: 7/10) PLAN.md:66 — The Apps Script URL is public once deployed. The shared secret stops direct writes, but the /api/join endpoint is public too; without bot protection a script can fill the Sheet with junk in minutes. Reviewer: Claude. Remedy: R2.
3. [P2] (confidence: 6/10) PLAN.md:66 — Single point of failure: if Apps Script is down or over quota, sign-ups fail. Medium confidence, verify this is actually an issue: Apps Script consumer quotas allow tens of thousands of executions a day, far above a waitlist. Handled by the 502 retry path above; no remedy proposed beyond it. Reviewer: Claude.

Realistic production failure per path: Apps Script cold start > 15 s → 502 → page shows "Something went wrong, try again", values kept (handled, visible). Turnstile script blocked by an ad blocker → token missing → 400 verification → page explains and offers retry (handled once R2 decided).

### R6: Site URL and DNS
Finding: Section 1 #1, P1, confidence 7/10, PLAN.md:88, reviewer Claude
Plan baseline: original proposal, URL unspecified; R1 approved Cloudflare Pages (D3)
Runtime evidence: unknown; domain inrl.co inferred from Figma footer (P4 unverified), current DNS provider unknown
Comparison grid:

| Choice | Current | A | B | C |
|---|---|---|---|---|
| R6 URL | unspecified | waitlist.inrl.co | inrl.co (bare domain) | inrl-waitlist.pages.dev only |
| R6 DNS work | none | One CNAME at current DNS provider | Move nameservers to Cloudflare, recreate all records incl. MX | None |
| R6 existing home page | live, location unknown | Untouched | Replaced or moved | Untouched |
| R1 host | approved D3: Cloudflare Pages | same | same | same |
| R2-R5 | pending | pending | pending | pending |

Question D4:
D4 — What web address should the waitlist live on?
Project/branch/task: INRL waitlist on Cloudflare Pages (approved D3); the domain looks like inrl.co and a live home page already exists.
ELI10: Cloudflare gives every site a free address like inrl-waitlist.pages.dev. To use your own domain, a subdomain such as waitlist.inrl.co needs one DNS record added wherever inrl.co is managed today. Putting the waitlist on plain inrl.co instead means moving the whole domain's DNS to Cloudflare, which also carries your email settings and would replace the current home page.
Stakes if we pick wrong: Moving DNS carelessly can break contact@inrl.co email or take down the existing home page.
Recommendation: A because it is one DNS record, leaves email and the home page untouched, and still looks on-brand.
Completeness: A=9/10, B=9/10, C=6/10
Pros / cons:
A) waitlist.inrl.co (recommended)
  ✅ One CNAME record at your current DNS provider, about five minutes of work
  ✅ Home page and contact@inrl.co email stay exactly as they are today
  ❌ Slightly longer address to print on posters, shirts and social links
B) inrl.co itself
  ✅ Shortest, cleanest address for the launch campaign and printed shirts
  ✅ All DNS lives in Cloudflare afterwards, one dashboard to manage
  ❌ Nameserver move must copy every record, email and home page at risk
C) pages.dev address only for now
  ✅ Zero DNS work, live within minutes of the first deploy
  ✅ Custom domain can still be added later without code changes
  ❌ Unbranded address looks less trustworthy when asking for emails
Effort: A (human: ~15 min / CC: ~5 min), B (human: ~2h / CC: ~20 min plus your registrar login), C (none).
Net: one small DNS record buys a branded address without touching email or the existing site.
Header: D4 URL
Options:
A) waitlist.inrl.co (recommended)
Attach waitlist.inrl.co to the Pages project with one CNAME at the current DNS provider; home page and email untouched. R2-R5 stay pending.
B) inrl.co itself
Move inrl.co nameservers to Cloudflare, recreate every existing record including MX, and serve the waitlist on the bare domain, replacing the current home page there. R2-R5 stay pending.
C) pages.dev only for now
Launch on the free inrl-waitlist.pages.dev address with no DNS changes; a custom domain can be added later. R2-R5 stay pending.

State: approved
Actual answer: A) waitlist.inrl.co (recommended), D4 answered 2026-10-15
Accepted scope: Attach waitlist.inrl.co to the Pages project with one CNAME at the current DNS provider; home page and email untouched. R2-R5 stay pending.
History: none

### R2: Bot protection on /api/join
Finding: Section 1 #2, P2, confidence 7/10, PLAN.md:66, reviewer Claude
Plan baseline: original proposal PLAN.md:31-33 lists honeypot + Turnstile; not approved
Runtime evidence: none, nothing built
Comparison grid:

| Choice | Current | A | B | C |
|---|---|---|---|---|
| R2 honeypot field | proposed | yes | yes | no |
| R2 Turnstile | proposed | yes, managed (usually invisible) widget, verified in join.js | no | no |
| R2 extra secret | none | TURNSTILE_SECRET in Pages env | none | none |
| R1 / R6 | approved D3 / D4 | same | same | same |
| R3-R5 | pending | pending | pending | pending |

Question D5:
D5 — How much bot protection should the sign-up form have?
Project/branch/task: INRL waitlist on Cloudflare Pages at waitlist.inrl.co (D3, D4); /api/join is a public endpoint that writes the Google Sheet.
ELI10: Anyone can send fake sign-ups to a public form. A honeypot is a hidden field only bots fill in, which stops the dumbest scripts. Cloudflare Turnstile is a free check that runs quietly in the background (most people never see a puzzle) and stops smarter bots. Without either, a single script can bury your real sign-ups under thousands of junk rows.
Stakes if we pick wrong: A junk-filled Sheet means emailing fake addresses at launch and hurting your email sender reputation.
Recommendation: A because Turnstile is free, already on the Cloudflare account from D3, and the honeypot costs nothing.
Completeness: A=10/10, B=7/10, C=3/10
Pros / cons:
A) Honeypot + Turnstile (recommended)
  ✅ Stops both simple scripts and smarter bots before anything reaches the Sheet
  ✅ Free and mostly invisible to real visitors, no image puzzles to solve
  ❌ One more secret to set up; some strict ad blockers can block the widget
B) Honeypot only
  ✅ Zero setup and no third-party script loaded on the page at all
  ✅ Never blocks a real visitor, even with aggressive privacy extensions
  ❌ Targeted bots skip hidden fields easily, so junk rows remain possible
C) No protection
  ✅ Simplest possible form and endpoint code, nothing extra to maintain
  ✅ No chance of a real visitor ever being blocked by a check
  ❌ Anyone can flood the Sheet with junk using a short script
Effort: A (human: ~2h / CC: ~10 min), B (human: ~30 min / CC: ~3 min), C (none).
Net: a free background check plus a hidden field versus a cleaner page with a junk-row risk.
Header: D5 bots
Options:
A) Honeypot + Turnstile (recommended)
Hidden honeypot field (filled = silently dropped with 200) plus a managed Turnstile widget whose token join.js verifies with TURNSTILE_SECRET before forwarding; failure returns 400 and the page offers retry. R3-R5 stay pending.
B) Honeypot only
Hidden honeypot field (filled = silently dropped with 200); no Turnstile script or secret. R3-R5 stay pending.
C) No protection
No honeypot and no Turnstile; every valid submission is forwarded. R3-R5 stay pending.

State: pending
Actual answer: none. At D5 the user replied "no more question guide me how to setup the website first" (2026-10-15). Reviewer default applied for the build: A) Honeypot + Turnstile. Not user-approved; change before launch if wanted.
Accepted scope: none approved; build default = honeypot + Turnstile
History: none

### Remaining choices (not asked; user stopped questions at D5)
Reviewer defaults applied for the build, all pending user approval:
- R3 Duplicate emails: keep the first row, return success to the visitor (no "already signed up" leak), no second row.
- R4 Consent notice: one line under the button, "By joining you agree to receive emails about INRL. Unsubscribe anytime." plus a privacy link. INRL looks Denmark-based (+45 phone), so GDPR applies. Needs a privacy page URL from the brand.
- R5 Fonts: self-host Oxanium and Roboto (WOFF2) instead of loading Google Fonts, avoiding the EU Google Fonts IP-transfer issue and one third-party request.
- Tests: vitest for join.js branches, Playwright for submit / error / mobile flows.
- Hero video: H.264 MP4 under 8 MB, poster image, `muted autoplay playsinline loop`, `preload="metadata"`, still poster when `prefers-reduced-motion`.

Sections 2-4 and the outside voice were not run (user stopped the review to get the setup guide).

## Setup guide
See SETUP.md.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Outside Review | codex (not installed) | Independent 2nd opinion | 0 | skipped | review stopped before this phase |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | issues_open (partial) | 5 issues, 0 critical gaps; Scope + Section 1 done, Sections 2-4 not run |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | — |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **OUTSIDE COVERAGE:** codex, plan-review, skipped (user stopped the review at D5), no findings.
- **VERDICT:** NOT CLEARED — eng review partial (Sections 2-4 not run); eng review required.

**UNRESOLVED DECISIONS:**
- R2 bot protection: D5 unanswered (build default: honeypot + Turnstile)
- R3 duplicate emails: not asked (default: keep first row)
- R4 consent notice: not asked (default: one line + privacy link; privacy URL needed)
- R5 font hosting: not asked (default: self-host)
