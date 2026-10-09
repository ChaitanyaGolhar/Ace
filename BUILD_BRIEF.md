# BUILD BRIEF — Offline-First Spaced-Repetition App

**Working name:** `recall` (placeholder, used for package names; will be renamed later)
**Owner:** Chaitanya
**Status:** Product decisions locked. Build starts at M0.

---

## 0. How you (Claude Code) must work on this project

1. **One milestone at a time.** Start with M0. Do not begin the next milestone until the current one meets every acceptance criterion and I have reviewed it.
2. **Strict TDD.** For every unit of behaviour: write the failing test → implement → refactor. Do not write implementation code without a test that drove it, except pure UI layout.
3. **At the end of each milestone, stop and report:**
   - what was built;
   - how I can verify it myself (exact commands and manual steps);
   - any decision you had to make that this brief did not cover.
4. **Don't expand scope.** If something is not in this brief, ask before adding it. Section 3 lists things that are explicitly out of scope.
5. **Ask before adding a dependency** that isn't listed in section 4.
6. **`packages/core` is sacred:**
   - It must stay pure: no I/O, no `Date.now()` inside logic (time is always passed in), no randomness.
   - It must stay deterministic. Every change to it needs tests.
7. **Use TypeScript `strict` everywhere.** No `any` without a comment explaining why.
8. **Explain non-obvious code briefly** in comments or the milestone report. I review everything you write, and I am using this project to learn.

---

## 1. Product summary

A web app (installable as a PWA) that helps students remember what they study, using spaced repetition.

- The user studies flashcards and rates how well they recalled each one.
- The FSRS algorithm schedules the next review.
- **It works fully offline.** You can study with no network, and everything syncs when you're back online.
- **It needs no account to start.** You only sign in to sync across devices.

**Goals of this project (in priority order):**

1. Learn to build a robust offline-first system with correct sync.
2. Learn product design for a daily-habit app.
3. Put it in front of real students, collect feedback, and learn about retention.

---

## 2. Locked product decisions

| Area | Decision |
|---|---|
| Card type (v1) | Basic flashcard only: `front` (plain text), `back` (plain text). Line breaks are preserved. No markdown, images, or cloze yet. |
| Rating | Self-rated after revealing the answer: **Again (1), Hard (2), Good (3), Easy (4)** |
| Scheduler | `ts-fsrs`, default parameters. No custom algorithm. |
| Card sources | User-created cards, plus prebuilt decks that ship with the app. AI generation comes later and is out of scope. |
| Source of truth | **The append-only review log.** Card scheduling state is *derived* by replaying the log. |
| Offline | Fully functional offline: create, edit, study and see stats. Sync only needs the network. |
| Accounts | Optional. The app works anonymously on one device; signing in enables sync. |
| Study day | Starts at **04:00 local time** (rollover hour, configurable). |
| New cards/day | Default **20**, configurable per user (global setting, not per deck, in v1). |
| Review limit | None in v1. |
| Missed days | No penalty logic. Overdue cards are simply due; FSRS handles the overdue interval. |

---

## 3. Explicitly out of scope (do not build)

- MCQ, fill-in-the-blank, short answer, cloze, images, audio, rich text
- AI card generation and any LLM calls
- Native mobile apps
- Social features, sharing, public deck marketplace, leaderboards
- Streak mechanics and gamification
- Payments
- Custom FSRS parameter optimisation (default params only)
- Background Sync API (sync only while the app is open)
- Microservices, Redis, queues, WebSockets
- Multi-user collaborative editing of a deck

---

## 4. Tech stack

**Monorepo:** pnpm workspaces, Node 24, TypeScript strict.

```
recall/
├── packages/
│   └── core/          # pure domain logic, shared by web + api
├── apps/
│   ├── web/           # Vite + React PWA (local-first)
│   └── api/           # Express 5 sync + auth server
├── content/
│   └── decks/         # prebuilt decks as JSON (bundled into web at build time)
├── docker-compose.yml # local Postgres
└── BUILD_BRIEF.md
```

