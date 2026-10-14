import { rewriteMediaRefs } from './rewriteMedia';

const BASE = '/api/apkg/deck.apkg/media/';

describe('rewriteMediaRefs', () => {
  it('rewrites a local img src to the API url', () => {
    const map = new Map([['diagram.png', '0']]);
    const out = rewriteMediaRefs('<img src="diagram.png">', map, BASE);
    expect(out).toBe('<img src="/api/apkg/deck.apkg/media/diagram.png">');
  });

  it('decodes a percent-encoded src to find the media file', () => {
    const map = new Map([['my diagram.png', '0']]);
    const out = rewriteMediaRefs('<img src="my%20diagram.png">', map, BASE);
    expect(out).toBe('<img src="/api/apkg/deck.apkg/media/my%20diagram.png">');
  });

  it('uses the raw src when it is not valid percent-encoding', () => {
    const map = new Map([['100% done.png', '0']]);
    const out = rewriteMediaRefs('<img src="100% done.png">', map, BASE);
    expect(out).toBe('<img src="/api/apkg/deck.apkg/media/100%25%20done.png">');
  });

  it('marks a malformed src as missing when no file matches', () => {
    const map = new Map();
    const out = rewriteMediaRefs('<img src="50%off.png">', map, BASE);
    expect(out).toBe('<img src="" data-missing-media="50%off.png">');
  });

  it('leaves absolute urls alone', () => {
    const map = new Map();
    const out = rewriteMediaRefs(
      '<img src="https://example.com/x.png">',
      map,
      BASE
    );
    expect(out).toBe('<img src="https://example.com/x.png">');
  });

  it('marks missing media with data-missing-media', () => {
    const map = new Map();
    const out = rewriteMediaRefs('<img src="gone.png">', map, BASE);
    expect(out).toBe('<img src="" data-missing-media="gone.png">');
  });

  it('replaces [sound:foo.mp3] with an audio element', () => {
    const map = new Map([['foo.mp3', '1']]);
    const out = rewriteMediaRefs('play: [sound:foo.mp3] now', map, BASE);
    expect(out).toBe(
      'play: <audio controls preload="none" src="/api/apkg/deck.apkg/media/foo.mp3"></audio> now'
    );
  });

  it('uses video for [sound:*.mp4]', () => {
    const map = new Map([['clip.mp4', '2']]);
    const out = rewriteMediaRefs('[sound:clip.mp4]', map, BASE);
    expect(out).toBe(
      '<video controls preload="none" src="/api/apkg/deck.apkg/media/clip.mp4"></video>'
    );
  });

  it('renders missing [sound:] as a visible placeholder', () => {
    const map = new Map();
    const out = rewriteMediaRefs('[sound:gone.mp3]', map, BASE);
    expect(out).toBe(
      '<span class="apkg-missing-media">[missing: gone.mp3]</span>'
    );
  });
});
