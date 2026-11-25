import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CREDITS_PER_TEXT_CHARACTER,
  MAX_TEXT_BYTES,
  claudeReadableText,
  estimateGiftCredits,
} from './estimateGiftCredits';
import {
  acceptedByGift,
  allPhotos,
  giftFileKind,
  readByClaudeCards,
} from './giftFileKinds';
import {
  HELD_GIFT_FILE_TTL_MS,
  HELD_GIFT_SIGNUP_KEY,
  createHeldGiftFileStore,
  createMemoryHeldGiftFileStore,
  memoryRecords,
} from './heldGiftFile';
import { giftHandoffState, readGiftHandoff } from './giftHandoff';
import {
  rememberGiftSignupOrigin,
  takeGiftSignupOrigin,
} from './giftSignupOrigin';

const FIXTURES = join(__dirname, '../../../../src/test/fixtures');

function notionPages(): Record<string, string> {
  const pages: Record<string, string> = {};
  for (const name of readdirSync(FIXTURES)) {
    if (name.endsWith('.html')) {
      pages[name] = readFileSync(join(FIXTURES, name), 'utf8');
    }
  }
  return pages;
}

// What the formula gives for the text Claude would read, worked out here
// from the pages themselves rather than from the zip.
function formulaFor(texts: string[]): number {
  const length = texts.reduce((sum, text) => sum + text.length, 0);
  return length * CREDITS_PER_TEXT_CHARACTER;
}

function zipFile(name: string, entries: Record<string, Uint8Array>): File {
  return new File([zipSync(entries)], name);
}

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => Array.from(values.keys())[index] ?? null,
    removeItem: (key) => {
      values.delete(key);
    },
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

describe('estimateGiftCredits on real inputs', () => {
  it('reads a zipped Notion export page by page, within 5 credits of the formula on the text Claude gets', async () => {
    const pages = notionPages();
    const copies: Record<string, Uint8Array> = {
      'Export/photo.png': new Uint8Array(400_000),
    };
    const texts: string[] = [];
    for (let copy = 0; copy < 40; copy += 1) {
      for (const [name, html] of Object.entries(pages)) {
        copies[`Export/${copy}/${name}`] = strToU8(html);
        texts.push(claudeReadableText(html));
      }
    }
    const expected = formulaFor(texts);

    const shown = await estimateGiftCredits([zipFile('Export.zip', copies)]);

    expect(expected).toBeGreaterThan(20);
    expect(shown).not.toBeNull();
    expect(shown!).toBeGreaterThanOrEqual(expected);
    expect(shown!).toBeLessThanOrEqual(expected + 5);
  });

  it('reads a Notion export zipped inside the zip Notion sends', async () => {
    const html = Object.values(notionPages()).join('\n');
    const inner = zipSync({ 'page.html': strToU8(html.repeat(30)) });
    const expected = formulaFor([claudeReadableText(html.repeat(30))]);

    const shown = await estimateGiftCredits([
      zipFile('Export.zip', { 'Export-Part-1.zip': inner }),
    ]);

    expect(shown!).toBeGreaterThanOrEqual(expected);
    expect(shown!).toBeLessThanOrEqual(expected + 5);
  });

  it('reads the words of a Word document, within 5 credits of the formula', async () => {
    const words = 'Mitochondria make most of the cell energy. '.repeat(3000);
    const xml = `<w:document><w:body><w:p><w:r><w:t>${words}</w:t></w:r></w:p></w:body></w:document>`;
    const expected = formulaFor([words]);

    const shown = await estimateGiftCredits([
      zipFile('notes.docx', { 'word/document.xml': strToU8(xml) }),
    ]);

    expect(shown!).toBeGreaterThanOrEqual(expected);
    expect(shown!).toBeLessThanOrEqual(expected + 5);
  });

  it.each([
    ['a scanned-style PDF', 'pdf-landscape-image.pdf', 'scan.pdf'],
    ['a text PDF', 'pdf-plain-text.pdf', 'notes.pdf'],
  ])('shows no number for %s', async (_case, fixture, name) => {
    const pdf = new File([readFileSync(join(FIXTURES, fixture))], name);

    expect(await estimateGiftCredits([pdf])).toBeNull();
  });

  it('shows no number for slides, which Claude reads page by page', async () => {
    const slides = zipFile('deck.pptx', {
      'ppt/slides/slide1.xml': strToU8('<a:t>Hi</a:t>'),
    });

    expect(await estimateGiftCredits([slides])).toBeNull();
  });

  it('shows no number once the text a zip declares passes the bound', async () => {
    const big = new Uint8Array(MAX_TEXT_BYTES + 1);
    const zip = zipFile('Export.zip', { 'page.html': big });

    expect(await estimateGiftCredits([zip])).toBeNull();
  });

  it('shows no number for a file that only claims to be a zip', async () => {
    expect(
      await estimateGiftCredits([new File(['not a zip'], 'Export.zip')])
    ).toBeNull();
  });

  it('reads plain notes as they are', async () => {
    const notes = new File(['x'.repeat(60_000)], 'notes.md');

    expect(await estimateGiftCredits([notes])).toBe(20);
  });
});

