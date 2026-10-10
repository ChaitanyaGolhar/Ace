import { describe, expect, it } from 'vitest';
import {
  cardContentOf,
  contentHash,
  planDeckUpdate,
  validateDeckFile,
  type CardContent,
  type DeckFile,
  type LocalCatalogCard,
} from '../src';

// Deck updates (BUILD_BRIEF_M6_M8 §7.6), per card key. The plan is pure; the app applies
// it in one Dexie transaction.

const basic = (front: string, back = `${front} — answer`): CardContent => ({
  type: 'basic',
  front,
  back,
});

function file(version: number, cards: [string, CardContent, number?][]): DeckFile {
  const result = validateDeckFile({
    format: 'ace-deck@2',
    slug: 'sppu-te-cse-dbms',
    version,
    title: 'DBMS',
    description: 'd',
    catalog: {
      university: 'SPPU',
      pattern: '2024',
      year: 'TE',
      semester: 5,
      branches: ['CSE'],
      subject: 'DBMS',
      subjectCodes: { CSE: null },
      units: [
        { number: 1, title: 'One' },
        { number: 2, title: 'Two' },
      ],
    },
    price: 0,
    author: 'A',
    lastVerifiedAt: '2026-10-11',
    cards: cards.map(([key, content, unit]) => ({ key, unit: unit ?? 1, ...content })),
  });
  if (!result.ok) throw new Error(result.errors.join('\n'));
  return result.deck;
}

/** The student's copy of `deck`: one live card per key, unedited. */
function copyOf(deck: DeckFile): LocalCatalogCard[] {
  return deck.cards.map((c, i) => {
    const content = cardContentOf(c);
    return {
      id: `card-${c.key}`,
      sourceKey: c.key,
      sourceHash: contentHash(content),
      content,
      unit: c.unit,
      deletedAt: null,
      order: i,
    };
  });
}

const v1 = file(1, [
  ['u1-001', basic('What is a DBMS?')],
  ['u1-002', basic('What is a key?')],
  ['u1-003', basic('What is a view?')],
]);

