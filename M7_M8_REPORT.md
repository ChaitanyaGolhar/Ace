# M7 + M8 report: Deck Store and paid decks

_Status: in progress (fast mode). This UI plan was written before the screens were built, as the brief asks for screens without a mock (§7.7)._

## M7: Deck Store

### What was built

- **Deck files (`ace-deck@2`)** are validated in core. Validation is strict: unknown fields are errors, and each error names the card key, the field and the problem. Before publishing, the validator gives the §7.4 warnings, including your amendments.
- **Owner CLI**, `pnpm deck validate | publish [--unlisted] [--yes] | list | unlist`:
  - prints a summary, the warnings and a diff against the previous version;
  - requires the version to be exactly previous + 1;
  - asks first, naming the target database.
- **API:**
  - Migration `0004_deck_store`, additive: `catalog_deck`, plus immutable `catalog_deck_version`.
  - `GET /catalog` (filters, ETag/304), `GET /catalog/:slug` (8 sample cards) and `GET /catalog/:slug/versions/:v`. Paid decks get 403 until M8.
  - There are no write endpoints.
- **App:**
  - **Store list:** chip filters (remembered), subject search, and an offline cache.
  - **Store deck page:** syllabus info, the subject code per branch, units, types, and sample cards on the real review face (nothing recorded). Add uses the duplicate sheet.
  - **Adding** is one Dexie transaction with deterministic card ids, in file order.
  - **Updates:** checked at start and at most every 12 h. The banner shows real plan counts; Update applies the plan in one transaction and shows the result toast. Deck rows get an "Update" tag.
  - **Unit filter:** "Study: All units / Unit N".
- **Removed:** the bundled decks and Browse. Welcome now offers "Find your subject"; existing copies are untouched.
- **Protocol 3:** an M6 app is refused (426) on pull too, and shows "Update required to sync".

### Proof per M7 criterion

