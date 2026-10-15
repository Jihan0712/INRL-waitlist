# INRL Waitlist

One-page waitlist for INRL at `waitlist.inrl.co`. Sign-ups land in the Google Sheet "INRL Waitlist".
Design: Figma `INRL - FINAL` → `SIGNUP · EARLY ACCESS`. Plan and decisions: [PLAN.md](PLAN.md). Going live: [SETUP.md](SETUP.md).

```
public/            the site (static): index.html, styles.css, app.js, countries.js, _headers, assets/
functions/api/     join.js, the POST /api/join endpoint (Cloudflare Pages Function)
apps-script/       Code.gs, pasted into the Sheet's Apps Script editor
tests/             vitest unit tests (*.test.js) and Playwright browser tests (*.spec.js)
```

## Commands

```bash
npm install          # once
npm run fonts        # copies self-hosted fonts into public/assets/fonts (already done; rerun after npm updates)
npm test             # unit tests: the endpoint and the Apps Script
npm run e2e          # browser tests, desktop + mobile (first time: npx playwright install chromium)
npm run dev          # local site + function on http://localhost:8788 (needs .dev.vars, copy .dev.vars.example)
```

Deploys: Cloudflare Pages builds from the GitHub repo (SETUP step 8). Every push to `main` goes live.
`npm run deploy` (wrangler) still works as a manual fallback.

## Before launch

- [x] Real Turnstile site key is in `public/index.html`. `TURNSTILE_SECRET` in Cloudflare must be the matching real secret.
- [x] Confirmation photo added (original kept in `source-assets/`).
- [ ] Large originals go in `source-assets/` (git-ignored). Never put files over 25 MB in `public/`: Pages rejects them and GitHub rejects files over 100 MB.
- [x] INRL logo SVG is in the headers (`public/assets/img/inrl-logo.svg` is the original).
- [ ] Put the exact colour hex values in the `:root` tokens in `styles.css` (current ones are estimates).
- [ ] Confirm the privacy policy URL (`https://inrl.co/privacy` is a guess) and where "Back to the site" should go (currently https://inrl.co).
