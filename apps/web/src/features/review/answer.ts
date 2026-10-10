import {
  clozeRatings,
  matchCloze,
  mcqRatings,
  suggestLongRating,
  type CardContent,
  type OptionId,
  type Outcome,
  type Rating,
} from '@recall/core';

// The review flow of each card type (BUILD_BRIEF_M6_M8 §6.3) as a pure state machine:
// what the user has done with the card on screen, which buttons the footer shows, and
// what the review log records. Typed text stays here, on screen; it never reaches the
// outcome.

export type AnswerState =
  | { type: 'basic'; revealed: boolean }
  | { type: 'short'; revealed: boolean; typing: boolean; typed: string }
  | { type: 'mcq'; selected: OptionId | null; checked: boolean }
  | {
      type: 'cloze';
      typed: string;
      result: null | { mode: 'typed'; correct: boolean } | { mode: 'revealed' };
      hintShown: boolean;
    }
  | { type: 'long'; revealed: boolean; ticked: number[]; typing: boolean; typed: string };

export type AnswerAction =
  | { kind: 'reveal' }
  | { kind: 'toggleTyping' }
  | { kind: 'type'; text: string }
  | { kind: 'select'; option: OptionId }
  | { kind: 'check' }
  | { kind: 'tick'; index: number }
  | { kind: 'showHint' };

/** What the footer offers. "continue" is a single button that records Again. */
export type RatingStage =
  | { buttons: 'none' }
  | { buttons: 'continue' | 'ratings'; ratings: readonly Rating[]; suggested: Rating | null };

export function initialAnswer(content: CardContent): AnswerState {
  switch (content.type) {
    case 'basic':
      return { type: 'basic', revealed: false };
    case 'short':
      return { type: 'short', revealed: false, typing: false, typed: '' };
    case 'mcq':
      return { type: 'mcq', selected: null, checked: false };
    case 'cloze':
      return { type: 'cloze', typed: '', result: null, hintShown: false };
    case 'long':
      return { type: 'long', revealed: false, ticked: [], typing: false, typed: '' };
  }
}

export function answerReducer(
  content: CardContent,
  state: AnswerState,
  action: AnswerAction,
): AnswerState {
  if (content.type !== state.type) return initialAnswer(content);
  switch (state.type) {
    case 'basic':
      return action.kind === 'reveal' ? { ...state, revealed: true } : state;
    case 'short':
    case 'long': {
      if (action.kind === 'toggleTyping') return { ...state, typing: !state.typing };
      if (action.kind === 'type') return { ...state, typed: action.text };
      if (action.kind === 'reveal') return { ...state, revealed: true };
      if (action.kind === 'tick' && state.type === 'long' && content.type === 'long') {
        if (!state.revealed || action.index < 0 || action.index >= content.keyPoints.length) {
          return state;
        }
        const ticked = state.ticked.includes(action.index)
          ? state.ticked.filter((i) => i !== action.index)
          : [...state.ticked, action.index].sort((a, b) => a - b);
        return { ...state, ticked };
      }
      return state;
    }
    case 'mcq': {
      if (content.type !== 'mcq' || state.checked) return state;
      if (action.kind === 'select') {
        return content.options.some((o) => o.id === action.option)
          ? { ...state, selected: action.option }
          : state;
      }
      if (action.kind === 'check' && state.selected !== null) return { ...state, checked: true };
      return state;
    }
    case 'cloze': {
      if (content.type !== 'cloze') return state;
      if (action.kind === 'showHint') return { ...state, hintShown: true };
      if (state.result !== null) return state;
      if (action.kind === 'type') return { ...state, typed: action.text };
      if (action.kind === 'check' && state.typed.trim() !== '') {
        return { ...state, result: { mode: 'typed', correct: matchCloze(content, state.typed) } };
      }
      if (action.kind === 'reveal') return { ...state, result: { mode: 'revealed' } };
      return state;
    }
  }
}

export function ratingStage(content: CardContent, state: AnswerState): RatingStage {
  const all: readonly Rating[] = [1, 2, 3, 4];
  switch (state.type) {
    case 'basic':
    case 'short':
      return state.revealed
        ? { buttons: 'ratings', ratings: all, suggested: null }
        : { buttons: 'none' };
    case 'mcq': {
      if (!state.checked || content.type !== 'mcq') return { buttons: 'none' };
      const ratings = mcqRatings(state.selected === content.correct);
      return { buttons: ratings.length === 1 ? 'continue' : 'ratings', ratings, suggested: null };
    }
    case 'cloze': {
      if (state.result === null) return { buttons: 'none' };
      const ratings =
        state.result.mode === 'typed'
          ? clozeRatings('typed', state.result.correct)
          : clozeRatings('revealed', null);
      return { buttons: ratings.length === 1 ? 'continue' : 'ratings', ratings, suggested: null };
    }
    case 'long': {
      if (!state.revealed || content.type !== 'long') return { buttons: 'none' };
      return {
        buttons: 'ratings',
        ratings: all,
        suggested: suggestLongRating(state.ticked.length, content.keyPoints.length),
      };
    }
  }
}

/** What the review log records about this answer (§6.4). Never typed text. */
export function outcomeOf(content: CardContent, state: AnswerState): Outcome | null {
  if (ratingStage(content, state).buttons === 'none') return null;
  switch (state.type) {
    case 'basic':
    case 'short':
      return null;
    case 'mcq':
      return content.type === 'mcq' && state.selected !== null
        ? { kind: 'mcq', selected: state.selected, correct: state.selected === content.correct }
        : null;
    case 'cloze':
      if (state.result === null) return null;
      return state.result.mode === 'typed'
        ? { kind: 'cloze', mode: 'typed', correct: state.result.correct }
        : { kind: 'cloze', mode: 'revealed', correct: null };
    case 'long': {
      if (content.type !== 'long') return null;
      const total = content.keyPoints.length;
      const hit = state.ticked.length;
      return { kind: 'long', hit, total, suggested: suggestLongRating(hit, total) };
    }
  }
}

/**
 * Keyboard shortcuts (§6.3) for the card on screen: an action, a rating, or nothing.
 * The caller makes sure they never fire while typing (except Enter to check).
 */
export function shortcut(
  content: CardContent,
  state: AnswerState,
  key: string,
): { action: AnswerAction } | { rate: Rating } | null {
  const stage = ratingStage(content, state);
  const digit = /^[1-9]$/.test(key) ? Number(key) : null;

  if (stage.buttons !== 'none') {
    if (state.type === 'long') {
      if (key === 'Enter' && stage.suggested !== null) return { rate: stage.suggested };
      if (digit !== null && content.type === 'long' && digit <= content.keyPoints.length) {
        return { action: { kind: 'tick', index: digit - 1 } };
      }
      return null;
    }
    if (stage.buttons === 'continue' && (key === 'Enter' || key === '1')) return { rate: 1 };
    if (digit !== null && digit <= 4 && stage.ratings.includes(digit as Rating)) {
      return { rate: digit as Rating };
    }
    return null;
  }

  switch (state.type) {
    case 'basic':
    case 'short':
    case 'long':
      return key === ' ' ? { action: { kind: 'reveal' } } : null;
    case 'mcq': {
      if (content.type !== 'mcq') return null;
      if (key === 'Enter' && state.selected !== null) return { action: { kind: 'check' } };
      const option = digit === null ? undefined : content.options[digit - 1];
      return option ? { action: { kind: 'select', option: option.id } } : null;
    }
    case 'cloze':
      return key === 'Enter' && state.typed.trim() !== '' ? { action: { kind: 'check' } } : null;
  }
}
