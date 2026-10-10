# UI contract

> **Status (after the design was applied):** this document was the input to the design
> session and describes the pre-design functional shell. The approved design is now
> implemented (see `UI_REPORT.md` at the repo root). The current, authoritative contract
> is the exported view-model interface at the top of each hook in
> `src/features/<screen>/use<Screen>.ts`; copy and selectors changed where the design
> changed them (e.g. "Start reviewing", "Review complete", Question/Answer labels, ⋯
> menus for card and deck actions). E2E selectors are listed in `UI_REPORT.md`.

The input for the visual design session. The current UI is a deliberately plain,
functional shell: semantic HTML, Tailwind only for layout, 44 px touch targets and
visible focus rings. Everything below is what a redesign must keep working.

**How screens are built.** Each screen is a thin component over a hook,
`src/features/<screen>/use<Screen>.ts`, which returns a **view-model** (data + state +
actions). Components contain no domain logic and no Dexie calls, so a redesign only
rewrites the `*.tsx` files. The view-model types below are the contract.

**E2E selectors.** Playwright tests find elements only by ARIA role + accessible name,
label text, or `data-testid`. When redesigning, keep: the accessible names listed under
"Copy", every `data-testid` listed here, and the roles (`button`, `link`, `heading`,
`list`, `status`, `alert`, `region`, `group`, `alertdialog`).

**Shared states** (`features/shell/states.tsx`):

| State     | Copy                                                                    | Role     | testid      |
| --------- | ----------------------------------------------------------------------- | -------- | ----------- |
| Loading   | "Loading…"                                                              | `status` | `loading`   |
| Error     | "Something went wrong while reading your data. Try reloading the page." | `alert`  | `error`     |
| Not found | screen-specific (below)                                                 | `status` | `not-found` |

Startup (before React mounts, `main.tsx`): "Loading…"; if IndexedDB is unavailable:
"This browser can’t store data for this app (IndexedDB is unavailable). Try another
browser, or leave private browsing mode."

"Offline" is not a separate state for the local-only screens (M1): they read and write
IndexedDB and work identically offline. Offline matters for sync and sign-in (see the
sync status chip and Settings › Account, M2).

---

## App shell (`features/shell/Layout.tsx`, hook `useShell`)

- **Purpose:** frame around every screen: navigation, update banner, toast region.
- **Routes:** wraps all routes.
- **View-model (`useShell`):** `{ theme: 'system' | 'light' | 'dark' | null }`. Effects:
  applies the theme (`color-scheme` + `data-theme` on `<html>`), and on `pagehide`
  commits pending deletes (see Undo toasts).
- **Copy:** nav landmark "Main" with links "Home", "Settings" (more links are added in
  later milestones: see the end of this file).
- **Keyboard:** standard Tab order.

## Update banner (`features/shell/UpdateBanner.tsx`, hook `useUpdateBanner`)

- **Purpose:** a new app version has downloaded; never reload by itself (§7.3).
- **View-model:** `{ visible: boolean; reload(): void; dismiss(): void }`.
- **States:** hidden / visible.
- **Copy:** "Update available — reload"; buttons "Reload", "Later". Role `status`,
  testid `update-banner`.

## Undo toasts (`features/shell/ToastRegion.tsx`, provider `app/toasts.tsx`)

- **Purpose:** short messages, some with an action (Undo).
- **View-model (`useToasts`):** `{ toasts: { id: number; message: string; actionLabel: string | null }[]; act(id); dismiss(id); show(toast) }`.
- **Behaviour:** each toast closes after 5 s. Card delete: the tombstone is written
  only when the toast times out, is dismissed (×), or the page is left; **Undo**
  cancels it (tombstones can never be cleared, invariant 9).
- **Copy:** region "Notifications" (`aria-live="polite"`); each toast has testid
  `toast`. Messages: "Card deleted" (action "Undo"), "Deck deleted",
  "Couldn’t delete the deck.". Dismiss button accessible name "Dismiss" (visible "×").

---

## 1. Home / Today (`/`, `features/home`)

