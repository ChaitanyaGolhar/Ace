import { z } from 'zod';

// Question types (BUILD_BRIEF_M6_M8 §6.1–6.4): card content, the display text derived
// from it, cloze matching, the rating rules per type, and the review-log outcome.
// Pure and deterministic, like the rest of core.

export const CARD_TYPES = ['basic', 'mcq', 'cloze', 'short', 'long'] as const;
export type CardType = (typeof CARD_TYPES)[number];

/** Every text field of the new types. */
export const MAX_FIELD_LENGTH = 5_000;
/** All text of one card together (and the legacy per-side limit of basic cards). */
export const MAX_CONTENT_LENGTH = 20_000;

const notBlank = (s: string) => s.trim().length > 0;
const Field = z.string().max(MAX_FIELD_LENGTH).refine(notBlank, 'must not be blank');
const OptionalField = Field.nullable();

export const OptionIdSchema = z.enum(['a', 'b', 'c', 'd', 'e', 'f']);
export type OptionId = z.infer<typeof OptionIdSchema>;

/** Basic cards keep the pre-M6 limits (20,000 per side), so every existing card stays valid. */
const LegacyText = z.string().max(MAX_CONTENT_LENGTH).refine(notBlank, 'must not be blank');

export const BasicContentSchema = z.strictObject({
  type: z.literal('basic'),
  front: LegacyText,
  back: LegacyText,
});

export const McqContentSchema = z
  .strictObject({
    type: z.literal('mcq'),
    question: Field,
    options: z
      .array(z.strictObject({ id: OptionIdSchema, text: Field }))
      .min(2)
      .max(6),
    correct: OptionIdSchema,
    explanation: OptionalField,
  })
  .superRefine((c, ctx) => {
    const ids = c.options.map((o) => o.id);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: 'custom', path: ['options'], message: 'option ids must be unique' });
    }
    if (!ids.includes(c.correct)) {
      ctx.addIssue({
        code: 'custom',
        path: ['correct'],
        message: 'correct must be one of the options',
      });
    }
    const texts = c.options.map((o) => o.text.trim().toLowerCase());
    if (new Set(texts).size !== texts.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['options'],
        message: 'option texts must be unique (ignoring case)',
      });
    }
  });

/** `{{…}}`: the blank. Content may not contain braces. */
const BLANK = /\{\{([^{}]*)\}\}/;

export const ClozeContentSchema = z.strictObject({
  type: z.literal('cloze'),
  text: Field.refine(
    hasExactlyOneBlank,
    'must contain exactly one {{blank}} with an answer inside',
  ),
  accepted: z.array(Field).max(10),
  hint: OptionalField,
  extra: OptionalField,
});

export const ShortContentSchema = z.strictObject({
  type: z.literal('short'),
  question: Field,
  answer: Field,
  explanation: OptionalField,
});

export const LongContentSchema = z.strictObject({
  type: z.literal('long'),
  question: Field,
  marks: z.int().min(1).max(20).nullable(),
  keyPoints: z.array(Field).min(2).max(12),
  modelAnswer: OptionalField,
});

export const CardContentSchema = z
  .discriminatedUnion('type', [
    BasicContentSchema,
    McqContentSchema,
    ClozeContentSchema,
    ShortContentSchema,
    LongContentSchema,
  ])
  .superRefine((c, ctx) => {
    if (c.type === 'basic') return;
    if (textLength(c) > MAX_CONTENT_LENGTH) {
      ctx.addIssue({
        code: 'custom',
        path: [],
        message: 'all text together must be at most 20,000 characters',
      });
      return;
    }
    // Old clients still read front/back with the 20,000 limit, so the derived text must fit.
    const { front, back } = deriveDisplay(c);
    if (front.length > MAX_CONTENT_LENGTH || back.length > MAX_CONTENT_LENGTH) {
      ctx.addIssue({
        code: 'custom',
        path: [],
        message: 'the card is too long to display (over 20,000 characters)',
      });
    }
  });

export type CardContent = z.infer<typeof CardContentSchema>;
export type BasicContent = z.infer<typeof BasicContentSchema>;
export type McqContent = z.infer<typeof McqContentSchema>;
export type ClozeContent = z.infer<typeof ClozeContentSchema>;
export type ShortContent = z.infer<typeof ShortContentSchema>;
export type LongContent = z.infer<typeof LongContentSchema>;

function hasExactlyOneBlank(text: string): boolean {
  const opens = text.split('{{').length - 1;
  const closes = text.split('}}').length - 1;
  const m = BLANK.exec(text);
  return opens === 1 && closes === 1 && m !== null && notBlank(m[1] ?? '');
}

function textLength(c: CardContent): number {
  const parts: (string | null)[] = (() => {
    switch (c.type) {
      case 'basic':
        return [c.front, c.back];
      case 'mcq':
        return [c.question, c.explanation, ...c.options.map((o) => o.text)];
      case 'cloze':
        return [c.text, c.hint, c.extra, ...c.accepted];
      case 'short':
        return [c.question, c.answer, c.explanation];
      case 'long':
        return [c.question, c.modelAnswer, ...c.keyPoints];
    }
  })();
  return parts.reduce((sum, p) => sum + (p?.length ?? 0), 0);
}

