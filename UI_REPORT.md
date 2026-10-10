# UI report — approved design applied to `apps/web`

> **Later status:** this report describes the app when the design was applied, mid-M2. Since then, M2 (sign-in and sync), M3 (ready-made decks and backup) and M4 (events) have filled the gaps listed in section 3. See `MORNING_REPORT.md`.

`pnpm check` is green (format, lint, typecheck; 132 core + 152 web + 18 API unit tests).
The full E2E suite passes (17 tests, including 6 axe accessibility checks). Screenshots
of every screen at 390×844 and 1280×800 in both themes are in `docs/ui-design/_actual/`.
I compared them against the mocks and fixed the visible differences listed at the end.

**Context:** this request arrived mid-way through the overnight M1–M4 run. M1 is done
(tag `m1-done`). M2 was stopped after the API auth cycle, and M3/M4 were not started.
That is why some screens have no data yet (section 3). See `MORNING_REPORT.md`.

## 1. Screens done

| Screen           | Route                                     | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| App shell        | all                                       | Sidebar from 1024px (logo, Home with today's count, Decks, Stats; Settings and sync status at the bottom). Below 1024px: top bar (logo, sync icon button, search) and bottom tab bar. One responsive implementation. Content column 740px.                                                                                                                                                                                                                                                                            |
| Home             | `/`                                       | "Today's study" panel (big count; "N reviews · N new · about N minutes"; Start reviewing; `Space` starts it; "Tomorrow: N cards…" line on desktop). Greeting changes with local time. Then "Your decks" (pill "N due" or "Up to date"), "+ New deck", "View all".                                                                                                                                                                                                                                                     |
| First visit      | `/` with zero decks                       | Welcome screen, with the mobile chrome hidden as in the mock. The ready-made card is wired to "Add & start" → review, but is hidden: there is no deck content (section 3).                                                                                                                                                                                                                                                                                                                                            |
| Review session   | `/study`, `/study?deck=…`                 | No navigation. ✕ top-left; deck name and "N of M" centred; thin progress bar; New/Review tag; first-card hint; "Show answer" (`Space`). Revealed: divider, answer, "How well did you remember?", Again/Hard/Good/Easy with intervals from `previewIntervals()`. Desktop also shows the 1–4 keys; Good has the accent border. Undo pill bottom-left ("Undo · previous card was Good", `Z`). Completion is part of the same screen ("Review complete", sentence, "Next cards due", "Back to home", "Undo last rating"). |
| Deck details     | `/decks/:id`                              | Breadcrumb, name, "N cards · N due today · N new · last studied …". "Study deck" and "Add card". Options menu (Rename deck; Delete deck… with a confirm dialog). Card rows: question on one line, "Due today / Tomorrow / In 3 days / In 2 weeks / New", and a ⋯ menu (Edit card; Delete card with the undo toast). Search over question and answer. The ready-made note appears for `source='prebuilt'`.                                                                                                             |
| Card editor      | `/decks/:id/cards/new`, `/cards/:id/edit` | Deck picker, Question, Answer, tip line, live "N cards added to <deck>". "Save & add another" (`Ctrl/Cmd+Enter`) and "Save and close"; actions pinned to the bottom on mobile. Leaving with unsaved text asks first: an in-app dialog, plus the browser's `beforeunload` prompt. Page max-width 640 on desktop.                                                                                                                                                                                                       |
| Decks            | `/decks`                                  | Home deck-list pattern, "Decks" heading, "New deck" primary.                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| New deck         | `/decks/new`                              | Simple form (no mock).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Ready-made decks | `/browse`                                 | Rows with name, description and count; "✓ In your decks"; adding again opens the bottom sheet (dialog on desktop) with "Add a second copy" (secondary) and "Keep one copy" (primary, autofocused). The catalog is empty today (section 3).                                                                                                                                                                                                                                                                            |
| Stats            | `/stats`                                  | Three tiles (stacked on mobile); "Coming up · next 7 days" and "Reviews per day" (30 bars, 2px stubs for zero days). Each bar is a focusable button with an aria-label; hover or focus updates the readout line. "Your cards". Single accent colour plus a stronger tint for today; bars have 4px rounded tops.                                                                                                                                                                                                       |
| Settings         | `/settings`                               | Study (stepper; "New day starts at" with hours 0–6), Appearance (System/Light/Dark segmented control), Account & sync ("On this device only" + "Sign in to sync"), storage-persistence row, Backup (Export/Import), version line. Every control saves immediately (the mock has no Save button).                                                                                                                                                                                                                      |
| Sign in          | `/signin`                                 | Email form → "Check your email" with "Send it again" and "Use a different email". It calls the real `POST /auth/magic-link`. The merge note uses the real number of decks (hidden with 0 decks).                                                                                                                                                                                                                                                                                                                      |
| Search           | `/search` (shortcut: `/` key)             | No mock. Global search of deck names and card question/answer text, reached from the search button/icon or the `/` key.                                                                                                                                                                                                                                                                                                                                                                                               |
| Toast            | —                                         | Dark in both themes ("Card deleted · Undo · ×").                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

**Foundations:**

- **Tokens:** every colour is a CSS variable on `:root` (dark) and `[data-theme="light"]`, with the exact hex values from both Foundations images. They are mapped to the semantic names in Tailwind 4's `@theme` block: Tailwind 4 has no `tailwind.config`, and `@theme` is its equivalent. Tailwind's default palette is removed, so components can only use the semantic names; there are no hex values in components.
- **Theme:**
  - "system" follows `prefers-color-scheme` live.
  - The setting stays in Dexie (`meta.settings`) and is mirrored to `localStorage`. An inline script in `index.html` reads that mirror to set `data-theme` before first paint, because IndexedDB is async.
- **Fonts:** Geist and Geist Mono via `@fontsource-variable`, self-hosted. The `woff2` files are in the service-worker precache.
- **Motion:** only colour transitions (≤150ms), and all transitions and animations are disabled under `prefers-reduced-motion`.

## 2. Remaining differences from the design, and why

1. **Large numbers are Geist Mono** (the today count, stats tiles, stepper, "Your cards" counts), as the instruction asked ("Geist Mono for numbers"). Some mocks appear to set the big count in Geist sans. The "N due" pills follow the mock (sans, tabular figures).
2. **Sync status always reads "On this device only · Sign in to sync".** The mobile top bar therefore shows the sign-in icon, not the green cloud in the mock. This is honest: there is no sync engine yet (section 3). All five states are implemented and unit-tested (`syncStatusView`), ready for the engine.
3. **The signed-in account row** ("Signed in as …", Sync now, Sign out) is not reachable, because the app has no signed-in state yet (section 3).
4. **The ready-made parts are hidden:** the welcome card, "See all ready-made decks", "Add a ready-made deck", and the Browse rows. There is no deck content. Browse shows "No ready-made decks are bundled with this version yet."
5. **The welcome card shows no time estimate:** "about 5 minutes to start" was a mock placeholder, and a new user has no review history to estimate from. Home leaves the estimate out until there are 20 reviews, as specified.
6. **Copy adjustments:**
   - "Everything is saved on this phone" → "this device" (it also runs on desktop).
   - The editor's sample answer placeholder (a DBMS-specific example) is omitted.
   - The sign-in email field has no `you@example.com` placeholder (on the do-not-ship list).
7. **Colour values not given in Foundations, which I derived:**
   - dark `link` / toast action `#A0AFFF` (the lavender in the mocks);
   - light `on-accent` `#FFFFFF`;
   - "today" bar tint (dark `#AAB6FF`, light `#2E42B8`, from the Stats mocks);
   - backdrop scrim.
8. **Focus on text fields** is the accent border plus a 1px accent ring, as in the editor mock. Everything else gets a 2px ring in the text colour with a 2px gap, as in the "Focused" button in Foundations.
9. **Editing a card can't move it to another deck.** The deck picker is disabled in edit mode, because the card service only edits text. Moving cards would be a new write path.
10. **Forecast days with 0 cards** also get the 2px stub, so every day stays visible.
11. **Screens without a mock** (Decks, New deck, Search, Check-your-email, the empty review state, dialogs) follow the same tokens and patterns.
12. **One build warning:** the main JS chunk is >500 kB minified. Code-splitting per route would fix it, but I left it alone as a non-visual change.

## 3. Data or features that don't exist yet

| Needed by                                                     | What's missing                                                                                                                                                                                                                                                                                                                        | Where it belongs |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| Welcome card, Browse, "Add a ready-made deck"                 | Ready-made deck content (`content/decks/*.json` + build-time validation). The catalog `src/content/readyMade.ts` is deliberately empty. The copy/duplicate logic (`services/readyMade.ts`) exists and is tested.                                                                                                                      | M3               |
| Sync status chip/line, Settings account row, mobile sync icon | Signed-in state in the app (`/me` cached in `meta`) and the client sync engine (push/pull, status, Sync now, Sign out). The API's auth endpoints exist; the sync endpoints and the client don't.                                                                                                                                      | M2               |
| Sign in → back to the app                                     | After clicking the magic link, the API sets the cookie and redirects to `/settings?signedIn=1`, but the app doesn't read that yet, so it still shows "On this device only".                                                                                                                                                           | M2               |
| Settings "· 2 devices"                                        | Not tracked anywhere; dropped as instructed.                                                                                                                                                                                                                                                                                          | —                |
| Stats                                                         | The brief's stats functions didn't exist (M4 wasn't built). I wrote them as pure, fixture-tested functions in **`apps/web/src/services/stats.ts`**, not in `packages/core`, which was off-limits. They use core's `applyReview`/`mergeLog` to know each card's state before each review (true retention). Worth moving to core in M4. | M4               |
| Settings › Backup                                             | Export/import didn't exist (M3). Implemented in `apps/web/src/services/backup.ts` with the brief's rules (`lww`/`mergeLog`, idempotent, identical CardStates after import), tested.                                                                                                                                                   | M3               |

**Scope notes:**

- **What I didn't touch:** `packages/core`, the API and the sync engine.
- **New web services:** stats, backup, ready-made copy, search, the magic-link client, and the presentation helpers (greeting, estimate, due/last-studied labels, sync-status copy, completion copy, stats readouts). All are unit-tested.
- **Test-first exceptions:** three small view-model helpers (`toStatsViewModel`, `hourLabel`, `decksNote`) were written just before their tests (`test/viewModels.test.ts`), not strictly test-first. Everything else was test-first.
- **Copy change:** card validation messages now say Question/Answer instead of Front/Back, and their tests were updated.

**New dependencies (all pre-approved):**

- `lucide-react` 1.53.0: the newest release, 1.54.0, was a day old and failed pnpm's release-age policy.
- `@fontsource-variable/geist` and `@fontsource-variable/geist-mono` 5.3.0.
- `@axe-core/playwright` 4.13.0.

**E2E tests updated for the new design (no assertion weakened):**

- The empty state is now the welcome screen.
- "Study now" → "Start reviewing", and "Study this deck" → "Study deck".
- "Session complete" → "Review complete"; the reviewed count is now read from the completion sentence.
- "N left" → "N of M".
- Front/Back → Question/Answer, and "Done" → "Save and close".
- Rename, delete and edit go through the ⋯ menus and dialogs.
- The manifest name is "Recall".

**New E2E tests:**

- `Space` starts reviewing from Home.
- The undo pill text.
- Undo from the completion screen restores the due date exactly.
- The unsaved-changes guard.
- axe checks on Home, Review and Settings in both themes.

Stable E2E selectors (role/label/testid): `welcome`, `count-total`, `count-reviews`,
`count-new`, `caught-up`, `tomorrow-count`, `deck-due`, `position`, `card-kind`,
`card-front`, `card-back`, `first-card-hint`, `announcer`, `undo-pill`,
`completion-text`, `next-due`, `review-empty`, `deck-meta`, `deck-empty`,
`search-empty`, `decks-empty`, `added-status`, `toast`, `update-banner`,
`storage-persistence`, `sync-status`, `browse-empty`, `duplicate-warning`,
`search-no-results`, `forecast-readout`, `per-day-readout`.

## 4. How to check it yourself

```sh
pnpm install
pnpm --filter @recall/web exec playwright install chromium   # once
docker compose up -d                                         # Postgres, for the API tests in pnpm check

pnpm check                                    # format, lint, typecheck, all unit tests
pnpm e2e                                      # Playwright: flows, offline, PWA, axe (both themes)

# Regenerate the comparison screenshots (390×844 and 1280×800, dark and light)
SCREENSHOTS=1 pnpm --filter @recall/web exec playwright test e2e/screenshots.spec.ts
#   → docs/ui-design/_actual/<screen>-<mobile|desktop>-<dark|light>.png

# Look at it in a browser
pnpm --filter @recall/web dev                 # http://localhost:5173
pnpm --filter @recall/web build && pnpm --filter @recall/web preview   # :4173, with offline support
```

Quick manual pass (about 10 minutes):

1. **Fresh profile.** Open the app: you get the welcome screen. "Create your own deck" → name it → Add card → type a few cards with `Ctrl+Enter`, watching "N cards added to …".
2. **Unsaved-text guard.** Type something, then click Decks: you get the "Discard this card?" dialog.
3. **Home.** Press `Space` to start.
4. **Review.** `Space` shows the answer, `1`–`4` rate, `Z` undoes. Check the "N of M" counter, the progress bar, and the undo pill wording. Finish to see "Review complete" → "Undo last rating" → it comes back.
5. **Theme.** Settings → Theme Light/Dark/System. Switch the OS theme while on "System": it follows live. Reload: no flash.
6. **Backup.** Settings → Export (downloads JSON) → Import the same file: "Everything was already here".
7. **Deck detail.** Use the ⋯ on a card → Delete → Undo toast (dark in both themes).
8. **Stats.** Tab or hover across the bars and watch the readout line change.
9. **Mobile.** Narrow the window below 1024px: the sidebar becomes the top bar + tab bar; the review screen has no navigation at any width.
10. **Offline.** Go offline after one visit (DevTools → Network → Offline) and reload: fonts and everything else still render.
