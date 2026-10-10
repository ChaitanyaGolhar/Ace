# Deploying Recall for test users

**Live since 2026-10-10:**

- **App:** https://ace.orizenn.com, on Vercel (project `ace`). It redeploys on every push to `main`.
- **API:** https://api.ace.orizenn.com, on Render (service `recall-api`; also `recall-api-4oyb.onrender.com`).
- **Database:** Neon project `ace-recall`, in Singapore.
- **Email:** sent from `Recall <login@contact.orizenn.com>`, using the Resend domain `contact.orizenn.com` that was already verified.
- **DNS:** CNAMEs `ace` and `api.ace` in Cloudflare, DNS only.

Render was created from the public repo URL without a GitHub link, so it doesn't redeploy on push. Use **Manual Deploy** in the Render dashboard, or connect GitHub there.

The rest of this file is the original step-by-step guide.

| Part           | Where         | Address                       |
| -------------- | ------------- | ----------------------------- |
| Web app (PWA)  | Vercel        | `https://ace.orizenn.com`     |
| API            | Render (free) | `https://api.ace.orizenn.com` |
| Postgres       | Neon (free)   | —                             |
| Sign-in emails | Resend (free) | sent from `login@orizenn.com` |

**Why `api.ace.orizenn.com` for the API:** the session cookie is set by the API. Browsers only send it with the app's requests when the app and the API are on the same site. Both are under `orizenn.com`, so they are; `*.vercel.app` and `*.onrender.com` are not, and sign-in would silently fail in Safari and in Chrome with third-party cookies blocked.

**DNS records you'll add at the registrar for `orizenn.com`** (nothing existing on `orizenn.com` changes):

| Name                        | Type     | Value                                            | For            |
| --------------------------- | -------- | ------------------------------------------------ | -------------- |
| `ace`                       | CNAME    | given by Vercel (e.g. `cname.vercel-dns.com`)    | the web app    |
| `api.ace`                   | CNAME    | given by Render (e.g. `recall-api.onrender.com`) | the API        |
| `send`, `resend._domainkey` | MX / TXT | given by Resend                                  | sign-in emails |

Resend's records live on their own names (`send.orizenn.com`, `resend._domainkey.orizenn.com`), so nothing else on `orizenn.com` changes. Checked on 2026-10-10 (public DNS):

- `orizenn.com` has no MX records.
- `ace.orizenn.com` is free.
- `orizenn.com` already has a DMARC policy (`p=quarantine`, relaxed alignment). It works with Resend's DKIM as is, so **don't add a second `_dmarc` record** if Resend suggests one.

The DNS is on **Cloudflare**. Add the `ace` and `api.ace` CNAMEs as **DNS only** (grey cloud): Vercel and Render issue their own certificates and need to see the traffic directly.

Nothing here needs code changes: the config is in [`render.yaml`](./render.yaml) and [`apps/web/vercel.json`](./apps/web/vercel.json). The same setup was rehearsed locally from a fresh clone: frozen install, production web build, and Render's start command against an empty database (migrations applied, health OK, CORS only for the app origin).

## 1. Resend (do this first: DNS can take a while)

1. Create an account at resend.com.
2. **Domains → Add domain → `orizenn.com`.** Region: the nearest one (e.g. `ap-northeast-1`/Tokyo, or whichever Resend offers closest to India).
3. Add the DNS records Resend shows (MX + TXT on `send`, TXT on `resend._domainkey`) in Cloudflare, as DNS only. Skip DMARC: one already exists. Wait until Resend shows **Verified**.
4. **API Keys → Create** with _Sending access_, limited to that domain. Copy the key (`re_…`). You'll paste it into Render; don't commit it or send it in chat.

## 2. Neon (Postgres)

1. Create an account at neon.tech → **New project**: name `recall`, Postgres 17, region **AWS Asia Pacific (Singapore)** (same region as the Render service).
2. **Connection details** → choose the **direct** connection (turn _Connection pooling_ **off**). Copy the string. It looks like
   `postgresql://USER:PASSWORD@ep-xxxx.ap-southeast-1.aws.neon.tech/neondb?sslmode=require`.
   Direct, because migrations take a session-level lock that a transaction pooler breaks. Traffic from a test group is tiny.