/**
 * The plain front/back text of a card (§6.2): what lists, search, stats and old clients
 * show. Deterministic; stored on every card and checked against its content.
 */
export function deriveDisplay(c: CardContent): { front: string; back: string } {
  switch (c.type) {
    case 'basic':
      return { front: c.front, back: c.back };
    case 'mcq': {
      const lines = c.options.map((o) => `${o.id.toUpperCase()}. ${o.text}`);
      const right = c.options.find((o) => o.id === c.correct);
      const answer = `${c.correct.toUpperCase()} — ${right?.text ?? ''}`;
      return {
        front: `${c.question}\n\n${lines.join('\n')}`,
        back: withNote(answer, c.explanation),
      };
    }
    case 'cloze':
      return {
        front: c.text.replace(BLANK, '_____'),
        back: c.text.replace(BLANK, (_, inner: string) => inner),
      };
    case 'short':
      return { front: c.question, back: withNote(c.answer, c.explanation) };
    case 'long':
      return { front: c.question, back: c.keyPoints.map((p) => `• ${p}`).join('\n') };
  }
}

function withNote(main: string, note: string | null): string {
  return note === null ? main : `${main}\n\n${note}`;
}

/** The answer of a cloze card: the text inside the braces, trimmed. */
export function clozeAnswer(c: ClozeContent): string {
  return (BLANK.exec(c.text)?.[1] ?? '').trim();
}

/**
 * Normalises a typed or expected cloze answer (§6.3): trim, Unicode NFC, lower case,
 * whitespace collapsed to single spaces, trailing `.,;:!?` removed.
 */
export function normalizeAnswer(s: string): string {
  return s
    .normalize('NFC')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[.,;:!?]+$/u, '')
    .trim();
}

/** Exact match after normalisation, against the answer or any accepted spelling. No fuzzing. */
export function matchCloze(c: ClozeContent, input: string): boolean {
  const typed = normalizeAnswer(input);
  if (typed === '') return false;
  return [clozeAnswer(c), ...c.accepted].some((expected) => normalizeAnswer(expected) === typed);
}

type Rating = 1 | 2 | 3 | 4;

/** MCQ (§6.3): a wrong choice can only be rated Again; a right one Hard, Good or Easy. */
export function mcqRatings(correct: boolean): readonly Rating[] {
  return correct ? [2, 3, 4] : [1];
}

/** Cloze (§6.3): typed and right → 2–4; typed and wrong → Again; revealed → any. */
export function clozeRatings(
  mode: 'typed' | 'revealed',
  correct: boolean | null,
): readonly Rating[] {
  if (mode === 'revealed') return [1, 2, 3, 4];
  return correct === true ? [2, 3, 4] : [1];
}

/**
 * Long answer (§6.3): the suggested rating from the share of key points ticked.
 * < 50% Again · 50–74% Hard · 75–100% Good. Integer arithmetic, so no rounding surprises.
 */
export function suggestLongRating(hit: number, total: number): Rating {
  if (!Number.isInteger(hit) || !Number.isInteger(total) || total < 1 || hit < 0 || hit > total) {
    throw new Error(`suggestLongRating: invalid ${String(hit)}/${String(total)}`);
  }
  if (hit * 100 < total * 50) return 1;
  if (hit * 100 < total * 75) return 2;
  return 3;
}

/**
 * What happened in a review, beyond the rating (§6.4). Strict objects whose only
 * string-valued fields are enums, so typed text can never be stored here.
 */
export const OutcomeSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('mcq'), selected: OptionIdSchema, correct: z.boolean() }),
  z
    .strictObject({
      kind: z.literal('cloze'),
      mode: z.enum(['typed', 'revealed']),
      correct: z.boolean().nullable(),
    })
    .refine((o) => (o.mode === 'revealed') === (o.correct === null), {
      message: 'correct is null exactly when the answer was revealed',
      path: ['correct'],
    }),
  z
    .strictObject({
      kind: z.literal('long'),
      hit: z.int().min(0).max(12),
      total: z.int().min(2).max(12),
      suggested: z.literal([1, 2, 3, 4]),
    })
    .refine((o) => o.hit <= o.total && o.suggested === suggestLongRating(o.hit, o.total), {
      message: 'hit must be at most total, and suggested must follow from them',
      path: ['suggested'],
    }),
]);

export type Outcome = z.infer<typeof OutcomeSchema>;

/** The ratings a review with this outcome may record. */
export function allowedRatings(outcome: Outcome | null): readonly Rating[] {
  if (outcome === null) return [1, 2, 3, 4];
  switch (outcome.kind) {
    case 'mcq':
      return mcqRatings(outcome.correct);
    case 'cloze':
      return clozeRatings(outcome.mode, outcome.correct);
    case 'long':
      return [1, 2, 3, 4];
  }
}
