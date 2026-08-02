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
    expect(census!.paragraphs).toBeGreaterThanOrEqual(1);
    expect(census!.chars).toBeGreaterThan(0);
  });

  it('returns null for an unreadable or binary non-docx file', async () => {
    const census = await censusUploadedFile({
      originalname: 'deck.apkg',
      buffer: Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00]),
    });
    expect(census).toBeNull();
  });
});
