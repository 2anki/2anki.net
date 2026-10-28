import express from 'express';

import { tellUploadOwner } from './tellUploadOwner';

function responseFor(owner: unknown) {
  const headers = new Map<string, string>();
  const res = {
    locals: owner === undefined ? {} : { owner },
    set: (name: string, value: string) => {
      headers.set(name, value);
    },
  } as unknown as express.Response;
  return { res, headers };
}

describe('tellUploadOwner', () => {
  it.each([
    ['a signed-in account', 4242, '4242'],
    ['an account id the session holds as text', '4242', '4242'],
    ['a signed-out visitor', undefined, 'none'],
    ['a session holding no owner', null, 'none'],
    ['a session holding an empty owner', '', 'none'],
  ])('names %s', (_label, owner, named) => {
    const { res, headers } = responseFor(owner);

    tellUploadOwner({} as express.Request, res, () => undefined);

    expect(headers.get('X-Upload-Owner')).toBe(named);
  });

  it('names a non-integer owner as the session holds it', () => {
    const { res, headers } = responseFor(42.5);

    tellUploadOwner({} as express.Request, res, () => undefined);

    expect(headers.get('X-Upload-Owner')).toBe('42.5');
  });

  it('sets the header before the next handler runs', () => {
    const { res, headers } = responseFor(7);
    const seenByNext: Array<string | undefined> = [];

    tellUploadOwner({} as express.Request, res, () => {
      seenByNext.push(headers.get('X-Upload-Owner'));
    });

    expect(seenByNext).toEqual(['7']);
  });
});
