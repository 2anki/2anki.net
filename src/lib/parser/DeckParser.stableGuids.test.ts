import { guidFor } from '../anki/guid';
import { setupTests } from '../../test/configure-jest';
import { parseApkgNotes } from '../../services/ApkgPreviewService/parseApkgNotes';
import CardOption from './Settings/CardOption';
import { DeckParser } from './DeckParser';
import Workspace from './WorkSpace';

beforeEach(() => setupTests());

async function parserFor(
  html: string,
  options: Record<string, string> = { cherry: 'false' },
  knownGuids?: Record<string, string>,
  name = 'toggle.html'
) {
  const workspace = new Workspace(true, 'fs');
  const parser = new DeckParser({
    name,
    settings: new CardOption(options),
    files: [{ name, contents: html }],
    noLimits: true,
    workspace,
    knownGuids,
  });
  await parser.writeDeckInfo(workspace);
  return parser;
}

async function cardsFor(
  html: string,
  options: Record<string, string> = { cherry: 'false' },
  name = 'toggle.html'
) {
  const parser = await parserFor(html, options, undefined, name);
  return parser.payload.flatMap((d) => d.cards);
}

const BLOCK_ID = '3917ab29-a11e-8047-9d97-cf0f00b3c8f7';
const OTHER_BLOCK_ID = '23b40f2c-3dba-49d5-b38b-735ce6483110';

const wrap = (body: string, title = 'Toggles') =>
  `<html><head><title>${title}</title></head><body><article class="page sans"><header><h1 class="page-title">${title}</h1></header><div class="page-body">${body}</div></article></body></html>`;

const detailsToggle = (id: string, summary: string, bodyInner: string) =>
  `<details id="${id}" class="toggle" open="" dir="auto"><summary dir="auto">${summary}</summary><div class="indented" dir="auto">${bodyInner}</div></details>`;

describe('stable card identity for the 2026 details export format', () => {
  it('carries the details block id onto the note', async () => {
    const cards = await cardsFor(
      wrap(detailsToggle(BLOCK_ID, 'What is the capital?', '<p>Tirana</p>'))
    );
    expect(cards).toHaveLength(1);
    expect(cards[0].notionId).toBe(BLOCK_ID);
  });

  it('keeps the block id identical across deck renames and setting changes', async () => {
    const body = detailsToggle(BLOCK_ID, 'Front text', '<p>Back text</p>');
    const first = await cardsFor(wrap(body, 'Deck One'));
    const second = await cardsFor(wrap(body, '📖 Renamed Deck'), {
      cherry: 'false',
      cloze: 'true',
    });
    expect(first[0].notionId).toBe(BLOCK_ID);
    expect(second[0].notionId).toBe(BLOCK_ID);
  });

  it('gives every toggle its own block id', async () => {
    const cards = await cardsFor(
      wrap(
        detailsToggle(BLOCK_ID, 'First question', '<p>First answer</p>') +
          detailsToggle(
            OTHER_BLOCK_ID,
            'Second question',
            '<p>Second answer</p>'
          )
      )
    );
    expect(cards).toHaveLength(2);
    expect(cards.map((c) => c.notionId)).toEqual([BLOCK_ID, OTHER_BLOCK_ID]);
  });

  it('leaves notionId unset when the source has no block id', async () => {
    const cards = await cardsFor(
      wrap(
        `<details class="toggle" open=""><summary>No id here</summary><div class="indented"><p>Answer</p></div></details>`
      )
    );
    expect(cards).toHaveLength(1);
    expect(cards[0].notionId).toBeUndefined();
  });
});

describe('fan-out notes never share a block id', () => {
  it('suffixes overlapping-cloze notes with their item index', async () => {
    const list = '<ul><li>alpha</li><li>beta</li><li>gamma</li></ul>';
    const cards = await cardsFor(
      wrap(detailsToggle(BLOCK_ID, 'List question', list)),
      { cherry: 'false', cloze: 'true', 'overlapping-cloze': 'show-all' }
    );
    expect(cards.length).toBeGreaterThanOrEqual(3);
    const ids = cards.map((c) => c.notionId);
    expect(new Set(ids).size).toBe(ids.length);
    for (const [index, id] of ids.entries()) {
      expect(id).toBe(`${BLOCK_ID}::${index}`);
    }
  });

  it('keeps the reversed companion off block-id identity entirely', async () => {
    const cards = await cardsFor(
      wrap(detailsToggle(BLOCK_ID, 'Question side', '<p>Answer side</p>')),
      { cherry: 'false', 'basic-reversed': 'true' }
    );
    expect(cards).toHaveLength(2);
    const ids = cards.map((c) => c.notionId);
    expect(ids).toContain(BLOCK_ID);
    expect(ids.filter((id) => id === BLOCK_ID)).toHaveLength(1);
    const companion = cards.find((c) => c.notionId !== BLOCK_ID);
    expect(companion?.notionId).toBeUndefined();
  });
});

