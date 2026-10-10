# Audit after M4

`UI_REPORT.md` was written at commit `3388ca1`, mid-M2. M2 sync, M3 and M4 came after it. This audit checks that the final app matches both reports. No new features were added.

**Result:** every item UI_REPORT listed as hidden or "can't show yet" now works with real data, and an E2E test drives each one through the real UI. There was no second stats or backup implementation. Four smaller duplicates were removed, keeping one copy in `packages/core`. Each of the 8 product events has its own E2E check. `pnpm check`, `pnpm e2e` and the screenshot script are green.

Tag: `v0.1-candidate` (local only; not pushed).

## 1. UI_REPORT's "can't show yet" items, now with real data

| Item (UI_REPORT §1–3)                                                                             | Status                                            | Proof                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Welcome card with a ready-made deck, "Add & start"                                                | ✅ already fine (M3)                              | `e2e/m3-onboarding.spec.ts` › "first visit: the first card is shown within 3 taps…"                                                                                                                                |
| "See all ready-made decks", Home and Decks "Add a ready-made deck"                                | ✅ already fine; **E2E added**                    | `e2e/real-data.spec.ts` › "ready-made links: welcome screen, Home and Decks all lead to Browse"                                                                                                                    |
| Browse with the real catalog                                                                      | ✅ already fine (M3)                              | `m3-onboarding.spec.ts` › "ready-made decks: adding a deck you already have warns first"                                                                                                                           |
| Duplicate-copy sheet ("Keep one copy" focused)                                                    | ✅ already fine (M3)                              | same test; screenshot `docs/ui-design/_actual/browse-duplicate-*.png`                                                                                                                                              |
| The app noticing you're signed in after the magic link                                            | ✅ already fine (M2)                              | `e2e/helpers.ts` › `signIn` (opens the real magic link, then expects "Signed in as …"), used by 6 tests                                                                                                            |
| "Signed in as …", Sync now, Sign out                                                              | ✅ already fine (M2)                              | `m2-sync.spec.ts` › "sign in with a magic link; Settings shows the account and \"Synced\""                                                                                                                         |
| Every sync status state: On this device only, Syncing…, Synced, Offline, Couldn't sync · retrying | ✅ works; **E2E added** for all five in one place | `real-data.spec.ts` › "every sync status state, in Settings and the sidebar". "Syncing…" is held with a delayed pull; the error comes from a 500 from the API. Also `m2-sync.spec.ts` (offline study, API killed). |
| Mobile top-bar sync icon (was stuck on "sign in")                                                 | ✅ works; **E2E added**                           | `real-data.spec.ts` › "phone width: the top-bar sync button shows the real status"                                                                                                                                 |
| Sign-in merge note with the real deck count                                                       | ✅ works; **E2E added**                           | `real-data.spec.ts` › "the sign-in screen states the real number of decks that will be merged"                                                                                                                     |
| Export / Import                                                                                   | ✅ already fine (M3)                              | `m3-onboarding.spec.ts` › "backup: export, import into a fresh browser (identical states), import again (no change)"                                                                                               |
| Stats                                                                                             | ✅ works; **E2E added**; small markup fix         | `real-data.spec.ts` › "Stats show real numbers after studying on two days" (Playwright clock: 3 cards learned, then 25 days later Good, Good, Again → 67%, 7 reviews, 2 of 30 days, 3 learned)                     |
| Settings "· 2 devices"                                                                            | — dropped (as UI_REPORT says)                     | —                                                                                                                                                                                                                  |

**Fixed:** the Stats tiles were plain `div`s with no accessible name. Each is now a `section` labelled by its title, with a `stat-value` test id, and each "Your cards" row has a test id. This was needed to read the numbers by role, and it helps screen readers. Nothing else needed wiring: M2/M3 had already connected these items.

## 2. Duplicates

**Stats and backup:** M3 and M4 did **not** add their own versions. M3's backup E2E and M4's stats both used the UI-era services. So nothing produced two different numbers there. As asked, the pure parts moved into core:

