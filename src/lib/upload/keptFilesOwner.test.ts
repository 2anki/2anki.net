import { keptFilesChangedOwner } from './keptFilesOwner';

describe('keptFilesChangedOwner', () => {
  it.each([
    ['no kept owner, as older pages send', {}, 4242, false],
    ['no body at all', undefined, 4242, false],
    ['the same account', { 'kept-owner': '4242' }, 4242, false],
    ['the same account read as text', { 'kept-owner': '4242' }, '4242', false],
    [
      'a signed-out visitor still signed out',
      { 'kept-owner': 'none' },
      null,
      false,
    ],
    ['another account', { 'kept-owner': '9999' }, 4242, true],
    [
      'a signed-out visitor now signed in',
      { 'kept-owner': 'none' },
      4242,
      true,
    ],
    ['an account now signed out', { 'kept-owner': '4242' }, undefined, true],
    ['an empty kept owner', { 'kept-owner': '' }, 4242, true],
    ['a kept owner sent twice', { 'kept-owner': ['4242', '4242'] }, 4242, true],
  ])('%s', (_label, body, owner, changed) => {
    expect(keptFilesChangedOwner(body, owner)).toBe(changed);
  });
});
