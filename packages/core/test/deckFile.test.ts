import { describe, expect, it } from 'vitest';
import {
  cardContentOf,
  deckWarnings,
  validateDeckFile,
  type DeckFile,
  type DeckWarning,
} from '../src';

// `ace-deck@2` (BUILD_BRIEF_M6_M8 §7.2, amended 2026-10-11) and the publishing warnings
// (§7.4). The format is also what ChatGPT generates, so errors name the card key, the
// field and the problem.

function validFile(): Record<string, unknown> {
  return {
    format: 'ace-deck@2',
    slug: 'sppu-te-cse-dbms',
    version: 1,
    title: 'Database Management Systems',
    description: 'Unit-wise revision for SPPU TE.',
    catalog: {
      university: 'SPPU',
      pattern: '2024',
      year: 'TE',
      semester: 5,
      branches: ['CSE', 'CSE-DS', 'AIDS'],
      subject: 'Database Management Systems',
      subjectCodes: { CSE: 'PCC301COM', 'CSE-DS': 'PCC301CDS', AIDS: null },
      units: [
        { number: 1, title: 'Introduction to DBMS' },
        { number: 2, title: 'Relational model' },
      ],
    },
    price: 0,
    author: 'Chaitanya Golhar',
    reviewedBy: null,
    lastVerifiedAt: '2026-10-11',
    cards: [
      {
        key: 'u1-001',
        unit: 1,
        type: 'basic',
        front: 'What is a DBMS?',
        back: 'Software that manages databases.',
      },
      {
        key: 'u1-002',
        unit: 1,
        type: 'mcq',
        question: 'Which key identifies a row?',
        options: [
          { id: 'a', text: 'Foreign key' },
          { id: 'b', text: 'Primary key' },
          { id: 'c', text: 'Super key' },
          { id: 'd', text: 'Alternate key' },
        ],
        correct: 'b',
        explanation: 'Unique and not null.',
      },
      {
        key: 'u1-003',
        unit: 1,
        type: 'cloze',
        text: 'A {{primary key}} uniquely identifies each row.',
        accepted: ['pk'],
        hint: null,
        extra: null,
      },
      {
        key: 'u2-001',
        unit: 2,
        type: 'short',
        question: 'What is a view?',
        answer: 'A stored query.',
        explanation: null,
      },
      {
        key: 'u2-002',
        unit: 2,
        type: 'long',
        question: 'Explain normalisation.',
        marks: 6,
        keyPoints: ['Removes redundancy', 'Avoids update anomalies', 'Normal forms 1NF to BCNF'],
        modelAnswer: 'Normalisation organises tables to reduce redundancy.',
      },
      {
        key: 'u1-004',
        unit: 1,
        type: 'long',
        question: 'Explain the three-schema architecture.',
        marks: 6,
        keyPoints: ['External level', 'Conceptual level', 'Internal level'],
        modelAnswer: null,
      },
    ],
  };
}

type Mutable = Record<string, unknown>;
const cardsOf = (f: Mutable) => f.cards as Mutable[];
const catalogOf = (f: Mutable) => f.catalog as Mutable;

function errorsFor(mutate: (f: Mutable) => void): string[] {
  const f = validFile();
  mutate(f);
  const result = validateDeckFile(f);
  if (result.ok) throw new Error('expected the file to be rejected');
  return result.errors;
}

describe('validateDeckFile: a valid file', () => {
  it('passes, with every card type', () => {
    const result = validateDeckFile(validFile());
    if (!result.ok) throw new Error(result.errors.join('\n'));
    expect(result.deck.cards.map((c) => c.type)).toEqual([
      'basic',
      'mcq',
      'cloze',
      'short',
      'long',
      'long',
    ]);
  });

  it('fills missing optional fields with null or []', () => {
    const f = validFile();
    const [, mcq, cloze, short, long] = cardsOf(f);
    delete mcq?.explanation;
    delete cloze?.accepted;
    delete cloze?.hint;
    delete cloze?.extra;
    delete short?.explanation;
    delete long?.marks;
    delete long?.modelAnswer;
    f.reviewedBy = undefined;
    delete f.reviewedBy;
    const result = validateDeckFile(f);
    if (!result.ok) throw new Error(result.errors.join('\n'));
    const [, m, c, s, l] = result.deck.cards;
    expect(m).toMatchObject({ explanation: null });
    expect(c).toMatchObject({ accepted: [], hint: null, extra: null });
    expect(s).toMatchObject({ explanation: null });
    expect(l).toMatchObject({ marks: null, modelAnswer: null });
    expect(result.deck.reviewedBy).toBeNull();
  });

  it('cardContentOf gives the M6 card content (no key or unit)', () => {
    const result = validateDeckFile(validFile());
    if (!result.ok) throw new Error('invalid');
    const first = result.deck.cards[0];
    if (!first) throw new Error('no card');
    expect(cardContentOf(first)).toEqual({
      type: 'basic',
      front: 'What is a DBMS?',
      back: 'Software that manages databases.',
    });
  });
});

