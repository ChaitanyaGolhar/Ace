# M6 report — Question types

_Status: in progress. This section was written before building the screens (brief §0.7)._

## UI plan (screens without a mock)

Everything uses the existing tokens and components: the review screen's header, progress bar, sticky footer and rating buttons; `field`, `btn-primary`, `btn-secondary`, `btn-ghost`; the Dialog. No new colours. State is always shown by icon **and** text, never by colour alone.

### Review screen, per type

The header, progress bar, undo pill and completion screen are unchanged. Above the question, the tag row reads "New" or "Review", followed by the type: "Multiple choice", "Fill in the blank", "Short answer" or "Long answer". Basic cards show no type tag.

**Short answer**
- **Layout:** the question, then a collapsed "Type your answer (optional)" toggle that opens a textarea. What you type is never saved.
- **Footer:** "Show answer" (Space).
- **After revealing:** a divider, the model answer, then the explanation in secondary text.
- **Rating:** the usual four rating buttons.

**Multiple choice**
- **Layout:** the question, then the options as a vertical list of large rows ("A  Primary key"), in a radio group. Keys 1–6 or a tap select an option.
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
