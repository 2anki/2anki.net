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
      complete: false,
    });
  });

  it('answers a deck-builder crash with the translated copy, said once', () => {
    expect(
      resolveDownloadError(500, {
        code: 'deck_builder_crash',
        message:
          'Something broke on our end building this deck. Try again — if it keeps failing, email support@2anki.net.',
      })
    ).toEqual({
      kind: 'failed',
      message:
        'Something broke on our end building this deck. Try again. If it keeps failing, email support@2anki.net.',
      complete: true,
    });
  });

  it('keeps the server message for a code with no translated copy', () => {
    expect(
      resolveDownloadError(400, {
        code: 'no_occlusion_boxes',
        message:
          'Draw at least one box over the part of the image to hide, then create the deck.',
      })
    ).toEqual({
      kind: 'failed',
      message:
        'Draw at least one box over the part of the image to hide, then create the deck.',
      complete: false,
    });
  });

  it('keeps the server message for an image over the size limit', () => {
    expect(
      resolveDownloadError(413, {
        code: 'too_large',
        message: 'This image is over the 10 MB limit.',
      })
    ).toEqual({
      kind: 'failed',
      message: 'This image is over the 10 MB limit.',
      complete: false,
    });
  });

  it('returns a null message when the body carries none', () => {
    expect(resolveDownloadError(500, 'oops')).toEqual({
      kind: 'failed',
      message: null,
      complete: false,
    });
  });
});