describe('validateDeckFile: every rule rejects with a readable error', () => {
  it('not an object at all', () => {
    for (const input of [null, 'text', [], 42]) {
      const result = validateDeckFile(input);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors.join(' ')).toMatch(/file|format/);
    }
  });

  const cases: [string, (f: Mutable) => void, RegExp][] = [
    ['wrong format', (f) => (f.format = 'ace-deck@1'), /format.*ace-deck@2/],
    ['bad slug', (f) => (f.slug = 'SPPU DBMS'), /slug/],
    ['version 0', (f) => (f.version = 0), /version/],
    ['version not a whole number', (f) => (f.version = 1.5), /version/],
    ['blank title', (f) => (f.title = '  '), /title/],
    ['missing description', (f) => delete f.description, /description/],
    ['bad year', (f) => (catalogOf(f).year = 'TY'), /catalog\.year/],
    ['semester 9', (f) => (catalogOf(f).semester = 9), /catalog\.semester/],
    ['no branches', (f) => (catalogOf(f).branches = []), /catalog\.branches/],
    ['duplicate branch', (f) => (catalogOf(f).branches = ['CSE', 'CSE']), /catalog\.branches.*CSE/],
    ['no units', (f) => (catalogOf(f).units = []), /catalog\.units/],
    [
      'duplicate unit number',
      (f) =>
        (catalogOf(f).units = [
          { number: 1, title: 'A' },
          { number: 1, title: 'B' },
        ]),
      /catalog\.units.*1/,
    ],
    ['negative price', (f) => (f.price = -1), /price/],
    ['price not whole paise', (f) => (f.price = 49.5), /price/],
    ['bad date', (f) => (f.lastVerifiedAt = '2026-13-40'), /lastVerifiedAt.*YYYY-MM-DD/],
    ['date in another format', (f) => (f.lastVerifiedAt = '11-10-2026'), /lastVerifiedAt/],
    ['no cards', (f) => (f.cards = []), /cards/],
    ['card not an object', (f) => (f.cards as unknown[]).push('oops'), /cards\[6\]/],
  ];
  for (const [name, mutate, pattern] of cases) {
    it(name, () => {
      expect(errorsFor(mutate).join('\n')).toMatch(pattern);
    });
  }

  it('pattern is the year only: "2024 Pattern", "2019-20" and "Rev-2019" are rejected, saying so', () => {
    for (const bad of ['2024 Pattern', '2019-20', 'Rev-2019', '24', 2024]) {
      const errors = errorsFor((f) => (catalogOf(f).pattern = bad)).join('\n');
      expect(errors, String(bad)).toMatch(/catalog\.pattern/);
      expect(errors).toMatch(/year only.*"2024"/);
    }
  });

  it('subjectCodes must have exactly one entry per branch, naming what is missing or extra', () => {
    expect(
      errorsFor((f) => (catalogOf(f).subjectCodes = { CSE: 'A', AIDS: null })).join('\n'),
    ).toMatch(/subjectCodes.*missing.*CSE-DS/);
    expect(
      errorsFor(
        (f) => (catalogOf(f).subjectCodes = { CSE: 'A', 'CSE-DS': 'B', AIDS: null, ECE: 'C' }),
      ).join('\n'),
    ).toMatch(/subjectCodes.*not a branch.*ECE/);
    expect(
      errorsFor((f) => (catalogOf(f).subjectCodes = { CSE: '', 'CSE-DS': null, AIDS: null })).join(
        '\n',
      ),
    ).toMatch(/subjectCodes\.CSE/);
  });

  it('card errors name the card key, the field and the problem', () => {
    const errors = errorsFor((f) => {
      const mcq = cardsOf(f)[1];
      if (mcq) mcq.correct = 'e';
    });
    expect(errors).toContainEqual(expect.stringMatching(/^u1-002 · correct: .*one of the options/));
  });

  it('a duplicate key is an error naming it', () => {
    const errors = errorsFor((f) => {
      const c = cardsOf(f)[2];
      if (c) c.key = 'u1-001';
    });
    expect(errors.join('\n')).toMatch(/u1-001.*duplicate key/);
  });

  it('keys follow u<unit>-<3 digits>', () => {
    for (const bad of ['U1-001', 'u1-1', 'u1-0001', 'unit1-001', '']) {
      const errors = errorsFor((f) => {
        const c = cardsOf(f)[0];
        if (c) c.key = bad;
      });
      expect(errors.join('\n'), bad).toMatch(/key/);
    }
  });

  it('a card unit must be in catalog.units', () => {
    const errors = errorsFor((f) => {
      const c = cardsOf(f)[0];
      if (c) c.unit = 7;
    });
    expect(errors.join('\n')).toMatch(/u1-001 · unit: unit 7 is not in catalog\.units/);
  });

  it('an unknown or missing card type is an error', () => {
    expect(
      errorsFor((f) => {
        const c = cardsOf(f)[0];
        if (c) c.type = 'essay';
      }).join('\n'),
    ).toMatch(/u1-001 · type/);
  });

  it('every M6 content rule applies (e.g. a cloze needs exactly one blank)', () => {
    expect(
      errorsFor((f) => {
        const c = cardsOf(f)[2];
        if (c) c.text = 'No blank here.';
      }).join('\n'),
    ).toMatch(/u1-003 · text: .*blank/);
  });
});

