import { clozeAnswer, type CardContent } from '@recall/core';
import { Check, ChevronDown, X } from 'lucide-react';
import { useId, type KeyboardEvent } from 'react';
import type { AnswerAction, AnswerState } from './answer';

// The card on the review screen, per type (BUILD_BRIEF_M6_M8 §6.3; UI plan in
// M6_REPORT.md). Basic cards look exactly as before M6. State is always shown with an
// icon *and* words, never by colour alone.

export const TYPE_TAGS: Partial<Record<CardContent['type'], string>> = {
  mcq: 'Multiple choice',
  cloze: 'Fill in the blank',
  short: 'Short answer',
  long: 'Long answer',
};

const prompt = 'text-card font-medium tracking-tight whitespace-pre-wrap';
const answerText = 'text-answer whitespace-pre-wrap text-text';
const note = 'text-body whitespace-pre-wrap text-text-secondary';

interface FaceProps {
  content: CardContent;
  answer: AnswerState;
  act: (action: AnswerAction) => void;
  disabled: boolean;
}

export function CardFace(props: FaceProps) {
  const { content } = props;
  switch (content.type) {
    case 'basic':
      return <BasicFace {...props} content={content} />;
    case 'short':
      return <ShortFace {...props} content={content} />;
    case 'mcq':
      return <McqFace {...props} content={content} />;
    case 'cloze':
      return <ClozeFace {...props} content={content} />;
    case 'long':
      return <LongFace {...props} content={content} />;
  }
}

function BasicFace({
  content,
  answer,
}: FaceProps & { content: Extract<CardContent, { type: 'basic' }> }) {
  const revealed = answer.type === 'basic' && answer.revealed;
  return (
    <>
      <p data-testid="card-front" className={prompt}>
        {content.front}
      </p>
      {revealed && (
        <>
          <hr className="border-border" />
          <p data-testid="card-back" className={answerText}>
            {content.back}
          </p>
        </>
      )}
    </>
  );
}

/** "Type your answer (optional)": a collapsed box; what's typed is never saved. */
function WriteBox({
  label,
  answer,
  act,
  disabled,
  rows,
}: {
  label: string;
  answer: { typing: boolean; typed: string };
  act: FaceProps['act'];
  disabled: boolean;
  rows: number;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        className="btn-ghost self-start px-0 text-text-secondary hover:bg-transparent"
        aria-expanded={answer.typing}
        aria-controls={id}
        onClick={() => {
          act({ kind: 'toggleTyping' });
        }}
      >
        <ChevronDown
          aria-hidden="true"
          className={`size-4 transition-transform duration-150 ${answer.typing ? 'rotate-180' : ''}`}
        />
        {label}
      </button>
      {answer.typing && (
        <textarea
          id={id}
          aria-label="Your answer (not saved)"
          className="field min-h-24 resize-y py-2 text-body"
          rows={rows}
          value={answer.typed}
          disabled={disabled}
          onChange={(e) => {
            act({ kind: 'type', text: e.target.value });
          }}
        />
      )}
    </div>
  );
}

function ShortFace({
  content,
  answer,
  act,
  disabled,
}: FaceProps & { content: Extract<CardContent, { type: 'short' }> }) {
  if (answer.type !== 'short') return null;
  return (
    <>
      <p data-testid="card-front" className={prompt}>
        {content.question}
      </p>
      {!answer.revealed && (
        <WriteBox
          label="Type your answer (optional)"
          answer={answer}
          act={act}
          disabled={disabled}
          rows={3}
        />
      )}
      {answer.revealed && (
        <>
          {answer.typed.trim() !== '' && (
            <p className={note}>
              <span className="font-medium">You wrote: </span>
              {answer.typed}
            </p>
          )}
          <hr className="border-border" />
          <p data-testid="card-back" className={answerText}>
            {content.answer}
          </p>
          {content.explanation !== null && (
            <p data-testid="card-explanation" className={note}>
              {content.explanation}
            </p>
          )}
        </>
      )}
    </>
  );
}

