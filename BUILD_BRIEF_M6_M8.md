# BUILD BRIEF — M6 to M8: Question types, Deck Store, Paid decks

**Product:** ACE (repo `recall`), live at ace.orizenn.com
**Owner:** Chaitanya
**Status:** Product decisions locked. Build starts at M6.
**Prerequisite:** M1–M4 and the UI redesign are on main. This brief extends BUILD_BRIEF.md; everything there still applies unless this brief overrides it.

---

## 0. How you (Claude Code) must work

1. **One milestone at a time:** M6 → M7 → M8. Stop after each one with a report. Don't start the next until I confirm.
2. **Strict TDD**, same rules as before. Never delete, skip or weaken a test.
3. **The app is live with real users.** Every database change must be:
   - **additive** — add columns and tables; never drop or rename one in the same release;
   - **backfilled** — existing rows get correct values;
   - **safe across versions** — an old cached PWA must not corrupt data written by a new client.

   Each milestone report must include a deploy-order section (API/migrations first, then web) and a rollback note.

4. **`packages/core` stays pure and deterministic.** Scheduling (FSRS replay) must not change. The golden test must stay identical, and `SCHEDULER_VERSION` stays as it is. If you believe it must change, stop and ask.
5. **Pre-approved dependencies:** none new. Ask first.
6. Log decisions the brief doesn't cover in DECISIONS.md, as before.
7. **Design:** follow the existing tokens and components in apps/web. For new screens, match the existing visual language (Foundations, existing screens). Before building, put a short UI plan in the report for any screen that has no mock: the layout in words and the states.

---

## 1. What we're building and why

- **M6 — Question types.** Cards today are front/back text only. SPPU exams are mostly descriptive, so students need multiple choice, fill-in-the-blank, short answer and **long answer with key points**.
- **M7 — Deck Store.** A curated catalog served from the server. Only the owner publishes decks, using a CLI. Students browse by university / year / semester / branch / subject, preview decks, add them, and **receive updates** when a deck is corrected.
- **M8 — Paid decks via unlock codes.** No payment gateway. Students pay the owner by UPI and receive a code; redeeming it unlocks the deck on their account. This tests willingness to pay before a payment integration is built.

## 2. Explicitly out of scope

- Razorpay or any payment gateway, refunds automation, invoices
- Public or third-party deck uploads, creator accounts, payouts
- Ratings, reviews, comments, social features
- AI generation or AI grading of answers
- Images, audio, LaTeX/math rendering, rich text (plain text + line breaks only, as now)
- Multi-select MCQ (exactly one correct option in v1)
- Any change to FSRS parameters or replay logic

---

# M6 — Question types

## 6.1 Card types

| Type    | Purpose                                                           |
| ------- | ----------------------------------------------------------------- |
| `basic` | Existing front/back card                                          |
| `mcq`   | One question, 2–6 options, exactly one correct                    |
| `cloze` | A sentence with exactly one blank                                 |
| `short` | A question with a short model answer (1–3 sentences)              |
| `long`  | An exam-style descriptive question with a checklist of key points |

## 6.2 Data model (in `packages/core`)

The Card keeps its existing fields and gains `type` and `content`:

```ts
interface Card {
  id: UUID;
  deckId: UUID;
  type: 'basic' | 'mcq' | 'cloze' | 'short' | 'long';
  content: CardContent; // discriminated union by type, validated with zod
  front: string; // DERIVED display text: the prompt (used for lists, search, old clients)
  back: string; // DERIVED display text: the answer summary
  unit: number | null; // syllabus unit, optional (used by M7 unit filter)
  sourceKey: string | null; // M7: stable key of the catalog card this was copied from
  sourceHash: string | null; // M7: hash of content as copied from the catalog
  createdAt;
  updatedAt;
  deletedAt;
}

type CardContent =
  | { type: 'basic'; front: string; back: string }
  | {
      type: 'mcq';
      question: string;
      options: { id: string; text: string }[];
      correct: string;
      explanation: string | null;
    }
  | { type: 'cloze'; text: string; accepted: string[]; hint: string | null; extra: string | null }
  | { type: 'short'; question: string; answer: string; explanation: string | null }
  | {
      type: 'long';
      question: string;
      marks: number | null;
      keyPoints: string[];
      modelAnswer: string | null;
    };
```

