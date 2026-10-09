# recall

An offline-first spaced-repetition web app (PWA) for students. Scheduling uses FSRS
via [`ts-fsrs`](https://github.com/open-spaced-repetition/ts-fsrs). See
[`BUILD_BRIEF.md`](./BUILD_BRIEF.md) for the full product and technical spec.

**Status:** M0 done (monorepo and `packages/core`). There is no web app or API yet.

## Setup

Requirements: Node 24+ (see `.nvmrc`) and pnpm (the version is pinned in `package.json` →
`packageManager`; `corepack enable` will pick it up).

```sh
pnpm install
```

## Commands (run from the repo root)

| Command          | What it does                                        |
| ---------------- | --------------------------------------------------- |
| `pnpm test`      | Runs every package's tests (Vitest)                 |
| `pnpm lint`      | ESLint (type-aware, strict) over the whole repo     |
| `pnpm typecheck` | `tsc` in every package                              |
| `pnpm format`    | Prettier, writes changes                            |
| `pnpm check`     | Format check + lint + typecheck + test, as CI would |

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
├── apps/                # web (M1) and api (M2), not built yet
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
