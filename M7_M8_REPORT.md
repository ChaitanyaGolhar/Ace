# M7 + M8 report: Deck Store and paid decks

_Status: **both live** on 11 Oct 2026. M7 went live at 04:01 IST and M8 at 05:20 IST, on main `dd7934e`. Built in fast mode, per your rules. The UI plan at the end was written before the store screens were built, as §7.7 asks._

## What's live

- **Store** at `/store`: browse by year, semester and branch, search, sample cards, Add, updates with a banner, and a unit filter. It's empty until you publish (the production catalog has 0 decks).
- **Paid decks:** a paid deck's page shows the price, "How to buy" (your `PURCHASE_INSTRUCTIONS`, placeholder text for now) and "Have a code?". Redeeming an `ACE-XXXX-XXXX-XX` code adds the deck at once. The store shows "Owned".
- **Owner tools,** run from the repo root against production: `pnpm deck validate|publish|list|unlist`, `pnpm codes create|list|disable`, `pnpm sales`.
- **Protocol 3:** the M6 app is refused and told to update. "Reload" now updates in one tap.
- **Your data:** untouched. Production decks, cards and review logs are byte-identical before and after both deploys (md5 checks below). The Neon restore branches `before-m7` and `before-m8` exist and never expire.

**Your actions:**