**Validation rules** (zod, shared by client and server):

- **mcq:** 2–6 options; option ids unique, `a`–`f`; `correct` is one of the ids; option texts unique (case-insensitive).
- **cloze:** `text` contains **exactly one** `{{…}}` with non-empty content. The text inside the braces is the primary answer. `accepted` holds extra accepted spellings (0–10).
- **long:** 2–12 key points, each non-empty; `marks` 1–20 or null.
- **Text lengths:** every text field ≤ 5,000 chars; whole content ≤ 20,000 chars (same total as before).
- **Derivation** in `core`, `deriveDisplay(content) → { front, back }`, deterministic:
  - mcq: front = question plus options as "A. …" lines; back = "B — text" plus explanation;
  - cloze: front = text with the blank as "_____"; back = the full sentence;
  - long: back = key points as "• …" lines.

  Tested.

- **Migration:** existing cards become `type: 'basic'`, `content: { front, back }`, `unit: null`, sourceKey/sourceHash null. This applies on the client (a Dexie version bump with upgrade) and on the server (migration with backfill). Test both against realistic fixtures.

## 6.3 Review behaviour and how each type maps to a rating

Ratings remain 1–4 and the scheduler doesn't change.

| Type  | Flow                                                                                                                                                      | Rating                                                                                                                                                                                                                                                                              |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| basic | Unchanged                                                                                                                                                 | User picks 1–4                                                                                                                                                                                                                                                                      |
| short | Question → optional "Type your answer" box (collapsed by default) → Show answer → model answer and explanation                                            | User picks 1–4                                                                                                                                                                                                                                                                      |
| mcq   | Question + options (tap, or keys 1–6) → Check → correct option marked ✓ and the chosen wrong one marked ✗ (icon + text, never colour alone) → explanation | **Wrong:** a single "Continue" button records **Again (1)**. **Right:** Hard / Good / Easy (2–4); no Again button.                                                                                                                                                                  |
| cloze | Sentence with the blank. Two paths: **type** the answer and press Check, or **Show answer** without typing                                                | **Typed and matches:** Hard / Good / Easy. **Typed and wrong:** shows the correct answer and what you typed, then "Continue" = Again. **Revealed:** user picks 1–4.                                                                                                                 |
| long  | Question (+ "N marks") → optional "Write your answer" box → Show key points → checklist, each tickable → model answer (collapsible)                       | App **suggests** a rating from the share of key points ticked: **< 50% Again · 50–74% Hard · 75–99% Good · 100% Good**. All four buttons are shown, the suggested one is highlighted, and the user can pick any. Ticks happen before rating; changing ticks updates the suggestion. |

**Cloze matching rule** (pure function in core, tested heavily):

- normalise both sides: trim, Unicode NFC, lowercase, collapse whitespace, remove trailing `.,;:!?`;
- correct if the normalised input equals the primary answer or any accepted spelling;
- no fuzzy matching. If students complain, they still have the Show answer path.

**Keyboard (desktop):**

- mcq: 1–6 select, Enter checks;
- cloze: Enter checks;
- long: 1–9 toggle key points, Space shows key points;
- rating keys 1–4 as before.

Shortcuts never fire while typing in an input, except Enter to check.

**Undo** works for every type: it restores the card in its answered state, so you can re-rate it.

## 6.4 ReviewLog outcome

ReviewLog gains an optional `outcome` field, synced like the rest of the log and **never containing typed text**:

```ts
outcome:
  | null
  | { kind: 'mcq'; selected: string; correct: boolean }
  | { kind: 'cloze'; mode: 'typed' | 'revealed'; correct: boolean | null }
  | { kind: 'long'; hit: number; total: number; suggested: 1|2|3|4 }
```

