# INRL Waitlist: Setup Guide

Where everything ends up:

```
waitlist.inrl.co  ──►  Cloudflare Pages (the website, free)
                          │  form submit
                          ▼
                       /api/join (small Cloudflare function)
                          │
                          ▼
                       Google Apps Script  ──►  Google Sheet "INRL Waitlist"
```

Part 1 is accounts and keys, which you can do today. Part 2 needs the website code, so do it after the build.
Write each key, URL and secret into a password manager as you go. Never paste them into chat, the code, or Figma.

---

## Part 1: Do this now (about 30 minutes)

### 1. Install Node.js (once per computer)
- Download the **LTS** version from https://nodejs.org and install it with the default options.
- Check it worked. In a terminal, run `node -v`. It should print a version number.

### 2. Create a free Cloudflare account
- Go to https://dash.cloudflare.com/sign-up and sign up with the brand's shared email (not a personal one), so the team keeps access.
- Choose the **Free** plan if it asks. You do **not** need to add inrl.co to Cloudflare. We only use a subdomain.

### 3. Create the Turnstile widget (bot protection)
- In the Cloudflare dashboard, open **Turnstile** in the sidebar, then click **Add widget**.
- Widget name: `INRL waitlist`.
- Hostnames: add `waitlist.inrl.co`. Also add the `inrl-waitlist.pages.dev` address once it exists (step 8).
- Widget mode: **Managed**.
- Save. Copy the **Site key** (public) and the **Secret key** (private) into your password manager.

### 4. Create the Google Sheet
- Sign in to the Google account that should own the sign-up data (the brand account, not a personal one).
- Go to https://sheets.new.
- Rename the file to `INRL Waitlist`.
- Rename the first tab (bottom left) to `Signups`.
- In row 1, type these headers, one per column, starting at A1:
  `Timestamp` | `First name` | `Last name` | `Country` | `Email` | `Source`
- Share it only with the people who need it. It holds personal data.

### 5. Make a shared secret
This is a long random password that lets only your website write to the Sheet.
- In a terminal, run this command:
  `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
- Save the output in your password manager as `SHEET_SHARED_SECRET`.

### 6. Check the inrl.co DNS at Crazy Domains
inrl.co is registered with **Crazy Domains**. Before anything else, check where its DNS is actually edited:
1. Log in at https://www.crazydomains.com → **My Account** → **Domains** → click **inrl.co**.
2. Look at the **Nameservers** for the domain.
   - If they are Crazy Domains' own nameservers (names containing `crazydomains`), you add the record in Crazy Domains (step 11).
   - If they point somewhere else (for example Shopify, Squarespace, Wix or your web host), the DNS is managed **there**, so add the step 11 record in that service instead. Crazy Domains changes would do nothing.
3. Don't change the nameservers. Step 11 adds **one** record and nothing else, so email and the current home page stay untouched.

### 7. Get these from the designer (Figma edit access)
- Export images at 2x as WebP or JPG: the hero poster, the form photo and the confirmation photo.
- The INRL wordmark as SVG.
- Exact colour hex values: teal button, dark footer, text colour.
- The hero film when it's ready: MP4 (H.264), 15 seconds, under 8 MB.
- A privacy policy URL. The form needs a consent line that links to it (GDPR).

---

## Part 2: After the code is built

### 8. Create the Pages project in the Cloudflare dashboard
You set this up by hand in the dashboard, and Cloudflare builds the site from a GitHub repository.
Don't use the dashboard's **Upload assets** (drag-and-drop) option. It skips the `functions/` folder, so the form would look fine but no sign-up would ever be saved.

**A. Put the code on GitHub**
1. In `public/index.html`, replace the Turnstile test key `1x00000000000000000000AA` with your **Site key** from step 3, then commit it:
   ```bash
   git commit -am "Use production Turnstile site key"
   ```
2. Sign in to GitHub (or create a free account) and go to https://github.com/new.
   - Repository name: `inrl-waitlist`
   - Visibility: **Private**
   - Leave "Add a README", ".gitignore" and "license" **off**. The project already has them.
3. Push the code, replacing `YOUR-USERNAME`. First add GitHub as the remote:
   ```bash
   git remote add origin https://github.com/YOUR-USERNAME/inrl-waitlist.git
   ```
   Then push:
   ```bash
   git push -u origin main
   ```

**B. Connect it in Cloudflare**
1. Cloudflare dashboard → **Workers & Pages** → **Create application**. That screen makes a **Worker** by default, which is the wrong type: you would end up with a `….workers.dev` address and a blank 404 site. Instead, click the small link at the bottom, **"Looking to deploy Pages? Get started"**, then **Import an existing Git repository** → **Get started**.
   - If you already made a Worker by mistake, delete it first: open it → **Settings** → **Delete**.
2. Connect your GitHub account. When GitHub asks which repositories to allow, choose **Only select repositories** → `inrl-waitlist`.
3. Pick `inrl-waitlist` → **Begin setup**, and fill in:
   - Project name: `inrl-waitlist` (this becomes `inrl-waitlist.pages.dev`; if Cloudflare adds a suffix because the name is taken, use that address in steps 3 and 11)
   - Production branch: `main`
   - Framework preset: **None**
   - Build command: leave **empty**
   - Build output directory: `public`
   - Root directory: leave **empty**
4. **Save and Deploy**. The first deploy takes about a minute. The site is then live at `https://inrl-waitlist.pages.dev`. The form won't save sign-ups until steps 9 and 10 are done.
5. Check that it worked:
   - The address ends in **`.pages.dev`**, not `.workers.dev`.
   - `https://inrl-waitlist.pages.dev` shows the waitlist page.
   - `https://inrl-waitlist.pages.dev/api/join` opened in a browser shows **"Method Not Allowed"** (status 405). That means the sign-up function is deployed. If you see a plain 404 page instead, the function didn't deploy: re-check that the build output directory is `public` and that you used Git, not Upload assets.

