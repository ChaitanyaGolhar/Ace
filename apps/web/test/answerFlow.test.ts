import type { CardContent } from '@recall/core';
import { describe, expect, it } from 'vitest';
import {
  answerReducer,
  initialAnswer,
  outcomeOf,
  ratingStage,
  shortcut,
  type AnswerAction,
  type AnswerState,
} from '../src/features/review/answer';

// The review flow per card type (BUILD_BRIEF_M6_M8 §6.3), as a pure state machine.

const basic: CardContent = { type: 'basic', front: 'Q', back: 'A' };
const short: CardContent = { type: 'short', question: 'Q', answer: 'A', explanation: null };
const mcq: CardContent = {
  type: 'mcq',
  question: 'Pick B',
  options: [
    { id: 'a', text: 'A' },
    { id: 'b', text: 'B' },
    { id: 'c', text: 'C' },
  ],
  correct: 'b',
  explanation: null,
};
const cloze: CardContent = {
  type: 'cloze',
  text: 'A {{primary key}} identifies a row.',
  accepted: ['pk'],
  hint: 'Two words',
  extra: null,
};
const long: CardContent = {
  type: 'long',
  question: 'Explain ACID.',
  marks: 4,
  keyPoints: ['Atomicity', 'Consistency', 'Isolation', 'Durability'],
  modelAnswer: 'ACID…',
};

function run(content: CardContent, ...actions: AnswerAction[]): AnswerState {
  return actions.reduce((s, a) => answerReducer(content, s, a), initialAnswer(content));
}

describe('basic and short answer', () => {
  it('basic: question first, then all four ratings, no outcome', () => {
    expect(ratingStage(basic, initialAnswer(basic))).toEqual({ buttons: 'none' });
    const s = run(basic, { kind: 'reveal' });
    expect(ratingStage(basic, s)).toEqual({ buttons: 'ratings', ratings: [1, 2, 3, 4], suggested: null });
    expect(outcomeOf(basic, s)).toBeNull();
  });

  it('short: the optional answer box opens and keeps typing, but the typed text never reaches the outcome', () => {
    let s = run(short, { kind: 'toggleTyping' }, { kind: 'type', text: 'my answer' });
    expect(s).toMatchObject({ typing: true, typed: 'my answer', revealed: false });
    s = answerReducer(short, s, { kind: 'reveal' });
    expect(ratingStage(short, s)).toEqual({ buttons: 'ratings', ratings: [1, 2, 3, 4], suggested: null });
    expect(outcomeOf(short, s)).toBeNull();
  });
});

describe('multiple choice', () => {
  it('Check needs a choice first', () => {
    const s = run(mcq, { kind: 'check' });
    expect(s).toMatchObject({ checked: false });
    expect(ratingStage(mcq, s)).toEqual({ buttons: 'none' });
  });

  it('wrong → a single Continue that records Again, with the outcome', () => {
    const s = run(mcq, { kind: 'select', option: 'a' }, { kind: 'check' });
    expect(ratingStage(mcq, s)).toEqual({ buttons: 'continue', ratings: [1], suggested: null });
    expect(outcomeOf(mcq, s)).toEqual({ kind: 'mcq', selected: 'a', correct: false });
  });

  it('right → Hard, Good, Easy only (no Again)', () => {
    const s = run(mcq, { kind: 'select', option: 'b' }, { kind: 'check' });
    expect(ratingStage(mcq, s)).toEqual({ buttons: 'ratings', ratings: [2, 3, 4], suggested: null });
    expect(outcomeOf(mcq, s)).toEqual({ kind: 'mcq', selected: 'b', correct: true });
  });

  it('the choice can change before Check, not after', () => {
    let s = run(mcq, { kind: 'select', option: 'a' }, { kind: 'select', option: 'b' });
    expect(s).toMatchObject({ selected: 'b' });
    s = run(mcq, { kind: 'select', option: 'a' }, { kind: 'check' }, { kind: 'select', option: 'b' });
    expect(s).toMatchObject({ selected: 'a', checked: true });
  });

  it('ignores an option id the card doesn’t have', () => {
    expect(run(mcq, { kind: 'select', option: 'f' })).toMatchObject({ selected: null });
  });
});

describe('fill in the blank', () => {
  it('typed and right (case and punctuation ignored) → Hard, Good, Easy', () => {
    const s = run(cloze, { kind: 'type', text: 'Primary Key.' }, { kind: 'check' });
    expect(s).toMatchObject({ result: { mode: 'typed', correct: true } });
    expect(ratingStage(cloze, s)).toEqual({ buttons: 'ratings', ratings: [2, 3, 4], suggested: null });
    expect(outcomeOf(cloze, s)).toEqual({ kind: 'cloze', mode: 'typed', correct: true });
  });

  it('an accepted spelling counts as right', () => {
    expect(run(cloze, { kind: 'type', text: 'PK' }, { kind: 'check' })).toMatchObject({
      result: { mode: 'typed', correct: true },
    });
  });

  it('typed and wrong → Continue (Again); the outcome has no typed text', () => {
    const s = run(cloze, { kind: 'type', text: 'foreign key' }, { kind: 'check' });
    expect(ratingStage(cloze, s)).toEqual({ buttons: 'continue', ratings: [1], suggested: null });
    expect(outcomeOf(cloze, s)).toEqual({ kind: 'cloze', mode: 'typed', correct: false });
    expect(JSON.stringify(outcomeOf(cloze, s))).not.toContain('foreign');
  });

  it('Check with nothing typed does nothing', () => {
    expect(run(cloze, { kind: 'type', text: '  ' }, { kind: 'check' })).toMatchObject({ result: null });
  });

  it('Show answer without typing → all four ratings', () => {
    const s = run(cloze, { kind: 'reveal' });
    expect(ratingStage(cloze, s)).toEqual({ buttons: 'ratings', ratings: [1, 2, 3, 4], suggested: null });
    expect(outcomeOf(cloze, s)).toEqual({ kind: 'cloze', mode: 'revealed', correct: null });
  });

  it('once answered, typing, checking or revealing again changes nothing', () => {
    const s = run(cloze, { kind: 'type', text: 'pk' }, { kind: 'check' }, { kind: 'type', text: 'x' }, { kind: 'reveal' });
    expect(s).toMatchObject({ typed: 'pk', result: { mode: 'typed', correct: true } });
  });

  it('the hint can be shown', () => {
    expect(run(cloze, { kind: 'showHint' })).toMatchObject({ hintShown: true });
  });
});