- Replay ignores `outcome`. Add a test that replay output is identical with and without outcomes.
- The schema must make it impossible to store free text in `outcome` (strict object, no string fields beyond the option id).

## 6.5 Card editor

- A type picker at the top of the editor (segmented control; on mobile a select).
- Each type shows its own fields:
  - mcq: options with add/remove (2–6), and a "correct" radio per option;
  - cloze: one text field, with help text "Wrap the answer in {{double braces}}", plus accepted spellings;
  - long: key points list with add/remove/reorder, marks, model answer.
- Validation messages appear next to the field. Save is disabled until the content is valid.
- **Changing type with content filled in** warns that fields not shared by the new type will be cleared.
- Editing keeps the card id, so its schedule is preserved.

## 6.6 Sync compatibility with old clients (important)

An old cached client knows nothing about `type`/`content`. If it pushes a card, last-write-wins could erase the new fields.

- Push requests gain `protocolVersion: 2`.
- The server **rejects pushes with protocolVersion < 2 (or missing) with HTTP 426.**
- On 426 the client shows the existing "Update available — reload" banner, worded as "Update required to sync", and keeps working offline. It must not retry in a loop.
- Pull responses always include all fields. Old clients strip unknown keys and show front/back, so they degrade gracefully read-only.
- Test: a v1 push against the new server gets 426 and the database is unchanged.

## 6.7 M6 acceptance criteria

- [ ] All content validation rules have unit tests, including every rejection case.
- [ ] `deriveDisplay` is tested for every type.
- [ ] Cloze matcher tests: case, spacing, trailing punctuation, Unicode, accepted spellings, and a near-miss that must fail.
- [ ] Rating mapping tests: mcq wrong → 1, right → 2–4 only; cloze typed/revealed paths; the long-answer suggestion at the boundaries (0, 49%, 50%, 74%, 75%, 99%, 100%).
- [ ] The golden scheduler test is unchanged; replay is identical with outcomes present.
- [ ] Migration tests:
  - Dexie upgrade turns existing cards into basic with identical front/back;
  - server migration backfills;
  - existing review history and CardStates are unchanged after the upgrade.
- [ ] Sync of every type between two clients (two-client test extended), including `outcome`.
- [ ] Old-client protection: 426 test plus the client banner test.
- [ ] E2E per type: create in the editor → review → correct rating recorded; mcq wrong → Again; long-answer ticks → suggested rating highlighted. Run offline too.
- [ ] Axe checks pass on the review screen for every type in both themes; screenshots for every type at 390 and 1280 in both themes.
- [ ] Backup export/import round-trips every type.

---

# M7 — Deck Store (owner-published catalog with updates)

## 7.1 Concepts

- **Catalog deck:** a deck published by the owner, identified by a `slug`, with immutable numbered **versions**.
- **Deck file (`ace-deck@2`):** the JSON format the owner writes (§7.2). The CLI validates and publishes it.
- **Student's copy:** adding a catalog deck creates a normal user Deck plus Cards (the student owns and can edit them). Each copy remembers where it came from, so updates can apply.

## 7.2 Deck file format `ace-deck@2`

This exact format is also what ChatGPT generates, so validate it strictly and give helpful error messages (card key + field + problem).

