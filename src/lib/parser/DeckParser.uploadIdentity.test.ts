import { vi, type MockInstance } from 'vitest';
import { setupTests } from '../../test/configure-jest';
import { guidFor } from '../anki/guid';
import type { IssuedCardGuid } from '../anki/guidLedgerTypes';
import {
  hashSourceKey,
  unpackIdentitySource,
  uploadIdentityKey,
  type UploadIdentityLedger,
} from '../anki/uploadCardIdentity';
import { cardFingerprint } from '../claude/ClaudeService';
import CardOption from './Settings/CardOption';
import { DeckParser } from './DeckParser';
import type Note from './Note';
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
      contentChangedAt: entry.contentChangedAt ?? null,
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
        contentChangedAt: expect.any(Number),
      },
    ]);
    expect(card.mod).toBe(parser.uploadIdentityEntries[0].contentChangedAt);
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

  describe('note mod', () => {
    const FIRST_EXPORT_MS = 1_700_000_000_000;
    const SECOND_EXPORT_MS = 1_700_000_600_000;
    let nowSpy: MockInstance<typeof Date.now>;

    beforeEach(() => {
      nowSpy = vi.spyOn(Date, 'now');
    });

    afterEach(() => {
      nowSpy.mockRestore();
    });

    it('holds the note mod across a re-import with unchanged content', async () => {
      nowSpy.mockReturnValueOnce(FIRST_EXPORT_MS);
      const discovery = await parse(
        wrap(plainToggle('What is X?', '<p>Answer</p>')),
        { uploadIdentity: { owner: OWNER, ledger: {} } }
      );
      const seededMod = discovery.payload[0].cards[0].mod;
      expect(seededMod).toBe(Math.floor(FIRST_EXPORT_MS / 1000));
      const ledger = ledgerFrom(discovery.uploadIdentityEntries);

      nowSpy.mockReturnValueOnce(SECOND_EXPORT_MS);
      const reimport = await parse(
        wrap(plainToggle('What is X?', '<p>Answer</p>')),
        { uploadIdentity: { owner: OWNER, ledger } }
      );
      expect(reimport.payload[0].cards[0].mod).toBe(seededMod);
    });

    it('bumps the note mod to the later export time when the answer changed', async () => {
      nowSpy.mockReturnValueOnce(FIRST_EXPORT_MS);
      const discovery = await parse(
        wrap(plainToggle('What is X?', '<p>First answer</p>')),
        { uploadIdentity: { owner: OWNER, ledger: {} } }
      );
      const seededMod = discovery.payload[0].cards[0].mod;
      const ledger = ledgerFrom(discovery.uploadIdentityEntries);

      nowSpy.mockReturnValueOnce(SECOND_EXPORT_MS);
      const edited = await parse(
        wrap(plainToggle('What is X?', '<p>Edited answer</p>')),
        { uploadIdentity: { owner: OWNER, ledger } }
      );
      expect(edited.payload[0].cards[0].mod).toBe(
        Math.floor(SECOND_EXPORT_MS / 1000)
      );
      expect(edited.payload[0].cards[0].mod).not.toBe(seededMod);
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
        contentChangedAt: 1_600_000_000,
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

describe('paragraphs decks made before the first-sentence front was escaped', () => {
  const STORED_AT = 1_600_000_000;
  const RAW_FRONT = 'It\'s salt & water < sugar, as the "syrup" note says.';
  const paragraph = (rest: string) =>
    `<p>It&#39;s salt &amp; water &lt; sugar, as the "syrup" note says. ${rest}</p>`;

  async function parseParagraphs(
    body: string,
    name: string,
    ledger: UploadIdentityLedger,
    options: Record<string, string> = {}
  ) {
    const workspace = new Workspace(true, 'fs');
    const parser = new DeckParser({
      name,
      settings: new CardOption({
        cherry: 'false',
        'rescue-rule': 'paragraphs',
        ...options,
      }),
      files: [{ name, contents: wrap(body) }],
      noLimits: true,
      workspace,
      uploadIdentity: { owner: OWNER, ledger },
    });
    await parser.writeDeckInfo(workspace);
    return parser;
  }

  // The rows an earlier upload wrote, when the shown front was the raw
  // sentence: keyed and fingerprinted on that raw text, with the same back.
  function ledgerKeyedOnRawFronts(shown: Note[]): UploadIdentityLedger {
    const ledger: UploadIdentityLedger = {};
    shown.forEach((card, index) => {
      const ordinal = index + 1;
      const earlier = {
        name: RAW_FRONT,
        back: card.back,
        cloze: card.cloze,
        mcq: card.mcq,
        enableInput: card.enableInput,
      };
      ledger[uploadIdentityKey(earlier, ordinal)] = {
        guid: `OLD-${ordinal}`,
        sourceKeyHash: hashSourceKey('notes.html'),
        fingerprint: cardFingerprint(earlier),
        contentChangedAt: STORED_AT,
      };
    });
    return ledger;
  }

  const ONE = paragraph('It keeps cells from swelling in the solution.');
  const TWO = paragraph('The gradient decides which way the water moves.');

  it('keeps the guid and the stored mod when the same file is uploaded again', async () => {
    const discovery = await parseParagraphs(ONE, 'notes.html', {});
    const [shown] = cardsOf(discovery);
    expect(shown.name).not.toBe(RAW_FRONT);

    const parser = await parseParagraphs(
      ONE,
      'notes.html',
      ledgerKeyedOnRawFronts([shown])
    );
    const [card] = cardsOf(parser);
    expect(card.guid).toBe('OLD-1');
    expect(card.mod).toBe(STORED_AT);
    expect(parser.uploadIdentityStats).toEqual({
      issued: 0,
      replayed: 1,
      guarded: 0,
    });
  });

  it('keeps the guid when the file was renamed', async () => {
    const discovery = await parseParagraphs(ONE, 'notes.html', {});
    const [shown] = cardsOf(discovery);

    const parser = await parseParagraphs(
      ONE,
      'renamed-notes.html',
      ledgerKeyedOnRawFronts([shown])
    );
    const [card] = cardsOf(parser);
    expect(card.guid).toBe('OLD-1');
    expect(card.mod).toBe(STORED_AT);
    expect(parser.uploadIdentityStats.guarded).toBe(0);
  });

  it('keeps each guid when two paragraphs share the same first sentence', async () => {
    const discovery = await parseParagraphs(ONE + TWO, 'notes.html', {});
    const parser = await parseParagraphs(
      ONE + TWO,
      'renamed-notes.html',
      ledgerKeyedOnRawFronts(cardsOf(discovery))
    );
    expect(cardsOf(parser).map((card) => card.guid)).toEqual([
      'OLD-1',
      'OLD-2',
    ]);
    expect(parser.uploadIdentityStats).toEqual({
      issued: 0,
      replayed: 2,
      guarded: 0,
    });
  });

  // Before the escape, the sentence sat raw on whichever side the options put
  // it; every other side was the same paragraph HTML it is now.
  function ledgerFromPreEscapeCards(shown: Note[]): UploadIdentityLedger {
    const ledger: UploadIdentityLedger = {};
    const ordinals = new Map<string, number>();
    shown.forEach((card, index) => {
      const earlier = {
        name: card.name === ESCAPED_FRONT ? RAW_FRONT : card.name,
        back: card.back === ESCAPED_FRONT ? RAW_FRONT : card.back,
        cloze: card.cloze,
        mcq: card.mcq,
        enableInput: card.enableInput,
      };
      const base = uploadIdentityKey(earlier);
      const ordinal = (ordinals.get(base) ?? 0) + 1;
      ordinals.set(base, ordinal);
      ledger[uploadIdentityKey(earlier, ordinal)] = {
        guid: `OLD-${index + 1}`,
        sourceKeyHash: hashSourceKey('notes.html'),
        fingerprint: cardFingerprint(earlier),
        contentChangedAt: STORED_AT,
      };
    });
    return ledger;
  }

  const ESCAPED_FRONT =
    'It&#39;s salt &amp; water &lt; sugar, as the &quot;syrup&quot; note says.';

  it.each([
    ['cloze off', { cloze: 'false' }, 1],
    ['typed answers on', { cloze: 'false', 'enable-input': 'true' }, 1],
    ['reversed', { reversed: 'true' }, 1],
    ['basic-reversed', { 'basic-reversed': 'true' }, 2],
  ])(
    'keeps every guid and mod with the %s card option on',
    async (_label, options, cardCount) => {
      const discovery = await parseParagraphs(ONE, 'notes.html', {}, options);
      const shown = cardsOf(discovery);
      expect(shown).toHaveLength(cardCount);
      expect(
        shown.some(
          (card) => card.name === ESCAPED_FRONT || card.back === ESCAPED_FRONT
        )
      ).toBe(true);
      expect(
        shown.map((card) => [
          card.frontEscaped === true,
          card.backEscaped === true,
        ])
      ).toEqual(
        shown.map((card) => [
          card.name === ESCAPED_FRONT,
          card.back === ESCAPED_FRONT,
        ])
      );

      const parser = await parseParagraphs(
        ONE,
        'notes.html',
        ledgerFromPreEscapeCards(shown),
        options
      );
      const cards = cardsOf(parser);
      expect(cards.map((card) => card.guid)).toEqual(
        shown.map((_card, index) => `OLD-${index + 1}`)
      );
      expect(cards.map((card) => card.mod)).toEqual(shown.map(() => STORED_AT));
      expect(parser.uploadIdentityStats).toEqual({
        issued: 0,
        replayed: cardCount,
        guarded: 0,
      });
    }
  );
});