| Criterion                                                                                                | Proof                                                                                                                                                                                                                                                                                                                                                                                         |
| -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ace-deck@2` validation: valid fixture, each rule failing readably, unknown fields rejected              | `packages/core/test/deckFile.test.ts`. Includes the valid fixture; one failing fixture per rule (format, slug, version, title, description, year, semester, branches, units, price, date, cards, card shape, keys, unit membership, types, M6 content rules); the pattern being the year only; subjectCodes keys; and unknown fields named at top level, in catalog, cards, units and options |
| Each §7.4 warning, with a triggering and a non-triggering fixture; the PCA and "label" cases             | `deckFile.test.ts` › `deckWarnings`. Covers duplicate questions, deck-level longest-correct (60% warns, 40% doesn't, ties don't count), few key points, a unit without long answers, the marks note, meta key points, and basic/cloze same term (PCA warns; "label" in a front doesn't)                                                                                                       |
| CLI against the test DB: v1 then v2 diff; version skip and duplicate refused; versions immutable; unlist | `apps/api/test/deckCli.test.ts`: "publishes v1, then v2 with the correct diff…", "refuses a version that skips (v3 after v1) or repeats (v1 again)…", "the database refuses UPDATE and DELETE of a published version", "unlist hides the deck from /catalog; its versions stay fetchable…". Also covers answering no, `--yes`, `--unlisted`, list, invalid files and long previews            |
| Catalog endpoints: filters, ETag/304, sample cards                                                       | `apps/api/test/catalog.test.ts` (11 tests). `migration0004.test.ts` covers the migration on a populated M6 database                                                                                                                                                                                                                                                                           |
| `planDeckUpdate`: every §7.6 row, plus version skipping                                                  | `packages/core/test/deckUpdate.test.ts` (12 tests). App level: `apps/web/test/catalog.test.ts` › "applying an update" (every rule through Dexie, skipping v1→v3, applying twice)                                                                                                                                                                                                              |
| Two devices apply the same update offline, then sync: no duplicates, identical state                     | `apps/web/test/integration/syncWithApi.test.ts` › "M7: … both devices apply the same update offline, then sync: no duplicate cards, identical final state" (real API and Postgres). API level: `catalogSync.test.ts`                                                                                                                                                                          |
| Schedule preserved                                                                                       | `apps/web/test/catalog.test.ts` › "schedule preserved: a reviewed card that is updated keeps its CardState and history"                                                                                                                                                                                                                                                                       |
| E2E: Store journey; CLI v2 → banner → Update; offline store                                              | `apps/web/e2e/store.spec.ts`, first three tests                                                                                                                                                                                                                                                                                                                                               |
| Unit filter E2E                                                                                          | `store.spec.ts` › "unit filter: "Study: Unit 2" studies only unit 2's cards". Unit tests: `apps/web/test/unitFilter.test.ts` and core `catalog.test.ts`                                                                                                                                                                                                                                       |
| Old bundled decks removed; existing copies unaffected (fixture DB)                                       | `apps/web/test/catalog.test.ts` › "local database upgrade to version 4" (a v3 database with a ready-made copy). E2E: `store.spec.ts` › "old ready-made decks are gone from the app; existing copies still work" (fixture backup)                                                                                                                                                              |
| Events with no card text, plus analytics SQL                                                             | Core `catalog.test.ts` (schemas) and `events.test.ts` (free-text guard). App: `catalog.test.ts`. E2E: `events.spec.ts` › "store events…". SQL: `catalog_deck_funnel` in `apps/api/analytics.sql`, tested in `analyticsCatalog.test.ts`                                                                                                                                                        |

### Tests changed (spec changes, none weakened)

- **Protocol 2 → 3:** the tests that pinned 2 now use `PROTOCOL_VERSION`, and still check that older and missing versions are refused.
  - The M6 test "pulls still work for old clients" became "since M7, an old pull gets 426", because §7 needs it (D-327).
  - "A newer protocol version is a 400" now uses `PROTOCOL_VERSION + 1`.
- **Bundled decks removed (§7.7):**
  - `readyMadeDecks.test.ts` (build-time bundling) was deleted. Its job is now done by the `ace-deck@2` tests and `pnpm deck validate`.
  - The `addReadyMadeDeck` and welcome-order tests were removed; their store equivalents are in `catalog.test.ts`.
  - `bigDeck.test.ts`, `robbins.spec.ts`, the onboarding, events and real-data specs, and the screenshots now use store decks published through the real CLI.
  - The first-visit test now honestly counts **4 taps** (it was 3).
- **Version pins:** "opens at version 3" became 4 (Dexie v4). The event-type and analytics-query lists gained the M7 entries.

## UI plan: Store (M7)

Everything uses the existing tokens and components: the Browse screen's list rows, the deck page's header, `panel`, `btn-*`, `field`, the Dialog and the review screen's `CardFace`. No new colours. State is shown with an icon and words, never by colour alone.

### Store list (`/store`, replacing "Ready-made decks")

- **Header:** "Store", with a back link to Decks. Under it: "Adding a deck copies its cards to you. Updates come when the author fixes or adds cards."
- **Filters:** three rows of chips (buttons with `aria-pressed`):
  - **Year:** All · FE · SE · TE · BE.
  - **Semester:** All plus the semesters of the chosen year (FE 1–2, SE 3–4, TE 5–6, BE 7–8). With no year chosen, every semester present in the catalog.
  - **Branch:** All plus every branch in the catalog.
  - Then a search field, "Search subjects".
  - Chips wrap on phones. The chosen year, semester and branch are remembered on this device; the search isn't.
- **Rows:** one per deck, each a link to its page.
  - Subject as the heading, the deck title under it.
  - A meta line: "Units 1–5 · 120 cards · MCQ, Fill in the blank, Long answer".
  - On the right, the price ("Free" or "₹49"), and "✓ In your decks" when you already have it.
- **Offline:** a note, "You're offline. Showing the store as it was on 11 Oct." Adding is blocked on the deck page. With nothing cached: "Connect to the internet to see the store."
- **Empty filter:** "No decks match these filters." with a "Clear filters" button.

### Deck page (`/store/:slug`)

- **Header:** back link to the Store, the subject as the title, the deck title as a subtitle.
- **About:** the description. Then a definition list:
  - University · Pattern ("2024 pattern") · Year and semester ("TE · Semester 5").
  - Subject code: the code for the branch you filtered by, otherwise every branch's code ("CSE: PCC301COM · CSE-DS: PCC301CDS"). Branches without a code are left out.
  - Author, and "Last checked 11 Oct 2026".
- **Units:** a list, "Unit 1 · Introduction to DBMS · 24 cards".
- **Types:** "MCQ 40 · Fill in the blank 20 · Short 10 · Long 8 · Basic 42", only the types present.
- **Sample cards:** each rendered with the real review face (`CardFace`) in a panel, with its type tag.
  - You can pick an MCQ option and Check, type a blank and Check, tick key points, or reveal an answer. "Try again" resets the card.
  - No rating buttons, and nothing is recorded.
  - Offline, samples aren't available: "Connect to the internet to see sample cards."
- **Add (free decks):** a primary "Add to my decks" button.
  - Already added: the duplicate sheet, "Add Machine Learning again?" with Add a second copy / Keep one copy.
  - Offline: the button is disabled, with "Connect to the internet to add decks." under it.
  - After adding: the new deck's page, with a toast "Added Database Management Systems".
- **Paid decks (M8):** the price, then the purchase section (below).

### Deck page in your decks (existing screen)

- **Update banner** (catalog decks with a newer version), under the header, as a `panel`:
  - "Update available: 12 changed, 5 new, 2 removed", with an **Update** button.
  - The counts are computed from the plan, so edited cards count as changed.
  - After Update: the toast "Updated: 12 fixed, 5 added, 2 removed, 1 kept your edits."
- **Study, by unit:** for decks whose cards have units, a select next to Study deck: "Study: All units / Unit 1 · Introduction… / Unit 2 …". Study deck starts a session for that unit.
- **Deck rows** (Home, Decks): a small "Update" tag next to the name when an update is available.

### Welcome (first visit)

The bundled-deck cards are replaced by a primary "Find your subject" button (to the Store) and the existing "Create your own deck".
