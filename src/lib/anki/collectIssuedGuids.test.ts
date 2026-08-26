import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { collectIssuedGuids, collectRekeyedGuids } from './collectIssuedGuids';
import CardOption from '../parser/Settings';
import Deck from '../parser/Deck';
import Note from '../parser/Note';

function noteWith(notionId?: string, sourcePageId?: string): Note {
  const note = new Note('front', 'back');
  note.notionId = notionId;
  note.sourcePageId = sourcePageId;
  return note;
}

function deckWith(cards: Note[]): Deck {
  return new Deck('Test', cards, undefined, null, 1, new CardOption({}));
}

function workspaceWith(sidecar: unknown): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'guids-'));
  if (sidecar !== undefined) {
    fs.writeFileSync(path.join(dir, 'guids.json'), JSON.stringify(sidecar));
  }
  return dir;
}

describe('collectIssuedGuids', () => {
  it('records a miss and skips ledger hits and repeats', () => {
    const dir = workspaceWith([
      { notionId: 'block-a', guid: 'guid-a' },
      { notionId: 'block-b', guid: 'guid-b' },
      { notionId: 'block-a', guid: 'guid-a' },
    ]);
    const decks = [
      deckWith([
        noteWith('block-a', 'page-1'),
        noteWith('block-b'),
        noteWith('block-a', 'page-1'),
      ]),
    ];

    const issued = collectIssuedGuids(dir, decks, { 'block-b': 'guid-b' });

    expect(issued).toEqual([
      { blockId: 'block-a', sourcePageId: 'page-1', guid: 'guid-a' },
    ]);
  });

  it('returns nothing without a ledger to record into', () => {
    const dir = workspaceWith([{ notionId: 'block-a', guid: 'guid-a' }]);
    expect(collectIssuedGuids(dir, [deckWith([noteWith('block-a')])])).toEqual(
      []
    );
  });

  it('returns nothing when the sidecar is missing or malformed', () => {
    const missing = workspaceWith(undefined);
    expect(
      collectIssuedGuids(missing, [deckWith([noteWith('block-a')])], {})
    ).toEqual([]);

    const malformed = workspaceWith({ not: 'an array' });
    expect(
      collectIssuedGuids(malformed, [deckWith([noteWith('block-a')])], {})
    ).toEqual([]);
  });

  it('fails safe on a length mismatch', () => {
    const dir = workspaceWith([{ notionId: 'block-a', guid: 'guid-a' }]);
    const decks = [deckWith([noteWith('block-a'), noteWith('block-b')])];
    expect(collectIssuedGuids(dir, decks, {})).toEqual([]);
  });

  it('fails safe when python echoes a different notionId order', () => {
    const dir = workspaceWith([
      { notionId: 'block-b', guid: 'guid-b' },
      { notionId: 'block-a', guid: 'guid-a' },
    ]);
    const decks = [deckWith([noteWith('block-a'), noteWith('block-b')])];
    expect(collectIssuedGuids(dir, decks, {})).toEqual([]);
  });

  it('skips cards without a block id while keeping alignment', () => {
    const dir = workspaceWith([
      { notionId: null, guid: 'guid-x' },
      { notionId: 'block-a', guid: 'guid-a' },
    ]);
    const decks = [deckWith([noteWith(undefined), noteWith('block-a')])];
    expect(collectIssuedGuids(dir, decks, {})).toEqual([
      { blockId: 'block-a', sourcePageId: undefined, guid: 'guid-a' },
    ]);
  });
});

describe('collectRekeyedGuids', () => {
  it('returns every block whose sidecar guid differs from the ledger', () => {
    const dir = workspaceWith([
      { notionId: 'block-changed', guid: 'block-guid-1' },
      { notionId: 'block-same', guid: 'block-guid-2' },
      { notionId: 'block-new', guid: 'block-guid-3' },
      { notionId: null, guid: 'content-guid' },
    ]);
    const decks = [
      deckWith([
        noteWith('block-changed', 'page-1'),
        noteWith('block-same', 'page-1'),
        noteWith('block-new', 'page-1'),
        noteWith(),
      ]),
    ];

    const entries = collectRekeyedGuids(dir, decks, {
      'block-changed': 'content-formula-guid',
      'block-same': 'block-guid-2',
    });

    expect(entries).toEqual([
      {
        blockId: 'block-changed',
        sourcePageId: 'page-1',
        guid: 'block-guid-1',
      },
      { blockId: 'block-new', sourcePageId: 'page-1', guid: 'block-guid-3' },
    ]);
  });

  it('fails safe on a misaligned sidecar like the insert-only collector', () => {
    const dir = workspaceWith([{ notionId: 'other', guid: 'g' }]);
    const decks = [deckWith([noteWith('block-a')])];

    expect(collectRekeyedGuids(dir, decks, { 'block-a': 'old' })).toEqual([]);
  });
});
