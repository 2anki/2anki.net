import {
  keptFilesChangedOwner,
  sessionOwnerOf,
  takeKeptOwner,
} from './keptFilesOwner';

describe('takeKeptOwner', () => {
  it('returns the account the page named and takes it off the fields', () => {
    const body: Record<string, unknown> = {
      'kept-owner': '4242',
      'claude-ai-flashcards': 'true',
    };

    expect(takeKeptOwner(body)).toBe('4242');
    expect(body).toEqual({ 'claude-ai-flashcards': 'true' });
  });

  it.each([
    ['no such field', {}],
    ['no fields at all', undefined],
  ])('returns nothing for a request with %s', (_label, body) => {
    expect(takeKeptOwner(body)).toBeUndefined();
  });
});

describe('sessionOwnerOf', () => {
  it.each([
    [4242, '4242'],
    ['4242', '4242'],
    [null, 'none'],
    [undefined, 'none'],
    ['', 'none'],
  ])('names the session of owner %j as %s', (owner, named) => {
    expect(sessionOwnerOf(owner)).toBe(named);
  });
});

describe('keptFilesChangedOwner', () => {
  it.each([
    ['no kept owner, as older pages send', undefined, 4242, false],
    ['the same account', '4242', 4242, false],
    ['the same account read as text', '4242', '4242', false],
    ['a signed-out visitor still signed out', 'none', null, false],
    ['another account', '9999', 4242, true],
    ['a signed-out visitor now signed in', 'none', 4242, true],
    ['an account now signed out', '4242', undefined, true],
    ['an empty kept owner', '', 4242, true],
    ['a kept owner sent twice', ['4242', '4242'], 4242, true],
  ])('%s', (_label, sentBy, owner, changed) => {
    expect(keptFilesChangedOwner(sentBy, owner)).toBe(changed);
  });
});
