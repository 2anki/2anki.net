import { vi } from 'vitest';

import { logMediaNameNotices, mediaNameNotices } from './logMediaNameNotices';

describe('mediaNameNotices', () => {
  it('keeps only the deck writer media-name lines', () => {
    const stderr = [
      'Skipping media outside the working directory: /tmp/a.png',
      '[media-names] renamed 3 media file(s) to names Anki accepts',
      '',
      "  [media-names] export refused a media name; Anki's media check renamed 1 media file(s) and the export was retried  ",
    ].join('\n');

    expect(mediaNameNotices(stderr)).toEqual([
      '[media-names] renamed 3 media file(s) to names Anki accepts',
      "[media-names] export refused a media name; Anki's media check renamed 1 media file(s) and the export was retried",
    ]);
  });

  it('finds nothing in output without the prefix', () => {
    expect(mediaNameNotices('Skipping 1 missing media file(s)\n')).toEqual([]);
  });
});

describe('logMediaNameNotices', () => {
  it('logs each media-name line once', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    try {
      logMediaNameNotices(
        'noise\n[media-names] renamed 2 media file(s) to names Anki accepts\n'
      );
      expect(info.mock.calls).toEqual([
        ['[media-names] renamed 2 media file(s) to names Anki accepts'],
      ]);
    } finally {
      info.mockRestore();
    }
  });
});
