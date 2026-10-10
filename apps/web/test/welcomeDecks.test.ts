import type { PrebuiltDeck } from '@recall/core';
import { describe, expect, it } from 'vitest';
import { formatCount } from '../src/services/format';
import { orderForWelcome } from '../src/services/readyMade';

const deck = (prebuiltId: string, name: string): PrebuiltDeck => ({
  prebuiltId,
  name,
  description: 'd',
  version: 1,
  cards: [{ front: 'q', back: 'a' }],
});

describe('orderForWelcome (first-visit screen)', () => {
  const dbms = deck('dbms-basics-v1', 'DBMS Basics');
  const robbins = deck('robbins-ch3-inflammation-repair-v1', 'Robbins Ch. 3');
  const other = deck('anatomy-v1', 'Anatomy');

  it('puts the prioritised decks first, in the given order, then the rest by name', () => {
    const priority = ['robbins-ch3-inflammation-repair-v1', 'dbms-basics-v1'];
    expect(orderForWelcome([dbms, other, robbins], priority).map((d) => d.prebuiltId)).toEqual([
      'robbins-ch3-inflammation-repair-v1',
      'dbms-basics-v1',
      'anatomy-v1',
    ]);
  });

  it('ignores priority ids that are not in the catalog, and keeps the input untouched', () => {
    const catalog = [dbms, robbins];
    expect(orderForWelcome(catalog, ['missing-v1', 'dbms-basics-v1'])).toEqual([dbms, robbins]);
    expect(catalog).toEqual([dbms, robbins]);
  });
});

describe('formatCount', () => {
  it('groups thousands', () => {
    expect(formatCount(20)).toBe('20');
    expect(formatCount(1014)).toBe('1,014');
    expect(formatCount(1234567)).toBe('1,234,567');
  });
});
