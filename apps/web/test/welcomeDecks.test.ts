import { describe, expect, it } from 'vitest';
import { toDeckRows } from '../src/features/home/deckRows';
import { formatCount } from '../src/services/format';
import { CARD_PAGE_SIZE, pageOfCards } from '../src/services/paging';

describe('formatCount', () => {
  it('groups thousands', () => {
    expect(formatCount(20)).toBe('20');
    expect(formatCount(1014)).toBe('1,014');
    expect(formatCount(1234567)).toBe('1,234,567');
  });
});

describe('pageOfCards (deck page list)', () => {
  const rows = Array.from({ length: 1000 }, (_, i) => i);

  it('shows the first page, says how many are shown, and how many more the button adds', () => {
    expect(pageOfCards(rows, 100)).toEqual({
      visible: rows.slice(0, 100),
      shownLabel: 'Showing 100 of 1,000 cards',
      more: 100,
    });
    expect(pageOfCards(rows, 950).more).toBe(50);
  });

  it('needs no label or button when everything fits', () => {
    expect(pageOfCards(rows.slice(0, 40), 100)).toEqual({
      visible: rows.slice(0, 40),
      shownLabel: null,
      more: 0,
    });
    expect(pageOfCards(rows, 1000).more).toBe(0);
  });
});

it('pages are 100 cards', () => {
  expect(CARD_PAGE_SIZE).toBe(100);
});

describe('deck list rows (Home and Decks)', () => {
  it('group thousands in the card count, like every other screen', () => {
    const counts = { due: 2, learning: 1, new: 20 };
    expect(
      toDeckRows([
        {
          id: 'r',
          name: 'Robbins',
          source: 'prebuilt',
          updateAvailable: false,
          cardCount: 1014,
          counts,
        },
        { id: 'o', name: 'One', source: 'user', updateAvailable: false, cardCount: 1, counts },
      ]),
    ).toEqual([
      { id: 'r', name: 'Robbins', meta: '1,014 cards · Ready-made', due: 3, update: false },
      { id: 'o', name: 'One', meta: '1 card', due: 3, update: false },
    ]);
  });
});
