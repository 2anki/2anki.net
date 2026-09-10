import { setupTests } from '../../test/configure-jest';
import { guidFor } from '../anki/guid';
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

describe('upload card identity for signed-in non-Notion uploads', () => {
  it('stamps guidFor(owner, identityKey) on first sight and records it', async () => {
    const parser = await parse(
      wrap(plainToggle('What is X?', '<p>Answer</p>')),
      {
        uploadIdentity: { owner: OWNER, ledger: {} },
      }
    );
    const cards = parser.payload.flatMap((d) => d.cards);
    expect(cards).toHaveLength(1);
    const card = cards[0];
    expect(card.notionId).toBeUndefined();
    expect(card.identityKey).toBe(uploadIdentityKey(card));
    expect(card.guid).toBe(guidFor(OWNER, card.identityKey!));
    expect(parser.uploadIdentityStats).toEqual({
      issued: 1,
      replayed: 0,
      guarded: 0,
    });
    expect(parser.uploadIdentityEntries).toEqual([
      {
        blockId: card.identityKey,
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
    const identityKey = discovery.payload[0].cards[0].identityKey!;
    const ledger: UploadIdentityLedger = {
      [identityKey]: {
        guid: 'STORED-GUID',
        sourceKeyHash: hashSourceKey('notes.html'),
        fingerprint: 'an-old-answer-fingerprint',
      },
    };

    const parser = await parse(
      wrap(plainToggle('What is X?', '<p>Edited answer</p>')),
      { uploadIdentity: { owner: OWNER, ledger } }
    );
    const card = parser.payload[0].cards[0];
    expect(card.guid).toBe('STORED-GUID');
    expect(parser.uploadIdentityStats).toEqual({
      issued: 0,
      replayed: 1,
      guarded: 0,
    });
    expect(parser.uploadIdentityEntries).toEqual([]);
  });

  it('replays the stored guid when the file was renamed', async () => {
    const discovery = await parse(
      wrap(plainToggle('What is X?', '<p>Answer</p>')),
      { name: 'old-name.html', uploadIdentity: { owner: OWNER, ledger: {} } }
    );
    const originalGuid = discovery.payload[0].cards[0].guid!;
    const identityKey = discovery.payload[0].cards[0].identityKey!;
    const { sourceKeyHash, fingerprint } = unpackIdentitySource(
      discovery.uploadIdentityEntries[0].sourcePageId
    );
    const ledger: UploadIdentityLedger = {
      [identityKey]: { guid: originalGuid, sourceKeyHash, fingerprint },
    };

    const parser = await parse(
      wrap(plainToggle('What is X?', '<p>Answer</p>')),
      { name: 'renamed.html', uploadIdentity: { owner: OWNER, ledger } }
    );
    const card = parser.payload[0].cards[0];
    expect(card.guid).toBe(originalGuid);
    expect(parser.uploadIdentityStats.replayed).toBe(1);
  });

  it('forks a fresh guid when both the filename and answer changed', async () => {
    const discovery = await parse(
      wrap(plainToggle('What is X?', '<p>Answer</p>')),
      { name: 'old-name.html', uploadIdentity: { owner: OWNER, ledger: {} } }
    );
    const identityKey = discovery.payload[0].cards[0].identityKey!;
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
  });

  it('gives identical fronts in one upload distinct guids via ordinals', async () => {
    const parser = await parse(
      wrap(
        plainToggle('Same front', '<p>Answer one</p>') +
          plainToggle('Same front', '<p>Answer two</p>')
      ),
      { uploadIdentity: { owner: OWNER, ledger: {} } }
    );
    const cards = parser.payload.flatMap((d) => d.cards);
    expect(cards).toHaveLength(2);
    const keys = cards.map((c) => c.identityKey);
    expect(new Set(keys).size).toBe(2);
    expect(keys[1]).toBe(`${keys[0]}#2`);
    const guids = cards.map((c) => c.guid);
    expect(new Set(guids).size).toBe(2);
  });
});

describe('upload card identity leaves other conversions untouched', () => {
  it('does nothing for anonymous uploads (no owner)', async () => {
    const parser = await parse(
      wrap(plainToggle('What is X?', '<p>Answer</p>'))
    );
    const card = parser.payload[0].cards[0];
    expect(card.guid).toBeUndefined();
    expect(card.identityKey).toBeUndefined();
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
    expect(card.identityKey).toBeUndefined();
    expect(card.guid).toBeUndefined();
    expect(parser.uploadIdentityStats).toEqual({
      issued: 0,
      replayed: 0,
      guarded: 0,
    });
  });
});