describe('planDeckUpdate: the §7.6 rules, per card key', () => {
  it('unchanged cards: nothing to do', () => {
    const plan = planDeckUpdate(
      copyOf(v1),
      v1,
      file(
        2,
        v1.cards.map((c) => [c.key, cardContentOf(c)]),
      ),
    );
    expect(plan).toMatchObject({ replace: [], add: [], remove: [], kept: [] });
    expect(plan.summary).toEqual({ changed: 0, added: 0, removed: 0 });
  });

  it('changed and unedited: replace the content and the sourceHash (same id, so the schedule stays)', () => {
    const fixed = basic('What is a primary key?');
    const v2 = file(2, [
      ['u1-001', basic('What is a DBMS?')],
      ['u1-002', fixed],
      ['u1-003', basic('What is a view?')],
    ]);
    const plan = planDeckUpdate(copyOf(v1), v1, v2);
    expect(plan.replace).toEqual([
      {
        cardId: 'card-u1-002',
        key: 'u1-002',
        content: fixed,
        unit: 1,
        sourceHash: contentHash(fixed),
      },
    ]);
    expect(plan.kept).toEqual([]);
    expect(plan.applied).toEqual({ fixed: 1, added: 0, removed: 0, keptEdits: 0 });
  });

  it('changed but edited by the user: keep the user’s version ("kept your edits")', () => {
    const local = copyOf(v1).map((c) =>
      c.sourceKey === 'u1-002' ? { ...c, content: basic('My own wording') } : c,
    );
    const v2 = file(2, [
      ['u1-001', basic('What is a DBMS?')],
      ['u1-002', basic('What is a primary key?')],
      ['u1-003', basic('What is a view?')],
    ]);
    const plan = planDeckUpdate(local, v1, v2);
    expect(plan.replace).toEqual([]);
    expect(plan.kept).toEqual([{ cardId: 'card-u1-002', key: 'u1-002', reason: 'changed' }]);
    expect(plan.applied).toEqual({ fixed: 0, added: 0, removed: 0, keptEdits: 1 });
  });

  it('a unit move counts as a change (unedited: applied)', () => {
    const v2 = file(2, [
      ['u1-001', basic('What is a DBMS?')],
      ['u1-002', basic('What is a key?'), 2],
      ['u1-003', basic('What is a view?')],
    ]);
    const plan = planDeckUpdate(copyOf(v1), v1, v2);
    expect(plan.replace.map((r) => [r.key, r.unit])).toEqual([['u1-002', 2]]);
  });

  it('new: add, in file order, after the existing cards', () => {
    const v2 = file(2, [
      ['u1-001', basic('What is a DBMS?')],
      ['u2-001', basic('What is SQL?'), 2],
      ['u1-002', basic('What is a key?')],
      ['u1-003', basic('What is a view?')],
      ['u2-002', basic('What is a join?'), 2],
    ]);
    const plan = planDeckUpdate(copyOf(v1), v1, v2);
    expect(plan.add.map((a) => a.key)).toEqual(['u2-001', 'u2-002']);
    expect(plan.add[0]).toEqual({
      key: 'u2-001',
      unit: 2,
      content: basic('What is SQL?'),
      sourceHash: contentHash(basic('What is SQL?')),
    });
    expect(plan.summary).toEqual({ changed: 0, added: 2, removed: 0 });
  });

  it('removed and unedited: tombstone it', () => {
    const v2 = file(2, [
      ['u1-001', basic('What is a DBMS?')],
      ['u1-003', basic('What is a view?')],
    ]);
    const plan = planDeckUpdate(copyOf(v1), v1, v2);
    expect(plan.remove).toEqual([{ cardId: 'card-u1-002', key: 'u1-002' }]);
    expect(plan.applied.removed).toBe(1);
  });

  it('removed but edited: keep it', () => {
    const local = copyOf(v1).map((c) =>
      c.sourceKey === 'u1-002' ? { ...c, content: basic('My note') } : c,
    );
    const v2 = file(2, [
      ['u1-001', basic('What is a DBMS?')],
      ['u1-003', basic('What is a view?')],
    ]);
    const plan = planDeckUpdate(local, v1, v2);
    expect(plan.remove).toEqual([]);
    expect(plan.kept).toEqual([{ cardId: 'card-u1-002', key: 'u1-002', reason: 'removed' }]);
  });

  it('cards the student deleted stay deleted: not replaced, not re-added', () => {
    const local = copyOf(v1).map((c) => (c.sourceKey === 'u1-002' ? { ...c, deletedAt: 5 } : c));
    const v2 = file(2, [
      ['u1-001', basic('What is a DBMS?')],
      ['u1-002', basic('What is a primary key?')],
    ]);
    const plan = planDeckUpdate(local, v1, v2);
    expect(plan.replace).toEqual([]);
    expect(plan.add).toEqual([]);
    expect(plan.remove.map((r) => r.key)).toEqual(['u1-003']);
  });

  it('a key already present locally (e.g. added on another device) is not added twice', () => {
    const v2 = file(2, [
      ...v1.cards.map((c): [string, CardContent] => [c.key, cardContentOf(c)]),
      ['u1-004', basic('New')],
    ]);
    const local = [
      ...copyOf(v1),
      {
        id: 'card-u1-004',
        sourceKey: 'u1-004',
        sourceHash: contentHash(basic('New')),
        content: basic('New'),
        unit: 1,
        deletedAt: null,
        order: 3,
      },
    ];
    expect(planDeckUpdate(local, v1, v2).add).toEqual([]);
  });

  it('the banner counts: changed, new and removed (edited ones included)', () => {
    const local = copyOf(v1).map((c) =>
      c.sourceKey === 'u1-001' ? { ...c, content: basic('Edited') } : c,
    );
    const v2 = file(2, [
      ['u1-001', basic('What is a DBMS, really?')],
      ['u1-002', basic('What is a primary key?')],
      ['u1-004', basic('What is a trigger?')],
    ]);
    const plan = planDeckUpdate(local, v1, v2);
    expect(plan.summary).toEqual({ changed: 2, added: 1, removed: 1 });
    expect(plan.applied).toEqual({ fixed: 1, added: 1, removed: 1, keptEdits: 1 });
  });
});

describe('planDeckUpdate: skipping versions (v1 → v4) applies the diff to the latest directly', () => {
  const v4 = file(4, [
    ['u1-001', basic('What is a DBMS?')], // unchanged overall (changed in v2, reverted in v3)
    ['u1-002', basic('What is a candidate key?')], // changed in v2
    ['u1-004', basic('What is a trigger?')], // added in v3
    // u1-003 removed in v4
  ]);

  it('one plan from the local copy (on v1) straight to v4', () => {
    const plan = planDeckUpdate(copyOf(v1), v1, v4);
    expect(plan.replace.map((r) => r.key)).toEqual(['u1-002']);
    expect(plan.add.map((a) => a.key)).toEqual(['u1-004']);
    expect(plan.remove.map((r) => r.key)).toEqual(['u1-003']);
    expect(plan.applied).toEqual({ fixed: 1, added: 1, removed: 1, keptEdits: 0 });
  });

  it('is deterministic', () => {
    expect(planDeckUpdate(copyOf(v1), v1, v4)).toEqual(planDeckUpdate(copyOf(v1), v1, v4));
  });
});