| What                                         | Before                            | After                         | Tests                                                                                                                                         |
| -------------------------------------------- | --------------------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `computeStats` (+ `StatsInput`, `StatsData`) | `apps/web/src/services/stats.ts`  | `packages/core/src/stats.ts`  | the 8 fixture tests moved to `packages/core/test/stats.test.ts`; the web keeps `loadStats` (Dexie) and the readout strings with their 2 tests |
| `BackupSchema`, `Backup`                     | `apps/web/src/services/backup.ts` | `packages/core/src/backup.ts` | new `packages/core/test/backup.test.ts` (3); import/export stay in web with their existing tests                                              |

**Other duplicates found and removed:**

| What                                       | Copies                                                                          | Kept                | Tests                                             |
| ------------------------------------------ | ------------------------------------------------------------------------------- | ------------------- | ------------------------------------------------- |
| `sameRow` ("did a merge change anything?") | `apps/web/src/services/rows.ts` and `apps/api/src/sync/rows.ts`, byte-identical | core `merge.ts`     | 2 new tests in `packages/core/test/merge.test.ts` |
| Ready-made deck type                       | web `ReadyMadeDeck` interface restated core's `PrebuiltDeck`                    | core `PrebuiltDeck` | existing tests now use it                         |

No test was deleted or weakened. Web went 196 → 188 because those 8 tests now run in core. One web view-model test gained a field (`key`) in its expected rows; that makes it stricter, not looser.

**The one place two versions give different numbers: true retention.** The app (core `computeStats`) and the server (`analytics.sql` › `true_retention`, M4) define it differently. This is on purpose: the server stores no card state, so the SQL can't replay FSRS. `apps/api/test/trueRetention.test.ts` runs one realistic history through both:

- **The app: 1 of 3 = 33%.** This one is right: it's the brief's definition ("reviews of cards in `review` state not rated Again"), and it knows each card's real state before each review.
- **The SQL: 2 of 3 = 67%.** Its stand-in for "review state" (previous review ≥ 1 day earlier) goes wrong both ways:
  - It **counts** a card that failed when new and came back the next day. That card is still in _learning_ (FSRS keeps it there), so the app skips it.
  - It **skips** a card that graduated with a 1-day interval in the evening and was reviewed the next morning. Review cards are due for the whole study day, so the gap can be under 24 h even though the card is in _review_ state. The app counts it.

A test also checks that the fixture is realistic: the states come from core's real scheduler. Both versions are kept (D-316). Use the SQL for trends across users, and the app's number for what the brief means.

## 3. Product events: one E2E check per event, through the real UI

`apps/web/e2e/events.spec.ts`. Events are read back from the app's IndexedDB, and the checks confirm that no card text is stored.

| Event                    | Driven by                                              | Checks                                                                                 |
| ------------------------ | ------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| `app_opened`             | opening and reloading the app                          | one per start                                                                          |
| `deck_added_prebuilt`    | welcome "Add & start", then Browse "Add a second copy" | `{prebuiltId: 'dbms-basics-v1'}`; copying 20 cards emits no `card_created`             |
| `card_created`           | the card editor ("Save & add another")                 | one per card, `{}`; the card and deck text appear nowhere in events                    |
| `session_started`        | Home "Start reviewing", then deck page "Study deck"    | `{scope:'all', due:0, new:3}`; reloading mid-session adds nothing; then `scope:'deck'` |
| `first_review_completed` | the first rating                                       | exactly one, even after more ratings                                                   |
| `session_completed`      | finishing every card, then "Back to home"              | `reviewed: 2`, a duration; no `session_abandoned`                                      |
| `session_abandoned`      | ✕ with cards left                                      | `{reviewed: 1, remaining: 2}`; no `session_completed`                                  |
| `signed_in`              | the real magic-link flow                               | one, not repeated on reload; afterwards every event is synced (`dirty = 0`)            |

