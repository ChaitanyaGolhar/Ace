# Decisions log (overnight run, M1–M4)

Decisions the brief did not cover, made without being able to ask. Each entry: what,
why, alternatives, how to reverse. Newest entries are appended at the end of each
milestone section.

## General

### D-001 docker-compose Postgres on port 54329, not 5432

- **What:** `docker-compose.yml` maps Postgres to host port 54329.
- **Why:** a local PostgreSQL 18 service already listens on 5432 on this machine.
- **Alternatives:** stop the local service; use the local install instead of Docker.
- **Reverse:** change the port in `docker-compose.yml` and the `DATABASE_URL`s in `.env.example` / test configs.

### D-002 Tooling caches outside the repo

- **What:** `npx playwright install chromium` downloaded Playwright's Chromium build (v1248) into the user-level cache `%LOCALAPPDATA%\ms-playwright`; pnpm uses its usual global store. Nothing else outside the repo was touched.
- **Why:** Playwright 1.64 needs that exact browser build to run the E2E tests; there is no in-repo alternative.
- **Alternatives:** none practical (E2E is required by the brief).
- **Reverse:** delete the `chromium_headless_shell-1248` / `chromium-1248` folders from `%LOCALAPPDATA%\ms-playwright`.

## M1 — Local-only PWA

### D-101 `uuid` package for UUID v7 (new dependency)

- **What:** `apps/web` depends on `uuid` (`v7()`) for client-generated ids.
- **Why:** §4 requires UUID v7 on the client; `uuid` is small, dependency-free and the de-facto standard. Ids are only generated at the edge (`main.tsx`); services receive a `newId()` function so tests use predictable ids.
- **Alternatives:** hand-written v7 generator (~20 lines, but crypto/monotonicity details are easy to get wrong).
- **Reverse:** replace the one call in `src/main.tsx`.

### D-102 `zod` also used directly in `apps/web`

- **What:** web depends on `zod` (already in §4 for core/API) to validate settings.
- **Why:** settings are web-only, so their schema doesn't belong in `core`.
- **Reverse:** move `SettingsSchema` into core and import it from there.

### D-103 Time zone setting = browser time zone, no UI

- **What:** `settings.timeZone` is `null` by default, meaning "use the browser's time zone, resolved at each start". Settings shows it read-only. It can be set programmatically (validated as an IANA zone).
- **Why:** §7.1 says default to the browser time zone; §10 lists no time-zone control. Resolving at runtime means travelling just works.
- **Alternatives:** store the browser zone on first launch (then it would go stale when travelling); add a picker.
- **Reverse:** add a select to `SettingsScreen` bound to `updateSettings({ timeZone })`.

### D-104 Text is trimmed; inner line breaks kept

- **What:** deck names and card front/back are stored with surrounding whitespace trimmed; empty-after-trim is rejected with a user-facing message. Line breaks inside the text are preserved.
- **Why:** trailing newlines/spaces are almost always accidental and make search and display messy.
- **Reverse:** remove `.trim()` in `services/cards.ts` / `services/decks.ts`.

### D-105 Deleted rows can't be edited

- **What:** `renameDeck` / `updateCard` / `createCard` (into a deleted deck) throw `NotFoundError` for tombstoned rows; deleting twice keeps the first `deletedAt`.
- **Why:** tombstones are sticky (invariant 9); an edit after a delete would be silently lost on every merge anyway.
- **Reverse:** n/a — follows from invariant 9.

### D-106 Study sessions