## 3. Render (API)

1. Create an account at render.com and connect GitHub (allow access to `ChaitanyaGolhar/Ace`).
2. **New → Blueprint** → pick the `Ace` repo. Render reads `render.yaml` and proposes the `recall-api` service. Fill in:

   | Variable         | Value                         |
   | ---------------- | ----------------------------- |
   | `DATABASE_URL`   | the Neon string from step 2   |
   | `WEB_ORIGIN`     | `https://ace.orizenn.com`     |
   | `API_ORIGIN`     | `https://api.ace.orizenn.com` |
   | `RESEND_API_KEY` | the key from step 1           |
   | `MAIL_FROM`      | `Recall <login@orizenn.com>`  |

   The others (`MAIL_MODE=resend`, `COOKIE_SECURE=true`, `TRUST_PROXY=true`, `NODE_VERSION=24`) are already in the file.

3. **Apply.** The first build takes a few minutes. The start command applies the database migrations, then starts the API. The log should end with `API listening … (mail: resend)`.
4. **Settings → Custom Domains → Add `api.ace.orizenn.com`.** Render shows a CNAME target (`recall-api.onrender.com`). Add that CNAME at your registrar and wait until Render shows it verified, with a certificate.
5. Check: `https://api.ace.orizenn.com/health` → `{"ok":true}`.

The Build Command is `npx --yes pnpm@12.6.0 install --frozen-lockfile`: Render's build image has a read-only `/usr/bin`, so `corepack enable` fails there.

## 4. Vercel (web app)

1. Create an account at vercel.com with GitHub → **Add New → Project** → import `Ace`.
2. **Root Directory: `apps/web`.** Leave "Include files outside the root directory" on: the build uses `packages/core` and `content/decks`. Framework, install and build commands come from `apps/web/vercel.json`.
3. **Environment Variables** (Production):

   | Variable                       | Value                                   |
   | ------------------------------ | --------------------------------------- |
   | `VITE_API_URL`                 | `https://api.ace.orizenn.com`           |
   | `ENABLE_EXPERIMENTAL_COREPACK` | `1` (so Vercel uses the repo's pnpm 12) |

   Node.js version (Settings → Build and Deployment): **24.x**.

4. **Deploy.**
5. **Settings → Domains → Add `ace.orizenn.com`.** Add the CNAME Vercel shows (`cname.vercel-dns.com`) at your registrar.

`VITE_API_URL` is baked in at build time. If you change it, redeploy.

## 5. Check it end to end (5 minutes)

1. Open `https://ace.orizenn.com` → welcome screen → **Add & start** → study a few cards.
2. Settings → **Sign in to sync** → your email → the email arrives from `login@orizenn.com` → open the link → back in Settings: "Signed in as …" and **Synced**.
3. Open the app on your phone, sign in with the same email → your deck and progress appear.
4. Install it: Chrome's "Install app", or Safari → Share → Add to Home Screen.

If sign-in fails, Render's **Logs** show the reason, for example `Resend returned 403: The domain is not verified.`

## 6. Inviting testers

Just send them `https://ace.orizenn.com`.

- No account is needed to study. Everything works offline on their device.
- They sign in only if they want sync or a second device. There are no passwords: they get a link by email.
- Their product events (app opened, sessions, first review, …) reach your database once they sign in. Events never contain card text.

**Free-tier behaviour to expect:**

- Render's free API sleeps after ~15 min idle. The first sign-in or sync after that waits ~30–60 s. Studying is never blocked: the app is local-first and syncs in the background.
- Neon suspends when idle and wakes in about a second.
- Resend's free plan allows 100 emails/day.

## 7. Reading the analytics

Neon console → **SQL Editor** → paste a query from [`apps/api/analytics.sql`](./apps/api/analytics.sql):

- time to first review;
- D1/D7/D30 return;
- weekly active learners;
- session completion;
- true retention.

`return_rate` takes one parameter: replace `$1` with the current time in epoch ms (`select (extract(epoch from now()) * 1000)::bigint;`). Definitions and caveats: DECISIONS D-314 and D-316.

## Updating

Push to `main`: Render and Vercel both redeploy automatically, and Render applies any new migrations on start.

Before pushing, run `pnpm check` and `pnpm e2e` locally.