function McqFace({
  content,
  answer,
  act,
  disabled,
}: FaceProps & { content: Extract<CardContent, { type: 'mcq' }> }) {
  const labelId = useId();
  if (answer.type !== 'mcq') return null;
  return (
    <>
      <p data-testid="card-front" id={labelId} className={prompt}>
        {content.question}
      </p>
      <div role="radiogroup" aria-labelledby={labelId} className="flex flex-col gap-2">
        {content.options.map((option, i) => {
          const chosen = answer.selected === option.id;
          const isCorrect = option.id === content.correct;
          const status = answer.checked
            ? isCorrect
              ? 'correct'
              : chosen
                ? 'wrong'
                : 'other'
            : chosen
              ? 'chosen'
              : 'other';
          // A hairline, doubled by an inset ring of the same colour for a state (no shift).
          const border =
            status === 'correct'
              ? 'border-success ring-1 ring-inset ring-success'
              : status === 'wrong'
                ? 'border-error ring-1 ring-inset ring-error'
                : status === 'chosen'
                  ? 'border-accent ring-1 ring-inset ring-accent'
                  : 'border-border';
          return (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={chosen}
              aria-keyshortcuts={String(i + 1)}
              data-testid={`option-${option.id}`}
              disabled={disabled || answer.checked}
              onClick={() => {
                act({ kind: 'select', option: option.id });
              }}
              className={`flex min-h-12 w-full items-start gap-3 rounded-md border bg-surface px-3 py-2.5 text-left text-body transition-colors duration-150 enabled:hover:bg-surface-raised disabled:cursor-default ${border} ${
                chosen && !answer.checked ? 'bg-surface-raised' : ''
              }`}
            >
              <span className="font-medium text-text-secondary">{option.id.toUpperCase()}.</span>
              <span className="flex-1 whitespace-pre-wrap">{option.text}</span>
              {status === 'correct' && (
                <span className="inline-flex shrink-0 items-center gap-1 text-meta font-medium text-success">
                  <Check aria-hidden="true" className="size-4" />
                  Correct answer
                </span>
              )}
              {status === 'wrong' && (
                <span className="inline-flex shrink-0 items-center gap-1 text-meta font-medium text-error">
                  <X aria-hidden="true" className="size-4" />
                  Your answer
                </span>
              )}
            </button>
          );
        })}
      </div>
      {answer.checked && content.explanation !== null && (
        <p data-testid="card-explanation" className={note}>
          {content.explanation}
        </p>
      )}
    </>
  );
}

/** The sentence with its blank: a gap before answering, the answer (emphasised) after. */
function Sentence({ text, filled }: { text: string; filled: boolean }) {
  const match = /\{\{([^{}]*)\}\}/.exec(text);
  if (!match) return <>{text}</>;
  const before = text.slice(0, match.index);
  const after = text.slice(match.index + match[0].length);
  return (
    <>
      {before}
      {filled ? (
        <strong className="font-semibold underline decoration-accent decoration-2 underline-offset-4">
          {match[1]}
        </strong>
      ) : (
        // aria-label isn't allowed on a plain span; screen readers read the hidden word.
        <span className="inline-block min-w-24 border-b-2 border-text-secondary">
          <span className="sr-only">blank</span>&nbsp;
        </span>
      )}
      {after}
    </>
  );
}

