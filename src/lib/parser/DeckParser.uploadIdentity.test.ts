import { setupTests } from '../../test/configure-jest';
import { guidFor } from '../anki/guid';
import type { IssuedCardGuid } from '../anki/guidLedgerTypes';
import {
  hashSourceKey,
  unpackIdentitySource,
  uploadIdentityKey,
  type UploadIdentityLedger,
} from '../anki/uploadCardIdentity';
import CardOption from './Settings/CardOption';
import { DeckParser } from './DeckParser';
import Workspace from './WorkSpace';

beforeEach(() => setupTests());

const OWNER = 7788;
const BLOCK_ID = '3917ab29-a11e-8047-9d97-cf0f00b3c8f7';

const wrap = (body: string, title = 'Notes') =>
  `<html><head><title>${title}</title></head><body><article class="page sans"><header><h1 class="page-title">${title}</h1></header><div class="page-body">${body}</div></article></body></html>`;

const plainToggle = (summary: string, bodyInner: string) =>
  `<details class="toggle" open="" dir="auto"><summary dir="auto">${summary}</summary><div class="indented" dir="auto">${bodyInner}</div></details>`;

const notionToggle = (id: string, summary: string, bodyInner: string) =>
  `<details id="${id}" class="toggle" open="" dir="auto"><summary dir="auto">${summary}</summary><div class="indented" dir="auto">${bodyInner}</div></details>`;

async function parse(
  html: string,
  {
    name = 'notes.html',
    uploadIdentity,
    knownGuids,
  }: {
    name?: string;
    uploadIdentity?: { owner: number; ledger: UploadIdentityLedger };
    knownGuids?: Record<string, string>;
  } = {}
) {
  const workspace = new Workspace(true, 'fs');
  const parser = new DeckParser({
    name,
    settings: new CardOption({ cherry: 'false' }),
    files: [{ name, contents: html }],
    noLimits: true,
    workspace,
    knownGuids,
    uploadIdentity,
  });
  await parser.writeDeckInfo(workspace);
  return parser;
}

// What the ledger holds after a signed-in upload wrote its entries.
function ledgerFrom(entries: IssuedCardGuid[]): UploadIdentityLedger {
  const ledger: UploadIdentityLedger = {};
  for (const entry of entries) {
    ledger[entry.blockId] = {
      guid: entry.guid,
      ...unpackIdentitySource(entry.sourcePageId),
    };
  }
  return ledger;
}

const cardsOf = (parser: DeckParser) => parser.payload.flatMap((d) => d.cards);

