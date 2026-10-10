# M6 report: Question types

_Status: built on branch `m6-question-types`, **not pushed and not deployed**. M7 not started._

## What was built

Four new card types next to basic, end to end: core model, API, local database, sync, review screen and editor.

| Type              | Review                                                                                        | Rating                                                                                    |
| ----------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Basic             | Unchanged                                                                                     | 1–4                                                                                       |
| Short answer      | Optional "Type your answer" box (never saved) → Show answer → model answer and explanation    | 1–4                                                                                       |
| Multiple choice   | 2–6 options (tap or 1–6) → Check → "Correct answer" ✓ / "Your answer" ✗ (icon and words)      | Wrong: **Continue** = Again. Right: Hard/Good/Easy only                                   |
| Fill in the blank | Type the blank and Check (Enter), or Show answer                                              | Typed right: 2–4. Typed wrong: answer and what you typed, Continue = Again. Revealed: 1–4 |
| Long answer       | "N marks", optional write box → Show key points → tick a checklist → collapsible model answer | All four; the **suggested** one is highlighted and labelled, and updates live             |

- **Core** (`packages/core/src/content.ts`, `schemas.ts`):
  - Strict content schemas per type.
  - `deriveDisplay` (front/back derived from the content, so search, lists and old clients keep working).
  - The cloze matcher.
  - Rating rules (`allowedRatings`, `suggestLongRating`).
  - A strict `outcome` on review logs, which can't hold typed text.
  - Protocol v2 and backup v2.
- **API:**
  - Migration `0003_question_types`: additive and backfilled.
  - Typed cards and outcomes through push and pull.
  - **426 `upgrade_required`** for pushes from old apps.
- **App:**
  - Dexie v3 upgrade (existing cards become basic; one re-pull).
  - Typed-card services.
  - Sync handling for 426: "Update required to sync", no retry loop.
  - Review screen and editor for every type.
  - Undo restores the answered state.
- **Not changed:** scheduling. FSRS only sees the rating; `SCHEDULER_VERSION` is still 1; the golden test and its fixture are byte-identical to `main`.

## Proof per acceptance criterion

All of it runs with `pnpm check` (format, lint, typecheck, unit and integration tests) and `pnpm e2e`. Last run: core **225**, API **67**, web **264** unit and integration tests pass. E2E: see the last line of this section.

| Criterion                                                                    | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Every content validation rule, including every rejection                     | `packages/core/test/content.test.ts` › `CardContentSchema`: strict types and fields; blank text; 2–6 options; ids a–f, unique; `correct` must exist; unique option text, case-insensitively; exactly one non-empty `{{…}}`; 0–10 accepted; 2–12 key points; marks 1–20; 5,000 per field; 20,000 total; basic keeps the legacy limit. `cardModel.test.ts`: type/content mismatch, non-derived front/back, unit/source fields. App: `apps/web/test/typedCards.test.ts` › "rejects invalid content with the field and a readable message". API: `apps/api/test/typedCards.test.ts` › "rejects a card whose front/back aren't derived… (400)" |
| `deriveDisplay` for every type                                               | `content.test.ts` › `deriveDisplay`: basic, mcq, cloze, short, long, deterministic                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Cloze matcher                                                                | `content.test.ts` › `matchCloze`: case, spacing, trailing punctuation, NFC (composed vs decomposed é), accepted spellings, a near miss and empty input fail, inner punctuation kept                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Rating mapping, including long boundaries 0/49/50/74/75/99/100%              | `content.test.ts` › "mcq: wrong → Again only; right → Hard, Good, Easy", "cloze: typed and right → 2–4; typed and wrong → 1; revealed → 1–4", "long: suggestion … at every boundary", "long: works with real checklist sizes". UI state machine: `apps/web/test/answerFlow.test.ts` (23 tests, mutation-checked)                                                                                                                                                                                                                                                                                                                          |
| Golden test unchanged; replay identical with outcomes                        | `git diff main -- packages/core/test/golden.test.ts packages/core/test/fixtures/golden.json packages/core/src/scheduler.ts` is empty. `cardModel.test.ts` › "replay ignores outcomes: identical CardState with and without them"                                                                                                                                                                                                                                                                                                                                                                                                          |
| Migrations: Dexie upgrade, server backfill, history and CardStates unchanged | App: `typedCards.test.ts` › "turns existing cards into basic cards with identical text; logs, states and flags unchanged; re-pull scheduled". Server: `apps/api/test/migration0003.test.ts` (applies 0001–0002 with realistic data, then 0003): backfill, `server_seq` unchanged, every row valid under the M6 schemas, history unchanged, and the pre-M6 API can still insert                                                                                                                                                                                                                                                            |
| Two-client sync of every type, including outcome                             | Against the real API and Postgres: `apps/web/test/integration/syncWithApi.test.ts` › "M6: every card type and review outcome syncs between two devices (studied offline on both)". Also `typedCards.test.ts` › "every type and outcome syncs from one device to another unchanged", plus the clean-vs-dirty pull rules                                                                                                                                                                                                                                                                                                                    |
| Old-client protection: 426 and client banner                                 | API: `typedCards.test.ts` › "a push with no protocolVersion / protocolVersion 1 gets 426 and the database is unchanged". App: `typedCards.test.ts` › "stops syncing with 'Update required to sync', without retrying in a loop; local data untouched". Integration: "a push without the protocol version (an old app) is refused with 426". E2E: `question-types.spec.ts` › "426: an outdated app shows 'Update required to sync' and stops retrying; studying goes on"                                                                                                                                                                   |
| E2E per type, offline too                                                    | `apps/web/e2e/question-types.spec.ts`: multiple choice (wrong → only Continue → rating 1 recorded; right → only 2–4, with keyboard); fill in the blank (typed right, typed wrong, revealed; typed text not stored); short answer (typed text never saved); long answer (ticks move the highlighted suggestion; any rating can be picked; outcome recorded); undo of a typed card; the editor (validation, type-change dialog); **offline** (create and review typed cards with no connection)                                                                                                                                             |
| Axe on the review screen for every type, both themes                         | `apps/web/e2e/a11y.spec.ts` › "Review: every question type (M6), before and after answering" and "Card editor: every type (M6)", in dark and light                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Screenshots for every type at 390 and 1280, both themes                      | `SCREENSHOTS=1 pnpm --filter @recall/web exec playwright test e2e/screenshots.spec.ts -g "question types"`; files listed below                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Backup round-trips every type                                                | `typedCards.test.ts` › "export → import into a fresh device gives identical cards, logs (with outcomes) and states". `cardModel.test.ts` › v2 backup holds every type; v1 backup imports as basic                                                                                                                                                                                                                                                                                                                                                                                                                                         |