describe('long answer', () => {
  it('key points can only be ticked once they are shown', () => {
    expect(run(long, { kind: 'tick', index: 0 })).toMatchObject({ ticked: [] });
  });

  it('suggests a rating from the ticks and updates it as ticks change; all four buttons stay', () => {
    let s = run(long, { kind: 'reveal' });
    expect(ratingStage(long, s)).toEqual({ buttons: 'ratings', ratings: [1, 2, 3, 4], suggested: 1 });
    s = run(long, { kind: 'reveal' }, { kind: 'tick', index: 0 }, { kind: 'tick', index: 1 });
    expect(ratingStage(long, s)).toMatchObject({ suggested: 2 }); // 50%
    s = answerReducer(long, s, { kind: 'tick', index: 2 });
    expect(ratingStage(long, s)).toMatchObject({ suggested: 3 }); // 75%
    s = answerReducer(long, s, { kind: 'tick', index: 3 });
    expect(ratingStage(long, s)).toMatchObject({ suggested: 3 }); // 100%
    s = answerReducer(long, s, { kind: 'tick', index: 3 });
    s = answerReducer(long, s, { kind: 'tick', index: 2 });
    expect(ratingStage(long, s)).toMatchObject({ suggested: 2 }); // untick → back to 50%
  });

  it('the outcome counts hits, the total and the suggestion', () => {
    const s = run(long, { kind: 'reveal' }, { kind: 'tick', index: 3 }, { kind: 'tick', index: 1 }, { kind: 'tick', index: 0 });
    expect(outcomeOf(long, s)).toEqual({ kind: 'long', hit: 3, total: 4, suggested: 3 });
  });

  it('ignores ticks of key points that don’t exist', () => {
    expect(run(long, { kind: 'reveal' }, { kind: 'tick', index: 9 })).toMatchObject({ ticked: [] });
  });

  it('the optional written answer is kept on screen but never reaches the outcome', () => {
    const s = run(long, { kind: 'toggleTyping' }, { kind: 'type', text: 'My essay' }, { kind: 'reveal' });
    expect(s).toMatchObject({ typed: 'My essay' });
    expect(JSON.stringify(outcomeOf(long, s))).not.toContain('essay');
  });
});

describe('keyboard shortcuts (§6.3)', () => {
  it('basic and short: Space shows the answer, then 1–4 rate', () => {
    expect(shortcut(basic, initialAnswer(basic), ' ')).toEqual({ action: { kind: 'reveal' } });
    expect(shortcut(basic, initialAnswer(basic), '3')).toBeNull();
    expect(shortcut(short, run(short, { kind: 'reveal' }), '3')).toEqual({ rate: 3 });
  });

  it('mcq: 1–6 select, Enter checks; after a wrong check Enter or 1 continue; after a right one 2–4 rate', () => {
    expect(shortcut(mcq, initialAnswer(mcq), '2')).toEqual({ action: { kind: 'select', option: 'b' } });
    expect(shortcut(mcq, initialAnswer(mcq), '6')).toBeNull(); // no 6th option
    expect(shortcut(mcq, run(mcq, { kind: 'select', option: 'a' }), 'Enter')).toEqual({ action: { kind: 'check' } });
    const wrong = run(mcq, { kind: 'select', option: 'a' }, { kind: 'check' });
    expect(shortcut(mcq, wrong, 'Enter')).toEqual({ rate: 1 });
    expect(shortcut(mcq, wrong, '1')).toEqual({ rate: 1 });
    expect(shortcut(mcq, wrong, '3')).toBeNull();
    const right = run(mcq, { kind: 'select', option: 'b' }, { kind: 'check' });
    expect(shortcut(mcq, right, '1')).toBeNull();
    expect(shortcut(mcq, right, '4')).toEqual({ rate: 4 });
  });

  it('cloze: Enter checks; afterwards the allowed ratings', () => {
    expect(shortcut(cloze, run(cloze, { kind: 'type', text: 'pk' }), 'Enter')).toEqual({ action: { kind: 'check' } });
    const wrong = run(cloze, { kind: 'type', text: 'x' }, { kind: 'check' });
    expect(shortcut(cloze, wrong, 'Enter')).toEqual({ rate: 1 });
    expect(shortcut(cloze, run(cloze, { kind: 'reveal' }), '2')).toEqual({ rate: 2 });
  });

  it('long: Space shows key points; then 1–9 toggle them and Enter rates with the suggestion', () => {
    expect(shortcut(long, initialAnswer(long), ' ')).toEqual({ action: { kind: 'reveal' } });
    const shown = run(long, { kind: 'reveal' }, { kind: 'tick', index: 0 }, { kind: 'tick', index: 1 });
    expect(shortcut(long, shown, '3')).toEqual({ action: { kind: 'tick', index: 2 } });
    expect(shortcut(long, shown, '9')).toBeNull(); // only 4 key points
    expect(shortcut(long, shown, 'Enter')).toEqual({ rate: 2 });
  });
});
