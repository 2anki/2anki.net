import { describe, expect, it } from 'vitest';

import { resolveDownloadError } from './resolveDownloadError';

describe('resolveDownloadError', () => {
  it('recognises the free-tier image cap by its code, not its wording', () => {
    expect(
      resolveDownloadError(403, {
        code: 'image_limit',
        message: 'Upgrade to process more than 3 images',
      })
    ).toEqual({ kind: 'image_limit' });
  });

  it('treats a 403 without the code as an ordinary failure', () => {
    expect(resolveDownloadError(403, { message: 'Forbidden' })).toEqual({
      kind: 'failed',
      message: 'Forbidden',
    });
  });

  it('returns a null message when the body carries none', () => {
    expect(resolveDownloadError(500, 'oops')).toEqual({
      kind: 'failed',
      message: null,
    });
  });
});
