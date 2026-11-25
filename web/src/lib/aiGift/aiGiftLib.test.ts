import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MIN_ESTIMATE_CREDITS,
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
  createMemoryHeldGiftFileStore,
} from './heldGiftFile';
import { giftHandoffState, readGiftHandoff } from './giftHandoff';

const named = (name: string, size = 0) => ({ name, size });

describe('estimateGiftCredits', () => {
  it.each([
    ['a 1 MB PDF', [named('lecture.pdf', 1_000_000)], 30],
    ['60 KB of notes', [named('notes.md', 60_000)], 20],
    ['a 5 MB Notion zip', [named('export.zip', 5_000_000)], 75],
    [
      'two files together',
      [named('a.txt', 30_000), named('b.txt', 30_000)],
      20,
    ],
  ])('estimates %s from its size and type', (_case, files, credits) => {
    expect(estimateGiftCredits(files)).toBe(credits);
  });

  it('never says less than the smallest conversion costs', () => {
    expect(estimateGiftCredits([named('tiny.txt', 10)])).toBe(
      MIN_ESTIMATE_CREDITS
    );
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
    expect(readByClaudeCards([named('a.pdf'), named('b.zip')])).toBe(true);
    expect(readByClaudeCards([named('a.pdf'), named('b.jpg')])).toBe(false);
    expect(allPhotos([named('a.jpg'), named('b.png')])).toBe(true);
    expect(acceptedByGift([named('a.pdf'), named('deck.apkg')])).toBe(false);
    expect(acceptedByGift([])).toBe(false);
  });
});

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

describe('the file kept on this device through sign-up', () => {
  beforeEach(() => {
    vi.stubGlobal('sessionStorage', memoryStorage());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const pdf = () => new File(['x'], 'lecture.pdf');

  it('hands the file back once, in the tab that started the sign-up', async () => {
    const store = createMemoryHeldGiftFileStore();
    const kept = pdf();

    await store.save([kept]);

    expect(await store.take()).toEqual([kept]);
    expect(await store.take()).toBeNull();
  });

  it('hands nothing back in a tab that never started a sign-up', async () => {
    const store = createMemoryHeldGiftFileStore();
    await store.save([pdf()]);
    globalThis.sessionStorage.removeItem(HELD_GIFT_SIGNUP_KEY);

    expect(await store.take()).toBeNull();
  });

  it('drops a file kept for more than an hour', async () => {
    let now = 0;
    const store = createMemoryHeldGiftFileStore(() => now);
    await store.save([pdf()]);
    now = HELD_GIFT_FILE_TTL_MS + 1;

    expect(await store.take()).toBeNull();
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