- **What:** `meta.session = { startedAt, deckId, completedAt? }`. Opening the review screen continues the stored session if it is for the same deck, in the same study day, and not completed; otherwise starts a new one. The session-complete screen marks it completed (idempotent, so a reload or React StrictMode's double effect shows the same summary). "Reviewed" and "time spent" = this device's non-voided logs since `startedAt` (time spent = sum of `durationMs`). Undo only voids this device's logs from the current session.
- **Why:** §10 says the session is reconstructed from the queue; only a start time is needed for the summary and undo scope.
- **Alternatives:** time spent = wall-clock since start (counts idle time); session state in React only (lost on reload).
- **Reverse:** `services/session.ts`.

### D-107 Session order and the card on screen

- **What:** next card = first due card (review due today / learning due now, by due), else first allowed new card, else the learn-ahead card. The card on screen stays put until it is rated, even if the queue reorders. After a rating/undo the screen waits for a queue snapshot that includes the write (detected by a change in the review-log count/voided-count fingerprint) before showing the next card.
- **Why:** without the wait, the stale snapshot briefly re-showed the just-rated card and it could be rated twice (caught by the reload E2E test).
- **Reverse:** `features/review/useReview.ts`.

### D-108 Undo toast for card delete: 5 s, Dismiss commits, leaving commits

- **What:** deleting a card hides it immediately and shows "Card deleted [Undo] [×]" for 5 s. Undo cancels the pending tombstone write; the timeout or Dismiss writes it; `pagehide` (closing/leaving the page) writes all pending tombstones.
- **Why:** §7.2 (delayed tombstone). 5 s is a common toast length.
- **Known gap:** if the browser is killed before `pagehide` fires, a pending delete is simply not applied (the card stays), which is the safe direction.
- **Reverse:** `services/pendingActions.ts`, `features/deck/useDeck.ts`.

### D-109 Delete deck confirm is inline, not `window.confirm`

- **What:** "Delete deck…" reveals an inline `role="alertdialog"` with "Delete deck" / "Cancel" (Cancel focused).
- **Why:** native dialogs block automation and can't be styled later; inline is accessible.
- **Reverse:** `features/deck/DeckScreen.tsx`.

### D-110 "Installable" verified with Chrome's own check, not Lighthouse

- **What:** `e2e/m1-pwa.spec.ts` checks manifest fields + icons, a controlling service worker, and `Page.getInstallabilityErrors` (Chrome DevTools Protocol) returning no errors.
- **Why:** Lighthouse 12 (2024) removed the PWA category, including the "installable" audit; Chrome's installability check is what Lighthouse used to report.
- **Reverse:** n/a.

### D-111 Service worker: `prompt` mode, no `clientsClaim`

- **What:** `vite-plugin-pwa` with `registerType: 'prompt'`. The first page that installs the worker isn't controlled until its next load (navigation requests are still served offline once the worker is active). New versions wait until the user taps "Reload" in the banner.
- **Why:** §7.3 forbids auto-reload mid-session.
- **Reverse:** `vite.config.ts`.

### D-112 Placeholder icons

- **What:** plain grey PNG squares (192, 512, 512 maskable), generated by `apps/web/scripts/make-icons.mjs` with no image library.
- **Why:** installability needs icons; branding is out of scope for tonight.
- **Reverse:** replace the files in `apps/web/public/icons/`.

### D-113 Rating-button interval format

- **What:** `<1m`, `Nm` (<1 h), `Nh` (<1 d), `Nd` (<30 d), `Nmo` (<1 y), `N.Ny` (≥1 y), rounded.
- **Reverse:** `services/format.ts`.

### D-114 Settings ranges

- **What:** new cards/day is an integer 0–9999; rollover hour 0–23 (select). Theme only sets the CSS `color-scheme` (no visual design yet).
- **Reverse:** `services/settings.ts`.

### D-115 E2E runs against the production build

- **What:** Playwright starts `pnpm build && pnpm preview` (port 4173), Chromium only, one worker.
- **Why:** offline tests need the real service worker; one worker because later suites restart shared servers.
- **Reverse:** `apps/web/playwright.config.ts`.

## M2 — Backend, auth and sync (paused)

### D-201 Prisma 7.10.0 (not the `latest` tag)

- **What:** `prisma`, `@prisma/client` and `@prisma/adapter-pg` pinned to 7.10.0, using the `prisma-client` generator (output `apps/api/src/generated/prisma`, git-ignored, generated on `pnpm install`) and the `pg` driver adapter. Tables/columns are snake_case via `@@map`/`@map`.
- **Why:** npm's `latest` tag for `prisma` points at an 8.0 release candidate; 7.10.0 is the newest stable. snake_case keeps the hand-written sync and analytics SQL readable.
- **Reverse:** bump the three packages together.

### D-202 express pinned to 5.2.1

- **What:** `express@5.2.1`, not 5.3.0.
- **Why:** 5.3.0 was published the day before; pnpm's minimum-release-age supply-chain check rejected it, and bypassing that check isn't worth it.
- **Reverse:** bump once 5.3.x has aged.

### D-203 New API dependencies

- `cors`, `cookie-parser` (small, standard Express middleware), `@prisma/adapter-pg` + `pg` (required by Prisma 7), `tsx` (runs the TypeScript server and the TS-source `@recall/core` without a build step), `supertest` (dev, listed in §4).
- `pnpm-workspace.yaml` `allowBuilds` lets `prisma`, `@prisma/engines` and `esbuild` run their install scripts (pnpm blocks them by default).

### D-204 Auth details

- Email is trimmed and lower-cased; `POST /auth/magic-link` always answers 202 (doesn't reveal whether an account exists).
- `GET /auth/verify` redirects to `<WEB_ORIGIN>/settings?signedIn=1`, or `?signInError=invalid` for an unknown/used/expired token (a JSON error page is unhelpful when clicking an email link).
- Rate limits count only allowed requests; limited requests get 429 `rate_limited`.
- Magic-link delivery: `MAIL_MODE=console` (dev, prints the link), `file` (appends JSON lines; for E2E), `resend` (production, Resend HTTP API — no SDK).
- `COOKIE_SECURE=false` exists only for plain-http setups other than localhost.

## UI implementation (approved design)

Full details, remaining differences and missing data are in `UI_REPORT.md`. The main
decisions:

### D-301 Tokens via Tailwind 4 `@theme`, default palette removed

- **What:** colours are CSS variables (`:root` = dark, `[data-theme="light"]`), mapped to semantic Tailwind names in `@theme inline`; `--color-*: initial` removes Tailwind's default palette so components can't use raw colours.
- **Why:** Tailwind 4 has no `tailwind.config` by default; `@theme` is its equivalent.
- **Reverse:** `apps/web/src/index.css`.

### D-302 No-flash theme via a localStorage mirror

- **What:** the theme setting stays in Dexie; `useShell` mirrors it to `localStorage['recall.theme']`, which an inline script in `index.html` reads before first paint.
- **Why:** IndexedDB is async, so it can't be read before the first paint.

### D-303 Stats and backup live in `apps/web/src/services`, not core

- **What:** stats computations and backup export/import were written as tested web services.
- **Why:** the UI task forbade changes to `packages/core`; the brief's M4 stats functions didn't exist yet.
- **Reverse:** move `services/stats.ts` into core in M4 (pure already; uses only core types and functions).

### D-304 Completion is part of the review screen

- **What:** `/study` shows the completion state itself (so "Undo last rating" works); `/study/complete` redirects home. ✕ and "Back to home" mark the session completed.

### D-305 Data router

- **What:** `createBrowserRouter` instead of `<BrowserRouter>`.
- **Why:** `useBlocker` (unsaved-changes guard in the card editor) needs a data router.

### D-205 Server merges `voidedAt` like the client: earliest wins

- **What:** on push, a stored log's `voidedAt` is set when the stored one is null (the brief's rule) **and** replaced by an earlier one if two devices voided at different times.
- **Why:** clients merge with `mergeLog` (earliest wins); if the server kept "first received" instead, two devices could end up with different `voidedAt` values for the same log.
- **Reverse:** `apps/api/src/sync/push.ts` (the `mergeLog` call).

### D-206 Pull reads all three tables from one snapshot (bug found by the concurrency test)

- **What:** `/sync/pull` runs its three SELECTs in one `REPEATABLE READ` transaction.
- **Why:** with independent reads, a push committing between them could put its logs (high seqs) on a page without its deck (lower seq), and the cursor would skip the deck for ever. The advisory lock can't prevent this; it's a read-side problem.

### D-207 "Accepted" means "processed", including rows that lost LWW

- **What:** every id in a valid batch is accepted; a row whose incoming version lost to a newer stored one is accepted too.
- **Why:** the client should stop pushing it; the newer version reaches it on the next pull.

### D-208 Client pull merge

- **What:** if the server's version of a deck/card wins against the local one, it replaces it with `dirty=0` and `localVersion+1` (so an in-flight push of the losing version can't later clear anything wrongly). Logs: insert if absent, else `mergeLog`. CardStates of affected cards are replayed in the same transaction that saves the cursor.