E2E result: `pnpm e2e` gives **52 passed**. The 8 skipped are the opt-in screenshot tests, which pass separately (8/8) with `SCREENSHOTS=1`.

## Migration and deploy order

**The API must be live before the new web app.** The current live API uses `z.object`, which silently drops unknown keys. If the new app pushed a typed card to it, the card would be saved as basic. The reverse order is safe: an old app talking to the new API gets 426, and its changes stay on the device until it reloads.

Vercel deploys `main` automatically, so **don't merge into `main` first.**

1. **Make a restore point.** In Neon, create a branch of `ace-recall` (instant, copy-on-write), e.g. `before-m6`.
2. **Push the branch only:** `git push origin m6-question-types`. Vercel builds only a _preview_ for it; production is untouched.
3. **Deploy the API from the branch.** In Render → `recall-api` → Settings, set the branch to `m6-question-types`, then Manual Deploy. On start, `prisma migrate deploy` applies `0003_question_types`. It only adds columns and backfills `content`, which is quick at our size.
   - Check that `https://api.ace.orizenn.com/health` is OK.
   - Until step 4 finishes, people on the live app will see sync errors. Their changes wait on the device and sync once they're on the new version.
4. **Ship the web app:** merge `m6-question-types` into `main` and push. Vercel deploys production.
5. **Point Render back at `main`** (same code now), so later deploys follow `main` as before.
6. **Afterwards:** open the app, take the update banner, check that Settings shows "Synced", and create one card of each type.

## Rollback

- **Database:** no rollback needed. 0003 is additive: `content` is nullable, `type` defaults to `'basic'`, and `outcome` is nullable. The previous API build runs against the migrated schema; `migration0003.test.ts` › "is additive" proves an insert with the old shape works. If something is badly wrong, Neon's `before-m6` branch is the restore point.
- **API only:** redeploy the previous commit on Render. The cost is that the new app's typed fields would be dropped again on push (see the deploy order), so roll back the web app with it.
- **Web app: not a plain "promote previous deployment".** Anyone who opened the new build has a local database at Dexie **version 3**. The old code asks for version 2, and IndexedDB refuses to open a newer database (`VersionError`), so the old build would fail to load for them.
  - To roll back the UI, deploy the previous code with one change: `db.version(3).stores({})` with no upgrade. The schema is identical, so the old code works on it.
  - The old app also pushes without a protocol version, so a rolled-back app would get 426 from the new API. Roll the API back too, or keep it and accept that sync waits.
- **Rolling forward again** is safe for everything except one case. Basic cards, new cards and review history made while rolled back all come through intact (cards without `content` read as basic). The exception: if a _typed_ card's text was edited through the old stack, the new API rebuilds its front/back from the stored `content`, so that edit is lost. Anything an old client stripped is repaired by the one-time re-pull.