| Layer | Choice |
|---|---|
| Domain | `packages/core`: TypeScript, `ts-fsrs`, `zod` |
| Web | Vite, React 18+, TypeScript, Tailwind CSS, React Router, `vite-plugin-pwa` (Workbox), Dexie (IndexedDB), `dexie-react-hooks` |
| API | Express 5, TypeScript, Prisma, PostgreSQL (Docker locally, Neon in production), `zod` request validation |
| IDs | **UUID v7**, generated on the client (time-ordered, globally unique) |
| Testing | Vitest (all packages), `fake-indexeddb` for Dexie tests, Supertest for the API, Playwright for E2E (including offline mode) |
| Lint/format | ESLint + Prettier |

> **ts-fsrs note:** check the installed version's API (e.g. `fsrs()`, `createEmptyCard()`, `Rating`, `scheduler.next(card, now, rating)`) against its README. Do not assume method names from memory. Wrap it behind our own interface in `core` so the rest of the code never imports `ts-fsrs` directly.

---

## 5. Domain model

### 5.1 Entities (synced)

```ts
type UUID = string; // uuid v7

interface Deck {
  id: UUID;
  name: string;
  source: 'user' | 'prebuilt';
  prebuiltId: string | null;   // which content/decks/*.json it came from
  createdAt: number;           // epoch ms
  updatedAt: number;           // epoch ms, set on every edit
  deletedAt: number | null;    // tombstone; sticky: once set, never cleared (invariant 9)
}

interface Card {
  id: UUID;
  deckId: UUID;
  front: string;
  back: string;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
}

interface ReviewLog {
  id: UUID;                    // generated on device → idempotency key
  cardId: UUID;
  rating: 1 | 2 | 3 | 4;
  reviewedAt: number;          // epoch ms, device clock
  durationMs: number;          // time from card shown to rating
  deviceId: string;
  voidedAt: number | null;     // set by "undo"; can only go null → value, never back
}
```

### 5.2 Derived (never synced; always recomputable)

```ts
interface CardState {
  cardId: UUID;
  due: number;                 // epoch ms
  stability: number;
  difficulty: number;
  reps: number;
  lapses: number;
  state: 'new' | 'learning' | 'review' | 'relearning';
  lastReviewedAt: number | null;
  learningSteps: number;       // current (re)learning step index; ts-fsrs reads it (added in M0)
}
```

### 5.3 Invariants (each one needs at least one test)

1. **ReviewLogs are append-only.** The only permitted mutation is setting `voidedAt` from null to a timestamp, and it never goes back to null.
2. **CardState is a pure function:** `replay(card, logs, params)`.
3. **Replay is order-independent:** logs are sorted inside `replay` by `(reviewedAt, id)`. Shuffled input gives identical output.
4. **Replay is duplicate-proof:** logs with the same `id` count once.
5. **Voided logs are ignored** by replay.
6. **Deleted cards and decks (tombstoned)** never appear in queues or stats. Their logs are kept.
7. **Deck/card conflicts resolve last-write-wins:** if exactly one version is tombstoned, it wins (invariant 9). Otherwise compare `updatedAt`; if equal, the higher `id` (lexical) wins; if still tied (two versions of the same row share an `id`), a deterministic comparison of the row contents decides. `lww(a, b)` and `lww(b, a)` always give the same result.
8. **Changing FSRS params or the replay logic** bumps `SCHEDULER_VERSION` in `core`. On startup, if the stored version differs, every CardState is rebuilt by replay. This is the entire migration strategy.
9. **Tombstones are sticky.** `deletedAt` is monotonic: once set, it never clears. In `lww`, a tombstoned version beats any non-tombstoned version regardless of `updatedAt`; if both are tombstoned, the normal rules apply. A tombstone survives any sequence of merges, in any order.

---

## 6. `packages/core` specification

All functions are pure. Time is always passed in as `now: number`.

