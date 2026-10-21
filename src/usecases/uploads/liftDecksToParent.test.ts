import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type Workspace from '../../lib/parser/WorkSpace';
import { liftDecksToParent } from './liftDecksToParent';

function makeWorkspace(location: string): Workspace {
  fs.mkdirSync(location, { recursive: true });
  return { id: path.basename(location), location } as Workspace;
}

describe('liftDecksToParent', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'lift-decks-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('moves only .apkg files up into the parent workspace', async () => {
    const parent = makeWorkspace(root);
    const child = makeWorkspace(path.join(root, 'child'));
    fs.writeFileSync(path.join(child.location, 'Biology.apkg'), 'deck');
    fs.writeFileSync(path.join(child.location, 'deck_info.json'), '{}');

    await liftDecksToParent(child, parent);

    expect(fs.readdirSync(parent.location).sort()).toEqual([
      'Biology.apkg',
      'child',
    ]);
    expect(fs.readdirSync(child.location)).toEqual(['deck_info.json']);
  });

  it('suffixes a deck whose name is already taken instead of overwriting it', async () => {
    const parent = makeWorkspace(root);
    const first = makeWorkspace(path.join(root, 'first'));
    const second = makeWorkspace(path.join(root, 'second'));
    fs.writeFileSync(path.join(first.location, 'Notes.apkg'), 'first');
    fs.writeFileSync(path.join(second.location, 'Notes.apkg'), 'second');

    await liftDecksToParent(first, parent);
    await liftDecksToParent(second, parent);

    expect(
      fs.readFileSync(path.join(parent.location, 'Notes.apkg'), 'utf8')
    ).toBe('first');
    expect(
      fs.readFileSync(path.join(parent.location, 'Notes (2).apkg'), 'utf8')
    ).toBe('second');
  });

  it('does nothing when the child workspace was never created', async () => {
    const parent = makeWorkspace(root);
    const missing = { id: 'gone', location: path.join(root, 'gone') };

    await liftDecksToParent(missing as Workspace, parent);

    expect(fs.readdirSync(parent.location)).toEqual([]);
  });
});
