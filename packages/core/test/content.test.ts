import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  CardContentSchema,
  clozeAnswer,
  clozeRatings,
  deriveDisplay,
  matchCloze,
  mcqRatings,
  normalizeAnswer,
  OutcomeSchema,
  suggestLongRating,
  type CardContent,
} from '../src';

// Question types (BUILD_BRIEF_M6_M8 §6.1–6.4).

const basic: CardContent = { type: 'basic', front: 'What is a key?', back: 'A unique identifier' };
const mcq: CardContent = {
  type: 'mcq',
  question: 'Which normal form removes partial dependencies?',
  options: [
    { id: 'a', text: '1NF' },
    { id: 'b', text: '2NF' },
    { id: 'c', text: '3NF' },
  ],
  correct: 'b',
  explanation: 'Every non-key attribute depends on the whole key.',
};
const cloze: CardContent = {
  type: 'cloze',
  text: 'A {{primary key}} uniquely identifies each row.',
  accepted: ['pk'],
  hint: null,
  extra: null,
};
const short: CardContent = {
  type: 'short',
  question: 'What is a transaction?',
  answer: 'A unit of work that is atomic.',
  explanation: null,
};
const long: CardContent = {
  type: 'long',
  question: 'Explain ACID properties.',
  marks: 6,
  keyPoints: ['Atomicity', 'Consistency', 'Isolation', 'Durability'],
  modelAnswer: null,
};

const ok = (c: unknown) => CardContentSchema.safeParse(c).success;
const messages = (c: unknown) => {
  const r = CardContentSchema.safeParse(c);
  return r.success ? [] : r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
};

describe('CardContentSchema — valid content of every type', () => {
  it.each([basic, mcq, cloze, short, long])('accepts $type', (c) => {
    expect(CardContentSchema.parse(c)).toEqual(c);
  });

  it('rejects unknown types and unknown fields (strict)', () => {
    expect(ok({ ...short, type: 'essay' })).toBe(false);
    expect(ok({ ...short, extra: 'x' })).toBe(false);
    expect(
      ok({ ...mcq, options: [...mcq.options.slice(0, 2), { id: 'c', text: 'x', y: 1 }] }),
    ).toBe(false);
  });

  it('rejects blank required text (whitespace only counts as blank)', () => {
    expect(ok({ ...basic, front: '   ' })).toBe(false);
    expect(ok({ ...short, question: '' })).toBe(false);
    expect(ok({ ...short, answer: '\n' })).toBe(false);
    expect(ok({ ...long, question: ' ' })).toBe(false);
  });
});

describe('mcq rules', () => {
  const withOptions = (n: number) => ({
    ...mcq,
    options: 'abcdefg'
      .slice(0, n)
      .split('')
      .map((id) => ({ id, text: `Option ${id}` })),
    correct: 'a',
  });

  it('2–6 options', () => {
    expect(ok(withOptions(1))).toBe(false);
    expect(ok(withOptions(2))).toBe(true);
    expect(ok(withOptions(6))).toBe(true);
    expect(ok(withOptions(7))).toBe(false);
  });

  it('option ids are a–f and unique', () => {
    expect(
      ok({
        ...mcq,
        options: [
          { id: 'a', text: 'x' },
          { id: 'g', text: 'y' },
        ],
      }),
    ).toBe(false);
    expect(
      ok({
        ...mcq,
        options: [
          { id: 'A', text: 'x' },
          { id: 'b', text: 'y' },
        ],
        correct: 'b',
      }),
    ).toBe(false);
    expect(
      messages({
        ...mcq,
        options: [
          { id: 'a', text: 'x' },
          { id: 'a', text: 'y' },
        ],
        correct: 'a',
      }),
    ).toContainEqual(expect.stringContaining('option ids must be unique'));
  });

  it('correct must be one of the option ids', () => {
    expect(messages({ ...mcq, correct: 'd' })).toContainEqual(
      expect.stringContaining('correct must be one of the options'),
    );
  });

  it('option texts are unique, case-insensitively', () => {
    const dup = {
      ...mcq,
      options: [
        { id: 'a', text: '2NF' },
        { id: 'b', text: '2nf ' },
      ],
      correct: 'a',
    };
    expect(messages(dup)).toContainEqual(expect.stringContaining('option texts must be unique'));
  });

  it('option text must not be blank; explanation may be null', () => {
    expect(
      ok({
        ...mcq,
        options: [
          { id: 'a', text: ' ' },
          { id: 'b', text: 'y' },
        ],
        correct: 'b',
      }),
    ).toBe(false);
    expect(ok({ ...mcq, explanation: null })).toBe(true);
  });
});