```ts
// scheduling
export const SCHEDULER_VERSION: number;
export function initialState(card: Card): CardState;
export function applyReview(state: CardState, log: ReviewLog, params?: SchedulerParams): CardState;
export function replay(card: Card, logs: ReviewLog[], params?: SchedulerParams): CardState;
export function previewIntervals(state: CardState, now: number, params?: SchedulerParams): Record<1|2|3|4, number>; // ms until due per rating, for the buttons

// study day
export function studyDayKey(at: number, timeZone: string, rolloverHour: number): string; // e.g. "2026-10-10"
export function endOfStudyDay(now: number, timeZone: string, rolloverHour: number): number; // first instant of the next study day

// queue
export interface QueueInput {
  decks: Deck[]; // added in M0: cards of a tombstoned or unknown deck are excluded (invariant 6)
  cards: Card[]; states: Map<UUID, CardState>; logs: ReviewLog[];
  now: number; timeZone: string; rolloverHour: number; newPerDay: number;
  deckId?: UUID; // optional filter
}
export interface Queue {
  due: UUID[];           // review cards due today + learning/relearning cards due now (§6.1), ordered by due asc
  newCards: UUID[];      // new cards allowed today, ordered by createdAt asc
  learnAheadNext: { cardId: UUID; due: number } | null; // learning card due within 20 min
  counts: { due: number; new: number; learning: number }; // disjoint: review due / new / learning+relearning due
}
export function buildQueue(input: QueueInput): Queue;

// conflict resolution
export function lww<T extends { id: string; updatedAt: number; deletedAt: number | null }>(a: T, b: T): T;
export function mergeLog(a: ReviewLog, b: ReviewLog): ReviewLog; // same id: keep earliest non-null voidedAt

// schemas
export const DeckSchema, CardSchema, ReviewLogSchema; // zod
```

### 6.1 Queue rules

- **Due cards:** sorted by `due` ascending.
  - `review` cards are due by **study day**: `due <= endOfStudyDay(now, timeZone, rolloverHour)`. A review card due at 23:00 is already offered at 05:00 the same study day.
  - `learning` and `relearning` cards are due by the **clock**: `due <= now` (apart from the learn-ahead rule below).
- **New cards allowed today:** `newPerDay` minus the number of cards whose *first non-voided log* falls in today's study day. Never negative.
- **Learn-ahead:** if nothing is due, but a learning or relearning card is due within the next 20 minutes, offer it now.
- **Session order:** due cards first, then new cards. A card rated *Again* goes back into the session when it becomes due again (learning steps).
- **Filtering:** the queue can be scoped to one deck or all decks.

### 6.2 Required core tests (minimum)

- `replay` matches applying the logs one by one with `applyReview`.
- `replay(shuffle(logs))` equals `replay(logs)`, run over many random shuffles with a seeded shuffle.
- Duplicate logs don't change the result.
- A voided log is excluded, and the state equals what it would be without that log.
- `studyDayKey`:
  - 03:59 and 04:00 local fall on different days;
  - works correctly in `Asia/Kolkata` and in a timezone with DST (e.g. `America/New_York` across the March switch).
- New-card limit:
  - 20 new cards introduced today → `newCards` is empty;
  - a voided first review frees up its slot.
- Learn-ahead window boundary: 19:59 away is offered; 20:01 away is not.
- `lww`: newer edit wins; equal timestamp falls back to `id`; a tombstone beats an older edit.
- Sticky tombstones (property tests): a tombstone beats any live version, even a newer one; `lww` gives the same result in either argument order; a tombstone survives any sequence of merges.
- Day-based due: a review card due at 23:00 local appears at 05:00 the same study day; a learning card due in 10 minutes is not in `due` yet (it may only be offered via learn-ahead).

---

## 7. Web app: local-first data layer

### 7.1 Dexie schema

```ts
db.version(1).stores({
  decks:      'id, updatedAt, deletedAt, dirty',
  cards:      'id, deckId, updatedAt, deletedAt, dirty',
  reviewLogs: 'id, cardId, reviewedAt, dirty',
  cardStates: 'cardId, due, state',
  meta:       'key'   // deviceId, syncCursor, schedulerVersion, settings, session
});
```

- **`dirty`** is a local-only number (0/1) meaning "not yet pushed". **`localVersion`** is a local-only counter, incremented on every local edit. Neither is ever sent to the server.
- **Settings** live in `meta`: `newPerDay`, `rolloverHour`, `timeZone` (default: browser timezone), `theme`.
- On first launch, generate a `deviceId` (UUID v7) and store it.
- Call `navigator.storage.persist()` on first launch, and show the result in Settings.

### 7.2 Write paths (every one is a single Dexie transaction)

