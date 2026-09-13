import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { countDuplicateGuids } from './countDuplicateGuids';

function workspaceWith(sidecar: string | object | undefined): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dup-guids-'));
  if (sidecar !== undefined) {
    const raw = typeof sidecar === 'string' ? sidecar : JSON.stringify(sidecar);
    fs.writeFileSync(path.join(dir, 'guids.json'), raw);
  }
  return dir;
}

describe('countDuplicateGuids', () => {
  it('is zero when every note has its own guid', () => {
    const dir = workspaceWith([
      { notionId: null, guid: 'a' },
      { notionId: null, guid: 'b' },
    ]);
    expect(countDuplicateGuids(dir)).toBe(0);
  });

  it('counts the notes Anki drops, one fewer than each group', () => {
    const dir = workspaceWith([
      { notionId: null, guid: 'a' },
      { notionId: null, guid: 'a' },
      { notionId: null, guid: 'a' },
      { notionId: 'block', guid: 'b' },
      { notionId: 'block', guid: 'b' },
      { notionId: null, guid: 'c' },
    ]);
    expect(countDuplicateGuids(dir)).toBe(3);
  });

  it('ignores entries without a guid', () => {
    const dir = workspaceWith([{ notionId: null }, { notionId: null }]);
    expect(countDuplicateGuids(dir)).toBe(0);
  });

  it.each([
    ['no sidecar', undefined],
    ['malformed json', '{not json'],
    ['a non-array', { guid: 'a' }],
  ])('is zero with %s', (_label, sidecar) => {
    expect(countDuplicateGuids(workspaceWith(sidecar))).toBe(0);
  });
});
