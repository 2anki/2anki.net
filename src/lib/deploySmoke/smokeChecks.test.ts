import {
  checkPage,
  checkSampleDeck,
  findAppBundleSrc,
  readHead,
} from './smokeChecks';

const HOME_TITLE = 'Convert Notion to Anki Flashcards — 2anki.net';
const BUNDLE = 'https://cdn.example/assets/index-abc.js';

function page({
  title,
  canonical,
}: {
  title: string;
  canonical?: string;
}): string {
  const canonicalTag =
    canonical == null ? '' : `<link rel="canonical" href="${canonical}">`;
  return `<!doctype html><html lang="en"><head><title>${title}</title><script type="module" crossorigin src="${BUNDLE}"></script>${canonicalTag}</head><body><div id="root"></div></body></html>`;
}

const homeShell = page({ title: HOME_TITLE });

describe('readHead', () => {
  it('reads the title and canonical href', () => {
    expect(
      readHead(
        page({ title: 'PDF to Anki', canonical: 'https://2anki.net/pdf/' })
      )
    ).toEqual({ title: 'PDF to Anki', canonical: 'https://2anki.net/pdf/' });
  });

  it('reads a canonical whose href comes before rel', () => {
    expect(
      readHead(
        '<title>X</title><link href="https://2anki.net/x/" rel="canonical">'
      ).canonical
    ).toBe('https://2anki.net/x/');
  });

  it('returns null for a missing title and canonical', () => {
    expect(readHead('<html><head></head></html>')).toEqual({
      title: null,
      canonical: null,
    });
  });
});

describe('findAppBundleSrc', () => {
  it('returns the module script src', () => {
    expect(findAppBundleSrc(homeShell)).toBe(BUNDLE);
  });

  it('returns null when the page has no module script', () => {
    expect(findAppBundleSrc('<div id="root"></div>')).toBeNull();
  });
});

describe('checkPage', () => {
  const landing = {
    path: '/convert/csv-to-anki/',
    canonical: 'https://2anki.net/convert/csv-to-anki/',
  };

  it('passes a landing page that serves its own title and canonical', () => {
    const html = page({
      title: 'CSV to Anki | 2anki',
      canonical: landing.canonical,
    });

    expect(checkPage(landing, { status: 200, body: html }, HOME_TITLE)).toEqual(
      []
    );
  });

  it('fails a landing path that serves the home shell', () => {
    expect(
      checkPage(landing, { status: 200, body: homeShell }, HOME_TITLE)
    ).toEqual([
      '/convert/csv-to-anki/: no canonical link, expected https://2anki.net/convert/csv-to-anki/',
      '/convert/csv-to-anki/: serves the home page title, so the home shell was sent instead of its prerendered page',
    ]);
  });

  it('fails a landing path whose canonical points elsewhere', () => {
    const html = page({
      title: 'CSV to Anki | 2anki',
      canonical: 'https://2anki.net/',
    });

    expect(checkPage(landing, { status: 200, body: html }, HOME_TITLE)).toEqual(
      [
        '/convert/csv-to-anki/: canonical is https://2anki.net/, expected https://2anki.net/convert/csv-to-anki/',
      ]
    );
  });

  it('fails a non-200 response without reading the body', () => {
    expect(
      checkPage(landing, { status: 503, body: 'updating' }, HOME_TITLE)
    ).toEqual(['/convert/csv-to-anki/: HTTP 503, expected 200']);
  });

  it('fails a page without the app root or bundle', () => {
    const html = `<title>CSV to Anki</title><link rel="canonical" href="${landing.canonical}">`;

    expect(checkPage(landing, { status: 200, body: html }, HOME_TITLE)).toEqual(
      [
        '/convert/csv-to-anki/: no <div id="root">, not the app shell',
        '/convert/csv-to-anki/: no module script, the app bundle is not loaded',
      ]
    );
  });

  it('fails a page with an empty title', () => {
    const html = page({ title: '  ', canonical: landing.canonical });

    expect(checkPage(landing, { status: 200, body: html }, HOME_TITLE)).toEqual(
      ['/convert/csv-to-anki/: no <title>']
    );
  });

  it('lets the home page carry the home title', () => {
    const home = { path: '/', canonical: 'https://2anki.net/' };
    const html = page({ title: HOME_TITLE, canonical: 'https://2anki.net/' });

    expect(checkPage(home, { status: 200, body: html }, HOME_TITLE)).toEqual(
      []
    );
  });
});

describe('checkSampleDeck', () => {
  const zip = Buffer.concat([
    Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    Buffer.alloc(64),
  ]);

  it('passes an apkg with the expected card count', () => {
    expect(
      checkSampleDeck({ status: 200, cardCount: '8', body: zip }, 8)
    ).toEqual([]);
  });

  it('fails a deck with fewer cards than the sample holds', () => {
    expect(
      checkSampleDeck({ status: 200, cardCount: '7', body: zip }, 8)
    ).toEqual(['sample conversion: 7 cards, expected 8']);
  });

  it('fails a body that is not an apkg zip', () => {
    expect(
      checkSampleDeck(
        { status: 200, cardCount: '8', body: Buffer.from('<html>') },
        8
      )
    ).toEqual(['sample conversion: response is not an .apkg (zip) file']);
  });

  it('fails a non-200 conversion', () => {
    expect(
      checkSampleDeck(
        { status: 500, cardCount: null, body: Buffer.from('{}') },
        8
      )
    ).toEqual(['sample conversion: HTTP 500, expected 200']);
  });
});