- **Rate a card:** insert a ReviewLog (`dirty=1`) and recompute + put that card's CardState, in **one transaction**. A reload mid-session must never leave a log without its state, or the reverse.
- **Undo last review:** set `voidedAt` on the latest non-voided log of the session (`dirty=1`), then recompute that card's state by replay.
- **Edit card/deck:** set `updatedAt=now`, `dirty=1`, increment `localVersion`.
- **Delete:** set `deletedAt=now` and `updatedAt=now`, `dirty=1`. Deleting a deck tombstones all its cards too.
- **Undo delete (toast):** tombstones are sticky (invariant 9), so undo can never clear one. The toast instead **delays writing the tombstone** until it is dismissed or times out; "Undo" simply cancels the pending write.

### 7.3 Service worker / PWA

- Precache the app shell and the bundled prebuilt decks. The app must load with no network after the first visit.
- Never cache API responses. Data lives in IndexedDB.
- When a new version is available, show a non-blocking "Update available — reload" banner. Never auto-reload mid-session.
- Include a manifest with name, icons, theme colour, and `display: standalone`.

---

## 8. Sync protocol

Sync only runs when the user is signed in. Only `Deck`, `Card` and `ReviewLog` sync. `CardState` is always recomputed locally.

### 8.1 Server change tracking

- Every synced row on the server has `userId` and **`serverSeq` (bigint)**, taken from one global Postgres sequence on every insert or update.
- **Correctness rule (important — explain it in the M2 report):**
  - Sequence values can commit out of order across concurrent transactions. A pull could then skip a row that commits later with a lower seq.
  - To prevent this, every push transaction for a user first takes `pg_advisory_xact_lock(hashtext(userId))`.
  - That serialises one user's writes, so for a given user, seq order equals commit order.

### 8.2 Push — `POST /sync/push`

```jsonc
// request
{ "deviceId": "…", "decks": [Deck], "cards": [Card], "reviewLogs": [ReviewLog] }   // max 500 rows total
// response
{ "accepted": { "decks": [id], "cards": [id], "reviewLogs": [id] } }
```

Server rules (inside one transaction, after the advisory lock):

- **Validate everything with zod.** Reject the whole batch on a schema error (400).
- **Ownership:** a row whose id already exists under a *different* user is rejected (403 for the batch).
- **Decks/cards:** upsert with `lww` semantics. Only overwrite if the incoming row wins. Assign a new `serverSeq` only if the row changed.
- **ReviewLogs:**
  - insert `ON CONFLICT (id) DO NOTHING`;
  - if the incoming log has `voidedAt` and the stored one doesn't, set it and assign a new seq.
- **Clock sanity:** clamp any timestamp more than 24h in the future to server `now`, and log a warning.
- **A card must reference a deck** that exists for this user, either in this batch or already stored.
- **Order within a batch:** decks → cards → logs.
- The whole push is **idempotent**: sending the same batch twice gives the same database state.

Client after push:

- For each accepted id, clear `dirty` **only if `localVersion` hasn't changed since the push was built**.
- This prevents losing an edit made while the request was in flight.

### 8.3 Pull — `GET /sync/pull?since=<cursor>&limit=500`

```jsonc
{ "decks": [...], "cards": [...], "reviewLogs": [...], "nextCursor": "12345", "hasMore": false }
```

- Returns this user's rows with `serverSeq > since`, ordered by `serverSeq`, up to `limit`.
- The client applies rows in one Dexie transaction per page:
  - decks/cards: `lww` against the local copy;
  - logs: insert if absent, otherwise `mergeLog`.
- The client then replays the CardState of every affected card, and saves `nextCursor` in the same transaction.
- Keep pulling while `hasMore` is true.

### 8.4 When sync runs

- Order is always **push, then pull**.
- Triggers:
  - app start;
  - the browser `online` event;
  - end of a study session;
  - every 60s while the tab is visible and online;
  - a manual "Sync now" button in Settings.
- Only one sync runs at a time (an in-memory mutex).
- **Failures:** use exponential backoff (5s → 10s → … max 5 min). The UI shows sync status: `Synced`, `Syncing…`, `Offline`, `Error (retrying)`, `Signed out`. A failed sync never blocks studying.