```jsonc
{
  "format": "ace-deck@2",
  "slug": "sppu-te-cse-dbms", // lowercase a-z0-9-, unique, never changes
  "version": 1, // integer; each publish must be previous + 1
  "title": "Database Management Systems",
  "description": "Unit-wise revision for SPPU TE …",
  "catalog": {
    "university": "SPPU",
    "pattern": "2019", // syllabus pattern as printed on the syllabus
    "year": "TE", // FE | SE | TE | BE
    "semester": 5, // 1–8
    "branches": ["CSE", "CSE-DS", "AIDS"],
    "subject": "Database Management Systems",
    "subjectCode": "310241", // or null
    "units": [{ "number": 1, "title": "Introduction to DBMS" }],
  },
  "price": 0, // in paise; 0 = free
  "author": "Chaitanya Golhar",
  "reviewedBy": null,
  "lastVerifiedAt": "2026-10-11", // ISO date
  "cards": [
    { "key": "u1-001", "unit": 1, "type": "basic", "front": "…", "back": "…" },
    {
      "key": "u1-002",
      "unit": 1,
      "type": "mcq",
      "question": "…",
      "options": [
        { "id": "a", "text": "…" },
        { "id": "b", "text": "…" },
        { "id": "c", "text": "…" },
        { "id": "d", "text": "…" },
      ],
      "correct": "b",
      "explanation": "…",
    },
    {
      "key": "u1-003",
      "unit": 1,
      "type": "cloze",
      "text": "A {{primary key}} uniquely identifies each row.",
      "accepted": ["pk"],
      "hint": null,
      "extra": null,
    },
    {
      "key": "u1-004",
      "unit": 1,
      "type": "short",
      "question": "…",
      "answer": "…",
      "explanation": null,
    },
    {
      "key": "u1-005",
      "unit": 1,
      "type": "long",
      "question": "…",
      "marks": 6,
      "keyPoints": ["…", "…", "…"],
      "modelAnswer": "…",
    },
  ],
}
```

Rules:

- `key` is unique within the deck and **never reused** for a different question across versions. That's what lets updates work. Pattern: `u<unit>-<3 digits>`.
- Every card's `unit` exists in `catalog.units`.
- Card fields follow the M6 content rules exactly. Missing optional fields default to null or [].
- Unknown top-level or card fields: reject, with the field name (catches typos in generated files).

## 7.3 Server

New tables (additive migration):

- `catalog_deck` (slug PK, latest published version, status `published | unlisted`, timestamps)
- `catalog_deck_version` (slug, version, the full validated JSON, checksum, card count, card-type counts, publishedAt). **Immutable** once written.

Public, read-only endpoints (no auth needed for free decks):

- `GET /catalog?year=&semester=&branch=&subject=`
  - the latest published version of each listed deck: metadata, card count, type counts, price, lastVerifiedAt;
  - no card content;
  - ETag + Cache-Control.
- `GET /catalog/:slug` — metadata plus **8 sample cards** (deterministic: the first card of each type, then fill in key order) and the version.
- `GET /catalog/:slug/versions/:version` — full content. Free decks: public. Paid decks: M8 rules.

There are **no write endpoints for the catalog.** Publishing happens only through the CLI.

## 7.4 Publishing CLI (owner only)

`pnpm deck validate <file>` — validates only. Prints a summary: cards per unit, per type, warnings.