describe('user-authored ids never become card identity', () => {
  const genericDetails = (id: string, summary: string, body: string) =>
    `<details id="${id}"><summary>${summary}</summary><div>${body}</div></details>`;

  it('ignores non-UUID ids on generic HTML details toggles', async () => {
    const cards = await cardsFor(
      wrap(
        genericDetails('faq-1', 'What is A?', '<p>Answer A</p>') +
          genericDetails('faq-1', 'What is B?', '<p>Answer B</p>')
      )
    );
    expect(cards).toHaveLength(2);
    expect(cards[0].notionId).toBeUndefined();
    expect(cards[1].notionId).toBeUndefined();
  });

  it('still accepts a Notion-shaped UUID on a plain details toggle', async () => {
    const cards = await cardsFor(
      wrap(genericDetails(BLOCK_ID, 'Real block', '<p>Answer</p>'))
    );
    expect(cards).toHaveLength(1);
    expect(cards[0].notionId).toBe(BLOCK_ID);
  });
});

// CustomExporter.save skips the Python packaging step under SKIP_CREATE_DECK
// (the CI server job sets it), so the buffer is not a real apkg there. The
// same contract is still covered split across suites: notionId resolution
// above, and guid_for(notionId) in create_deck/tests/test_stable_guids.py.
const describeWithPython = process.env.SKIP_CREATE_DECK
  ? describe.skip
  : describe;

describeWithPython('the shipped apkg carries block-id GUIDs', () => {
  async function apkgGuidsFor(title: string): Promise<string[]> {
    const workspace = new Workspace(true, 'fs');
    const parser = new DeckParser({
      name: 'toggle.html',
      settings: new CardOption({ cherry: 'false' }),
      files: [
        {
          name: 'toggle.html',
          contents: wrap(
            detailsToggle(BLOCK_ID, 'Same question', '<p>Same answer</p>'),
            title
          ),
        },
      ],
      noLimits: true,
      workspace,
    });
    const apkg = await parser.build(workspace);
    const parsed = await parseApkgNotes(apkg);
    return parsed.notes.map((n) => n.guid);
  }

  it('keeps the same GUID across deck renames, derived from the block id', async () => {
    const first = await apkgGuidsFor('Deck One');
    const second = await apkgGuidsFor('📖 Renamed Deck');
    expect(first).toEqual([guidFor(BLOCK_ID)]);
    expect(second).toEqual(first);
  });
});

describe('guid ledger replay', () => {
  const body = detailsToggle(BLOCK_ID, 'Ledger question', '<p>Answer</p>');

  it('stamps the stored guid on a ledger hit and issues nothing', async () => {
    const parser = await parserFor(
      wrap(body),
      { cherry: 'false' },
      {
        [BLOCK_ID]: 'stored-guid',
      }
    );
    const cards = parser.payload.flatMap((d) => d.cards);
    expect(cards[0].guid).toBe('stored-guid');
    expect(parser.issuedGuidEntries).toEqual([]);
  });

  it('computes, stamps, and reports a new guid on a ledger miss', async () => {
    const parser = await parserFor(wrap(body), { cherry: 'false' }, {});
    const cards = parser.payload.flatMap((d) => d.cards);
    expect(cards[0].guid).toBeDefined();
    expect(parser.issuedGuidEntries).toEqual([
      {
        blockId: BLOCK_ID,
        sourcePageId: undefined,
        guid: cards[0].guid,
      },
    ]);
    expect(cards[0].sourcePageId).toBeUndefined();
  });

  it('leaves guids unset entirely for anonymous conversions', async () => {
    const parser = await parserFor(wrap(body), { cherry: 'false' });
    const cards = parser.payload.flatMap((d) => d.cards);
    expect(cards[0].guid).toBeUndefined();
    expect(parser.issuedGuidEntries).toEqual([]);
  });
});
