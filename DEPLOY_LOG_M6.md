# M6 deploy log: 2026-10-11 (IST)

**Outcome: M6 is live.**

- API `38b435a` on Render, from `main`.
- Web `38b435a` on Vercel (bundle `index-CVfYKIHl.js`).
- Database at migration `0003_question_types`.

One incident on the first attempt: the API failed to start, with no impact on users. It was fixed and verified (see "Incident" below). Existing cards and review history are unchanged (checksums below).

## Steps

| Time (IST)  | Step                                          | Result                                                                                                                                                                                                                                                                                     |
| ----------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 01:04       | Start                                         | `main` = `a6a7380`, `m6-question-types` = `626837c` (7 commits ahead, fast-forward).                                                                                                                                                                                                       |
| 01:05       | **1. Neon restore branch**                    | **`before-m6`** (id `br-green-fog-b31lhwel`) forked from `production` in 0.87 s, with data and schema as of then. Auto-delete: **Never**.                                                                                                                                                  |
| 01:07       | Baseline (read-only SQL)                      | users 1, decks 3, cards 1054, review logs 29. Max `server_seq`: cards 1115, logs 1142. md5 cards `860cad83ffded91739e3f4b7ecae31cb`, logs `5e8a7c408c4408aaa18efa75e44ca188`, decks `8faa25d133fc3b72dec1e66599ed158f`.                                                                    |
| 01:07       | **2. Push**                                   | `m6-question-types` pushed (`626837c`).                                                                                                                                                                                                                                                    |
| 01:09–01:10 | Old-client setup                              | A separate Chromium profile ("browser B") was signed in on the old app (bundle `index-BrsgKSaR.js`, local DB v2). The sign-in email arrived 01:09.                                                                                                                                         |
| 01:11       | **3. Render → branch `m6-question-types`**    | Saving the branch started deploy `dep-db599jajnfac739m1ajg`.                                                                                                                                                                                                                               |
| 01:11:57    | Migration                                     | `0003_question_types` applied: "All migrations have been successfully applied."                                                                                                                                                                                                            |
| 01:12:00    | **Start failed**                              | `ERR_MODULE_NOT_FOUND …/src/generated/prisma/client.ts`, exit 1. Render kept the previous API live. **Stopped and reported.**                                                                                                                                                              |
| 01:12:14    | Old API restart                               | The previous build restarted (instance `42xsw`) on the migrated DB: "No pending migrations", listening. Old code on the new schema works in production.                                                                                                                                    |
| 01:12–01:15 | Checks                                        | `/health` 200. Browser B (old app) synced: push 200, pull 200. DB unchanged (see below).                                                                                                                                                                                                   |
| ~01:25      | Build fix                                     | Explicit `prisma generate` in the build command (`render.yaml`, `DEPLOY.md`, commit `38b435a`, pushed to the branch). Reproduced the failure locally with a warm `node_modules`; the new command generates the client and the API starts. Render's Build Command updated in the dashboard. |
| 01:28       | **Stale-content check, before the switch**    | 0 basic cards with stale `content` since the migration; 0 overall; 0 without content; 0 cards changed since the baseline.                                                                                                                                                                  |
| 01:29       | Deploy `dep-db59i4flot8c73e69ok0` (`38b435a`) | Started by saving the build command. **Cached build**: install skipped ("Done in 44ms"), then `prisma generate` ran. 3 migrations, none pending. API listening. **Live** about 01:31.                                                                                                      |
| 01:31       | Old client vs new API                         | Browser B (old app) pushes → **426** on every attempt; nothing written. Its UI shows "Couldn't sync · retrying" (the old app has no 426 handling).                                                                                                                                         |
| ~01:32      | **Stale-content check, after the switch**     | 0 / 0 / 0, no changes since the baseline. **No repair needed**, so the repair script wasn't run.                                                                                                                                                                                           |
| 01:34       | **Cached redeploy check**                     | Manual Deploy → "Deploy latest commit" (`dep-db59kkajnfac739n4ao0`): install skipped ("Done in 41ms"), `prisma generate` ran, **Deploy succeeded, service live**.                                                                                                                          |
| 01:36       | **4. Merge into `main`**                      | Fast-forward `a6a7380..38b435a`, pushed. Vercel production live at **01:36:43**, bundle `index-CVfYKIHl.js` (M6 strings present).                                                                                                                                                          |
| 01:37       | **5. Render → `main`**                        | Deploy `dep-db59m2rrjlhs73cthiq0` (`38b435a`): **Deploy succeeded** (a third cached build).                                                                                                                                                                                                |
| 01:38       | Existing user upgrade                         | Your Chrome (old version, "Couldn't sync · retrying") offered "Update available — reload". After Reload: new bundle, local DB v3, **Synced**.                                                                                                                                              |
| 01:39–01:41 | **6. Second browser**                         | A fresh profile ("browser A") requested a link from the new version. **The sign-in email arrived at 01:39.** It created deck "M6 deploy check" with one card of each type through the editor, then Synced.                                                                                 |
| 01:45       | **6. First browser upgrades and pulls**       | Browser B took the update banner: its last old push got 426, then the new bundle, DB v3, push 200, one-time re-pull, Synced.                                                                                                                                                               |
| 01:45       | **6. Comparison**                             | 5 of 5 typed cards **identical** in A and B (id, type, full content, front, back).                                                                                                                                                                                                         |
| 01:45       | **6. Data check**                             | See below: existing cards and history identical.                                                                                                                                                                                                                                           |
| 01:45       | Cleanup                                       | Browsers B and A signed out through the app: `POST /auth/logout` → 204. Replaying each old session cookie → **401** (server session deleted). 0 cookies left. Profiles `profile-A` and `profile-B` deleted.                                                                                |