Warnings (they don't block publishing):

- near-duplicate questions (same normalised text);
- mcq options where the correct option is much longer than the others;
- long answers with fewer than 3 key points;
- units with no long-answer cards.

`pnpm deck publish <file> [--unlisted]`:

- connects with `DATABASE_URL`, so it runs on my machine against the target DB;
- validates and checks that the version is exactly previous + 1;
- prints a **diff against the previous version**: added / changed / removed card keys, with a one-line preview each;
- asks for confirmation (`--yes` skips it, for scripts), then writes the version in one transaction.

`pnpm deck list` shows slug, version, status, price, card count. `pnpm deck unlist <slug>` hides a deck from the store; students who added it keep their copies.

## 7.5 Adding a deck (client)

- Deck gets `source: 'user' | 'prebuilt' | 'catalog'`, `catalogSlug`, `catalogVersion` (synced fields; additive migration).
- Adding fetches the version content and creates one Deck plus Cards in **one Dexie transaction**, with each card's `sourceKey` set to its key, `sourceHash` set to a hash of its content, and `unit` set.
- **Card ids for catalog cards are deterministic:** derived from (local deckId, sourceKey) as a UUID v5-style hash. Then two devices applying the same update produce the same ids, and sync merges them instead of duplicating. Extend the core id schema to accept this form for catalog cards, and test it.
- New cards are introduced in file order (createdAt strictly increasing in file order), as in the Robbins deck work.
- Adding requires the network. Offline, the Store shows the cached catalog with "Connect to the internet to add decks."
- The "add the same deck twice" warning (existing sheet) applies to catalog decks too, matched by `catalogSlug`.

## 7.6 Deck updates

- When online, at app start and at most once every 12 hours, the client compares the `catalogVersion` of each added catalog deck with `GET /catalog`.
- If a newer version exists, the deck page shows a banner: "Update available — 12 changed, 5 new, 2 removed". It also appears as a small badge on the deck row.
- **The update is applied only when the user taps "Update"**, never automatically. Rules, per card key:
  - **changed and unedited** (local content hash == sourceHash): replace the content, update sourceHash. Schedule and history are kept;
  - **changed but edited by the user:** keep the user's version and count it as "kept your edits";
  - **new:** add (deterministic id), introduced after existing new cards;
  - **removed and unedited:** tombstone (review logs are kept);
  - **removed but edited:** keep.

  Then set `catalogVersion`. All in one Dexie transaction, with a result toast: "Updated: 12 fixed, 5 added, 2 removed, 1 kept your edits."

- Updates sync to other devices through normal sync. A second device opening the same deck sees it's already on the latest version.
- Skipping versions (v1 → v4) applies the diff between the local version and the latest directly.

## 7.7 Store UI

Replaces "Browse ready-made decks". No mock exists, so put a UI plan in the report before building. Use the existing components and the visual language of the Browse screen and Deck details.

**Store list:**

- filter chips for Year, Semester, Branch (defaults remembered locally) and search by subject;
- deck rows show subject, title, unit range, card count, the types present, a price ("Free" or "₹49") and "In your decks" if already added.

**Deck detail:**

- description, syllabus info (university, pattern, year, semester, subject code), unit list with card counts;
- types breakdown, "Last checked {date}", author;
- **sample cards rendered with the real review components** in preview mode: tappable, but nothing is recorded;
- an Add button (free) or the M8 purchase section (paid).

**Unit filter on the deck page:** "Study: All units ▾ / Unit 1 / Unit 2 …" uses `unit` to scope the study queue for that deck (`buildQueue` gets an optional `unit` filter; tested). This makes in-sem revision of only units 1–2 possible.

**Remove the bundled prebuilt decks:**

- the build-time `content/decks` bundling and the Welcome screen's bundled deck;
- the Welcome screen links to the Store instead ("Find your subject").

Existing users' copies of the old decks are untouched.

## 7.8 M7 acceptance criteria

- [ ] `ace-deck@2` validation tests:
  - a valid fixture passes;
  - each rule has a failing fixture with a readable error;
  - unknown fields are rejected.
- [ ] CLI tests (against the test DB):
  - publish v1, then a v2 with changes, prints the correct diff;
  - version-skip and duplicate-version are refused;
  - published versions can't be modified;
  - unlist hides the deck from `/catalog` but its version content stays fetchable for existing owners.
- [ ] API tests for the catalog endpoints, including filters, ETag/304 and sample-card selection.
- [ ] Update-rule tests in `core` (pure function `planDeckUpdate(localCards, fromVersion, toVersion) → plan`): every row of the §7.6 table, plus version skipping.
- [ ] Two-device test: both devices apply the same update offline, then sync — no duplicate cards, identical final state.
- [ ] Schedule preserved: a reviewed card that's updated keeps its CardState.
- [ ] E2E:
  - Store → filter → detail → preview a sample card → Add → study a card;
  - publish v2 with the CLI → the app shows the update banner → Update → the changed card shows the new text;
  - offline: the Store shows the cached list and blocks Add with the message.
- [ ] Unit filter E2E.
- [ ] Old bundled decks removed; existing users' copies unaffected (test with a fixture DB).
- [ ] Events (no card text): `store_opened`, `catalog_deck_viewed {slug}`, `catalog_deck_added {slug, version}`, `deck_update_applied {slug, from, to}`. Add analytics SQL: per deck, views → adds → users with ≥1 review → users still reviewing after 7 days.

---

# M8 — Paid decks via unlock codes

## 8.1 Model

- `price > 0` (paise) in the deck file makes a deck paid.
- New tables (additive):
  - `unlock_code`: id, **hash of the code** (never store the plaintext), slugs[] (one or more decks, allowing bundles), maxRedemptions (default 1), redemptionCount, expiresAt (nullable), note (free text, owner only, e.g. "UPI 11 Oct Rahul"), createdAt, disabledAt;
  - `entitlement`: (userId, slug) unique, source (`code`), codeId, createdAt.
- Code format: `ACE-XXXX-XXXX-XX`, using Crockford base32 (no I, L, O, U). At least 50 bits of randomness from a CSPRNG. Matching is case-insensitive and ignores dashes and spaces.

## 8.2 Server

- `POST /entitlements/redeem {code}` (auth required):
  - finds the code by hash, with a constant-time comparison;
  - checks it isn't disabled, expired or used up;
  - creates the entitlements and increments `redemptionCount`, **in one transaction with a row lock**, so two simultaneous redemptions of a one-use code can't both succeed;
  - returns the unlocked slugs.

  Redeeming a code you already redeemed is idempotent (returns success, no double count).

- Rate limits: 5 attempts per minute per user, 20 per hour per IP. Failed attempts are logged without the code.
- `GET /entitlements` returns the user's unlocked slugs.
- `GET /catalog/:slug/versions/:version` for a paid deck needs a signed-in user with an entitlement, otherwise 403. This also covers updates.
- Error format as before. Messages: "This code isn't valid", "This code has already been used", "This code has expired".

## 8.3 CLI (owner only)

- `pnpm codes create --deck <slug> [--deck <slug2>] --count N [--max-uses 1] [--expires 2026-12-31] --note "…"` prints the plaintext codes **once**, then stores only hashes.
- `pnpm codes list [--deck <slug>]` shows code id (not plaintext), note, uses, status.
- `pnpm codes disable <id>`.
- `pnpm sales` prints redemptions per deck per day.

## 8.4 Client

On a paid deck's detail page, below the sample cards:

- the price;
- **How to buy** — text from server config (`PURCHASE_INSTRUCTIONS` env, Markdown-free plain text with line breaks), e.g. a UPI ID and WhatsApp number. **Not hardcoded in the client;**
- **"Have a code?"** with an input and a Redeem button.

Behaviour:

- If signed out: "Sign in to unlock" goes to the existing sign-in flow and returns to this page afterwards.
- On success: "Unlocked", and the deck is added immediately.
- Unlocked decks show "Owned" in the Store.
- **Once added, a paid deck works offline exactly like any other deck.** Its content isn't protected beyond that (accepted).
- Signing in on a new device: owned decks show "Owned — Add". They aren't auto-added, so they don't clutter the device.

## 8.5 M8 acceptance criteria

- [ ] Code generation tests:
  - format;
  - entropy source is the CSPRNG (no Math.random);
  - normalisation of user input.
- [ ] Redemption tests:
  - valid, invalid, expired, disabled, used-up;
  - idempotent re-redeem;
  - multi-deck code;
  - **concurrency:** 10 parallel redemptions of a one-use code → exactly one succeeds.
- [ ] Rate-limit tests.
- [ ] Access tests: a paid version's content returns 403 without an entitlement and 200 with one; a free deck needs no auth.
- [ ] No plaintext codes in the DB or logs (a test scans the table and the captured logs).
- [ ] E2E: sign in → paid deck → redeem a code created by the CLI → deck added → study offline.
- [ ] Events: `purchase_info_viewed {slug}`, `code_redeemed {slugs}`, `code_redeem_failed {reason}` (never the code itself). Analytics SQL: per paid deck, detail views → purchase-info views → redemptions → studied after 7 days.

---

## 9. Reports

At the end of each milestone, write `M6_REPORT.md` / `M7_REPORT.md` / `M8_REPORT.md` with:

- what was built;
- proof per acceptance criterion (test name or command);
- **migration and deploy order;**
- rollback notes;
- screenshots path;
- decisions;
- how I can verify it myself in 10 minutes.

Then stop.