describe('validateDeckFile: unknown fields are rejected, by name', () => {
  it('top level', () => {
    expect(errorsFor((f) => (f.titel = 'typo')).join('\n')).toMatch(/titel/);
  });
  it('catalog', () => {
    expect(errorsFor((f) => (catalogOf(f).sem = 5)).join('\n')).toMatch(/catalog.*sem/);
  });
  it('a card', () => {
    expect(
      errorsFor((f) => {
        const c = cardsOf(f)[1];
        if (c) c.explanaton = 'typo';
      }).join('\n'),
    ).toMatch(/u1-002.*explanaton/);
  });
  it('a unit and an option', () => {
    expect(
      errorsFor((f) => {
        catalogOf(f).units = [
          { number: 1, title: 'A', hours: 6 },
          { number: 2, title: 'B' },
        ];
      }).join('\n'),
    ).toMatch(/hours/);
    expect(
      errorsFor((f) => {
        const mcq = cardsOf(f)[1] as { options: Mutable[] };
        const first = mcq.options[0];
        if (first) first.correct = true;
      }).join('\n'),
    ).toMatch(/u1-002.*options\.0.*correct/);
  });
});

// ---------------------------------------------------------------- warnings (§7.4)

function deckWith(mutate: (f: Mutable) => void = () => undefined): DeckFile {
  const f = validFile();
  mutate(f);
  const result = validateDeckFile(f);
  if (!result.ok) throw new Error(result.errors.join('\n'));
  return result.deck;
}
const codes = (ws: DeckWarning[]) => ws.map((w) => w.code);