**Checking these tests can fail:** I changed the review screen's ✕ / "Back to home" back to the pre-M4 call, which records nothing. Both session tests failed. Then I restored the code.

## 4. Commands, screenshots and comparison

| Command                                                                                | Result                                                                                         |
| -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `pnpm check`                                                                           | ✅ format, lint, typecheck; tests: core **166**, API **52**, web **188**                       |
| `pnpm e2e`                                                                             | ✅ **36 passed** (4 screenshot tests skipped: they're opt-in)                                  |
| `SCREENSHOTS=1 pnpm --filter @recall/web exec playwright test e2e/screenshots.spec.ts` | ✅ 4 passed → 72 images in `docs/ui-design/_actual/` (18 screens × phone/desktop × dark/light) |

**Fixed in the screenshot script:**

- It was written before sync and the real catalog. It now signs in through the real API, so every later screen shows the real "Synced" state. It also captures "Check your email", the duplicate-copy sheet and signed-in Settings.
- It waits for sync to settle. The first run captured "Syncing…" in the chrome, because each page load starts a sync.

**Compared against `docs/ui-design/`.** I compared these pairs:

- First visit
- Home (phone and desktop)
- Review / completion
- Duplicate sheet
- Settings
- Sign in
- Stats
- Deck details
- Light-theme Home

They match in layout, content, controls and states, now with real data: the ready-made card, the green synced cloud, "Signed in as …", the real merge-note count, and Stats from real reviews. Differences I measured but did **not** change (design calls for you):

- **Type size on phones.** The phone mocks are 2× renders (the duplicate sheet's body text wraps at the same words as the app). Against that, the mocks' text mostly measures smaller than the app's: the Home greeting at 0.81×, the "Today's study" label at 0.86×, button labels at about 0.89×. But it isn't uniform: the sign-in heading is at 0.94×, and the sheet body text is identical. So the mocks aren't on one consistent scale. The app follows the Foundations type scale (page 30, card 24, section 18, body 15, meta 13).
  - Two headings are deliberately bigger than the page size: welcome (44 px) and "Review complete" (40 px). They read largest against their mocks; say if you want them at the page size.
- **Desktop content column.** The desktop mocks are about 1.6× renders of a ~1600 px-wide window (the sidebar measures 274 px there; the app's is 272). On that canvas the content column is 850–950 px, and it varies between mocks. The app uses 740 px, so Stats tile captions wrap onto one more line.
- **Storage row.** The Settings mock shows the "Stored safely" variant. Headless Chrome doesn't grant persistent storage, so the screenshot shows the other implemented variant ("Saved on this device"). Both are implemented.
- **Placeholders not shipped**, as UI_REPORT says: the mock's second "[Next deck name]" row, "· 2 devices", and the `you@example.com` field placeholder.

## 5. Final test counts

| Suite                  | Before the audit (after M4) | After                                                                                           |
| ---------------------- | --------------------------- | ----------------------------------------------------------------------------------------------- |
| core                   | 149                         | **166** (+8 stats moved in, +3 backup schema, +2 `sameRow`, +4 purity checks for the new files) |
| API                    | 49                          | **52** (+3 true retention: app vs SQL)                                                          |
| web unit / integration | 196                         | **188** (−8 stats tests moved to core; none removed)                                            |
| E2E                    | 23 (+4 opt-in)              | **36** (+4 opt-in, also run: 4 passed); +5 real-data, +8 events                                 |

## 6. Commits in this audit

- `f61e953` test(web): E2E proof that the UI report's hidden parts work with real data; stats tiles as labelled regions
- `75349d7` refactor: one copy each of computeStats, BackupSchema, sameRow and the prebuilt deck type, in core
- `0d23749` test(api): pin down where the app's and the SQL's true retention differ
- `4e8daea` test(web): one E2E check per M4 event, driven through the redesigned screens
- `e9bbb20` test(web): screenshot script captures signed-in, synced and duplicate-sheet states; regenerate screenshots

Decisions recorded: D-303 (updated) and D-316 in `DECISIONS.md`.