1. **Publish** the AI (CSE + CSE-DS) and ML (AIDS) Unit 1 decks. Commands are in [Publishing a deck](#publishing-a-deck).
2. **Set the purchase text:** add `PURCHASE_INSTRUCTIONS` on Render (see [The purchase text](#the-purchase-text)). Until then, paid decks show "Paid decks are sold by the deck author. Payment details will appear here soon."
3. **Rotate secrets:** the Neon password and the Resend key are still pending, by your choice.

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

## M8: Paid decks

### What was built

- **Codes:** `ACE-XXXX-XXXX-XX`, Crockford base32, 50 bits from `crypto.randomBytes`.
  - What a student types is normalised: case, spaces and missing dashes don't matter; I/L read as 1, O as 0; the `ACE` prefix is optional.
  - Only a scrypt hash is stored. The plaintext appears once, in the output of `pnpm codes create`.
- **Migration `0005_paid_decks`** (additive):
  - `unlock_code` (hash, decks, max/count uses, expiry, note, disabled), `unlock_redemption` and `entitlement`;
  - CHECK constraints so a code can't be used more times than allowed.
- **API:**
  - `POST /entitlements/redeem` runs in one transaction with the code row locked. Re-redeeming your own code is idempotent, and one code can unlock several decks.
    - Error messages: "This code isn't valid", "This code has already been used" and "This code has expired".
    - Rate limits: 5 attempts a minute per user, 20 an hour per IP. Failures are logged with the reason only.
  - `GET /entitlements` and `GET /purchase-info` (the text from `PURCHASE_INSTRUCTIONS`).
  - Paid versions need a signed-in user with the entitlement (403 otherwise, `Cache-Control: private`). That covers updates too.
- **App** (paid deck page, below the sample cards):
  - the price, **How to buy** (server text) and **Have a code?** with Redeem;
  - signed out: **Sign in to unlock**, which comes back to the deck after the magic link;
  - on success: "Unlocked — added …", and the deck opens. Once added, a paid deck works offline like any other;
  - the store shows **Owned**; on a new device the page shows "Owned" with Add, never added automatically;
  - events: `purchase_info_viewed {slug}`, `code_redeemed {slugs}` and `code_redeem_failed {reason}`, never the code.
- **Owner CLI:** `pnpm codes create | list | disable` and `pnpm sales`.
- **Analytics:** `paid_deck_funnel`.
- **Fixes found in the M7 deploy:**
  - "Update required to sync" → Reload now waits for the new service worker and activates it, so one tap is enough.
  - The catalog's 304s now work behind Render's compression (weak ETags).

### Proof per M8 criterion

| Criterion                                                                                          | Proof                                                                                                                                                                                                                                                                                                       |
| -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Code generation: format; CSPRNG, no Math.random; input normalisation                               | `apps/api/test/paid.test.ts` › "code generation": the format over 200 codes; `RANDOM_SOURCE === crypto.randomBytes`; a scan of `src/paid` for `Math.random`; 2,000 codes with no duplicates. Normalisation: `packages/core/test/unlockCode.test.ts`                                                         |
| Redemption: valid, invalid, expired, disabled, used-up; idempotent; multi-deck; 10-way concurrency | `paid.test.ts` › "POST /entitlements/redeem". "10 parallel redemptions of a one-use code by 10 people → exactly one succeeds" checks 1×200, 9×409, a count of 1 and 1 entitlement                                                                                                                           |
| Rate limits                                                                                        | `paid.test.ts` › "rate limits": the 6th attempt in a minute is 429 and allowed again a minute later; 20 an hour per IP across users                                                                                                                                                                         |
| Access: paid 403 without the entitlement, 200 with it; free needs no auth                          | `paid.test.ts` › "access to paid content (§8.2)": signed out, signed in without, and with the entitlement (v1 and the v2 update); another paid deck stays 403; private cache; a free deck with no session                                                                                                   |
| No plaintext codes in the DB or logs                                                               | `paid.test.ts` › "no plaintext codes in the database or the logs": after create, an ok redeem, a failed redeem and list, it scans every row of 6 tables and the captured logs for each code, in 3 forms. App side: `apps/web/test/entitlements.test.ts` › "the code itself is never stored on the device"   |
| E2E: sign in → paid deck → redeem a CLI-created code → added → study offline                       | `apps/web/e2e/paid.spec.ts`, first test. It uses the real `pnpm codes create`, a wrong code first, then the right one typed loosely. Also "Sign in to unlock" returning to the deck, and "Owned — Add" on a second device                                                                                   |
| Events with no code; analytics SQL per paid deck                                                   | `entitlements.test.ts`, `paid.spec.ts` (events read from IndexedDB) and core `events.test.ts`. SQL: `paid_deck_funnel` (viewers → purchase-info viewers → redeemers → studied 7+ days after unlocking), tested in `analyticsCatalog.test.ts`. Migration: `migration0005.test.ts` on a populated M7 database |

**Totals on `dd7934e`:**

- `pnpm check`: core 327, API 128 and web 289 tests, all passing.
- `pnpm e2e`: 63 passed; the 8 screenshot captures skip unless `SCREENSHOTS=1`.

### Tests changed in M8

- **`a11y.spec.ts`** now runs with reduced motion. During the M8 run, axe once caught the Check button 150 ms into its fade from disabled to enabled, and flagged its contrast. The app turns transitions off under reduced motion, so axe now measures settled colours. The check itself is unchanged.
- The run that showed it also had one test time out. The PC went into Modern Standby (04:26–05:01, in the Windows event log) and froze the browser mid-load. A clean rerun passed. Since then a keep-awake process holds the system awake; it changes no power settings.
- **The "Paid decks open soon" text** from M7 is gone, replaced by the purchase section. No test asserted it.

## Deploy logs (IST, 11 Oct 2026)

Both deploys followed DEPLOY.md: restore branch → baseline → API from the feature branch (migrates) → mixed-version check → main (Vercel) → Render back to main → verify → clean up.

### M7

| Time        | Step                                                                                                                                                                                                          |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 03:41–03:44 | Neon branch `before-m7` (`br-odd-leaf-b3vo686s`, from production, never expires). Baseline: decks 5, cards 1059, logs 36, with md5s of every row                                                              |
| 03:44       | Pushed `m7-deck-store` (`fc5869e`)                                                                                                                                                                            |
| 03:46–03:48 | Render branch → `m7-deck-store`. Deploy `dep-db5bia8473hc73ailcs0`: "Applying migration `0004_deck_store`", all applied, live                                                                                 |
| 03:48       | **Mixed version:** the M6 app (profile B) got push → 426, banner "Update required to sync" with Reload/Later. `/catalog` → 200 `{decks: []}`, `Cache-Control: public, no-cache`                               |
| 03:48–04:01 | main → `248e979` pushed; Vercel live at 04:01 (`index-uTS3OyP5.js`)                                                                                                                                           |
| 04:02–04:06 | Render back on main (`dep-db5bq48473hc73ajesp0`), live. Post-deploy SQL identical (same counts and md5s). Profile B, after relaunch: M7 bundle, Dexie v4, Synced. Signed out (204, old cookie → 401), deleted |
| Finding     | Reload on the 426 banner needed a second tap (the new service worker was waiting). Fixed in M8 (D-342)                                                                                                        |

### M8

| Time        | Step                                                                                                                                                                       |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 05:08–05:10 | Neon branch `before-m8` (`br-bitter-moon-b3so2lw2`, from production, never expires). Baseline: decks 5, cards 1059, logs 58, seqs 1163/1169/1238, md5s; catalog 0; users 1 |
| 05:10       | Pushed `m8-paid-decks` (`dd7934e`). Profile B signed in on the M7 app (`index-uTS3OyP5.js`) and Synced                                                                     |
| 05:15–05:17 | Render branch → `m8-paid-decks`. Deploy `dep-db5cslajnfac73a1kih0`: "Applying migration `0005_paid_decks`", all applied, live                                              |
| 05:18       | Checks: `/health` ok; `/purchase-info` → placeholder; `/entitlements` and `/entitlements/redeem` → 401 without a session; `/catalog` weak ETag → **304** (fixed)           |
| 05:18       | **Mixed version:** the M7 app against the M8 API: push 200, pull 200, Synced, no banner (M8 doesn't change the protocol)                                                   |
| 05:19–05:20 | main → `dd7934e` pushed; Vercel live at 05:20 (`index-spV3x5Gs.js`)                                                                                                        |
| 05:21–05:23 | Render back on main (`dep-db5cuko473hc73an6cpg`): "No pending migrations to apply", live                                                                                   |
| 05:24       | Post-deploy SQL **identical** (decks 5, cards 1059, logs 58, same seqs and md5s). New tables empty. `_prisma_migrations` 0001–0005                                         |
| 05:26       | Profile B: **one tap** on the update banner's Reload → M8 bundle, Synced. Signed out (204, old cookie → 401, 0 cookies) and deleted                                        |

**Notes:**

- **No secrets or env vars changed.** I didn't add `PURCHASE_INSTRUCTIONS`. Render's bulk editor showed the existing values (including `DATABASE_URL` and `RESEND_API_KEY`) as empty fields, so saving risked blanking them. I cancelled without saving; the app shows the placeholder until you add it.
- **The PC was locked** for this deploy. I drove the Render and Neon pages through page scripts, then verified each step by reading the page.
- **No paid deck was created in production** to test redemption live. It would have put a test deck and codes in your real store. The E2E covers that flow against a real API and Postgres.

## Rollback

- **Web:** in Vercel, promote the previous deployment (`index-uTS3OyP5.js` for M7; before that, M6).
- **API:** in Render, roll back to `dep-db5bq48473hc73ajesp0` (M7). Migrations 0004 and 0005 only add tables and columns, so an older API runs on the newer schema.
- **Data:** the Neon branches `before-m8` and `before-m7` hold production as it was before each deploy. Restore via Neon → Branches → production → Restore from `before-m8`. Only for data loss, which hasn't happened.

## 10-minute phone check

On your phone, at https://ace.orizenn.com:

1. **Update (1 min).** Open the app. If the banner says "Update available — reload", tap **Reload once**; it should come back updated, without a second tap. Settings → "Synced".
2. **Your data (1 min).** Home shows your decks and due count as before. Open your M6 deck and check its cards.
3. **Store (2 min).** Decks → **Store**, or "Find your subject" on a fresh install. It's empty until you publish. After publishing (below), filter TE → Sem 5/6 → your branch and open a deck: you should see units, types and sample cards. Try one sample (MCQ Check), then **Add to my decks**, which opens the deck.
4. **Unit filter (1 min).** On that deck, "Study: Unit 1" → Study deck → the header reads "… · Unit 1".
5. **Offline (1 min).** Airplane mode → Store shows "You're offline. Showing the store as it was on …", and Add is disabled. Your added deck still studies. Airplane mode off.
6. **Update flow (2 min).** Publish v2 of a deck you added (change one card), reopen the app, open the deck. You should see the banner "Update available: 1 changed" → **Update** → the toast.
7. **Paid (2 min), if one of your decks is paid** (`price` > 0). Signed out, its page shows the price, How to buy (placeholder until set) and **Sign in to unlock**. Then:
   - Create a code (below) and sign in; you return to the deck page.
   - Type the code in lower case with spaces → **Redeem** → "Unlocked — added …".
   - The Store row says **Owned**.
   - Typing the same code on another account says "This code has already been used".

## Owner commands

All run from the repo root, `C:\Users\chaitanya\Desktop\recall`, in PowerShell. They need production's **direct** (not pooled) connection string: Neon → Connect → production, with "Connection pooling" off. It only lives in that terminal session:

```powershell
$env:DATABASE_URL = '<paste the Neon direct connection string>'
```

Without it, the commands use `apps/api/.env`, which is your local dev database. Check which one each command used:

- `pnpm deck publish` and `unlist` name the host and database and ask first.
- `pnpm codes create` says where the codes were stored ("… in ep-….neon.tech/neondb (they work only there)"). If it names `localhost/recall_dev`, those codes won't work for buyers.

### Publishing a deck

```powershell
pnpm deck validate <path\to\deck.json>   # errors and §7.4 warnings, nothing written
pnpm deck publish <path\to\deck.json>    # summary, warnings, diff → asks "Publish … to <host>/neondb?"
pnpm deck list                           # what's published
pnpm deck unlist <slug>                  # hide from the Store (copies and versions stay)
```

For your three Unit 1 files, run validate then publish on each, for example `pnpm deck publish C:\Users\chaitanya\Desktop\decks\sppu-te-cse-ai-u1.json`.

- The first publish of a slug must be `"version": 1`; each update is exactly +1.
- `--unlisted` publishes without showing it in the Store; `--yes` skips the question.
- For a paid deck, set `"price"` in paise (`4900` = ₹49).

### Unlock codes

```powershell
pnpm codes create --deck <slug> --count 1 --note "UPI 11 Oct Rahul"   # prints the code(s) ONCE — copy them now
pnpm codes create --deck <slug> --deck <slug2> --count 1 --note "bundle, UPI 12 Oct Priya"   # one code, two decks
pnpm codes create --deck <slug> --count 5 --max-uses 1 --expires 2026-12-31 --note "class batch"
pnpm codes list [--deck <slug>]        # id, status, uses, decks, expiry, note (never the code)
pnpm codes disable <id>                # the 8-character id from list
pnpm sales                             # redemptions per day (India time) per deck
```

- `--note` is required, so every code traces back to a payment.
- `--expires` lasts through the end of that day, India time.
- `--count` can be at most 1000.

### The purchase text

Render → **recall-api** → **Environment** → **Edit** → **Add variable**:

- Key: `PURCHASE_INSTRUCTIONS`.
- Value: plain text, typing `\n` where a line should break. For example: `Pay ₹49 by UPI to yourname@upi.\nThen WhatsApp the screenshot to +91 …; you'll get a code.`

Before saving, check that the other variables still show their values. Then **Save, rebuild, and deploy**. No app update is needed: the text comes from the server.

## Decisions

All decisions are in DECISIONS.md: D-326…D-336 for M7 and D-337…D-343 for M8. The M8 ones cover:

- code storage (scrypt with a fixed salt, and why);
- redemption semantics: a disabled code reads as "isn't valid";
- paid access, which covers every version;
- the purchase screen, including no auto-add on new devices;
- the owner CLIs;
- the one-tap Reload;
- weak ETags.

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