- **Purpose:** what to study today; entry to decks.
- **View-model (`HomeViewModel`):**
  ```ts
  {
    status: 'loading' | 'error' | 'ready';
    isEmpty: boolean;                       // no decks at all (first-time user)
    counts: { due: number; new: number; learning: number }; // disjoint (see core Queue)
    canStudy: boolean;                      // due + new + learning > 0
    decks: { id: string; name: string; counts: { due: number; new: number; learning: number } }[]; // sorted by name
  }
  ```
- **Actions:** links only — "Study now" → `/study`; deck row → `/decks/:id`;
  "Create a deck" → `/decks/new`.
- **States:** loading, error, empty (first-time), ready with nothing to study, ready.
- **Copy:** heading "Today". Empty: "Start with a ready-made deck or create your own."
  (testid `home-empty`) with link "Create a deck". Counts: "Due", "New", "Learning"
  (testids `count-due`, `count-new`, `count-learning`; group label "Today’s cards").
  "Study now" (link) or "Nothing to study right now.". Section heading "Decks", deck
  row text "<name>" + "<due+learning> due · <new> new".
- **Notes for design:** per-deck "new" is what that deck could offer today on its own;
  the daily new-card limit is shared across decks, so per-deck numbers can add up to
  more than the total.

## 2. Review session (`/study`, `/study?deck=<id>`, `features/review`)

- **Purpose:** the product. Show front → reveal back → rate.
- **View-model (`ReviewViewModel`):**
  ```ts
  {
    status: 'loading' | 'error' | 'empty' | 'studying' | 'complete'; // complete → navigates to completeHref
    card: { id: string; front: string; back: string } | null; // plain text, keep line breaks (white-space: pre-wrap)
    revealed: boolean;
    showHint: boolean;          // only on the very first card the user ever studies
    ratings: { rating: 1|2|3|4; label: 'Again'|'Hard'|'Good'|'Easy'; interval: string; key: '1'|'2'|'3'|'4' }[];
    remaining: number;          // cards left in this session
    reviewed: number;           // reviews done in this session
    canUndo: boolean;
    busy: boolean;              // saving a rating/undo; rating buttons disabled
    announcement: string;       // '' or 'Answer shown' (screen-reader live region)
    actionError: string | null;
    completeHref: string;
    showAnswer(): void; rate(r: 1|2|3|4): void; undo(): void;
  }
  ```
- **States:** loading, error, empty (nothing to study), studying (front only / revealed),
  busy, complete (redirect).
- **Keyboard:** `Space` show answer · `1`–`4` rate (only when revealed) · `Z` undo.
  Ignored while typing in a field or with Ctrl/Cmd/Alt held.
