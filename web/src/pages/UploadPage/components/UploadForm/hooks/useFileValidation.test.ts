import { zip } from 'fflate';
import { describe, it, expect } from 'vitest';
import {
  detectUploadIssues,
  detectMarkdownZipIssue,
} from './useFileValidation';

function fakeFile(name: string): File {
  return new File([''], name);
}

async function zipFile(
  name: string,
  entries: Record<string, Uint8Array>,
  sizeOverride?: number
): Promise<File> {
  const data = await new Promise<Uint8Array>((resolve, reject) => {
    zip(entries, { level: 0 }, (error, result) => {
      if (error != null) {
        reject(error);
        return;
      }
      resolve(result);
    });
  });
  const file = new File([data as BlobPart], name, { type: 'application/zip' });
  if (sizeOverride != null) {
    Object.defineProperty(file, 'size', { value: sizeOverride });
  }
  return file;
}

const bytes = new Uint8Array([1, 2, 3]);

describe('detectUploadIssues', () => {
  it('returns null for a zip file', () => {
    expect(detectUploadIssues([fakeFile('export.zip')])).toBeNull();
  });

  it('returns null for an empty file list', () => {
    expect(detectUploadIssues([])).toBeNull();
  });

  it('returns a dismissible warning for a single markdown file', () => {
    const result = detectUploadIssues([fakeFile('notes.md')]);
    expect(result).not.toBeNull();
    expect(result!.status).toBe('warning');
    expect(result!.code).toBe('markdown');
  });

  it('returns a warning for multiple markdown files', () => {
    const result = detectUploadIssues([
      fakeFile('page1.md'),
      fakeFile('page2.md'),
    ]);
    expect(result).not.toBeNull();
    expect(result!.status).toBe('warning');
    expect(result!.code).toBe('markdown');
  });

  it('is case-insensitive for markdown detection', () => {
    const result = detectUploadIssues([fakeFile('NOTES.MD')]);
    expect(result).not.toBeNull();
    expect(result!.status).toBe('warning');
  });

  it('resolves markdown copy through the translator when given one', () => {
    const result = detectUploadIssues(
      [fakeFile('notes.md')],
      false,
      (key) => `translated:${key}`
    );
    expect(result!.title).toBe('translated:upload.validation.markdown.title');
    expect(result!.body).toBe('translated:upload.validation.markdown.body');
    expect(result!.continueLabel).toBe('translated:upload.validation.continue');
  });

  it('returns warning for a single html file', () => {
    const result = detectUploadIssues([fakeFile('page.html')]);
    expect(result).not.toBeNull();
    expect(result!.status).toBe('warning');
    expect(result!.title.toLowerCase()).toContain('images');
  });

  it('returns warning for multiple html files', () => {
    const result = detectUploadIssues([
      fakeFile('page1.html'),
      fakeFile('page2.html'),
    ]);
    expect(result).not.toBeNull();
    expect(result!.status).toBe('warning');
    expect(result!.title).toContain('HTML');
  });

  it('returns null for csv files', () => {
    expect(detectUploadIssues([fakeFile('data.csv')])).toBeNull();
  });

  it('returns info for a single pdf file', () => {
    const result = detectUploadIssues([fakeFile('slides.pdf')]);
    expect(result).not.toBeNull();
    expect(result!.status).toBe('info');
    expect(result!.title).toContain('pair');
  });

  it('returns info for multiple pdf files', () => {
    const result = detectUploadIssues([
      fakeFile('chapter1.pdf'),
      fakeFile('chapter2.pdf'),
    ]);
    expect(result).not.toBeNull();
    expect(result!.status).toBe('info');
  });

  it('is case-insensitive for pdf detection', () => {
    const result = detectUploadIssues([fakeFile('NOTES.PDF')]);
    expect(result).not.toBeNull();
    expect(result!.status).toBe('info');
  });

  it('returns null for xlsx files', () => {
    expect(detectUploadIssues([fakeFile('sheet.xlsx')])).toBeNull();
  });

  it('returns null for mixed zip and html', () => {
    expect(
      detectUploadIssues([fakeFile('export.zip'), fakeFile('extra.html')])
    ).toBeNull();
  });

  it('provides a continue label for each state', () => {
    const md = detectUploadIssues([fakeFile('n.md')]);
    expect(md!.continueLabel.length).toBeGreaterThan(0);

    const pdf = detectUploadIssues([fakeFile('n.pdf')]);
    expect(pdf!.continueLabel.length).toBeGreaterThan(0);

    const html = detectUploadIssues([fakeFile('n.html')]);
    expect(html!.continueLabel.length).toBeGreaterThan(0);

    const safari = detectUploadIssues([fakeFile('a.html'), fakeFile('b.html')]);
    expect(safari!.continueLabel.length).toBeGreaterThan(0);
  });
});

describe('detectMarkdownZipIssue', () => {
  it('warns on a zip that holds markdown and no html', async () => {
    const file = await zipFile('export.zip', {
      'Export/Page.md': bytes,
      'Export/image.png': bytes,
    });
    const result = await detectMarkdownZipIssue([file]);
    expect(result).not.toBeNull();
    expect(result!.status).toBe('warning');
    expect(result!.code).toBe('markdown_zip');
    expect(result!.title).toBe('upload.validation.markdownZip.title');
  });

  it('stays quiet for a zip mixing markdown and html', async () => {
    const file = await zipFile('export.zip', {
      'Export/Page.md': bytes,
      'Export/Page.html': bytes,
    });
    expect(await detectMarkdownZipIssue([file])).toBeNull();
  });

  it('stays quiet for a pure-csv zip', async () => {
    const file = await zipFile('export.zip', {
      'data/rows.csv': bytes,
      'data/more.csv': bytes,
    });
    expect(await detectMarkdownZipIssue([file])).toBeNull();
  });

  it('skips the peek and stays quiet for an oversized zip', async () => {
    const file = await zipFile(
      'export.zip',
      { 'Export/Page.md': bytes },
      250 * 1024 * 1024
    );
    expect(await detectMarkdownZipIssue([file])).toBeNull();
  });

  it('ignores non-zip files', async () => {
    expect(await detectMarkdownZipIssue([fakeFile('notes.md')])).toBeNull();
  });

  it('resolves zip copy through the translator when given one', async () => {
    const file = await zipFile('export.zip', { 'Export/Page.md': bytes });
    const result = await detectMarkdownZipIssue(
      [file],
      (key) => `translated:${key}`
    );
    expect(result!.title).toBe(
      'translated:upload.validation.markdownZip.title'
    );
  });
});