## Database checks (read-only SQL on `production`)

|                                                   | Baseline 01:07    | After migration 01:15 | After deploy 01:45                          |
| ------------------------------------------------- | ----------------- | --------------------- | ------------------------------------------- |
| pre-existing cards (seq ≤ 1115): count, md5       | 1054, `860cad83…` | 1054, `860cad83…`     | 1054, **`860cad83…`**                       |
| pre-existing review logs (seq ≤ 1142): count, md5 | 29, `5e8a7c40…`   | 29, `5e8a7c40…`       | 29, **`5e8a7c40…`**                         |
| total cards / logs                                | 1054 / 29         | 1054 / 29             | 1059 / 31                                   |
| card types                                        | n/a               | basic 1054            | basic 1055, mcq 1, cloze 1, short 1, long 1 |
| basic cards with stale `content`                  | n/a               | 0                     | 0                                           |
| migrations                                        | 0001, 0002        | 0001–0003             | 0001–0003                                   |

The 5 new cards are the "M6 deploy check" deck. The 2 new review logs didn't come from these checks; probably your own study in an app tab opened during the deploy.

## Incident: the API didn't start on the first deploy

- **What happened:** the migration applied (01:11:57), then the new API crashed on start with `Cannot find module '…/apps/api/src/generated/prisma/client.ts'`. Render didn't switch traffic, so the previous API stayed live.
- **Cause:** the Prisma client is generated into `apps/api/src/generated/` (git-ignored) only by the API's `postinstall`. Render restored its build cache, pnpm found nothing to install ("Lockfile is up to date… Done in 41ms"), so `postinstall` didn't run. The first-ever deploy worked because it was a full install. This was already in the pipeline before M6; any cached redeploy, `main` included, would have failed.
- **Impact: none.**
  - Traffic stayed on the previous API, which works on the migrated schema; that was tested beforehand and seen live at 01:12:14.
  - Old clients kept syncing (browser B: push and pull 200).
  - No stale rows were written in the mixed-version window (0 before and after the switch).
- **Fix:** the build command now runs `prisma generate` explicitly: `npx --yes pnpm@12.6.0 install --frozen-lockfile && npx --yes pnpm@12.6.0 --filter @recall/api prisma:generate`. It's in `render.yaml` (the service is Blueprint-managed), in the Render dashboard and in `DEPLOY.md`.
- **How the cached path is now covered:**
  - Reproduced locally first: a fresh clone, a warm `node_modules` and no generated client. The old command leaves the client missing; the new one generates it and the API starts.
  - On Render, all three deploys after the fix restored the cache, skipped the install and started cleanly: 01:29 (build-command change), 01:34 (explicit "Deploy latest commit" with cache) and 01:37 (branch back to `main`).
- **Process change:** `DEPLOY.md` → "Updating" now:
  - describes how Render really deploys (manually, or on a settings change; failed deploys keep the old instance);
  - adds a standard step for migrations that add a source-of-truth column: a read-only stale-row check right before and after the switch, and a repair under the per-user sync lock if it's not 0.

## Secrets

**None rotated during this deploy.** By your decision, the Resend API key (`RESEND_API_KEY`) and the Neon role password (in `DATABASE_URL`) will be rotated after testing. No secret values were printed, logged or written to a file. The two magic links used were single-use and have been consumed. Both test sessions were deleted on the server.

## Anything odd

- **The old app can't show "Update required to sync".** A tab still on the old version sees the 426 as a generic "Couldn't sync · retrying" and retries. It doesn't lose data: its changes stay local and sync once it reloads (shown with browser B and your Chrome). The new message protects _future_ protocol changes; its UI is covered by the E2E test `question-types.spec.ts` › "426: …".
- **Render starts a deploy when you save the Branch or the Build Command.** That happened three times here.
- **Render shows the GitHub repo as the source, but its build log says it lacks access and clones the public URL.** Pushes don't trigger deploys.
- **An unauthenticated probe can't tell API versions apart:** auth is checked before the protocol version, so both get 401. Use a signed-in old client, as above.
- **Typing long text into Neon's SQL editor through browser automation timed out each time.** The text still arrived complete, and it was read back before every run.
- **Render banner:** infrastructure maintenance on 2026-10-14, 06:30 IST.
- **Left in place on purpose:**
  - the "M6 deploy check" deck in your account (5 cards; delete it whenever you like);
  - the Neon branch `before-m6`;
  - the `m6-question-types` branch on GitHub.