describe('upload card identity for signed-in non-Notion uploads', () => {
  it('stamps guidFor(owner, identityKey) on first sight and records it', async () => {
    const parser = await parse(
      wrap(plainToggle('What is X?', '<p>Answer</p>')),
      {
        uploadIdentity: { owner: OWNER, ledger: {} },
      }
    );
    const cards = cardsOf(parser);
    expect(cards).toHaveLength(1);
    const card = cards[0];
    const identityKey = uploadIdentityKey(card);
    expect(card.notionId).toBeUndefined();
    expect(card.guid).toBe(guidFor(OWNER, identityKey));
    expect(parser.uploadIdentityStats).toEqual({
      issued: 1,
      replayed: 0,
      guarded: 0,
    });
    expect(parser.uploadIdentityEntries).toEqual([
      {
        blockId: identityKey,
        guid: card.guid,
        sourcePageId: expect.any(String),
      },
    ]);
  });

  it('replays the stored guid when the answer was edited in the same file', async () => {
    const discovery = await parse(
      wrap(plainToggle('What is X?', '<p>First answer</p>')),
      { uploadIdentity: { owner: OWNER, ledger: {} } }
    );
    const ledger = ledgerFrom(discovery.uploadIdentityEntries);
    const originalGuid = discovery.payload[0].cards[0].guid!;

    const parser = await parse(
      wrap(plainToggle('What is X?', '<p>Edited answer</p>')),
      { uploadIdentity: { owner: OWNER, ledger } }
    );
    const card = parser.payload[0].cards[0];
    expect(card.guid).toBe(originalGuid);
    expect(parser.uploadIdentityStats).toEqual({
      issued: 0,
      replayed: 1,
      guarded: 0,
    });
  });

  it('re-records a replayed card with its latest answer fingerprint', async () => {
    const discovery = await parse(
      wrap(plainToggle('What is X?', '<p>First answer</p>')),
      { uploadIdentity: { owner: OWNER, ledger: {} } }
    );
    const ledger = ledgerFrom(discovery.uploadIdentityEntries);
    const [firstEntry] = discovery.uploadIdentityEntries;

    const parser = await parse(
      wrap(plainToggle('What is X?', '<p>Edited answer</p>')),
      { uploadIdentity: { owner: OWNER, ledger } }
    );
    const [entry] = parser.uploadIdentityEntries;
    expect(entry.blockId).toBe(firstEntry.blockId);
    expect(entry.guid).toBe(firstEntry.guid);
    expect(unpackIdentitySource(entry.sourcePageId).fingerprint).not.toBe(
      unpackIdentitySource(firstEntry.sourcePageId).fingerprint
    );
  });

  it('keeps the guid through an answer edit followed by a rename', async () => {
    const first = await parse(
      wrap(plainToggle('What is X?', '<p>First answer</p>')),
      { name: 'notes.html', uploadIdentity: { owner: OWNER, ledger: {} } }
    );
    const originalGuid = first.payload[0].cards[0].guid!;

    const edited = await parse(
      wrap(plainToggle('What is X?', '<p>Edited answer</p>')),
      {
        name: 'notes.html',
        uploadIdentity: {
          owner: OWNER,
          ledger: ledgerFrom(first.uploadIdentityEntries),
        },
      }
    );
    expect(edited.payload[0].cards[0].guid).toBe(originalGuid);

    const renamed = await parse(
      wrap(plainToggle('What is X?', '<p>Edited answer</p>')),
      {
        name: 'renamed.html',
        uploadIdentity: {
          owner: OWNER,
          ledger: ledgerFrom(edited.uploadIdentityEntries),
        },
      }
    );
    expect(renamed.payload[0].cards[0].guid).toBe(originalGuid);
    expect(renamed.uploadIdentityStats).toEqual({
      issued: 0,
      replayed: 1,
      guarded: 0,
    });
  });

  it('replays the stored guid when the file was renamed', async () => {
    const discovery = await parse(
      wrap(plainToggle('What is X?', '<p>Answer</p>')),
      { name: 'old-name.html', uploadIdentity: { owner: OWNER, ledger: {} } }
    );
    const originalGuid = discovery.payload[0].cards[0].guid!;
    const ledger = ledgerFrom(discovery.uploadIdentityEntries);

    const parser = await parse(
      wrap(plainToggle('What is X?', '<p>Answer</p>')),
      { name: 'renamed.html', uploadIdentity: { owner: OWNER, ledger } }
    );
    const card = parser.payload[0].cards[0];
    expect(card.guid).toBe(originalGuid);
    expect(parser.uploadIdentityStats.replayed).toBe(1);
  });

  it('keeps every guid when the cards are reordered', async () => {
    const discovery = await parse(
      wrap(
        plainToggle('What is X?', '<p>Answer X</p>') +
          plainToggle('What is Y?', '<p>Answer Y</p>')
      ),
      { uploadIdentity: { owner: OWNER, ledger: {} } }
    );
    const [x, y] = cardsOf(discovery).map((c) => c.guid);

    const parser = await parse(
      wrap(
        plainToggle('What is Y?', '<p>Answer Y</p>') +
          plainToggle('What is X?', '<p>Answer X</p>')
      ),
      {
        uploadIdentity: {
          owner: OWNER,
          ledger: ledgerFrom(discovery.uploadIdentityEntries),
        },
      }
    );
    expect(cardsOf(parser).map((c) => c.guid)).toEqual([y, x]);
    expect(parser.uploadIdentityStats.replayed).toBe(2);
  });

  it('issues a new guid when the question text changes (v1 limitation)', async () => {
    const discovery = await parse(
      wrap(plainToggle('What is X?', '<p>Answer</p>')),
      { uploadIdentity: { owner: OWNER, ledger: {} } }
    );
    const originalGuid = discovery.payload[0].cards[0].guid!;
    const [originalEntry] = discovery.uploadIdentityEntries;

    const parser = await parse(
      wrap(plainToggle('What exactly is X?', '<p>Answer</p>')),
      {
        uploadIdentity: {
          owner: OWNER,
          ledger: ledgerFrom(discovery.uploadIdentityEntries),
        },
      }
    );
    const card = parser.payload[0].cards[0];
    expect(card.guid).not.toBe(originalGuid);
    expect(parser.uploadIdentityStats).toEqual({
      issued: 1,
      replayed: 0,
      guarded: 0,
    });
    expect(parser.uploadIdentityEntries.map((e) => e.blockId)).not.toContain(
      originalEntry.blockId
    );
  });

  it('forks a fresh guid when both the filename and answer changed', async () => {
    const discovery = await parse(
      wrap(plainToggle('What is X?', '<p>Answer</p>')),
      { name: 'old-name.html', uploadIdentity: { owner: OWNER, ledger: {} } }
    );
    const identityKey = discovery.uploadIdentityEntries[0].blockId;
    const ledger: UploadIdentityLedger = {
      [identityKey]: {
        guid: 'STORED-GUID',
        sourceKeyHash: hashSourceKey('old-name.html'),
        fingerprint: 'a-different-answer-fingerprint',
      },
    };
    const parser = await parse(
      wrap(plainToggle('What is X?', '<p>Edited answer</p>')),
      { name: 'new-name.html', uploadIdentity: { owner: OWNER, ledger } }
    );
    const card = parser.payload[0].cards[0];
    expect(card.guid).not.toBe('STORED-GUID');
    expect(card.guid).not.toBe(guidFor(OWNER, identityKey));
    expect(parser.uploadIdentityStats).toEqual({
      issued: 0,
      replayed: 0,
      guarded: 1,
    });
    expect(parser.uploadIdentityEntries).toEqual([]);
  });

  it('gives identical fronts in one upload distinct guids via ordinals', async () => {
    const parser = await parse(
      wrap(
        plainToggle('Same front', '<p>Answer one</p>') +
          plainToggle('Same front', '<p>Answer two</p>')
      ),
      { uploadIdentity: { owner: OWNER, ledger: {} } }
    );
    const cards = cardsOf(parser);
    expect(cards).toHaveLength(2);
    const keys = parser.uploadIdentityEntries.map((e) => e.blockId);
    expect(new Set(keys).size).toBe(2);
    expect(keys[1]).toBe(`${keys[0]}#2`);
    const guids = cards.map((c) => c.guid);
    expect(new Set(guids).size).toBe(2);
  });

  it('keeps identical-front cards attached to their own answers when reordered', async () => {
    const discovery = await parse(
      wrap(
        plainToggle('Same front', '<p>Answer A</p>') +
          plainToggle('Same front', '<p>Answer B</p>') +
          plainToggle('Same front', '<p>Answer C</p>')
      ),
      { uploadIdentity: { owner: OWNER, ledger: {} } }
    );
    const guidByBack = new Map(cardsOf(discovery).map((c) => [c.back, c.guid]));

    const parser = await parse(
      wrap(
        plainToggle('Same front', '<p>Answer C</p>') +
          plainToggle('Same front', '<p>Answer A</p>') +
          plainToggle('Same front', '<p>Answer B</p>')
      ),
      {
        uploadIdentity: {
          owner: OWNER,
          ledger: ledgerFrom(discovery.uploadIdentityEntries),
        },
      }
    );
    for (const card of cardsOf(parser)) {
      expect(card.guid).toBe(guidByBack.get(card.back));
    }
    expect(parser.uploadIdentityStats.replayed).toBe(3);
  });

  it('forks rather than guesses when one of several identical-front answers is edited', async () => {
    const discovery = await parse(
      wrap(
        plainToggle('Same front', '<p>Answer A</p>') +
          plainToggle('Same front', '<p>Answer B</p>')
      ),
      { uploadIdentity: { owner: OWNER, ledger: {} } }
    );
    const [guidA] = cardsOf(discovery).map((c) => c.guid);

    const parser = await parse(
      wrap(
        plainToggle('Same front', '<p>Answer A</p>') +
          plainToggle('Same front', '<p>Answer B, edited</p>')
      ),
      {
        uploadIdentity: {
          owner: OWNER,
          ledger: ledgerFrom(discovery.uploadIdentityEntries),
        },
      }
    );
    const [first, second] = cardsOf(parser);
    expect(first.guid).toBe(guidA);
    expect(parser.uploadIdentityStats).toEqual({
      issued: 0,
      replayed: 1,
      guarded: 1,
    });
    expect(cardsOf(discovery).map((c) => c.guid)).not.toContain(second.guid);
  });
});

describe('upload card identity leaves other conversions untouched', () => {
  it('does nothing for anonymous uploads (no owner)', async () => {
    const parser = await parse(
      wrap(plainToggle('What is X?', '<p>Answer</p>'))
    );
    const card = parser.payload[0].cards[0];
    expect(card.guid).toBeUndefined();
    expect(parser.payload[0].useContentGuid).toBe(true);
    expect(parser.uploadIdentityStats).toEqual({
      issued: 0,
      replayed: 0,
      guarded: 0,
    });
    expect(parser.uploadIdentityEntries).toEqual([]);
  });

  it('keeps a Notion HTML export on the block-id path', async () => {
    const parser = await parse(
      wrap(notionToggle(BLOCK_ID, 'What is X?', '<p>Answer</p>')),
      { uploadIdentity: { owner: OWNER, ledger: {} } }
    );
    const card = parser.payload[0].cards[0];
    expect(card.notionId).toBe(BLOCK_ID);
    expect(card.guid).toBeUndefined();
    expect(parser.uploadIdentityStats).toEqual({
      issued: 0,
      replayed: 0,
      guarded: 0,
    });
    expect(parser.uploadIdentityEntries).toEqual([]);
  });
});