### D-209 Each row is pushed at most once per sync round

- **What:** a row edited while its push is in flight stays dirty and goes out in the next round (the next trigger, at most 60 s later), not in a loop within the same round.
- **Why:** guarantees a round always ends.

### D-210 Signing in from the magic link

- **What:** `/auth/verify` redirects to `/settings?signedIn=1`; the app removes the parameter, asks `/me`, caches `{ signedIn, email }` in `meta.auth`, then syncs. `?signInError=invalid` shows a message in Settings. On a 401 during sync the app marks itself signed out and keeps all local data.
- **Known limitation:** signing into a _different_ account on a device whose rows were already synced to another account fails with 403 (ownership) on push, and the status shows "Couldn't sync". There is no "switch account" flow (not in the brief).

### D-211 Test infrastructure for the real API

- `apps/api` exports `./testing` (`prepareDatabase`, `startTestServer`) for other packages' tests. The web integration tests use their own database `recall_web_test` (created on demand), so they can run in parallel with the API's tests (`recall_test`).
- E2E runs the real API as a child process (port 3100, database `recall_e2e`, `MAIL_MODE=file`); the web build points at it via `VITE_API_URL`. A test can stop and restart it (`e2e/support/apiServer.ts`).

### D-212 Sync triggers

- **What:** app start (after first render), the `online` event, the tab becoming visible again, every 60 s while visible and online, the end of a study session (the X button / "Back to home"), and "Sync now". One sync at a time; requests during a sync cause exactly one follow-up round. Backoff 5 s, 10 s, ... up to 5 min.