### 8.5 First sign-in on a device with anonymous local data

- Local rows already have UUIDs.
- After sign-in, push everything as usual; the server assigns ownership to the session's user.
- Then pull, which merges data from the user's other devices. No special merge code is needed, and this must be tested.

---

## 9. API and auth

### 9.1 Auth: email magic link

- `POST /auth/magic-link { email }`: creates a one-time token (hashed in DB, 15-min expiry) and emails a link.
  - In development, log the link to the console instead of sending email.
  - Production email provider: Resend. Add it only in M2, behind an interface.
- `GET /auth/verify?token=…`: consumes the token, creates a `Session` (random 32-byte token, stored hashed, 60-day expiry), sets an `httpOnly`, `Secure`, `SameSite=Lax` cookie, then redirects to the app.
- `POST /auth/logout`: deletes the session.
- `GET /me`: returns `{ id, email }`, or 401.
- Rate limit `/auth/magic-link` to 5 requests per email per hour and 20 per IP per hour (in memory is fine).
- **Offline behaviour:** the web app caches `{ signedIn, email }` in `meta`. If the session expires, sync shows `Signed out`, and studying continues normally.

### 9.2 Prisma schema (draft — refine in M2, keep semantics)

```prisma
model User {
  id        String   @id @default(uuid())
  email     String   @unique
  createdAt DateTime @default(now())
  sessions  Session[]
}

model Session {
  id        String   @id @default(uuid())
  userId    String
  tokenHash String   @unique
  expiresAt DateTime
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model MagicLinkToken {
  id        String   @id @default(uuid())
  email     String
  tokenHash String   @unique
  expiresAt DateTime
  usedAt    DateTime?
}

model Deck {
  id         String  @id            // client uuid v7
  userId     String
  name       String
  source     String
  prebuiltId String?
  createdAt  BigInt
  updatedAt  BigInt
  deletedAt  BigInt?
  serverSeq  BigInt
  @@index([userId, serverSeq])
}

model Card {
  id        String  @id
  userId    String
  deckId    String
  front     String
  back      String
  createdAt BigInt
  updatedAt BigInt
  deletedAt BigInt?
  serverSeq BigInt
  @@index([userId, serverSeq])
}

model ReviewLog {
  id         String  @id
  userId     String
  cardId     String
  rating     Int
  reviewedAt BigInt
  durationMs Int
  deviceId   String
  voidedAt   BigInt?
  serverSeq  BigInt
  @@index([userId, serverSeq])
  @@index([cardId])
}
```

- `serverSeq` comes from a raw-SQL sequence `change_seq`, created in a migration and assigned with `nextval('change_seq')` inside the push transaction.

### 9.3 API rules

- Every route except auth requires a session and is scoped by `userId`. No route accepts a `userId` from the client.
- Validate every request body and query with zod.
- Use one error format: `{ error: { code, message } }`.
- CORS: allow only the web app origin, with credentials.
- Keep secrets in env only; ship a `.env.example`.

---

## 10. UI specification

**Design principles:**

- The review screen is the product. Everything else is secondary.
- It must work one-handed on a phone and fully by keyboard on a laptop.
- Calm, clean and fast. No confetti, streak flames or nagging.
- Never communicate state by colour alone. The four rating buttons have text labels **and** interval previews.

### Screens

1. **Home / Today**
   - Big counts: *Due*, *New*, *Learning*, and a **Study now** button.
   - Below that, the deck list with each deck's due/new counts, then the sync status chip.
   - Empty state for a first-time user: "Start with a ready-made deck or create your own."
2. **Review session**
   - Shows the front, then a **Show answer** button (`Space`).
   - The back appears below the front, with four buttons showing the next interval (e.g. *Again · 10m*, *Hard · 1d*, *Good · 3d*, *Easy · 8d*). Keys `1`–`4`.
   - Thin progress indicator (remaining in session).
   - **Undo** (`Z` or a button) for the last rating.
   - Survives reload: the session is reconstructed from the queue, so no separate session state is needed for correctness.
3. **Session complete**
   - Number reviewed, time spent, and when the next cards are due ("12 cards due tomorrow").
   - Back to Home.
4. **Deck view**
   - Card list with search over front/back text.
   - Add card, edit card, delete card (with undo toast), rename deck, delete deck (with confirm).