## Screenshots

`docs/ui-design/_actual/`, for 390 (mobile) and 1280 (desktop), dark and light:

- `type-mcq-front`, `type-mcq-wrong`
- `type-cloze-front`, `type-cloze-correct`
- `type-short-front`, `type-short-revealed`
- `type-long-front`, `type-long-checked`
- `editor-basic`, `editor-mcq`, `editor-cloze`, `editor-short`, `editor-long`

The existing screens were also re-captured (`welcome`, `robbins-review-*`, `stats`, `settings`, `search`). There are no mocks for the new screens; they follow the UI plan below.

## Decisions

In `DECISIONS.md`, D-319 to D-325. In short:

- **D-319:** content is the source of truth; front/back are derived. Key-order-independent comparisons, because jsonb reorders keys.
- **D-320:** ratings follow from the outcome. Typed text is never stored. Scheduling is unchanged.
- **D-321:** cloze matching is normalised but exact, with no fuzzy matching.
- **D-322:** protocol v2, and 426 for old apps.
- **D-323:** additive server migration, Dexie v3 with one re-pull, backup v2 (v1 still imports).
- **D-324:** review and editor interaction.
- **D-325:** light-theme success and error colours darkened to pass 4.5:1 as text.

Two choices you may want to look at:

- **Undo now restores the answered state for basic cards too.** You re-rate the card straight away instead of revealing it again. The brief asked for this "for every type". Two older E2E undo tests were updated to match.
- **On long-answer cards, digits tick key points, so Enter rates the suggestion.** The brief gives digits to both the key points and the ratings; they can't do both on one screen. The rating buttons stay clickable.

Fixes found along the way:

- **Editor:** leaving an empty field you never typed in no longer shows "can't be empty". The error appearing on blur moved the Save button under the pointer, so the click was lost.
- **Keyboard:** a focused checkbox or radio no longer blocks review shortcuts. Before, it was treated as a text field. Unit test: `apps/web/test/keyboard.test.ts`.
- **Long answer:** the suggested rating button shows its interval as well as "Suggested". It had replaced the interval; the E2E test now checks for both.
- **Editor labels:** the Deck and Card type selects have explicit labels. Wrapped in their labels, every option's text counted as part of the label name.
- **Light theme:** success and error colours made readable as text (D-325).

Existing tests changed, all as spec changes, none weakened:

- `m1-study.spec.ts`: the two undo tests now expect the card back _answered_ (§6.3). They still check the restored due date and the voided log.
- `m3-onboarding.spec.ts`: exported backups are version 2 (D-323).
- `apps/web/test/review.test.ts`: the loaded review card also carries `type` and `content`.
- Fixtures (seed and big-deck backups, unit fixtures) carry the new fields. The seed gains a "Question types" deck for the axe tests and screenshots.

**One thing to know:** in one full E2E run, the test API stopped responding near the end, and the last three sign-in tests failed with "Couldn't reach the server". Its output went nowhere then (`stdio: 'ignore'`), so I couldn't see why. It didn't happen in the next full runs or when those specs ran alone. The harness now writes the API's output to `apps/web/e2e/.tmp/api.log` (git-ignored), so if it happens again the reason is there.

## Verify it yourself in 10 minutes

1. `docker compose up -d`, then `pnpm check`. Expect it all green, with the counts above.
2. `pnpm e2e`. Expect it all green. For just M6: `pnpm --filter @recall/web exec playwright test e2e/question-types.spec.ts e2e/a11y.spec.ts`.
3. Open the app:
   - Run `pnpm --filter @recall/api migrate`, `pnpm --filter @recall/api dev` and `pnpm --filter @recall/web dev`, and open http://localhost:5173.
   - Make a deck. Add one card of each type with the type picker.
   - Try the editor rules: Save stays disabled until the card is valid. A cloze sentence without `{{…}}` shows the error after you leave the field. Switching type from a filled MCQ asks first.
4. Study the deck:
   - **Multiple choice:** pick a wrong option, then Check. You get ✓/✗ with words, and only **Continue**.
   - **Fill in the blank:** type the answer with different case and a full stop, then press Enter. It shows "Correct" and only Hard/Good/Easy.
   - **Long answer:** tick points. The "Suggested" button moves as you tick; you can still press any rating.
   - Press **Z**: the last card comes back answered.
5. **The 426 path** is easiest to see in the E2E test, which runs the real UI against a server answering 426: `pnpm --filter @recall/web exec playwright test e2e/question-types.spec.ts -g 426 --headed`. The banner reads "Update required to sync", with Reload.
6. Look through the screenshots in `docs/ui-design/_actual/type-*` and `editor-*`.

## UI plan (screens without a mock)

