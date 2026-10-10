import { CardContentSchema, OptionIdSchema, type CardContent, type CardType } from '@recall/core';
import { normalizeContent } from '../../services/cards';

// The card editor's form state (BUILD_BRIEF_M6_M8 §6.5). One flat draft covers every
// type, so switching type can carry the shared fields (question, answer, explanation).
// Validation runs core's CardContentSchema and maps each problem to the field it
// belongs to, with the message shown next to that field.

export interface Draft {
  type: CardType;
  /** basic front · mcq/short/long question · cloze sentence */
  prompt: string;
  /** basic answer · short model answer */
  answer: string;
  /** mcq · short */
  explanation: string;
  /** mcq option texts, in order (ids are a, b, c… by position) */
  options: string[];
  /** index of the correct option, or null if none chosen yet */
  correct: number | null;
  accepted: string[];
  hint: string;
  extra: string;
  /** long: '' for none, otherwise the number as typed */
  marks: string;
  keyPoints: string[];
  modelAnswer: string;
}

export const TYPE_LABELS: Record<CardType, string> = {
  basic: 'Basic',
  mcq: 'Multiple choice',
  cloze: 'Fill in the blank',
  short: 'Short answer',
  long: 'Long answer',
};

export function emptyDraft(type: CardType = 'basic'): Draft {
  return {
    type,
    prompt: '',
    answer: '',
    explanation: '',
    options: ['', ''],
    correct: null,
    accepted: [],
    hint: '',
    extra: '',
    marks: '',
    keyPoints: ['', ''],
    modelAnswer: '',
  };
}

const optional = (s: string | null) => s ?? '';
const orNull = (s: string) => (s.trim() === '' ? null : s);
const letter = (i: number) => OptionIdSchema.options[i] ?? 'a';

export function draftFromContent(c: CardContent): Draft {
  const d = emptyDraft(c.type);
  switch (c.type) {
    case 'basic':
      return { ...d, prompt: c.front, answer: c.back };
    case 'mcq':
      return {
        ...d,
        prompt: c.question,
        options: c.options.map((o) => o.text),
        correct: c.options.findIndex((o) => o.id === c.correct),
        explanation: optional(c.explanation),
      };
    case 'cloze':
      return {
        ...d,
        prompt: c.text,
        accepted: [...c.accepted],
        hint: optional(c.hint),
        extra: optional(c.extra),
      };
    case 'short':
      return { ...d, prompt: c.question, answer: c.answer, explanation: optional(c.explanation) };
    case 'long':
      return {
        ...d,
        prompt: c.question,
        marks: c.marks === null ? '' : String(c.marks),
        keyPoints: [...c.keyPoints],
        modelAnswer: optional(c.modelAnswer),
      };
  }
}

function parseMarks(marks: string): number | null {
  const t = marks.trim();
  return /^\d+$/.test(t) ? Number(t) : null;
}

/** The content this draft describes (not yet validated; the service trims it). */
export function draftToContent(d: Draft): CardContent {
  switch (d.type) {
    case 'basic':
      return { type: 'basic', front: d.prompt, back: d.answer };
    case 'mcq':
      return {
        type: 'mcq',
        question: d.prompt,
        options: d.options.map((text, i) => ({ id: letter(i), text })),
        correct: letter(d.correct ?? 0),
        explanation: orNull(d.explanation),
      };
    case 'cloze':
      return {
        type: 'cloze',
        text: d.prompt,
        accepted: d.accepted,
        hint: orNull(d.hint),
        extra: orNull(d.extra),
      };
    case 'short':
      return {
        type: 'short',
        question: d.prompt,
        answer: d.answer,
        explanation: orNull(d.explanation),
      };
    case 'long':
      return {
        type: 'long',
        question: d.prompt,
        marks: parseMarks(d.marks),
        keyPoints: d.keyPoints,
        modelAnswer: orNull(d.modelAnswer),
      };
  }
}

const MARKS_MESSAGE = 'Marks must be a whole number from 1 to 20.';
const CLOZE_MESSAGE = 'Wrap the answer in {{double braces}} — exactly one blank.';

/** Field → error message, plus the validated content when there are no errors. */
export function validateDraft(d: Draft): {
  content: CardContent | null;
  errors: Record<string, string>;
} {
  const errors: Record<string, string> = {};
  if (d.type === 'mcq' && (d.correct === null || d.correct >= d.options.length)) {
    errors.correct = 'Choose the correct option.';
  }
  if (d.type === 'long' && d.marks.trim() !== '' && parseMarks(d.marks) === null) {
    errors.marks = MARKS_MESSAGE;
  }
  const parsed = CardContentSchema.safeParse(normalizeContent(draftToContent(d)));
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const key = fieldKey(issue.path);
      errors[key] ??= messageFor(d, key, issue);
    }
  }
  const valid = Object.keys(errors).length === 0 && parsed.success;
  return { content: valid ? parsed.data : null, errors };
}

