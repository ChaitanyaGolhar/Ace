# M7 + M8 report: Deck Store and paid decks

_Status: in progress (fast mode). This UI plan was written before the screens were built, as the brief asks for screens without a mock (§7.7)._

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
