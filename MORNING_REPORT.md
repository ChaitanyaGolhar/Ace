# Morning report — overnight run M1 → M4

_Status: in progress. This file is updated after every milestone and every blocker._

## 1. Summary

| Milestone | Status                  |
| --------- | ----------------------- |
| M1        | ✅ done — tag `m1-done` |
| M2        | ✅ done — tag `m2-done` |
| M3        | in progress             |
| M4        | not started (paused)    |

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