describe('cloze rules', () => {
  it('exactly one {{…}} with non-empty content', () => {
    expect(ok({ ...cloze, text: 'No blank here.' })).toBe(false);
    expect(ok({ ...cloze, text: 'Two {{a}} and {{b}}.' })).toBe(false);
    expect(ok({ ...cloze, text: 'Empty {{}} blank.' })).toBe(false);
    expect(ok({ ...cloze, text: 'Blank {{   }} of spaces.' })).toBe(false);
    expect(ok({ ...cloze, text: 'Unclosed {{blank.' })).toBe(false);
    expect(ok({ ...cloze, text: 'Stray }} then {{x}}.' })).toBe(false);
    expect(messages({ ...cloze, text: 'No blank.' })).toContainEqual(
      expect.stringContaining('exactly one {{blank}}'),
    );
  });

  it('accepted: 0–10 non-blank spellings', () => {
    expect(ok({ ...cloze, accepted: [] })).toBe(true);
    expect(ok({ ...cloze, accepted: Array.from({ length: 10 }, (_, i) => `s${String(i)}`) })).toBe(
      true,
    );
    expect(ok({ ...cloze, accepted: Array.from({ length: 11 }, (_, i) => `s${String(i)}`) })).toBe(
      false,
    );
    expect(ok({ ...cloze, accepted: [' '] })).toBe(false);
  });
});

describe('long rules', () => {
  const points = (n: number) => Array.from({ length: n }, (_, i) => `Point ${String(i + 1)}`);

  it('2–12 non-blank key points', () => {
    expect(ok({ ...long, keyPoints: points(1) })).toBe(false);
    expect(ok({ ...long, keyPoints: points(2) })).toBe(true);
    expect(ok({ ...long, keyPoints: points(12) })).toBe(true);
    expect(ok({ ...long, keyPoints: points(13) })).toBe(false);
    expect(ok({ ...long, keyPoints: ['One', ' '] })).toBe(false);
  });

  it('marks 1–20 or null', () => {
    expect(ok({ ...long, marks: null })).toBe(true);
    expect(ok({ ...long, marks: 1 })).toBe(true);
    expect(ok({ ...long, marks: 20 })).toBe(true);
    expect(ok({ ...long, marks: 0 })).toBe(false);
    expect(ok({ ...long, marks: 21 })).toBe(false);
    expect(ok({ ...long, marks: 2.5 })).toBe(false);
  });
});

describe('text lengths', () => {
  const x = (n: number) => 'x'.repeat(n);

  it('every field of the new types is at most 5,000 characters', () => {
    expect(ok({ ...short, question: x(5000) })).toBe(true);
    expect(ok({ ...short, question: x(5001) })).toBe(false);
    expect(ok({ ...short, explanation: x(5001) })).toBe(false);
    expect(
      ok({
        ...mcq,
        options: [
          { id: 'a', text: x(5001) },
          { id: 'b', text: 'y' },
        ],
        correct: 'b',
      }),
    ).toBe(false);
    expect(ok({ ...long, keyPoints: [x(5001), 'y'] })).toBe(false);
    expect(ok({ ...cloze, accepted: [x(5001)] })).toBe(false);
  });

  it('the whole content is at most 20,000 characters', () => {
    const fat = {
      ...long,
      question: x(4000),
      keyPoints: [x(5000), x(5000), x(5000)],
      modelAnswer: x(1001),
    };
    expect(messages(fat)).toContainEqual(expect.stringContaining('20,000'));
    expect(ok({ ...fat, modelAnswer: x(1000) })).toBe(true);
  });

  it('basic cards keep the legacy limit (20,000 per side), so every existing card stays valid', () => {
    expect(ok({ ...basic, front: x(20_000), back: x(20_000) })).toBe(true);
    expect(ok({ ...basic, front: x(20_001) })).toBe(false);
  });
});