## M3 — Ready-made decks, onboarding and backup

### D-306 Build-time deck pipeline as a Vite plugin

- **What:** `apps/web/build/readyMadeDecks.ts` reads `content/decks/*.json`, validates each with core `PrebuiltDeckSchema` (strict: unknown keys and duplicate questions are errors; the file name must equal `prebuiltId`), and serves them as `virtual:ready-made-decks`. Any problem fails `vite build` with a list naming file and field. The decks are compiled into the JS bundle, so the service worker precaches them.
- **Note:** the web scripts use `vite --configLoader runner`, because the config now imports the TypeScript-source workspace package `@recall/core`, which Vite's default config bundler can't load.
- **Reverse:** remove the plugin from `vite.config.ts`.

### D-307 Placeholder deck content written for the build

- **What:** `content/decks/dbms-basics-v1.json`, 20 original cards (ACID, keys, normal forms, isolation anomalies, 2PL, indexes, joins, WAL), written from scratch for this run.
- **Why:** §11 asks for one ~20-card placeholder; Chaitanya writes the real decks.
- **Reverse:** edit or replace the file; the build validates it.

### D-308 Ready-made deck flows

- **What:** "Add & start" on the welcome screen adds the deck and opens the review session (1 tap to the first card). On Browse, "Add" opens the new deck's page; adding a deck you already have opens the warning with "Keep one copy" focused as the safe default. Copies get new UUIDs, `source='prebuilt'`, `prebuiltId` set.

### D-309 Backup file

- **What:** JSON `{ format: "recall-backup", version: 1, exportedAt, decks, cards, reviewLogs }`, including tombstones and undone (voided) logs, without local-only fields. Import validates with zod (all-or-nothing), merges with `lww`/`mergeLog`, marks changed rows dirty (so they sync), and replays affected cards.

### D-310 Dialog focus

