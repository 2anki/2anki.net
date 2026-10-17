import JSZip from 'jszip';

import { censusFromHtml, censusUploadedFile } from './documentStructureCensus';

async function minimalDocx(paragraphText: string): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`
  );
  zip.file(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`
  );
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body><w:p><w:r><w:t>${paragraphText}</w:t></w:r></w:p></w:body>
</w:document>`
  );
  return zip.generateAsync({ type: 'nodebuffer' });
}

describe('censusFromHtml', () => {
  it('counts headings, paragraphs, list items, tables, and toggles', () => {
    const html = `
      <h1>Chapter</h1>
      <h2>Section</h2>
      <p>One</p><p>Two</p>
      <ul><li>a</li><li>b</li><li>c</li></ul>
      <ol><li>d</li></ol>
      <table><tr><td>x</td></tr></table>
      <details><summary>t</summary>body</details>
    `;
    expect(censusFromHtml(html)).toEqual({
      chars: html.length,
      words: 11,
      headings: 2,
      paragraphs: 2,
      lists: 2,
      listItems: 4,
      tables: 1,
      toggles: 1,
      images: 0,
    });
  });

  it('returns zero counts for empty input', () => {
    expect(censusFromHtml('')).toEqual({
      chars: 0,
      words: 0,
      headings: 0,
      paragraphs: 0,
      lists: 0,
      listItems: 0,
      tables: 0,
      toggles: 0,
      images: 0,
    });
  });

  it('counts images', () => {
    const html = '<p><img src="a.png" /><img src="b.png" /></p>';
    expect(censusFromHtml(html).images).toBe(2);
  });

  it('counts visible words, not markup', () => {
    const html = '<h1>Cell  biology</h1><p>The <b>nucleus</b> holds DNA.</p>';
    expect(censusFromHtml(html).words).toBe(6);
  });
});

describe('censusUploadedFile', () => {
  it('censuses an HTML upload directly from its buffer', async () => {
    const html = '<h1>T</h1><ul><li>q</li><li>a</li></ul>';
    const census = await censusUploadedFile({
      originalname: 'page.html',
      buffer: Buffer.from(html),
    });
    expect(census).toMatchObject({ headings: 1, listItems: 2 });
  });

  it('converts a DOCX upload and censuses the resulting HTML', async () => {
    const docx = await minimalDocx('Docx body text');
    const census = await censusUploadedFile({
      originalname: 'notes.docx',
      buffer: docx,
    });
    expect(census).not.toBeNull();
    const doc = census as { paragraphs: number; chars: number };
    expect(doc.paragraphs).toBeGreaterThanOrEqual(1);
    expect(doc.chars).toBeGreaterThan(0);
  });

  it('returns null for an unreadable or binary non-docx file', async () => {
    const census = await censusUploadedFile({
      originalname: 'deck.apkg',
      buffer: Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00]),
    });
    expect(census).toBeNull();
  });
});

describe('censusUploadedFile — zip archives (#4029)', () => {
  const { zipSync, strToU8 } = require('fflate');

  function buildZip(entries: Record<string, Uint8Array>): Buffer {
    return Buffer.from(zipSync(entries));
  }

  it('drops macOS resource-fork entries from the census', async () => {
    const zip = buildZip({
      'Page abc.html': strToU8('<html></html>'),
      '__MACOSX/._Page abc.html': strToU8('meta'),
      'img/._photo.png': strToU8('meta'),
      'img/Thumbs.db': strToU8('meta'),
      '.DS_Store': strToU8('meta'),
      'img/photo.png': strToU8('png'),
    });
    const census = await censusUploadedFile({
      originalname: 'export.zip',
      buffer: zip,
    });
    expect(census).toMatchObject({
      kind: 'zip',
      entryCount: 2,
      supportedCount: 1,
      unsupportedCount: 1,
      imageCount: 1,
    });
  });

  it('returns an entry manifest with supported verdicts and nested-zip count', async () => {
    const inner = zipSync({ 'Inner Page abc.html': strToU8('<html></html>') });
    const zip = buildZip({
      'Private & Shared/Bony Page abc123.html': strToU8('<html></html>'),
      'Private & Shared/notes.pdf': strToU8('%PDF-1.4'),
      'ExportBlock-abc-Part-1.zip': inner,
      'assets/photo.png': strToU8('png-bytes'),
    });

    const census = await censusUploadedFile({
      originalname: 'workspace-export.zip',
      buffer: zip,
    });

    expect(census).toMatchObject({
      kind: 'zip',
      entryCount: 4,
      nestedZipCount: 1,
      supportedCount: 2,
      unsupportedCount: 1,
      imageCount: 1,
      truncated: false,
    });
    const entries = (
      census as { entries: { name: string; supported: boolean }[] }
    ).entries;
    expect(entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: expect.stringMatching(/^html:[0-9a-f]{8}$/),
          supported: true,
        }),
        expect.objectContaining({
          name: expect.stringMatching(/^png:[0-9a-f]{8}$/),
          supported: false,
        }),
      ])
    );
  });

  it('marks an unreadable zip instead of throwing', async () => {
    const census = await censusUploadedFile({
      originalname: 'corrupt.zip',
      buffer: Buffer.from('PK\x03\x04 not really a zip'),
    });
    expect(census).toMatchObject({ kind: 'zip', unreadable: true });
  });

  it('caps the manifest at 50 entries and flags truncation', async () => {
    const many: Record<string, Uint8Array> = {};
    for (let i = 0; i < 60; i++) {
      many[`page-${i}.html`] = strToU8('<html></html>');
    }
    const census = await censusUploadedFile({
      originalname: 'big.zip',
      buffer: buildZip(many),
    });
    expect(census).toMatchObject({
      kind: 'zip',
      entryCount: 60,
      truncated: true,
    });
    expect((census as { entries: unknown[] }).entries.length).toBe(50);
  });
});

describe('countWords through censusFromHtml', () => {
  it('counts decoded text and drops runs with no letter or digit', () => {
    expect(censusFromHtml('<p>a&nbsp;b &amp; c</p>').words).toBe(3);
    expect(censusFromHtml('<p>one two</p><br').words).toBe(2);
    expect(censusFromHtml('x < 5 and y < 7').words).toBe(5);
  });

  it('does not count the CSS a Notion export embeds', () => {
    const html =
      '<html><head><title>Page</title><style>.a { color: red; } .b { margin: 0 }</style></head><body><h1>Cells</h1><p>two words</p><script>var x = 1;</script><noscript>hidden</noscript><svg><text>label</text></svg></body></html>';
    expect(censusFromHtml(html).words).toBe(3);
  });

  it('counts each han, kana or hangul character as a word', () => {
    expect(
      censusFromHtml('<p>細胞生物学は細胞の構造を研究する学問です。</p>').words
    ).toBe(20);
    expect(censusFromHtml('<p>세포 생물학</p>').words).toBe(5);
  });

  it('counts a word written in astral letters', () => {
    expect(censusFromHtml('<p>\u{20000}\u{20001} \u{1D400}</p>').words).toBe(2);
  });

  it('keeps words apart across adjacent elements', () => {
    expect(censusFromHtml('<h1>Cell</h1><p>biology</p>').words).toBe(2);
  });

  it('finishes a long unbroken run without counting it as prose', () => {
    const html = '<p>' + '<'.repeat(2_000_000) + ' word</p>';
    expect(censusFromHtml(html).words).toBe(1);
  });

  it('stops scanning past the word budget', () => {
    const html = '<p>' + 'ab '.repeat(3_000_000) + '</p>';
    expect(censusFromHtml(html).words).toBe(1_747_627);
  });
});

describe('censusFromHtml on a Notion export fixture', () => {
  it('counts only the visible words of the page', async () => {
    const fs = await import('node:fs');
    const html = fs.readFileSync('src/test/fixtures/no-images.html', 'utf8');
    expect(censusFromHtml(html).words).toBe(12);
  });
});
