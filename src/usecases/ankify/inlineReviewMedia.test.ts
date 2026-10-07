import { vi } from 'vitest';
import { inlineReviewMedia } from './inlineReviewMedia';

const base64Of = (text: string): string =>
  Buffer.from(text, 'utf-8').toString('base64');

describe('inlineReviewMedia', () => {
  it('inlines a bare-filename image as a data URI', async () => {
    const fetchMedia = vi.fn(async () => base64Of('PNGBYTES'));
    const cache = new Map<string, string | null>();

    const out = await inlineReviewMedia('<img src="a.png">', fetchMedia, cache);

    expect(out).toContain(`data:image/png;base64,${base64Of('PNGBYTES')}`);
    expect(fetchMedia).toHaveBeenCalledWith('a.png');
  });

  it('maps each known extension to the right mime', async () => {
    const cache = new Map<string, string | null>();
    const out = await inlineReviewMedia(
      '<img src="a.jpg"><img src="b.jpeg"><img src="c.gif"><img src="d.webp"><img src="e.svg">',
      async () => base64Of('X'),
      cache
    );

    expect(out).toContain('data:image/jpeg;base64,');
    expect(out).toContain('data:image/gif;base64,');
    expect(out).toContain('data:image/webp;base64,');
    expect(out).toContain('data:image/svg+xml;base64,');
  });

  it('leaves external, data, and absolute image srcs untouched', async () => {
    const fetchMedia = vi.fn(async () => base64Of('X'));
    const cache = new Map<string, string | null>();
    const html =
      '<img src="https://x/y.png"><img src="http://x/z.png">' +
      '<img src="data:image/png;base64,AAA"><img src="/media/q.png">';

    const out = await inlineReviewMedia(html, fetchMedia, cache);

    expect(out).toBe(html);
    expect(fetchMedia).not.toHaveBeenCalled();
  });

  it('replaces a missing image with a muted chip', async () => {
    const cache = new Map<string, string | null>();
    const out = await inlineReviewMedia(
      '<img src="gone.png">',
      async () => false,
      cache
    );

    expect(out).toBe(
      '<span class="n2a-review-missing">Image not in Anki</span>'
    );
  });

  it('replaces an unknown extension image with a missing chip (never a broken data URI)', async () => {
    const cache = new Map<string, string | null>();
    const out = await inlineReviewMedia(
      '<img src="weird.xyz">',
      async () => base64Of('X'),
      cache
    );

    expect(out).toBe(
      '<span class="n2a-review-missing">Image not in Anki</span>'
    );
  });

  it('renders [sound:X] as an audio element with a data URI', async () => {
    const cache = new Map<string, string | null>();
    const out = await inlineReviewMedia(
      'listen [sound:word.mp3]',
      async () => base64Of('MP3'),
      cache
    );

    expect(out).toContain(
      `<audio controls preload="none" src="data:audio/mpeg;base64,${base64Of('MP3')}"></audio>`
    );
    expect(out).not.toContain('[sound:');
  });

  it('replaces a missing sound with a muted chip', async () => {
    const cache = new Map<string, string | null>();
    const out = await inlineReviewMedia(
      '[sound:gone.mp3]',
      async () => false,
      cache
    );

    expect(out).toBe(
      '<span class="n2a-review-missing">Audio not in Anki</span>'
    );
  });

  it('strips [anki:play:q:N] and [anki:play:a:N] tokens entirely', async () => {
    const cache = new Map<string, string | null>();
    const out = await inlineReviewMedia(
      'Q[anki:play:q:0] A[anki:play:a:1]',
      async () => false,
      cache
    );

    expect(out).toBe('Q A');
  });

  it('resolves [anki:play:q:0] to an audio element using note-field sounds', async () => {
    const fetchMedia = vi.fn(async () => base64Of('MP3'));
    const cache = new Map<string, string | null>();

    const out = await inlineReviewMedia(
      'listen [anki:play:q:0]',
      fetchMedia,
      cache,
      ['1600420050000.mp3']
    );

    expect(out).toContain(
      `<audio controls preload="none" src="data:audio/mpeg;base64,${base64Of('MP3')}"></audio>`
    );
    expect(out).not.toContain('[anki:play:');
    expect(fetchMedia).toHaveBeenCalledWith('1600420050000.mp3');
  });

  it('strips [anki:play:q:0] when noteSounds is empty', async () => {
    const fetchMedia = vi.fn(async () => base64Of('MP3'));
    const cache = new Map<string, string | null>();

    const out = await inlineReviewMedia(
      'listen [anki:play:q:0]',
      fetchMedia,
      cache,
      []
    );

    expect(out).toBe('listen ');
    expect(out).not.toContain('[anki:play:');
    expect(out).not.toContain('<audio');
    expect(fetchMedia).not.toHaveBeenCalled();
  });

  it('fetches a note-field sound shared by q and a sides only once', async () => {
    const fetchMedia = vi.fn(async () => base64Of('MP3'));
    const cache = new Map<string, string | null>();

    await inlineReviewMedia('[anki:play:q:0]', fetchMedia, cache, ['s.mp3']);
    await inlineReviewMedia('[anki:play:a:0]', fetchMedia, cache, ['s.mp3']);

    expect(fetchMedia).toHaveBeenCalledTimes(1);
  });

  it('leaves no raw [sound: or [anki:play: token in the output', async () => {
    const cache = new Map<string, string | null>();
    const out = await inlineReviewMedia(
      '[sound:a.mp3] [anki:play:q:0] [anki:play:a:0] [sound:b.wav]',
      async () => base64Of('X'),
      cache
    );

    expect(out).not.toContain('[sound:');
    expect(out).not.toContain('[anki:play:');
  });

  it('fetches each unique filename once via the cache', async () => {
    const fetchMedia = vi.fn(async () => base64Of('X'));
    const cache = new Map<string, string | null>();

    await inlineReviewMedia('<img src="a.png">', fetchMedia, cache);
    await inlineReviewMedia(
      '<img src="a.png"><img src="a.png">',
      fetchMedia,
      cache
    );

    expect(fetchMedia).toHaveBeenCalledTimes(1);
  });

  it('caches a miss so it is not refetched', async () => {
    const fetchMedia = vi.fn(async () => false as const);
    const cache = new Map<string, string | null>();

    await inlineReviewMedia('<img src="gone.png">', fetchMedia, cache);
    await inlineReviewMedia('<img src="gone.png">', fetchMedia, cache);

    expect(fetchMedia).toHaveBeenCalledTimes(1);
  });

  it('stops fetching new files once the cache holds 200 entries', async () => {
    const fetchMedia = vi.fn(async () => base64Of('X'));
    const cache = new Map<string, string | null>();
    const refs = Array.from(
      { length: 201 },
      (_, i) => `<img src="f${i}.png">`
    ).join('');

    const out = await inlineReviewMedia(refs, fetchMedia, cache);

    expect(fetchMedia).toHaveBeenCalledTimes(200);
    expect(out).toContain('n2a-review-missing');
  });

  it('treats a >5 MB decoded image as missing', async () => {
    const bigBase64 = 'A'.repeat(Math.ceil((6 * 1024 * 1024) / 0.75));
    const cache = new Map<string, string | null>();

    const out = await inlineReviewMedia(
      '<img src="huge.png">',
      async () => bigBase64,
      cache
    );

    expect(out).toBe(
      '<span class="n2a-review-missing">Image not in Anki</span>'
    );
  });

  it('returns non-media html unchanged', async () => {
    const cache = new Map<string, string | null>();
    const out = await inlineReviewMedia(
      '<p>Just text</p>',
      async () => false,
      cache
    );

    expect(out).toBe('<p>Just text</p>');
  });
});