- **What:** dialogs focus the element marked `data-autofocus` when they open (React's `autoFocus` only fires on mount, and dialog content mounts before it opens). Found by the M3 E2E test that checks "Keep one copy" is focused.

## M4 — Stats and retention instrumentation

### D-311 Event schema: strict, text-free payloads

- **What:** `packages/core/src/events.ts`. One strict props schema per event type (unknown keys rejected); props hold only non-negative integers, enums and, for `deck_added_prebuilt`, the deck slug (`prebuiltId`, slug regex, ≤100 chars). A test inspects every props schema and fails if any field is a free-text string. Props: `session_started {scope: all|deck, due, new}`, `session_completed {reviewed, durationMs}`, `session_abandoned {reviewed, remaining ≥ 1}`, `deck_added_prebuilt {prebuiltId}`, all others `{}`.
- **Why:** the brief requires "no card text" to be enforced by the schema. Strict objects plus "no free strings" make it impossible, not just unlikely.
- **Sync protocol:** `events` is optional in a push (defaults to `[]`, so an older client still validates) and counts towards the 500-row limit; pulls always include it.
- **Reverse:** add props fields in `EVENT_PROPS`; the introspection test will force a decision on any new string field.

### D-312 When each event is recorded (web)

- **What:**
  - `app_opened`: every app start (each page load), after the database is initialized. Fire-and-forget: a failed analytics write never blocks startup.
  - `card_created`: in the same Dexie transaction as the card. Not for cards copied from a ready-made deck or imported from a backup.
  - `deck_added_prebuilt`: in the same transaction as the copied deck (one event, not one per card).
  - `first_review_completed`: in the rating transaction, when this device has no such event yet. So it is once per device. The analytics take the earliest per user. Undo doesn't remove it (append-only).
  - `session_started`: only when a new session starts (not when one is resumed after a reload), with the due (review + learning) and new counts at that moment.
  - `session_completed` / `session_abandoned`: when the user ends the session (✕ or "Back to home"). It's abandoned if ≥1 card was left. A session with nothing studied and nothing left records neither. A session left by closing the tab records neither: there is no reliable moment to write it.
  - `signed_in`: when this device goes from signed out to signed in (not on every `/me` check).
- **Why:** writing an event in the same transaction as the change it describes means the two can't disagree. `occurredAt` uses the device clock, like `reviewedAt`.
- **Reverse:** move or remove the `recordEvent` calls (`apps/web/src/services/*`, `main.tsx`, `sync/engine.ts`).

### D-313 Events storage and sync

- **What:** Dexie schema version 2 adds `events: 'id, type, occurredAt, dirty'`. That is additive, so existing v1 databases upgrade in place (tested). On the server, migration `0002_events` creates `events` with `props JSONB` and `server_seq` from the shared `change_seq`. Push inserts events if absent, never updates them, and applies the same ownership check (403) and future-clamp as other rows. Pull returns them in the same snapshot and `server_seq` order. Pulled events are stored clean (`dirty=0`), so they never go back up.
- **Not in the backup file:** backups stay decks, cards and logs (§7, D-309). Events are analytics data, not user data.
- **Reverse:** drop the table in a new migration; remove `events` from push/pull (clients without it still validate).

### D-314 Analytics definitions (`apps/api/analytics.sql`)

- **What:** five named queries (`-- name: …`), each tested against a hand-made fixture. The tests were also checked against deliberately broken versions of the SQL: every mutation tried made a test fail.
  - "First seen" = a user's earliest event. Anonymous use is synced at sign-in, so it is truer than `users.created_at`.
  - D1/D7/D30 return: any event in [first seen + N days, + N+1 days). Only users whose day N has ended by the as-of time (`$1`) count. Rate NULL when nobody is eligible yet.
  - Weekly active learners: distinct users with a non-voided review, per UTC week (Monday start).
  - Due-review completion rate: completed / started sessions per UTC week. Approximation: events carry no session id.
  - True retention per user: the server has no CardState, so a review counts as "review state" when the previous non-voided review of that card was ≥ 1 day earlier. Pass = not rated Again.
- **Alternatives:** a session id on session events (would make completion exact; a small additive change to the props); storing CardState snapshots server-side (rejected: CardState is derived and never synced, §7).

### D-315 "Calendar of days studied" on the Stats screen

- **What:** following the approved design, the calendar is the 30-day "Reviews per day" strip (a grey marker on days without study, today highlighted) plus the "Days studied · N of 30" figure. There is no separate month grid.
- **Why:** this is the approved mock (`docs/ui-design/*/Stats — desktop*.png`). It shows the same information without a second chart.
- **Reverse:** add a month-grid component fed by `perDay` (the data is already computed and tested).
