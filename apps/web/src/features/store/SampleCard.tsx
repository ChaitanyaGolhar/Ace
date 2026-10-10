import { useState } from 'react';
import { cardContentOf, type DeckFileCard } from '@recall/core';
import { answerReducer, initialAnswer, ratingStage, type AnswerAction } from '../review/answer';
import { CardFace } from '../review/CardFace';
import { TYPE_NAMES } from './storeView';

/**
 * A sample card on a store page (§7.7), with the real review face: you can answer it,
 * but there are no ratings and nothing is recorded.
 */
export function SampleCard({ card, label }: { card: DeckFileCard; label: string }) {
  const content = cardContentOf(card);
  const [answer, setAnswer] = useState(() => initialAnswer(content));
  const act = (action: AnswerAction) => {
    setAnswer((s) => answerReducer(content, s, action));
  };
  const answered = ratingStage(content, answer).buttons !== 'none';

  return (
    <article
      aria-label={label}
      data-testid="sample-card"
      className="panel flex flex-col gap-5 p-5 lg:p-6"
    >
      <span className="self-start rounded-sm border border-border px-3 py-1 text-meta text-text-secondary">
        {TYPE_NAMES[content.type]} · Unit {card.unit}
      </span>
      <CardFace content={content} answer={answer} act={act} disabled={false} />
      <div className="flex flex-wrap gap-2">
        {answered ? (
          <button
            type="button"
            className="btn-ghost px-0"
            onClick={() => {
              setAnswer(initialAnswer(content));
            }}
          >
            Try again
          </button>
        ) : answer.type === 'mcq' ? (
          <button
            type="button"
            className="btn-secondary"
            disabled={answer.selected === null}
            onClick={() => {
              act({ kind: 'check' });
            }}
          >
            Check
          </button>
        ) : answer.type === 'cloze' ? (
          <>
            <button
              type="button"
              className="btn-secondary"
              disabled={answer.typed.trim() === ''}
              onClick={() => {
                act({ kind: 'check' });
              }}
            >
              Check
            </button>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => {
                act({ kind: 'reveal' });
              }}
            >
              Show answer
            </button>
          </>
        ) : (
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              act({ kind: 'reveal' });
            }}
          >
            {answer.type === 'long' ? 'Show key points' : 'Show answer'}
          </button>
        )}
      </div>
    </article>
  );
}
