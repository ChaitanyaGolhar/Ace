export type UUID = string;

/**
 * Derived scheduling state of one card. Never synced: it is always recomputable
 * by replaying the card's review log (see `replay`).
 */
export interface CardState {
  cardId: UUID;
  /** Epoch ms when the card is next due. */
  due: number;
  stability: number;
  difficulty: number;
  reps: number;
  lapses: number;
  state: 'new' | 'learning' | 'review' | 'relearning';
  lastReviewedAt: number | null;
  /**
   * Index of the current (re)learning step (FSRS `learning_steps`). Not in the
   * brief's draft interface, but the scheduler reads it, so without it a stored
   * CardState could not be advanced by `applyReview` with the same result as replay.
   */
  learningSteps: number;
}