describe('deckWarnings', () => {
  it('the valid fixture has none', () => {
    expect(deckWarnings(deckWith())).toEqual([]);
  });

  it('near-duplicate questions (same normalised text)', () => {
    const deck = deckWith((f) => {
      cardsOf(f).push({
        key: 'u2-003',
        unit: 2,
        type: 'short',
        question: '  what is a VIEW? ',
        answer: 'x',
      });
    });
    const w = deckWarnings(deck).find((x) => x.code === 'duplicate_question');
    expect(w?.keys).toEqual(['u2-001', 'u2-003']);
    // A different question doesn't warn.
    expect(
      codes(
        deckWarnings(
          deckWith((f) => {
            cardsOf(f).push({
              key: 'u2-003',
              unit: 2,
              type: 'short',
              question: 'What is a trigger?',
              answer: 'x',
            });
          }),
        ),
      ),
    ).not.toContain('duplicate_question');
  });

  describe('deck level: the correct option is the longest in more than 40% of MCQs', () => {
    const mcq = (n: number, longestCorrect: boolean, tie = false) => ({
      key: `u2-${String(100 + n)}`,
      unit: 2,
      type: 'mcq',
      question: `Question ${String(n)}?`,
      options: [
        { id: 'a', text: tie ? 'Same length A' : 'Short' },
        {
          id: 'b',
          text: longestCorrect ? 'A much longer correct option' : tie ? 'Same length B' : 'Mid',
        },
      ],
      correct: 'b',
    });
    const withMcqs = (longest: number, other: number, ties = 0) =>
      deckWith((f) => {
        cardsOf(f).splice(1, 1); // drop the fixture's MCQ
        for (let i = 0; i < longest; i++) cardsOf(f).push(mcq(i, true));
        for (let i = 0; i < other; i++) cardsOf(f).push(mcq(longest + i, false));
        for (let i = 0; i < ties; i++) cardsOf(f).push(mcq(longest + other + i, false, true));
      });

    it('3 of 5 (60%) warns, once, for the whole deck', () => {
      const ws = deckWarnings(withMcqs(3, 2)).filter((w) => w.code === 'correct_option_longest');
      expect(ws).toHaveLength(1);
      expect(ws[0]?.message).toMatch(/3 of 5 MCQs \(60%\)/);
    });
    it('2 of 5 (40%) does not warn: it must be more than 40%', () => {
      expect(codes(deckWarnings(withMcqs(2, 3)))).not.toContain('correct_option_longest');
    });
    it('ties for longest don’t count', () => {
      expect(codes(deckWarnings(withMcqs(0, 0, 5)))).not.toContain('correct_option_longest');
    });
  });

  it('long answers with fewer than 3 key points', () => {
    const deck = deckWith((f) => {
      const long = cardsOf(f)[4];
      if (long) long.keyPoints = ['One', 'Two'];
    });
    expect(deckWarnings(deck).find((w) => w.code === 'few_key_points')?.keys).toEqual(['u2-002']);
  });

  it('units with no long-answer cards', () => {
    const deck = deckWith((f) => {
      catalogOf(f).units = [
        ...(catalogOf(f).units as Mutable[]),
        { number: 3, title: 'Transactions' },
      ];
    });
    const w = deckWarnings(deck).find((x) => x.code === 'unit_without_long');
    expect(w?.message).toMatch(/Unit 3/);
    expect(codes(deckWarnings(deckWith()))).not.toContain('unit_without_long');
  });

  it('a marks note like "[6 marks]" in a long question (any number, any case)', () => {
    for (const q of [
      'Explain ACID. [6 marks]',
      'Explain ACID [10 MARKS]',
      'Explain ACID (1 mark)',
    ]) {
      const deck = deckWith((f) => {
        const long = cardsOf(f)[4];
        if (long) long.question = q;
      });
      expect(deckWarnings(deck).find((w) => w.code === 'marks_in_question')?.keys, q).toEqual([
        'u2-002',
      ]);
    }
    // "marks" as an ordinary word doesn't warn.
    const deck = deckWith((f) => {
      const long = cardsOf(f)[4];
      if (long) long.question = 'Explain how a DBMS marks a row as deleted.';
    });
    expect(codes(deckWarnings(deck))).not.toContain('marks_in_question');
  });

  it('key points starting with Gives / Uses / Notes / Mentions / Explains that', () => {
    for (const p of [
      'Gives an example',
      'uses a diagram',
      'NOTES the trade-off',
      'Mentions BCNF',
      'Explains that 3NF removes transitive dependencies',
    ]) {
      const deck = deckWith((f) => {
        const long = cardsOf(f)[4] as { keyPoints: string[] };
        long.keyPoints = [p, 'Two', 'Three'];
      });
      expect(deckWarnings(deck).find((w) => w.code === 'meta_key_point')?.keys, p).toEqual([
        'u2-002',
      ]);
    }
    // Words that merely start the same way, or "Explains" without "that", don't warn.
    const deck = deckWith((f) => {
      const long = cardsOf(f)[4] as { keyPoints: string[] };
      long.keyPoints = ['Users need access control', 'Explains the anomaly', 'Notably faster'];
    });
    expect(codes(deckWarnings(deck))).not.toContain('meta_key_point');
  });

  describe('a basic card and a cloze card testing the same term', () => {
    it('the PCA case warns: basic back "Principal Component Analysis." and cloze "PCA" accepting it', () => {
      const deck = deckWith((f) => {
        cardsOf(f).push(
          {
            key: 'u2-010',
            unit: 2,
            type: 'basic',
            front: 'What does PCA stand for?',
            back: 'Principal Component Analysis.',
          },
          {
            key: 'u2-011',
            unit: 2,
            type: 'cloze',
            text: '{{PCA}} reduces dimensionality.',
            accepted: ['Principal Component Analysis'],
          },
        );
      });
      expect(deckWarnings(deck).find((w) => w.code === 'basic_cloze_same_term')?.keys).toEqual([
        'u2-010',
        'u2-011',
      ]);
    });

    it('the primary answer matches too (normalised as by the cloze matcher)', () => {
      const deck = deckWith((f) => {
        cardsOf(f).push({
          key: 'u2-010',
          unit: 2,
          type: 'basic',
          front: 'Which key identifies each row?',
          back: '  Primary   KEY! ',
        });
      });
      expect(codes(deckWarnings(deck))).toContain('basic_cloze_same_term');
    });

    it('a basic card whose front merely contains the term does not warn', () => {
      const deck = deckWith((f) => {
        cardsOf(f).push(
          {
            key: 'u2-010',
            unit: 2,
            type: 'basic',
            front: 'Why does every label need an owner?',
            back: 'For accountability.',
          },
          { key: 'u2-011', unit: 2, type: 'cloze', text: 'Each row gets a {{label}}.' },
        );
      });
      expect(codes(deckWarnings(deck))).not.toContain('basic_cloze_same_term');
    });
  });
});