describe('deriveDisplay', () => {
  it('basic: front and back as they are', () => {
    expect(deriveDisplay(basic)).toEqual({ front: 'What is a key?', back: 'A unique identifier' });
  });

  it('mcq: question plus lettered options; back is the correct option plus explanation', () => {
    expect(deriveDisplay(mcq)).toEqual({
      front: 'Which normal form removes partial dependencies?\n\nA. 1NF\nB. 2NF\nC. 3NF',
      back: 'B — 2NF\n\nEvery non-key attribute depends on the whole key.',
    });
    expect(deriveDisplay({ ...mcq, explanation: null }).back).toBe('B — 2NF');
  });

  it('cloze: front has the blank as _____, back is the full sentence', () => {
    expect(deriveDisplay(cloze)).toEqual({
      front: 'A _____ uniquely identifies each row.',
      back: 'A primary key uniquely identifies each row.',
    });
  });

  it('short: question; back is the answer plus explanation', () => {
    expect(deriveDisplay(short)).toEqual({
      front: 'What is a transaction?',
      back: 'A unit of work that is atomic.',
    });
    expect(deriveDisplay({ ...short, explanation: 'Like ACID.' }).back).toBe(
      'A unit of work that is atomic.\n\nLike ACID.',
    );
  });

  it('long: question; back is the key points as "• " lines', () => {
    expect(deriveDisplay(long)).toEqual({
      front: 'Explain ACID properties.',
      back: '• Atomicity\n• Consistency\n• Isolation\n• Durability',
    });
  });

  it('is deterministic', () => {
    expect(deriveDisplay(structuredClone(mcq))).toEqual(deriveDisplay(mcq));
  });
});

describe('cloze matching', () => {
  it('the primary answer is the text inside the braces, trimmed', () => {
    expect(clozeAnswer({ ...cloze, text: 'A {{ primary key }} identifies.' })).toBe('primary key');
  });

  it('normalises: trim, NFC, lowercase, collapse spaces, trailing punctuation', () => {
    expect(normalizeAnswer('  Primary   KEY.  ')).toBe('primary key');
    expect(normalizeAnswer('key?!')).toBe('key');
    expect(normalizeAnswer('café')).toBe(normalizeAnswer('café'));
    expect(normalizeAnswer('a\tb\nc')).toBe('a b c');
  });

  it('accepts the primary answer in any case, spacing or with trailing punctuation', () => {
    for (const input of [
      'primary key',
      'PRIMARY KEY',
      ' primary  key ',
      'Primary key.',
      'primary key!',
    ]) {
      expect(matchCloze(cloze, input), input).toBe(true);
    }
  });

  it('accepts the extra accepted spellings', () => {
    expect(matchCloze(cloze, 'PK')).toBe(true);
  });

  it('Unicode: a composed and a decomposed é match each other', () => {
    const cafe = { ...cloze, text: 'I had a {{café}} au lait.', accepted: [] };
    expect(matchCloze(cafe, 'café')).toBe(true);
    expect(matchCloze(cafe, 'cafe')).toBe(false);
  });

  it('a near miss fails (no fuzzy matching), and so does empty input', () => {
    expect(matchCloze(cloze, 'primary keys')).toBe(false);
    expect(matchCloze(cloze, 'primery key')).toBe(false);
    expect(matchCloze(cloze, 'primarykey')).toBe(false);
    expect(matchCloze(cloze, '   ')).toBe(false);
  });

  it('only trailing punctuation is ignored, not punctuation inside the answer', () => {
    const c = { ...cloze, text: 'Use {{e.g.}} carefully.', accepted: [] };
    expect(matchCloze(c, 'e.g')).toBe(true);
    expect(matchCloze(c, 'eg')).toBe(false);
  });
});

