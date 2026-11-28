import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cardsIn, decksToStore } from './decksToStore';

describe('decksToStore', () => {
  let root: string;
  let workspace: string;

  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'to-store-')));
    workspace = path.join(root, 'job');
    fs.mkdirSync(workspace);
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  function deck(name: string, contents = 'apkg'): string {
    const file = path.join(workspace, name);
    fs.writeFileSync(file, contents);
    return file;
  }

  it('stores a deck the writer reported by its real path when the workspace sits under a symlink', async () => {
    const linkedBase = path.join(root, 'linked-base');
    fs.symlinkSync(root, linkedBase);
    const realDeck = deck('Biology.apkg');

    const decks = await decksToStore('job', path.join(linkedBase, 'job'), [
      { apkgPath: realDeck, cardCount: 12 },
    ]);

    expect(decks).toEqual([{ apkgPath: realDeck, cardCount: 12 }]);
  });

  it('stores a deck recorded through the symlinked path of its workspace', async () => {
    const linkedBase = path.join(root, 'linked-base');
    fs.symlinkSync(root, linkedBase);
    const realDeck = deck('Biology.apkg');

    const decks = await decksToStore('job', workspace, [
      { apkgPath: path.join(linkedBase, 'job', 'Biology.apkg'), cardCount: 5 },
    ]);

    expect(decks).toEqual([{ apkgPath: realDeck, cardCount: 5 }]);
  });

  it('stores a deck whose name starts with two dots', async () => {
    const dotted = deck('..notes.apkg');

    const decks = await decksToStore('job', workspace, [
      { apkgPath: dotted, cardCount: 3 },
    ]);

    expect(decks).toEqual([{ apkgPath: dotted, cardCount: 3 }]);
  });

  it('refuses a deck reached through a folder inside the workspace that links outside it', async () => {
    const outside = path.join(root, 'outside');
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'Secret.apkg'), 'not yours');
    fs.symlinkSync(outside, path.join(workspace, 'linked.apkg'));

    const decks = await decksToStore('job', workspace, [
      {
        apkgPath: path.join(workspace, 'linked.apkg', 'Secret.apkg'),
        cardCount: 9,
      },
    ]);

    expect(decks).toEqual([]);
  });

  it('refuses a deck file that is itself a symlink, even to a file inside the workspace', async () => {
    const real = deck('Real.apkg');
    const link = path.join(workspace, 'Link.apkg');
    fs.symlinkSync(real, link);

    const decks = await decksToStore('job', workspace, [
      { apkgPath: link, cardCount: 4 },
    ]);

    expect(decks).toEqual([]);
  });

  it.each([
    ['a file outside the workspace', () => deckOutside()],
    ['a folder named like a deck', () => folderNamedLikeADeck()],
    ['a file that does not exist', () => path.join(workspace, 'Gone.apkg')],
  ])('refuses %s', async (_label, recorded) => {
    const decks = await decksToStore('job', workspace, [
      { apkgPath: recorded(), cardCount: 6 },
    ]);

    expect(decks).toEqual([]);
  });

  function deckOutside(): string {
    const file = path.join(root, 'Elsewhere.apkg');
    fs.writeFileSync(file, 'apkg');
    return file;
  }

  function folderNamedLikeADeck(): string {
    const folder = path.join(workspace, 'pictures.apkg');
    fs.mkdirSync(folder);
    return folder;
  }

  it('skips a package that recorded no deck file and keeps the others', async () => {
    const kept = deck('Kept.apkg');

    const decks = await decksToStore('job', workspace, [
      { cardCount: 8 },
      { apkgPath: kept, cardCount: 2 },
    ]);

    expect(decks).toEqual([{ apkgPath: kept, cardCount: 2 }]);
  });

  it('keeps a file two packages wrote once, with the later package cards, in the first position', async () => {
    const shared = deck('alpha.apkg');
    const other = deck('beta.apkg');

    const decks = await decksToStore('job', workspace, [
      { apkgPath: shared, cardCount: 20 },
      { apkgPath: other, cardCount: 7 },
      { apkgPath: shared, cardCount: 30 },
    ]);

    expect(decks).toEqual([
      { apkgPath: shared, cardCount: 30 },
      { apkgPath: other, cardCount: 7 },
    ]);
    expect(cardsIn(decks)).toBe(37);
  });
});