5. **Card editor**
   - Front/back textareas.
   - "Save & add another" (`Ctrl/Cmd+Enter`), so cards can be added rapidly.
6. **Browse prebuilt decks**
   - List of bundled decks with name, description and card count, and an **Add to my decks** button.
   - Adding copies the deck and its cards with new UUIDs, `source='prebuilt'`, and `prebuiltId` set.
   - Adding the same deck twice warns first.
7. **Stats** (M4)
   - Due forecast for the next 7 days (bar chart).
   - Reviews per day for the last 30 days.
   - **True retention** for the last 30 days: the share of reviews of cards in `review` state *not* rated Again.
   - Calendar of days studied.
   - Total cards by state.
8. **Settings**
   - New cards/day, rollover hour, theme (system/light/dark).
   - Account: sign in / sign out, email.
   - Sync status and **Sync now**.
   - Storage persistence status.
   - **Export backup** (JSON of decks, cards and logs) and **Import backup** (merges using the same `lww`/`mergeLog` rules).

**First-visit flow (target: under 60 seconds to the first card):**
open the app → Home empty state → tap a prebuilt deck → **Add & start** → review screen.
No sign-up, no settings, no tutorial screens. A single one-line hint on the first card: "Try to recall the answer, then tap Show answer."

**Accessibility:**

- Every control is reachable by keyboard, with visible focus rings.
- Buttons have accessible names.
- The review screen announces "Answer shown" to screen readers.
- Minimum touch target is 44px.

---

## 11. Prebuilt deck format

```jsonc
// content/decks/<prebuiltId>.json
{
  "prebuiltId": "dbms-basics-v1",
  "name": "DBMS Basics",
  "description": "Core DBMS concepts for semester and GATE revision.",
  "version": 1,
  "cards": [ { "front": "What does ACID stand for?", "back": "Atomicity, Consistency, Isolation, Durability" } ]
}
```

- Validate the files with zod at build time; the build fails on an invalid deck.
- Ship **one sample deck of ~20 cards** in M3 as a placeholder. Chaitanya will write the real decks.
- Content must be original, not copied from books.

---

## 12. Milestones

### M0 — Monorepo and `packages/core`

**Build:**

- pnpm workspace, TS configs, ESLint/Prettier, Vitest.
- In `core`:
  - types and zod schemas;
  - `ts-fsrs` wrapper;
  - `initialState`, `applyReview`, `replay`, `previewIntervals`;
  - `studyDayKey`, `endOfStudyDay`;
  - `buildQueue`, `lww`, `mergeLog`;
  - `SCHEDULER_VERSION`.

**Acceptance:**

- [ ] All tests in §6.2 pass; `pnpm test` is green from the repo root.
- [ ] `core` has zero runtime dependencies besides `ts-fsrs` and `zod`.
- [ ] No use of `Date.now()` or `Math.random()` inside `core/src` (add a lint rule or a test that greps for it).
- [ ] The report explains, in plain words, how replay makes sync conflict-free.

### M1 — Local-only PWA (no backend)

**Build:**

- `apps/web` with Dexie, all write paths from §7.2.
- Screens 1–5 and 8 (minus account/sync and import/export).
- PWA setup; scheduler-version rebuild on startup.

**Acceptance:**

- [ ] Create a deck, add 10 cards, and study them; ratings change the next due dates as previewed on the buttons.
- [ ] **Offline E2E (Playwright):** load the app once, go offline (`context.setOffline(true)`), reload, then create a card and complete a review session. Everything works.
- [ ] Reload mid-session (Playwright): no lost or duplicated review, and the session continues correctly.
- [ ] Rating plus CardState update is atomic, with a unit test using `fake-indexeddb`.
- [ ] Undo restores the previous due date exactly.
- [ ] The new-card limit is respected across multiple sessions in the same study day, and resets after the rollover hour (test with mocked time).
- [ ] Lighthouse PWA "installable" passes, and keyboard-only review works (`Space`, `1`–`4`, `Z`).

### M2 — Backend, auth and sync

**Build:**

