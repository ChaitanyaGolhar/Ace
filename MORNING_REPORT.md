# Morning report — overnight run M1 → M4

_Status: **finished.** M1–M4 done and tagged; M5 not started, as instructed. No criterion is blocked._

## 1. Summary

| Milestone | Status                  |
| --------- | ----------------------- |
| M1        | ✅ done — tag `m1-done` |
| M2        | ✅ done — tag `m2-done` |
| M3        | ✅ done — tag `m3-done` |
| M4        | ✅ done — tag `m4-done` |

**Change of plan mid-run.** While M2 was in progress, a new instruction arrived: apply
the approved visual design to `apps/web` as a UI-only change ("don't change
packages/core, the sync engine, or the API"). The overnight M1→M4 run was stopped at a
clean point (the API auth cycle, committed and green) and the UI work started. The UI
work is reported separately in `UI_REPORT.md` (done: all screens implemented to the
approved design, `pnpm check` green, 17 E2E tests incl. axe checks passing).

## 2. Acceptance criteria

### M1 — Local-only PWA

| Criterion                                                                                              | Status                                | Proof                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Create a deck, add 10 cards, study them; ratings change the next due dates as previewed on the buttons | ✅                                    | E2E `m1-study.spec.ts` › "create a deck, add 10 cards and study them; each rating schedules what its button previewed" (reads each button's interval, rates, then checks the stored `due − reviewedAt` formats to the same label). Unit: `review.test.ts` › "schedules exactly what previewIntervals showed, for every rating"                       |
| Offline E2E: load once, go offline, reload, create a card, complete a session                          | ✅                                    | E2E `m1-offline.spec.ts` › "offline: load once, go offline, reload, create a card and complete a session" (`context.setOffline(true)`)                                                                                                                                                                                                               |
| Reload mid-session: no lost or duplicated review; session continues                                    | ✅                                    | E2E `m1-offline.spec.ts` › "reload mid-session: …" (1 log before reload, answer hidden after, 3 logs / 3 distinct cards at the end, undo still available)                                                                                                                                                                                            |
| Rating + CardState update is atomic (unit test, fake-indexeddb)                                        | ✅                                    | `apps/web/test/review.test.ts` › "is atomic: if saving the CardState fails, no log is stored" and "… if saving the log fails, the CardState is unchanged" (failures injected with Dexie hooks)                                                                                                                                                       |
| Undo restores the previous due date exactly                                                            | ✅                                    | `review.test.ts` › "restores the previous CardState, including the due date, exactly"; E2E `m1-study.spec.ts` › "undo restores the previous due date exactly"                                                                                                                                                                                        |
| New-card limit respected across sessions in a study day, resets after the rollover (mocked time)       | ✅                                    | `apps/web/test/queue.test.ts` › "respects the new-card limit across sessions in a study day, and resets at the rollover" (fake clock: 03:59:59.999 vs 04:00 IST)                                                                                                                                                                                     |
| Lighthouse PWA "installable" passes                                                                    | ✅ (via Chrome's own check, see note) | E2E `m1-pwa.spec.ts` › "a service worker controls the page, and Chrome reports no installability errors" (`Page.getInstallabilityErrors` → `[]`) and "the web app manifest has name, icons, theme colour and standalone display". **Lighthouse 12+ removed the PWA category**, so Lighthouse itself can't run this audit any more (DECISIONS D-110). |
| Keyboard-only review works (`Space`, `1`–`4`, `Z`)                                                     | ✅                                    | E2E `m1-study.spec.ts` › "keyboard-only review: Space shows the answer, 1–4 rate, Z undoes"                                                                                                                                                                                                                                                          |

Commands run for M1 (all green): `pnpm check` (format, lint, typecheck, 118 core + 88
web unit tests) and `pnpm e2e` (10/10, run twice to check for flakiness).

Bug found and fixed by the E2E suite: right after a rating, the review screen could
briefly show the card just rated (stale live-query snapshot), so it could be rated twice.
The screen now waits for a snapshot that includes the write (DECISIONS D-107).

### M2 — Backend, auth and sync

(Resumed after the UI work, when asked to "continue".)

| Criterion                                                                                                               | Status | Proof                                                                                                                                                                                                                                                    |
| ----------------------------------------------------------------------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API tests (Supertest + real Postgres): push idempotent                                                                  | ✅     | `apps/api/test/sync.test.ts` › "is idempotent: the same batch twice gives the same database state" (full table dumps compared)                                                                                                                           |
| … LWW correct                                                                                                           | ✅     | `sync.test.ts` › "a newer edit overwrites…", "equal updatedAt falls back…", "tombstones are sticky…"                                                                                                                                                     |
| … log insert-if-absent                                                                                                  | ✅     | `sync.test.ts` › "are inserted if absent; a different copy of an existing log never changes it"                                                                                                                                                          |
| … `voidedAt` merges correctly                                                                                           | ✅     | `sync.test.ts` › "voidedAt: set when the stored log has none, never cleared, earliest wins"                                                                                                                                                              |
| … ownership 403                                                                                                         | ✅     | `sync.test.ts` › "ownership: a row that exists under another user rejects the whole batch (403)"                                                                                                                                                         |
| … pull pagination                                                                                                       | ✅     | `sync.test.ts` › "pages in serverSeq order with nextCursor and hasMore, without gaps or repeats"                                                                                                                                                         |
| … advisory lock present                                                                                                 | ✅     | `sync.test.ts` › "takes the per-user advisory lock" (a push provably waits while another transaction holds `pg_advisory_xact_lock(hashtext(userId))`)                                                                                                    |
| Concurrency: parallel pushes; full pull returns every row; incremental pulls never skip                                 | ✅     | `apps/api/test/concurrency.test.ts` (3 tests). Verified meaningful: with the lock removed, the race test failed 5/5 runs; with it, 5/5 pass.                                                                                                             |
| Two-client simulation (two Dexie DBs vs the real API): same card studied offline on both → identical logs and CardState | ✅     | `apps/web/test/integration/syncWithApi.test.ts` › "both study the same card offline, then sync: identical logs and CardState"                                                                                                                            |
| Edit during an in-flight push is not lost                                                                               | ✅     | same file › "an edit made while a push is in flight is not lost" (real API); unit: `syncEngine.test.ts`                                                                                                                                                  |
| Anonymous local data uploaded on first sign-in, then merged with another device                                         | ✅     | `syncWithApi.test.ts` › "anonymous local data is uploaded on first sign-in…"; also the E2E two-devices test (A creates data anonymously, then signs in)                                                                                                  |
| E2E: two browser contexts, same user; study offline in A, go online, B shows updated counts                             | ✅     | `apps/web/e2e/m2-sync.spec.ts` › "two devices: study offline on A, go online, B shows the updated counts after sync"                                                                                                                                     |
| Studying never blocked by sync errors (API killed mid-session)                                                          | ✅     | `m2-sync.spec.ts` › "studying is never blocked by sync errors (the API is killed mid-session)" (kills the API process; status shows "Couldn’t sync · retrying"; the session completes; it syncs after the restart)                                       |
| zod max lengths on client and server (deck name 200, front/back 20,000)                                                 | ✅     | core `schemas.test.ts` › "max lengths…"; web `decksAndCards.test.ts` › "max lengths (client side…)"; API `sync.test.ts` › "enforces the max lengths and the 500-row limit (400)"; integration › "the server enforces the same max lengths as the client" |
| Report explains the advisory-lock and sequence reasoning                                                                | ✅     | below                                                                                                                                                                                                                                                    |

**Why the advisory lock, in plain words.** Every change on the server gets a number from
one shared counter (`change_seq`), and a device asks "give me everything after number N".
The catch: a number is handed out when a row is _written_, but the row only becomes
visible when its transaction _commits_, and commits can finish in a different order. Say
push A takes numbers 10–20 and is still working, while push B takes 21 and commits first.
A device that pulls right then sees 21, remembers "I have everything up to 21", and will
never ask for 10–20 again, even after A commits. Taking
`pg_advisory_xact_lock(hashtext(userId))` at the start of every push makes one user's
pushes run one after another, so for that user the numbers are handed out in the same
order as the commits, and "everything after N" is always complete. Different users still
push in parallel.

**A second, read-side hole, found by the concurrency test.** The pull read decks, cards
and logs with three separate queries. A push could commit between them, so a page could
contain its logs but not its deck, and the cursor jumped past the deck. The lock can't
help there; the fix was to read all three in one database snapshot (DECISIONS D-206).

Commands run (all green): `pnpm check` (core 132, API 38, web 178 tests) and `pnpm e2e`
(20 passed; the 4 screenshot tests are opt-in).

### M3 — Ready-made decks, onboarding and backup

| Criterion                                                                         | Status | Proof                                                                                                                                                                                                                       |
| --------------------------------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E2E: fresh browser → first card within 3 taps, with no forms                      | ✅     | `apps/web/e2e/m3-onboarding.spec.ts` › "first visit: the first card is shown within 3 taps, with no forms" (1 tap: "Add & start"; no textbox on the way)                                                                    |
| Importing an exported backup into a fresh install reproduces identical CardStates | ✅     | `apps/web/test/library.test.ts` › "importing into a fresh install reproduces identical CardStates"; E2E `m3-onboarding.spec.ts` › "backup: export, import into a fresh browser…" (real download/upload)                     |
| Importing the same backup twice changes nothing (idempotent)                      | ✅     | `library.test.ts` › "importing the same backup twice changes nothing" (full table snapshots compared) and "re-importing your own backup changes nothing"; E2E second import → "Everything was already here."                |
| An invalid deck JSON fails the build with a clear message                         | ✅     | `apps/web/test/readyMadeDecks.test.ts` › "the production build › fails with a clear message when a deck file is invalid" (runs a real `vite build` against an invalid deck folder) plus unit tests for each kind of problem |

Also: the placeholder deck `content/decks/dbms-basics-v1.json` (20 original cards), the
Browse screen with the duplicate warning (E2E "ready-made decks: adding a deck you already
have warns first"), and a dialog-focus fix that test found (DECISIONS D-310).

Commands run (all green): `pnpm check` (core 140, API 38, web 184 tests) and `pnpm e2e`.

### M4 — Stats and retention instrumentation

| Criterion                                                              | Status | Proof                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stats numbers are verified against a fixture of known logs             | ✅     | `apps/web/test/stats.test.ts` › "computeStats (fixture of known logs)" (8 tests: true retention, review count, reviews per day, 7-day forecast, cards by state, deleted decks excluded, study days with the rollover hour). Server side: `apps/api/test/analytics.test.ts` runs every query in `apps/api/analytics.sql` against a hand-made fixture (6 tests, mutation-checked, see below).                                     |
| Events work offline and sync without duplicates                        | ✅     | `apps/web/test/events.test.ts` › "recorded offline, synced later, without duplicates on the server or other devices". Real API: `apps/web/test/integration/syncWithApi.test.ts` › "events recorded offline sync later, without duplicates (M4)" (a third, fresh device pulls exactly the 3 events). API: `apps/api/test/events.test.ts` › "are stored once (insert-if-absent)…", "are append-only…", ownership 403, pagination. |
| No event payload contains front/back text (test asserts on the schema) | ✅     | `packages/core/test/events.test.ts` › "no event payload can contain card text (front/back): props are strict" and "no payload field is free text: every prop is a number, boolean, enum or slug" (inspects every props schema). API › "reject card text in payloads (400)". Web › "card_created … (no text in the event)" and "refuses a payload with card text".                                                               |

**What was built:**

- **Schema and sync.** Core `EventSchema` with the brief's 8 event types (D-311). It is in the push/pull protocol: optional in pushes and counted in the 500-row limit.
- **Server.** Migration `0002_events`. Push is insert-if-absent with the ownership check; pull reads events in the same snapshot as the other rows (D-313).
- **Web.** Dexie schema version 2 (an existing v1 database upgrades in place; tested). Events are recorded at the points listed in D-312, each in the same transaction as the change it describes. The sync client pushes and pulls them.
- **Analytics.** `apps/api/analytics.sql` holds 5 named queries: time to first review, D1/D7/D30 return, weekly active learners, due-review completion rate, and true retention per user. Their definitions and approximations are in D-314.
- **Stats screen.** It already existed from the UI work; its "calendar of days studied" follows the approved design (D-315).

**Checks that the tests mean something.** The SQL tests passed on the first run, so I broke the SQL on purpose four ways:

- counting voided reviews;
- dropping the 1-day "review state" rule;
- making D-N eligibility start a day early;
- taking the latest event as "first seen".

Three mutants failed the tests at once. The eligibility one survived, so I added an as-of check halfway through day 7. Now all four fail.

As a final check, the E2E run's database held events synced from real browsers, with the count equal to the distinct-id count for every type, and payloads of only `{}`, counts and enums.

**Also changed:** startup records `app_opened` without waiting for it, so an analytics failure can never stop the app from opening.

Commands run (all green): `pnpm check` (core 149, API 49, web 196 tests) and `pnpm e2e` (23 passed; the 4 screenshot tests are opt-in).

## 3. Run everything from a fresh clone

Needs Node 24+, pnpm (`corepack enable`), and Docker.

```sh
pnpm install
pnpm --filter @recall/web exec playwright install chromium   # once, for E2E
docker compose up -d                                         # Postgres on localhost:54329
cp apps/api/.env.example apps/api/.env                       # MAIL_MODE=console: magic links print in the API terminal
pnpm --filter @recall/api migrate                            # migrations → recall_dev

pnpm check    # format + lint + typecheck + all unit/API/integration tests (needs Postgres up)
pnpm e2e      # Playwright against a production build; starts its own API on :3100
```

To use the app:

```sh
pnpm --filter @recall/api dev     # API on http://localhost:3000
pnpm --filter @recall/web dev     # http://localhost:5173 (no service worker in dev)
# or, with the service worker (needed for the offline check):
pnpm --filter @recall/web build && pnpm --filter @recall/web preview   # http://localhost:4173
```

If you use the preview build (port 4173) with sign-in, set `WEB_ORIGIN=http://localhost:4173` in `apps/api/.env` and restart the API. CORS and the magic-link redirect only allow that one origin. Use `localhost`, not `127.0.0.1` or a LAN IP.

## 4. Test this first (about 10 minutes)

Run the API and the **preview build** (section 3, with `WEB_ORIGIN=http://localhost:4173`). Use Chrome.

1. **First visit (1 min).** Open http://localhost:4173 in a fresh profile or a guest window. You should see the welcome card, with no sign-up and no tutorial. Tap **Add & start**. The first card appears with the one-line hint.
2. **Study (2 min).** Press `Space` to show the answer and `1`–`4` to rate. Each button shows the interval it will schedule. Rate a few cards, then press `Z` (or tap the undo pill). The last card comes back.
3. **Offline (2 min).** DevTools › Network › Offline, then reload. The app still loads. Add a card (Decks › your deck › Add card), study a few cards, and finish the session.
4. **Sign in (1 min).** Go back online. Settings › **Sign in to sync** › enter any email. Open the link printed in the API terminal. You land back in Settings, signed in, and the status reaches "Synced".
5. **Second browser (2 min).** Open an incognito window at http://localhost:4173 and sign in with the same email (new link from the terminal). Your decks, cards and today's counts appear. Study one card there, then press **Sync now** in the first window. Its due count drops to match.
6. **Undo across sync (1 min).** Rate a card, undo it, then sync. The other window doesn't count the undone review.
7. **Stats (1 min).** Open Stats. You should see the "Remembered on review" percentage (true retention), reviews, days studied, the 7-day forecast, reviews per day (hover or focus a bar to read it), and cards by state.
8. **Optional: events.**
   ```sh
   docker compose exec db psql -U recall -d recall_dev -c "select type, props from events order by occurred_at"
   ```
   You should see your app opens, the deck you added, sessions, sign-ins. No card text.

## 5. Known issues and risks

- **Not deployed and not pushed**, as instructed. Real email (`MAIL_MODE=resend`) is implemented but untested. Only the `console` and `file` modes are exercised.
- **E2E runs on Chromium only.** Safari/iOS (IndexedDB eviction, PWA install) is untested.
- **Analytics approximations** (D-314):
  - Events have no session id, so the session completion rate is per-week counts. Sessions ended by closing the tab record no end event.
  - Server-side "true retention" uses a ≥1-day gap as a stand-in for review state. It can differ slightly from the Stats screen, which replays real card states.
  - `first_review_completed` is per device; the queries take the earliest.
- **Event timestamps use device clocks.** A wrong clock skews analytics; future times are clamped to the server's now + 24 h.
- **The events table only grows.** There is no pruning, and no dashboard: run the SQL by hand.
- **Scheduling.** FSRS fuzz is off, so intervals are exact and cards learned together stay bunched; seeded fuzz would need a `SCHEDULER_VERSION` bump. ts-fsrs patches `Date.prototype` (see README).
- **Bundle size.** The main JS chunk is over 500 kB minified (a build warning); route code-splitting would fix it.
- **Stats code location.** The stats functions live in `apps/web/src/services/stats.ts`, not in core (D-303). They are fine where they are; move them if the API ever needs them.
- **Ready-made content.** `dbms-basics-v1` is a 20-card placeholder written for the build (D-307). The real decks are yours to write.
- **Cards can't move between decks** (the editor's deck picker is disabled when editing).

## 6. Where to look next

- `DECISIONS.md`: every choice the brief didn't cover, with alternatives and how to reverse it. The M4 entries are D-311–D-315.
- `apps/web/UI_CONTRACT.md`: the original screen contract (superseded by the approved design; see its note).
- `UI_REPORT.md`: the design implementation report, including the remaining differences from the mocks. Its section 3 predates M2–M4, which have since filled those gaps.
- `apps/api/analytics.sql`: the retention queries.
- `BUILD_BRIEF.md`: the spec. M5 is untouched.
