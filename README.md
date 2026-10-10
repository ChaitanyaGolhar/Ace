# recall

An offline-first spaced-repetition web app (PWA) for students. Scheduling uses FSRS
via [`ts-fsrs`](https://github.com/open-spaced-repetition/ts-fsrs). See
[`BUILD_BRIEF.md`](./BUILD_BRIEF.md) for the full product and technical spec.

**Status:** M0 (core), M1 (local-only PWA) and M2 (API, auth, sync) done; the approved visual design is applied. See `MORNING_REPORT.md` for the
latest milestone status, `DECISIONS.md` for decisions the brief didn't cover, and
`apps/web/UI_CONTRACT.md` for the screen-by-screen UI contract.

## Setup

Requirements: Node 24+ (see `.nvmrc`) and pnpm (the version is pinned in `package.json` →
`packageManager`; `corepack enable` will pick it up).

```sh
pnpm install
pnpm --filter @recall/web exec playwright install chromium   # once, for E2E
```

Database and API (needed for sign-in/sync and for the API and integration tests):

```sh
docker compose up -d                          # Postgres on localhost:54329 (dbs: recall_dev, recall_test, recall_e2e)
cp apps/api/.env.example apps/api/.env        # once; MAIL_MODE=console prints magic links in the API terminal
pnpm --filter @recall/api migrate             # apply migrations to recall_dev
pnpm --filter @recall/api dev                 # http://localhost:3000
```

Run the web app (works without the API; sign-in and sync need it):

```sh
pnpm --filter @recall/web dev       # http://localhost:5173 (no service worker in dev)
pnpm --filter @recall/web build && pnpm --filter @recall/web preview   # http://localhost:4173, with the service worker
```

The web app talks to `VITE_API_URL` (default `http://localhost:3000`). To sign in during
development: Settings › Sign in to sync › enter any email › open the link printed in the
API terminal.

## Commands (run from the repo root)

| Command          | What it does                                         |
| ---------------- | ---------------------------------------------------- |
| `pnpm test`      | Runs every package's tests (Vitest)                  |
| `pnpm lint`      | ESLint (type-aware, strict) over the whole repo      |
| `pnpm typecheck` | `tsc` in every package                               |
| `pnpm format`    | Prettier, writes changes                             |
| `pnpm check`     | Format check + lint + typecheck + test, as CI would  |
| `pnpm e2e`       | Playwright E2E against a production build (Chromium) |

In `packages/core`, `pnpm test:watch` runs Vitest in watch mode, and `pnpm golden:update`
regenerates the scheduler golden fixture (see "Changing the scheduler" below).

## Layout

```
recall/
├── packages/
│   └── core/            # pure domain logic, shared by web + api (M0)
│       ├── src/
│       │   ├── schemas.ts    # zod schemas + types for Deck, Card, ReviewLog
│       │   ├── types.ts      # CardState (derived, never synced)
│       │   ├── scheduler.ts  # the ts-fsrs wrapper: initialState, applyReview, replay, previewIntervals
│       │   ├── studyDay.ts   # studyDayKey, endOfStudyDay (04:00 rollover, DST-safe)
│       │   ├── queue.ts      # buildQueue: due cards, new-card limit, learn-ahead
│       │   └── merge.ts      # lww (decks/cards) and mergeLog (review logs)
│       └── test/
├── apps/
│   └── web/             # Vite + React PWA, local-first (M1)
│       ├── src/
│       │   ├── db/           # Dexie schema (§7.1) and typed meta keys
│       │   ├── services/     # all data logic: write paths (§7.2), queue, sessions — unit tested
│       │   ├── features/     # one folder per screen: use<Screen>.ts view-model + thin component
│       │   └── app/          # router, providers, live-query wrapper, toasts
│       ├── test/             # Vitest + fake-indexeddb
│       ├── e2e/              # Playwright
│       └── UI_CONTRACT.md    # view-models, states, copy and selectors for every screen
└── BUILD_BRIEF.md
```

## Architecture: `packages/core`

`core` is pure: no I/O, no clock reads, no randomness. Time is always passed in as
`now` (epoch ms). An ESLint rule and a test (`test/purity.test.ts`) both reject
`Date.now()`, `new Date()`, `Math.random()` and friends in `core/src`. Its only runtime
dependencies are `ts-fsrs` and `zod`, and only `scheduler.ts` imports `ts-fsrs`.

### The review log is the source of truth

Every rating is stored as an immutable `ReviewLog` with a client-generated UUID. A
card's scheduling state (`CardState`) is never edited directly; it is computed by
`replay(card, logs)`:

1. drop logs for other cards;
2. merge copies of the same log (same id) with `mergeLog`, so duplicates count once
   and a log voided in any copy stays voided;
3. drop voided logs (that is how "undo" works);
4. sort by `(reviewedAt, id)`;
5. fold `applyReview` over them, starting from `initialState(card)`.

Any stored `CardState` is just a cache of this result, so it can always be rebuilt.

### Conflict resolution

- **Review logs** never conflict: two devices create logs with different ids, so
  merging is a set union. The only mutable field, `voidedAt`, can only go from null
  to a timestamp, and `mergeLog` keeps the earliest one.
- **Decks and cards** use last-write-wins (`lww`), with **sticky tombstones**: a
  deleted version (non-null `deletedAt`) beats any live version, however old it is,
  so once a row is deleted anywhere it stays deleted everywhere. Otherwise the newer
  `updatedAt` wins, then the higher id, then a deterministic content comparison.
  `lww` is commutative and associative (property-tested), so every device that sees
  the same versions picks the same winner, whatever order they arrive in. Because a
  tombstone can never be cleared, "undo delete" in the UI works by delaying the
  tombstone write, not by reverting it.

### What counts as due

`buildQueue` treats the two kinds of scheduled card differently. Review cards are
scheduled in days, so they are due for the whole study day they fall in (a card due at
23:00 is offered at 05:00). Learning and relearning steps are minutes long, so those
cards are due only once their exact due time has passed, apart from the 20-minute
learn-ahead rule.

### Changing the scheduler

Changing FSRS params, the replay logic, or the `ts-fsrs` version (it is pinned to an
exact version on purpose) can change every card's schedule. That requires bumping
`SCHEDULER_VERSION` in `scheduler.ts`; clients then rebuild all CardStates by replay.
`test/golden.test.ts` enforces this: it replays fixed histories and compares them with
`test/fixtures/golden.json`. If the output changes, bump the version, then run
`pnpm --filter @recall/core golden:update` (it refuses to run without the bump).

### Notes on ts-fsrs

- **It patches `Date.prototype`.** Importing ts-fsrs adds methods such as `scheduler`,
  `diff`, `format` and `dueFormat` to every `Date` (deprecated upstream, to be removed
  in ts-fsrs 6). Our code never calls them, but they are there globally in any bundle
  that includes `core`.
- **Fuzz is off by design.** FSRS can add a small random spread to intervals so that
  cards learned together don't stay bunched up. We disable it (`enable_fuzz: false`),
  so the interval shown on each rating button is exactly what the card gets and replay
  is trivially deterministic. Revisit in M4 with deterministic, seeded fuzz (for
  example seeded from the card and log ids), which would need a `SCHEDULER_VERSION`
  bump.
- **Elapsed days are counted in UTC calendar days** inside ts-fsrs, independent of our
  04:00 local study day. This is deterministic and doesn't affect correctness.

## Architecture: `apps/web` (local-first)

- **IndexedDB is the app's database** (Dexie). Synced tables carry two local-only
  fields: `dirty` (not yet pushed) and `localVersion` (bumped on every local edit).
- **Services** (`src/services`) hold all data logic and take an `AppContext`
  (`{ db, now, newId }`), so tests use an in-memory IndexedDB (`fake-indexeddb`), a fake
  clock and predictable ids. Real time and UUID v7s are created only in `main.tsx`.
- **Every write path is one Dexie transaction.** Rating a card inserts the log and
  stores the card's CardState, recomputed by `replay` over all its logs, together; a
  crash can't leave one without the other (tested by forcing a failure mid-transaction).
- **Undo** voids the log (never deletes it) and replays. **Deleting** writes a sticky
  tombstone, so the undo toast works by delaying that write.
- **Screens** are `use<Screen>` hooks returning a view-model over live queries, plus a
  thin component. See `apps/web/UI_CONTRACT.md`.
- **Startup** (`services/bootstrap.ts`): creates the device id, asks for persistent
  storage once, and rebuilds every CardState by replay if `SCHEDULER_VERSION` changed.
- **PWA:** `vite-plugin-pwa` precaches the app shell; no runtime caching (API responses
  are never cached); a new version shows an "Update available — reload" banner and never
  reloads by itself.

## Architecture: `apps/api` and sync

- **Express 5 + Prisma 7 + Postgres.** Auth is an email magic link (token stored hashed,
  15 min) that creates a 60-day session in an httpOnly, Secure, SameSite=Lax cookie.
- **Sync** (`apps/api/src/sync`): `POST /sync/push` takes up to 500 rows (decks, then
  cards, then logs) in one transaction that first takes a per-user advisory lock;
  decks/cards are upserted with core `lww`, logs are insert-if-absent with `voidedAt`
  merged by core `mergeLog`. Every change takes a new `server_seq` from one sequence.
  `GET /sync/pull?since=&limit=` returns one page in seq order from a single snapshot.
  Why the lock and the snapshot matter: see `MORNING_REPORT.md` › M2.
- **Client sync engine** (`apps/web/src/sync`): push dirty rows, then pull pages; clear
  `dirty` only if `localVersion` didn't change during the push; apply each pulled page
  (lww/mergeLog, replay affected cards, save the cursor) in one Dexie transaction; one
  sync at a time; exponential backoff; never blocks studying.
