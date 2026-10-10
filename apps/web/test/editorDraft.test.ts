import type { CardContent } from '@recall/core';
import { describe, expect, it } from 'vitest';
import {
  changeType,
  draftFromContent,
  draftToContent,
  emptyDraft,
  lostOnTypeChange,
  validateDraft,
  type Draft,
} from '../src/features/editor/draft';

// The card editor's form state (BUILD_BRIEF_M6_M8 §6.5): one draft for every type, with
// field-level validation that mirrors core's rules.

const with_ = (d: Draft, patch: Partial<Draft>): Draft => ({ ...d, ...patch });

describe('content ↔ draft', () => {
  const samples: CardContent[] = [
    { type: 'basic', front: 'Q', back: 'A' },
    {
      type: 'mcq',
      question: 'Pick',
      options: [
        { id: 'a', text: 'One' },
        { id: 'b', text: 'Two' },
        { id: 'c', text: 'Three' },
      ],
      correct: 'c',
      explanation: 'Because.',
    },
    { type: 'cloze', text: 'A {{b}} c', accepted: ['bee'], hint: 'h', extra: null },
    { type: 'short', question: 'Q', answer: 'A', explanation: null },
    { type: 'long', question: 'Q', marks: 6, keyPoints: ['x', 'y'], modelAnswer: 'm' },
  ];

  it.each(samples)('$type round-trips', (content) => {
    expect(draftToContent(draftFromContent(content))).toEqual(content);
  });

  it('option ids are re-lettered a, b, c… by position (after a removal too)', () => {
    const d = with_(emptyDraft('mcq'), { prompt: 'Q', options: ['x', 'y', 'z'], correct: 2 });
    expect(draftToContent(d)).toMatchObject({
      options: [
        { id: 'a', text: 'x' },
        { id: 'b', text: 'y' },
        { id: 'c', text: 'z' },
      ],
      correct: 'c',
    });
  });

  it('blank optional fields become null; marks text becomes a number', () => {
    const d = with_(emptyDraft('long'), { prompt: 'Q', keyPoints: ['a', 'b'], marks: ' 5 ', modelAnswer: '  ' });
    expect(draftToContent(d)).toEqual({ type: 'long', question: 'Q', marks: 5, keyPoints: ['a', 'b'], modelAnswer: null });
    expect(draftToContent(with_(d, { marks: '' }))).toMatchObject({ marks: null });
  });

  it('an empty draft has two blank options / key points to fill in', () => {
    expect(emptyDraft('mcq').options).toEqual(['', '']);
    expect(emptyDraft('long').keyPoints).toEqual(['', '']);
  });
});

describe('validation, field by field', () => {
  const errors = (d: Draft) => validateDraft(d).errors;

  it('a valid draft has no errors and gives the content', () => {
    const v = validateDraft(with_(emptyDraft('short'), { prompt: 'Q', answer: 'A' }));
    expect(v.errors).toEqual({});
    expect(v.content).toEqual({ type: 'short', question: 'Q', answer: 'A', explanation: null });
  });

  it('empty required fields, named for the type', () => {
    expect(errors(emptyDraft('basic'))).toMatchObject({
      prompt: 'Question can’t be empty.',
      answer: 'Answer can’t be empty.',
    });
    expect(errors(emptyDraft('short'))).toMatchObject({ answer: 'Model answer can’t be empty.' });
    expect(errors(emptyDraft('cloze'))).toMatchObject({ prompt: 'Sentence can’t be empty.' });
  });

  it('mcq: blank options, duplicates, and no correct option', () => {
    const d = with_(emptyDraft('mcq'), { prompt: 'Q', options: ['Same', 'same', ''] });
    const e = errors(d);
    expect(e['options.2']).toBe('Option C can’t be empty.');
    expect(e.correct).toBe('Choose the correct option.');
    expect(errors(with_(d, { options: ['Same', 'same'], correct: 0 })).options).toBe(
      'Options must all be different.',
    );
  });

  it('cloze: exactly one {{blank}}', () => {
    const msg = 'Wrap the answer in {{double braces}} — exactly one blank.';
    expect(errors(with_(emptyDraft('cloze'), { prompt: 'No blank' })).prompt).toBe(msg);
    expect(errors(with_(emptyDraft('cloze'), { prompt: 'Two {{a}} {{b}}' })).prompt).toBe(msg);
    expect(errors(with_(emptyDraft('cloze'), { prompt: 'One {{a}} ok' }))).toEqual({});
  });

  it('long: at least two non-empty key points, marks 1–20', () => {
    const base = with_(emptyDraft('long'), { prompt: 'Q', keyPoints: ['a', ''] });
    expect(errors(base)['keyPoints.1']).toBe('Key point 2 can’t be empty.');
    expect(errors(with_(base, { keyPoints: ['a'] })).keyPoints).toBe('Add at least 2 key points.');
    expect(errors(with_(base, { keyPoints: ['a', 'b'], marks: '25' })).marks).toBe(
      'Marks must be a whole number from 1 to 20.',
    );
    expect(errors(with_(base, { keyPoints: ['a', 'b'], marks: 'six' })).marks).toBe(
      'Marks must be a whole number from 1 to 20.',
    );
  });

  it('too-long text says so next to the field', () => {
    expect(errors(with_(emptyDraft('short'), { prompt: 'x'.repeat(5001), answer: 'a' })).prompt).toBe(
      'This is too long (at most 5,000 characters).',
    );
  });
});

describe('changing type (§6.5)', () => {
  it('carries the question, the answer and the explanation where the new type has them', () => {
    const short = with_(emptyDraft('short'), { prompt: 'Q', answer: 'A', explanation: 'E' });
    expect(changeType(short, 'basic')).toMatchObject({ type: 'basic', prompt: 'Q', answer: 'A' });
    expect(changeType(short, 'mcq')).toMatchObject({ type: 'mcq', prompt: 'Q', explanation: 'E', answer: '' });
    expect(changeType(short, 'long')).toMatchObject({ type: 'long', prompt: 'Q', explanation: '' });
  });

  it('lists the filled fields that would be cleared, so the editor can warn first', () => {
    const mcq = with_(emptyDraft('mcq'), { prompt: 'Q', options: ['x', 'y'], correct: 1, explanation: 'E' });
    expect(lostOnTypeChange(mcq, 'short')).toEqual(['Options']);
    expect(lostOnTypeChange(mcq, 'basic')).toEqual(['Options', 'Explanation']);
    expect(lostOnTypeChange(emptyDraft('mcq'), 'long')).toEqual([]); // nothing filled in
    const long = with_(emptyDraft('long'), { prompt: 'Q', keyPoints: ['a', ''], marks: '4' });
    expect(lostOnTypeChange(long, 'basic')).toEqual(['Marks', 'Key points']);
  });
});