describe('giftFileKind', () => {
  it.each([
    ['lecture.PDF', 'pdf'],
    ['board.jpeg', 'photo'],
    ['notes.md', 'text'],
    ['page.html', 'html'],
    ['slides.pptx', 'office'],
    ['export.zip', 'zip'],
  ])('reads %s as %s', (name, kind) => {
    expect(giftFileKind(name)).toBe(kind);
  });

  it.each([
    'deck.apkg',
    'cards.xml',
    'map.opml',
    'book.epub',
    'My Clippings.txt',
    'noextension',
  ])('leaves %s to its own converter', (name) => {
    expect(giftFileKind(name)).toBeNull();
  });

  it('offers Claude for notes and documents but not photos', () => {
    const named = (name: string) => ({ name });
    expect(readByClaudeCards([named('a.pdf'), named('b.zip')])).toBe(true);
    expect(readByClaudeCards([named('a.pdf'), named('b.jpg')])).toBe(false);
    expect(allPhotos([named('a.jpg'), named('b.png')])).toBe(true);
    expect(acceptedByGift([named('a.pdf'), named('deck.apkg')])).toBe(false);
    expect(acceptedByGift([])).toBe(false);
  });
});

describe('the file kept on this device through sign-up', () => {
  beforeEach(() => {
    vi.stubGlobal('sessionStorage', memoryStorage());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const pdf = () => new File(['x'], 'lecture.pdf');

  it('hands the file back once, in the tab that dropped it', async () => {
    const store = createMemoryHeldGiftFileStore();
    const kept = pdf();

    expect(await store.save([kept])).toBe(true);

    expect(await store.take()).toEqual([kept]);
    expect(await store.take()).toBeNull();
  });

  it('says it could not keep the file when the store would not survive the page load', async () => {
    const store = createHeldGiftFileStore(memoryRecords(false));

    expect(await store.save([pdf()])).toBe(false);
    expect(sessionStorage.getItem(HELD_GIFT_SIGNUP_KEY)).toBeNull();
  });

  it('says it could not keep the file when the store refuses it', async () => {
    const records = {
      ...memoryRecords(true),
      put: async () => {
        throw new Error('quota exceeded');
      },
    };
    const store = createHeldGiftFileStore(records);

    expect(await store.save([pdf()])).toBe(false);
  });

  it('never hands the file to another tab, and leaves it for the tab that dropped it', async () => {
    const records = memoryRecords(true);
    const store = createHeldGiftFileStore(records);
    const kept = pdf();
    await store.save([kept]);
    const droppingTab = sessionStorage.getItem(HELD_GIFT_SIGNUP_KEY);

    vi.stubGlobal('sessionStorage', memoryStorage());
    expect(await store.take()).toBeNull();

    sessionStorage.setItem(HELD_GIFT_SIGNUP_KEY, droppingTab ?? '');
    expect(await store.take()).toEqual([kept]);
  });

  it('deletes a file kept for more than an hour, whoever asks', async () => {
    let now = 0;
    const records = memoryRecords(true);
    const store = createHeldGiftFileStore(records, () => now);
    await store.save([pdf()]);
    vi.stubGlobal('sessionStorage', memoryStorage());
    now = HELD_GIFT_FILE_TTL_MS + 1;

    expect(await store.take()).toBeNull();
    expect(await records.get()).toBeNull();
  });
});

describe('the sign-up origin left for the upload page', () => {
  beforeEach(() => {
    vi.stubGlobal('sessionStorage', memoryStorage());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is read once, after the card left it', () => {
    expect(takeGiftSignupOrigin()).toBeNull();

    rememberGiftSignupOrigin();

    expect(takeGiftSignupOrigin()).toBe('upload_card_ai');
    expect(takeGiftSignupOrigin()).toBeNull();
  });
});

describe('the upload card hand-off', () => {
  it('reads back the files and the Claude choice it was given', () => {
    const files = [new File(['x'], 'a.pdf')];

    expect(readGiftHandoff(giftHandoffState({ files, claude: false }))).toEqual(
      { files, claude: false }
    );
  });

  it.each([null, {}, { giftHandoff: { files: [] } }, { giftHandoff: 'x' }])(
    'reads nothing from %j',
    (state) => {
      expect(readGiftHandoff(state)).toBeNull();
    }
  );
});