_Written before the screens were built (brief §0.7); what was built follows it._

Everything uses the existing tokens and components: the review screen's header, progress bar, sticky footer and rating buttons; `field`, `btn-primary`, `btn-secondary`, `btn-ghost`; the Dialog. No new colours. State is always shown by icon **and** text, never by colour alone.

### Review screen, per type

The header, progress bar, undo pill and completion screen are unchanged. Above the question, the tag row reads "New" or "Review", followed by the type: "Multiple choice", "Fill in the blank", "Short answer" or "Long answer". Basic cards show no type tag.

**Short answer**

- **Layout:** the question, then a collapsed "Type your answer (optional)" toggle that opens a textarea. What you type is never saved.
- **Footer:** "Show answer" (Space).
- **After revealing:** a divider, the model answer, then the explanation in secondary text.
- **Rating:** the usual four rating buttons.

**Multiple choice**

- **Layout:** the question, then the options as a vertical list of large rows ("A Primary key"), in a radio group. Keys 1–6 or a tap select an option.
- **Footer:** "Check" (Enter), disabled until an option is chosen.
- **After checking:**
  - Options are locked.
  - The correct option shows a check icon and "Correct answer".
  - A wrong choice shows a cross and "Your answer".
  - The explanation follows below.
- **Footer, wrong:** a single **Continue** button, recorded as Again, with "Marked as Again" under it. Enter or 1 also continue.
- **Footer, right:** **Hard / Good / Easy**, three columns with intervals as usual, keys 2–4. There's no Again.

**Fill in the blank**

- **Layout:** the sentence with the blank drawn as a gap, then an optional "Show hint" link. Below that, a text field labelled "Your answer" next to a **Check** button (Enter checks, even while typing). Under them, a secondary "Show answer" button.
- **Typed and right:**
  - "Correct" with a check icon.
  - The full sentence with the answer emphasised.
  - Any extra note.
  - **Hard / Good / Easy**.
- **Typed and wrong:**
  - "Not quite" with a cross.
  - "Answer: …" and "You typed: …".
  - The full sentence.
  - **Continue** (Again).
- **Revealed without typing:** the full sentence and all four ratings.

**Long answer**

- **Layout:** the question, with "N marks" as a tag when set. Then a collapsed "Write your answer (optional)" textarea, which isn't saved.
- **Footer:** "Show key points" (Space).
- **After showing the key points:**
  - A checklist of every key point as a large checkbox row. Keys 1–9 toggle.
  - A live line: "3 of 4 key points · Suggested: Good".
  - A collapsible "Model answer" (a `details` element), if there is one.
- **Footer:** all four ratings. The suggested one has the accent border and a "Suggested" label, so it doesn't rely on colour. Changing ticks moves the suggestion. **Enter** rates with the suggestion; any button can be picked instead.
- **Keys:** digits toggle key points on these cards, which is why Enter, not 1–4, is the rating key here (DECISIONS).

**All types**

- **Undo** brings the card back in its answered state, with the choice, ticks or typed-check result restored, so it can be rated again.
- **Shortcuts** never fire inside a text field, except Enter to check.

### Card editor

- **Type picker** at the top: a segmented control on desktop ("Basic · Multiple choice · Fill in the blank · Short answer · Long answer") and a select on phones. Basic is the default.
- **Fields per type:**
  - **Basic:** Question, Answer (as today).
  - **Multiple choice:** Question; options A–F, each with a text field, a "Correct" radio and a remove button (2–6 options, "Add option"); Explanation (optional).
  - **Fill in the blank:** Sentence, with help text "Wrap the answer in {{double braces}}"; Other accepted answers (a list with add and remove, up to 10); Hint (optional); Extra note (optional).
  - **Short answer:** Question, Model answer, Explanation (optional).
  - **Long answer:** Question; Marks (optional, 1–20); Key points (2–12, with add, remove, move up and move down); Model answer (optional).
- **Validation:** a field's error appears next to it once the field has been touched. **Save** stays disabled until the whole card is valid. Errors use the same messages the service would give (core validation).
- **Changing type:** if it would clear filled fields, a dialog asks first ("Change to Multiple choice? The answer and explanation will be cleared."), offering **Change type** or **Keep**.
  - Carried across: the prompt (question, front, or sentence text), the answer (basic answer ↔ short model answer) and the explanation (MCQ ↔ short).
- **Editing** keeps the card id, so the schedule is kept. "Save & add another" (Ctrl/Cmd+Enter) and "Save and close" work as today, and so does the unsaved-changes guard.

### Sync banner

When the server answers 426, the existing top banner reads **"Update required to sync"** with **Reload** and **Later**. Reload checks for the new version, then reloads. Studying keeps working offline. The sync status line reads "Update required to sync" with the error icon.