From now on, every `git push` to `main` redeploys the site automatically.
The project's `wrangler.toml` also names `public` as the output folder. If Cloudflare shows a build setting as "managed by wrangler.toml", that's expected.

### 9. Add the Apps Script to the Sheet
1. In the Sheet: **Extensions → Apps Script**.
2. Delete the sample code and paste in the contents of `apps-script/Code.gs`. Save.
3. **Project Settings** (gear icon) → **Script properties** → add `SHARED_SECRET` = the value from step 5.
4. **Deploy → New deployment** → type **Web app**:
   - Execute as: **Me**
   - Who has access: **Anyone**
5. Click **Deploy** and approve the permissions. Google warns "Google hasn't verified this app". That's normal for your own script: click **Advanced → Go to (project name)**.
6. Copy the **Web app URL** (it ends in `/exec`).

### 10. Add the secrets to Cloudflare
Go to Cloudflare dashboard → **Workers & Pages** → `inrl-waitlist` → **Settings → Variables and Secrets**. Add these for **Production**, each set to **Secret** (encrypted):

| Name | Value |
|---|---|
| `TURNSTILE_SECRET` | Turnstile secret key (step 3) |
| `APPS_SCRIPT_URL` | Web app URL (step 9) |
| `SHEET_SHARED_SECRET` | Shared secret (step 5) |

Then go to the **Deployments** tab, open the **⋯** menu on the latest deployment and click **Retry deployment**, so the function picks up the secrets.

### 11. Connect waitlist.inrl.co
Order matters here. Add the domain in Cloudflare first, then the DNS record, or the site shows an error.
1. In Cloudflare: `inrl-waitlist` → **Custom domains → Set up a custom domain**, enter `waitlist.inrl.co`, and continue.
2. In Crazy Domains (or wherever step 6 showed the DNS lives): **My Account → Domains → inrl.co → DNS Settings** (sometimes labelled **Manage DNS**), then **Add Record** and enter:
   - Type: `CNAME`
   - Host / Name: `waitlist` (just the word, not the full `waitlist.inrl.co`)
   - Points to / Value: `inrl-waitlist.pages.dev`
   - TTL: leave the default
   If Crazy Domains says a record for `waitlist` already exists, stop and check what it is before you replace it.
3. Wait until Cloudflare shows the domain as **Active**. This usually takes minutes but can take up to a few hours. HTTPS is set up automatically.

### 12. Test it live
1. Open https://waitlist.inrl.co on your phone and on a laptop.
2. Sign up with a real email. The page should switch to "YOU'RE ON THE LIST." and a new row should appear in the Sheet within seconds.
3. Sign up again with the same email. There should still be only one row.
4. Try a broken email (like `abc@`). You should get an inline error and no new row.
5. Delete your test rows from the Sheet before launch.

---

## If something goes wrong

| Symptom | Likely cause | Fix |
|---|---|---|
| "Something went wrong" on submit | `APPS_SCRIPT_URL` or `SHEET_SHARED_SECRET` wrong or missing | Recheck step 10 values, then **Retry deployment** (end of step 10) |
| Rows never appear but no error shows | Apps Script deployed with access other than "Anyone" | Redo step 9.4 as a **new deployment**, then update the URL in step 10 |
| "Verification failed" | Hostname missing from the Turnstile widget | Add the domain in step 3 |
| waitlist.inrl.co shows error 522 | CNAME was added before the custom domain was set up in Pages | Do step 11.1, then wait |
| The site address ends in `.workers.dev` and shows a 404 | A Worker was created instead of a Pages project | Delete the Worker and redo step 8B using the "Looking to deploy Pages?" link |
| You edited Code.gs but nothing changed | Apps Script serves the old deployment | **Deploy → Manage deployments → Edit → Version: New version** |