- **Copy:** "Show answer"; rating buttons "Again · 10m", "Hard · 1d", "Good · 3d",
  "Easy · 8d" (label + " · " + interval; `aria-keyshortcuts` 1–4; group label "Rate
  your recall"); "Undo" (`aria-keyshortcuts="z"`). Hint (testid `first-card-hint`):
  "Try to recall the answer, then tap Show answer." Progress: `<progress>` labelled
  "<n> cards left" plus text "<n> left" (testid `remaining`). Live region (role
  `status`, testid `announcer`): "Answer shown". Empty (testid `review-empty`):
  "Nothing to study right now." + "Back to Home". Errors (role `alert`): "Couldn’t
  save that rating. Please try again.", "Couldn’t undo. Please try again.".
  testids: `card-front`, `card-back`.
- **Interval format:** `<1m`, `10m`, `5h`, `3d`, `2mo`, `1.5y`.

## 3. Session complete (`/study/complete`, `features/complete`)

- **View-model (`SessionCompleteViewModel`):**
  ```ts
  { status: 'loading'|'error'|'ready'; hasSummary: boolean; reviewed: number; timeSpent: string; nextDue: string; backToHome(): void }
  ```
- **States:** loading, error, ready with summary, ready without summary (no session).
- **Copy:** heading "Session complete"; "Cards reviewed" (testid `reviewed-count`),
  "Time spent" (testid `time-spent`, e.g. "4m 12s"); next due (testid `next-due`), one of:
  "No cards are scheduled yet.", "<n> card(s) due later today", "<n> card(s) due
  tomorrow", "<n> card(s) due on Thu, 15 Oct"; button "Back to Home".

## 4. Deck view (`/decks/:deckId`, `features/deck/useDeck`)

- **View-model (`DeckViewModel`):**
  ```ts
  {
    status: 'loading' | 'error' | 'notFound' | 'ready';
    deckId: string; name: string;
    counts: { due: number; new: number; learning: number };
    cardCount: number;                  // live cards, excluding pending deletes
    cards: { id: string; front: string; back: string }[]; // after search, oldest first
    search: string; canStudy: boolean;
    renaming: boolean; renameValue: string; renameError: string | null;
    confirmingDelete: boolean;
    setSearch(q), deleteCard(id), startRename(), setRenameValue(v), saveRename(), cancelRename(),
    requestDeleteDeck(), cancelDeleteDeck(), confirmDeleteDeck()
  }
  ```
- **States:** loading, error, not found ("This deck doesn’t exist or was deleted."),
  no cards (testid `deck-empty`: "No cards yet. Add your first card."), no search
  results (testid `search-empty`: "No cards match “<q>”."), renaming, confirming delete.
- **Copy:** heading = deck name; "Rename" → field "Deck name", "Save name", "Cancel";
  "<due+learning> due · <new> new · <n> cards"; links "Study this deck", "Add card";
  field "Search cards"; list "Cards"; per card: link "Edit" (name "Edit card: <front>"),
  button "Delete" (name "Delete card: <front>"); "Delete deck…" → alertdialog "Delete
  “<name>” and its <n> cards? This can’t be undone." with "Delete deck" / "Cancel".

## Create deck (`/decks/new`, `features/deck/useNewDeck`)

- **View-model:** `{ name: string; error: string | null; saving: boolean; setName(v); create() }`.
- **Copy:** heading "Create a deck"; field "Deck name"; button "Create deck"; error
  (role `alert`) "Deck name can’t be empty." or "Couldn’t create the deck.".

## 5. Card editor (`/decks/:deckId/cards/new`, `/cards/:cardId/edit`, `features/editor`)

- **View-model (`CardEditorViewModel`):**
  ```ts
  {
    status: 'loading' | 'error' | 'notFound' | 'ready';
    mode: 'new' | 'edit';
    deckId: string | null;
    front: string;
    back: string;
    frontError: string | null;
    backError: string | null;
    formError: string | null;
    saving: boolean;
    addedCount: number;
    focusFrontToken: number; // refocus Front after "Save & add another"
    (setFront(v), setBack(v), saveAndContinue(), done());
  }
  ```
- **Keyboard:** `Ctrl+Enter` / `⌘+Enter` = primary action.
- **Copy:** heading "Add card" / "Edit card"; fields "Front", "Back" (textareas);
  primary button "Save & add another" (new) / "Save" (edit); secondary "Done" (new) /
  "Cancel" (edit); tip "Tip: Ctrl+Enter (⌘+Enter on Mac) to save & add another."; status
  (testid `added-status`) "Card added (<n> so far)"; errors "Front can’t be empty.",
  "Back can’t be empty.", "Couldn’t save the card. Please try again."; not found "This
  card doesn’t exist or was deleted.".

## 8. Settings (`/settings`, `features/settings/useSettingsScreen`)

- **View-model (`SettingsViewModel`):**
  ```ts
  {
    status: 'loading' | 'error' | 'ready';
    newPerDay: string;
    rolloverHour: number;
    theme: 'system' | 'light' | 'dark';
    timeZone: string;
    storagePersistence: 'granted' | 'denied' | 'unsupported' | null;
    saving: boolean;
    error: string | null;
    savedMessage: string | null;
    (setNewPerDay(v), setRolloverHour(v), setTheme(v), save());
  }
  ```
- **Copy:** heading "Settings"; section "Study": "New cards per day" (number),
  "New day starts at" (select "00:00"…"23:00"), "Time zone: <zone>"; fieldset "Theme":
  "System", "Light", "Dark"; button "Save settings"; status "Settings saved"; error
  "New cards per day must be a whole number from 0 to 9999." / "Couldn’t save
  settings.". Section "Storage" (testid `storage-persistence`): "Persistent: the browser
  won’t clear your cards to free up space." / "Not persistent: the browser may clear
  your cards if the device runs low on space." / "This browser can’t make storage
  persistent.".

## Not found route (`*`)

- Copy: "Page not found." (role `status`, testid `not-found`).
