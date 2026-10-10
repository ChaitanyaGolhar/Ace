# Deploying Recall for test users

| Part           | Where         | Address                      |
| -------------- | ------------- | ---------------------------- |
| Web app (PWA)  | Vercel        | `https://app.YOURDOMAIN`     |
| API            | Render (free) | `https://api.YOURDOMAIN`     |
| Postgres       | Neon (free)   | —                            |
| Sign-in emails | Resend (free) | sent from `login@YOURDOMAIN` |

**Why two subdomains of your own domain:** the session cookie is set by the API. Browsers only send it with the app's requests when the app and the API are on the same site. `app.` and `api.` of one domain are the same site; `*.vercel.app` and `*.onrender.com` are not, and sign-in would silently fail in Safari and in Chrome with third-party cookies blocked.

Replace `YOURDOMAIN` below with your domain (for example `recall.study` or `chaitanya.dev`).

Nothing here needs code changes: the config is in [`render.yaml`](./render.yaml) and [`apps/web/vercel.json`](./apps/web/vercel.json). The same setup was rehearsed locally from a fresh clone: frozen install, production web build, and Render's start command against an empty database (migrations applied, health OK, CORS only for the app origin).

## 1. Resend (do this first: DNS can take a while)

1. Create an account at resend.com.
2. **Domains → Add domain → `YOURDOMAIN`.** Region: the nearest one (e.g. `ap-northeast-1`/Tokyo, or whichever Resend offers closest to India).
3. Add the DNS records Resend shows (MX + TXT for SPF, TXT for DKIM, optional DMARC) at your domain registrar. Wait until Resend shows **Verified**.
4. **API Keys → Create** with _Sending access_, limited to that domain. Copy the key (`re_…`). You'll paste it into Render; don't commit it or send it in chat.

## 2. Neon (Postgres)

1. Create an account at neon.tech → **New project**: name `recall`, Postgres 17, region **AWS Asia Pacific (Singapore)** (same region as the Render service).
2. **Connection details** → choose the **direct** connection (turn _Connection pooling_ **off**). Copy the string. It looks like
   `postgresql://USER:PASSWORD@ep-xxxx.ap-southeast-1.aws.neon.tech/neondb?sslmode=require`.
   Direct, because migrations take a session-level lock that a transaction pooler breaks. Traffic from a test group is tiny.

## 3. Render (API)

1. Create an account at render.com and connect GitHub (allow access to `ChaitanyaGolhar/Ace`).
2. **New → Blueprint** → pick the `Ace` repo. Render reads `render.yaml` and proposes the `recall-api` service. Fill in:

   | Variable         | Value                       |
   | ---------------- | --------------------------- |
   | `DATABASE_URL`   | the Neon string from step 2 |
   | `WEB_ORIGIN`     | `https://app.YOURDOMAIN`    |
   | `API_ORIGIN`     | `https://api.YOURDOMAIN`    |
   | `RESEND_API_KEY` | the key from step 1         |
   | `MAIL_FROM`      | `Recall <login@YOURDOMAIN>` |

   The others (`MAIL_MODE=resend`, `COOKIE_SECURE=true`, `TRUST_PROXY=true`, `NODE_VERSION=24`) are already in the file.

3. **Apply.** The first build takes a few minutes. The start command applies the database migrations, then starts the API. The log should end with `API listening … (mail: resend)`.
4. **Settings → Custom Domains → Add `api.YOURDOMAIN`.** Render shows a CNAME target (`recall-api.onrender.com`). Add that CNAME at your registrar and wait until Render shows it verified, with a certificate.
5. Check: `https://api.YOURDOMAIN/health` → `{"ok":true}`.

If the build fails at `corepack enable`, set the Build Command to `npx --yes pnpm@12.6.0 install --frozen-lockfile` instead.

## 4. Vercel (web app)

1. Create an account at vercel.com with GitHub → **Add New → Project** → import `Ace`.
2. **Root Directory: `apps/web`.** Leave "Include files outside the root directory" on: the build uses `packages/core` and `content/decks`. Framework, install and build commands come from `apps/web/vercel.json`.
3. **Environment Variables** (Production):

   | Variable                       | Value                                   |
   | ------------------------------ | --------------------------------------- |
   | `VITE_API_URL`                 | `https://api.YOURDOMAIN`                |
   | `ENABLE_EXPERIMENTAL_COREPACK` | `1` (so Vercel uses the repo's pnpm 12) |

   Node.js version (Settings → Build and Deployment): **24.x**.

4. **Deploy.**
5. **Settings → Domains → Add `app.YOURDOMAIN`.** Add the CNAME Vercel shows (`cname.vercel-dns.com`) at your registrar.

`VITE_API_URL` is baked in at build time. If you change it, redeploy.

## 5. Check it end to end (5 minutes)

1. Open `https://app.YOURDOMAIN` → welcome screen → **Add & start** → study a few cards.
2. Settings → **Sign in to sync** → your email → the email arrives from `login@YOURDOMAIN` → open the link → back in Settings: "Signed in as …" and **Synced**.
3. Open the app on your phone, sign in with the same email → your deck and progress appear.
4. Install it: Chrome's "Install app", or Safari → Share → Add to Home Screen.

If sign-in fails, Render's **Logs** show the reason, for example `Resend returned 403: The domain is not verified.`

## 6. Inviting testers

Just send them `https://app.YOURDOMAIN`.

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