function fieldKey(path: readonly PropertyKey[]): string {
  const [head, index] = path;
  switch (head) {
    case 'front':
    case 'question':
    case 'text':
      return 'prompt';
    case 'back':
    case 'answer':
      return 'answer';
    case 'options':
      return typeof index === 'number' ? `options.${String(index)}` : 'options';
    case 'keyPoints':
      return typeof index === 'number' ? `keyPoints.${String(index)}` : 'keyPoints';
    case 'accepted':
      return typeof index === 'number' ? `accepted.${String(index)}` : 'accepted';
    case undefined:
      return 'form';
    default:
      return String(head);
  }
}

function messageFor(d: Draft, key: string, issue: { code: string; message: string }): string {
  const blank = issue.message.includes('blank') && !issue.message.includes('{{');
  if (key === 'prompt') {
    if (blank) return `${d.type === 'cloze' ? 'Sentence' : 'Question'} can’t be empty.`;
    if (d.type === 'cloze' && issue.message.includes('{{')) return CLOZE_MESSAGE;
  }
  if (key === 'answer' && blank) {
    return `${d.type === 'short' ? 'Model answer' : 'Answer'} can’t be empty.`;
  }
  const item = /^(options|keyPoints|accepted)\.(\d+)$/.exec(key);
  if (item && blank) {
    const i = Number(item[2]);
    if (item[1] === 'options') return `Option ${letter(i).toUpperCase()} can’t be empty.`;
    if (item[1] === 'keyPoints') return `Key point ${String(i + 1)} can’t be empty.`;
    return 'This can’t be empty.';
  }
  if (issue.code === 'too_big' && key !== 'options' && key !== 'keyPoints' && key !== 'accepted') {
    if (key === 'marks') return MARKS_MESSAGE;
    return `This is too long (at most ${d.type === 'basic' ? '20,000' : '5,000'} characters).`;
  }
  if (key === 'marks') return MARKS_MESSAGE;
  if (key === 'options') {
    if (issue.message.includes('unique')) return 'Options must all be different.';
    return issue.code === 'too_small' ? 'Add at least 2 options.' : 'At most 6 options.';
  }
  if (key === 'keyPoints') {
    return issue.code === 'too_small' ? 'Add at least 2 key points.' : 'At most 12 key points.';
  }
  if (key === 'accepted') return 'At most 10 accepted answers.';
  if (key === 'correct') return 'Choose the correct option.';
  if (key === 'form')
    return 'This card is too long: all its text together must be at most 20,000 characters.';
  if (blank) return 'This can’t be empty.';
  return issue.message;
}

/** Which fields each type has, beyond the shared prompt. */
const FIELDS: Record<CardType, readonly (keyof Draft)[]> = {
  basic: ['answer'],
  mcq: ['options', 'explanation'],
  cloze: ['accepted', 'hint', 'extra'],
  short: ['answer', 'explanation'],
  long: ['marks', 'keyPoints', 'modelAnswer'],
};

const ORDER: readonly (keyof Draft)[] = [
  'answer',
  'options',
  'accepted',
  'hint',
  'extra',
  'marks',
  'keyPoints',
  'modelAnswer',
  'explanation',
];

function label(type: CardType, field: keyof Draft): string {
  const labels: Partial<Record<keyof Draft, string>> = {
    answer: type === 'short' ? 'Model answer' : 'Answer',
    options: 'Options',
    accepted: 'Accepted answers',
    hint: 'Hint',
    extra: 'Extra note',
    marks: 'Marks',
    keyPoints: 'Key points',
    modelAnswer: 'Model answer',
    explanation: 'Explanation',
  };
  return labels[field] ?? field;
}

function filled(d: Draft, field: keyof Draft): boolean {
  const v = d[field];
  if (Array.isArray(v)) return v.some((s) => s.trim() !== '');
  return typeof v === 'string' && v.trim() !== '';
}

/** Filled fields of the current type that the new type doesn't have (so they'd be cleared). */
export function lostOnTypeChange(d: Draft, to: CardType): string[] {
  if (to === d.type) return [];
  return ORDER.filter(
    (f) => FIELDS[d.type].includes(f) && !FIELDS[to].includes(f) && filled(d, f),
  ).map((f) => label(d.type, f));
}

/** Switches type, keeping the prompt and any field both types share. */
export function changeType(d: Draft, to: CardType): Draft {
  if (to === d.type) return d;
  const next = emptyDraft(to);
  next.prompt = d.prompt;
  for (const f of FIELDS[to]) {
    if (FIELDS[d.type].includes(f) && (f === 'answer' || f === 'explanation')) next[f] = d[f];
  }
  return next;
}