- `apps/api`: Express 5, Prisma, docker-compose Postgres.
- Magic-link auth (console email in dev), push/pull exactly per §8.
- Client sync engine, sync status UI, sign in/out in Settings.

**Acceptance:**

- [ ] **API tests (Supertest + real Postgres):**
  - push is idempotent (same batch twice gives the same DB state);
  - LWW is correct;
  - log insert-if-absent works;
  - `voidedAt` merges correctly;
  - ownership 403;
  - pull pagination;
  - advisory lock present.
- [ ] **Concurrency test:** two pushes for the same user fired in parallel. A subsequent full pull from cursor 0 returns every row, and incremental pulls never skip a row.
- [ ] **Two-client simulation test** (two Dexie instances via `fake-indexeddb` against the real API):
  - both study the same card offline, then sync;
  - both end with identical logs and identical CardState.
- [ ] Edit made during an in-flight push is not lost (the `localVersion` rule).
- [ ] Anonymous local data is uploaded on first sign-in, then merged with another device's data.
- [ ] **E2E:** two browser contexts signed in as the same user; study offline in A, go online, and B shows the updated due counts after sync.
- [ ] Studying is never blocked by sync errors (kill the API mid-session in E2E).
- [ ] zod max lengths, enforced on both client and server: deck name 200 chars, card front/back 20,000 chars each.
- [ ] The M2 report explains the advisory-lock and sequence reasoning in plain words.

### M3 — Prebuilt decks, onboarding and backup

**Build:**

- `content/decks` pipeline with build-time validation.
- Browse screen (6) and the first-visit flow from §10.
- Export/import backup.

**Acceptance:**

- [ ] **E2E:** fresh browser → first card shown within 3 taps and with no forms.
- [ ] Importing an exported backup into a fresh install reproduces identical CardStates.
- [ ] Importing the same backup twice changes nothing (idempotent).
- [ ] An invalid deck JSON fails the build with a clear message.

### M4 — Stats and retention instrumentation

**Build:**

- Stats screen (7).
- A minimal product-events system:
  - an append-only `events` table, synced like logs;
  - events contain **no card text**;
  - events: `app_opened`, `first_review_completed`, `session_started`, `session_completed`, `session_abandoned` (left with ≥1 card remaining), `deck_added_prebuilt`, `card_created`, `signed_in`.
- Server-side SQL queries (documented in `apps/api/analytics.sql`) for:
  - time to first review;
  - D1/D7/D30 return rate;
  - weekly active learners;
  - due-review completion rate;
  - true retention per user.

**Acceptance:**

- [ ] Stats numbers are verified against a fixture of known logs (unit tests).
- [ ] Events work offline and sync without duplicates.
- [ ] No event payload contains front/back text (test asserts on the schema).

### M5 — (Not in this brief)

Real students use it, feedback is collected, and then AI generation of cards from notes is planned. **Do not start.**

---

## 13. Testing strategy summary

| Layer | Tool | What |
|---|---|---|
| `core` | Vitest | All scheduling, queue, day, merge logic. Seeded randomised shuffle tests. |
| Web data layer | Vitest + `fake-indexeddb` | Transactions, undo, sync client, two-client simulation |
| API | Vitest + Supertest + Docker Postgres | Auth, push/pull, idempotency, concurrency |
| E2E | Playwright | First-visit flow, offline study, reload mid-session, two-device sync |

- Use a fixed fake clock in all time-dependent tests.
- Never rely on wall-clock time in an assertion.

---

## 14. Conventions

- Commit after each green TDD cycle, with conventional commit messages (`feat(core): …`, `test(api): …`).
- Keep domain logic out of React components. Components call hooks/services; services call `core` and Dexie.
- Timestamps are epoch ms numbers everywhere in the domain. Convert at the edges only.
- No `console.log` left in committed code, except the dev magic-link logger.
- Every milestone ends with an updated `README.md`: setup, run, test, and an architecture overview.

---

## 15. Open decisions (do not block on these; flag when reached)

1. **Final product name.**
2. **Subject of the first real prebuilt deck** (needed by M3; a placeholder sample deck is fine until then).
3. **Production hosting for the API** (decide at the end of M2). The web app is static (Vercel or Cloudflare Pages).
4. **Reminders** (web push vs email): deferred until after M4 and real-user feedback.