function ClozeFace({
  content,
  answer,
  act,
  disabled,
}: FaceProps & { content: Extract<CardContent, { type: 'cloze' }> }) {
  if (answer.type !== 'cloze') return null;
  const done = answer.result !== null;
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      act({ kind: 'check' });
    }
  };
  return (
    <>
      <p data-testid="card-front" className={prompt}>
        <Sentence text={content.text} filled={done} />
      </p>
      {!done && content.hint !== null && !answer.hintShown && (
        <button
          type="button"
          className="link self-start"
          onClick={() => {
            act({ kind: 'showHint' });
          }}
        >
          Show hint
        </button>
      )}
      {content.hint !== null && answer.hintShown && (
        <p className={note}>
          <span className="font-medium">Hint: </span>
          {content.hint}
        </p>
      )}
      {!done && (
        <label className="flex flex-col gap-2 text-body font-medium text-text-secondary">
          Your answer
          <input
            type="text"
            className="field text-answer text-text"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            enterKeyHint="done"
            value={answer.typed}
            disabled={disabled}
            onKeyDown={onKeyDown}
            onChange={(e) => {
              act({ kind: 'type', text: e.target.value });
            }}
          />
        </label>
      )}
      {answer.result?.mode === 'typed' && (
        <div data-testid="cloze-result" className="flex flex-col gap-1">
          {answer.result.correct ? (
            <p className="inline-flex items-center gap-1.5 text-body font-semibold text-success">
              <Check aria-hidden="true" className="size-4" />
              Correct
            </p>
          ) : (
            <>
              <p className="inline-flex items-center gap-1.5 text-body font-semibold text-error">
                <X aria-hidden="true" className="size-4" />
                Not quite
              </p>
              <p className="text-body">
                <span className="text-text-secondary">Answer: </span>
                <span className="font-medium">{clozeAnswer(content)}</span>
              </p>
              <p className="text-body">
                <span className="text-text-secondary">You typed: </span>
                {answer.typed}
              </p>
            </>
          )}
        </div>
      )}
      {done && content.extra !== null && (
        <p data-testid="card-explanation" className={note}>
          {content.extra}
        </p>
      )}
    </>
  );
}

function LongFace({
  content,
  answer,
  act,
  disabled,
}: FaceProps & { content: Extract<CardContent, { type: 'long' }> }) {
  if (answer.type !== 'long') return null;
  const ticked = new Set(answer.ticked);
  return (
    <>
      <p data-testid="card-front" className={prompt}>
        {content.question}
      </p>
      {content.marks !== null && (
        <span className="self-start rounded-sm border border-border px-1.5 py-px text-meta text-text-secondary">
          {content.marks} {content.marks === 1 ? 'mark' : 'marks'}
        </span>
      )}
      {!answer.revealed && (
        <WriteBox
          label="Write your answer (optional)"
          answer={answer}
          act={act}
          disabled={disabled}
          rows={6}
        />
      )}
      {answer.revealed && (
        <>
          {answer.typed.trim() !== '' && (
            <details className="text-body text-text-secondary">
              <summary className="cursor-pointer">What you wrote</summary>
              <p className="mt-2 whitespace-pre-wrap">{answer.typed}</p>
            </details>
          )}
          <hr className="border-border" />
          <fieldset className="flex flex-col gap-2" data-testid="key-points">
            <legend className="mb-1 text-small text-text-secondary">
              Tick the key points your answer covered
            </legend>
            {content.keyPoints.map((point, i) => (
              <label
                key={i}
                className={`flex min-h-11 cursor-pointer items-start gap-3 rounded-md border bg-surface px-3 py-2.5 text-body ${
                  ticked.has(i) ? 'border-accent' : 'border-border'
                }`}
              >
                <input
                  type="checkbox"
                  className="mt-0.5 size-4 shrink-0 accent-[var(--color-accent)]"
                  checked={ticked.has(i)}
                  disabled={disabled}
                  aria-keyshortcuts={i < 9 ? String(i + 1) : undefined}
                  onChange={() => {
                    act({ kind: 'tick', index: i });
                  }}
                />
                <span className="flex-1 whitespace-pre-wrap">{point}</span>
                <span className="hidden font-mono text-meta text-text-muted lg:inline">
                  {i < 9 ? i + 1 : ''}
                </span>
              </label>
            ))}
          </fieldset>
          {content.modelAnswer !== null && (
            <details className="text-body" data-testid="model-answer">
              <summary className="cursor-pointer font-medium text-text-secondary">
                Model answer
              </summary>
              <p className={`${answerText} mt-3`}>{content.modelAnswer}</p>
            </details>
          )}
        </>
      )}
    </>
  );
}
