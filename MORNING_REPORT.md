# Morning report — overnight run M1 → M4

_Status: in progress. This file is updated after every milestone and every blocker._

## 1. Summary

| Milestone | Status                  |
| --------- | ----------------------- |
| M1        | ✅ done — tag `m1-done` |
| M2        | in progress             |
| M3        | not started             |
| M4        | not started             |

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