describe('rating mapping', () => {
  it('mcq: wrong → Again only; right → Hard, Good, Easy (no Again)', () => {
    expect(mcqRatings(false)).toEqual([1]);
    expect(mcqRatings(true)).toEqual([2, 3, 4]);
  });

  it('cloze: typed and right → 2–4; typed and wrong → 1; revealed → 1–4', () => {
    expect(clozeRatings('typed', true)).toEqual([2, 3, 4]);
    expect(clozeRatings('typed', false)).toEqual([1]);
    expect(clozeRatings('revealed', null)).toEqual([1, 2, 3, 4]);
  });

  it('long: suggestion from the share of key points ticked, at every boundary', () => {
    const at = (hit: number) => suggestLongRating(hit, 100);
    expect(at(0)).toBe(1);
    expect(at(49)).toBe(1);
    expect(at(50)).toBe(2);
    expect(at(74)).toBe(2);
    expect(at(75)).toBe(3);
    expect(at(99)).toBe(3);
    expect(at(100)).toBe(3);
  });

  it('long: works with real checklist sizes (no floating-point edge errors)', () => {
    expect(suggestLongRating(1, 2)).toBe(2); // 50%
    expect(suggestLongRating(2, 3)).toBe(2); // 66.7%
    expect(suggestLongRating(3, 4)).toBe(3); // 75%
    expect(suggestLongRating(5, 7)).toBe(2); // 71.4%
    expect(() => suggestLongRating(3, 2)).toThrow();
  });
});

describe('OutcomeSchema (no free text, ever)', () => {
  it('accepts the three kinds', () => {
    for (const o of [
      { kind: 'mcq', selected: 'c', correct: false },
      { kind: 'cloze', mode: 'typed', correct: true },
      { kind: 'cloze', mode: 'revealed', correct: null },
      { kind: 'long', hit: 3, total: 4, suggested: 3 },
    ]) {
      expect(OutcomeSchema.parse(o)).toEqual(o);
    }
  });

  it('rejects anything that could carry typed text', () => {
    expect(
      OutcomeSchema.safeParse({ kind: 'mcq', selected: 'my answer', correct: false }).success,
    ).toBe(false);
    expect(
      OutcomeSchema.safeParse({ kind: 'cloze', mode: 'typed', correct: false, typed: 'pk' })
        .success,
    ).toBe(false);
    expect(OutcomeSchema.safeParse({ kind: 'short', answer: 'x' }).success).toBe(false);
  });

  it('keeps each kind internally consistent', () => {
    expect(OutcomeSchema.safeParse({ kind: 'cloze', mode: 'typed', correct: null }).success).toBe(
      false,
    );
    expect(
      OutcomeSchema.safeParse({ kind: 'cloze', mode: 'revealed', correct: true }).success,
    ).toBe(false);
    expect(OutcomeSchema.safeParse({ kind: 'long', hit: 5, total: 4, suggested: 3 }).success).toBe(
      false,
    );
    expect(OutcomeSchema.safeParse({ kind: 'long', hit: 1, total: 4, suggested: 3 }).success).toBe(
      false,
    );
    expect(OutcomeSchema.safeParse({ kind: 'long', hit: 1, total: 1, suggested: 3 }).success).toBe(
      false,
    );
  });

  it('every outcome field is a number, boolean, enum or option id — introspected', () => {
    // The only string-valued fields allowed are enums: `kind`, `mode`, and the option id.
    for (const option of OutcomeSchema.options) {
      for (const [key, field] of Object.entries(option.shape)) {
        const schema = field as z.ZodType;
        const inner = schema instanceof z.ZodNullable ? (schema.unwrap() as z.ZodType) : schema;
        expect(['literal', 'enum', 'boolean', 'number'], key).toContain(inner.def.type);
      }
    }
  });
});
