import { zip } from 'fflate';
import { describe, it, expect } from 'vitest';
import {
  detectUploadIssues,
  detectMarkdownZipIssue,
  detectInternetShortcutIssue,
  detectFileIssues,
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
      (key) => `translated:${key}`
    );
    expect(result!.title).toBe('translated:upload.validation.markdown.title');
    expect(result!.body).toBe('translated:upload.validation.markdown.body');
    expect(result!.continueLabel).toBe('translated:upload.validation.continue');
  });

  it('returns the single-html warning resolved through the translator', () => {
    const result = detectUploadIssues(
      [fakeFile('page.html')],
      (key) => `translated:${key}`
    );
    expect(result).toEqual({
      status: 'warning',
      title: 'translated:upload.validation.unbundledSingle.title',
      body: 'translated:upload.validation.unbundledSingle.body',
      continueLabel: 'translated:upload.validation.unbundledSingle.continue',
      code: 'unbundled_html',
    });
  });

  it('returns the unpacked-export warning for multiple html files', () => {
    const result = detectUploadIssues(
      [fakeFile('page1.html'), fakeFile('page2.html')],
      (key) => `translated:${key}`
    );
    expect(result).toEqual({
      status: 'warning',
      title: 'translated:upload.validation.unbundledMany.title',
      body: 'translated:upload.validation.unbundledMany.body',
      continueLabel: 'translated:upload.validation.unbundledMany.continue',
      code: 'unbundled_html',
    });
  });

  it('returns null for csv files', () => {
    expect(detectUploadIssues([fakeFile('data.csv')])).toBeNull();
  });

  it.each([
    [['slides.pdf']],
    [['chapter1.pdf', 'chapter2.pdf']],
    [['NOTES.PDF']],
  ])('returns null for pdf files %j', (names) => {
    expect(detectUploadIssues(names.map(fakeFile))).toBeNull();
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

describe('detectUploadIssues — files that are not the study material', () => {
  it.each([
    ['Notes.lnk', 'shortcut'],
    ['Page.url', 'internet_shortcut'],
    ['Notebook.goodnotes', 'goodnotes'],
    ['favicon.ico', 'icon'],
  ])('stops %s with a next step and no convert-anyway button', (name, code) => {
    const result = detectUploadIssues([fakeFile(name)]);
    expect(result).toMatchObject({ status: 'error', code, blocking: true });
  });

  it('lets a shortcut through when it comes with a real file', () => {
    expect(
      detectUploadIssues([fakeFile('Notes.lnk'), fakeFile('Notes.pdf')])
    ).toBeNull();
  });
});

describe('detectUploadIssues — icon files', () => {
  it('names an icon as an icon and points at the notes file', () => {
    const result = detectUploadIssues(
      [fakeFile('favicon.ico')],
      (key) => `translated:${key}`
    );
    expect(result).toEqual({
      status: 'error',
      title: 'translated:upload.validation.icon.title',
      body: 'translated:upload.validation.icon.body',
      continueLabel: '',
      code: 'icon',
      blocking: true,
    });
  });
});

function internetShortcut(name: string, url: string): File {
  return new File([`[InternetShortcut]\r\nURL=${url}\r\nIDList=\r\n`], name);
}

describe('detectInternetShortcutIssue', () => {
  it.each([
    'https://www.notion.so/Biology-13ad6043d0164833bcc33d2a60ed6dcc',
    'https://notion.so/workspace/Page-13ad6043d0164833bcc33d2a60ed6dcc',
    'https://beryl-jaguar-018.notion.site/Page-13ad6043d0164833bcc33d2a60ed6dcc',
  ])('offers the Notion route for a link to %s', async (url) => {
    const result = await detectInternetShortcutIssue(
      [internetShortcut('Biology.url', url)],
      (key) => `translated:${key}`
    );
    expect(result).toEqual({
      status: 'error',
      title: 'translated:upload.validation.internetShortcutNotion.title',
      body: 'translated:upload.validation.internetShortcutNotion.body',
      continueLabel: '',
      code: 'internet_shortcut_notion',
      blocking: true,
      actionLink: {
        label: 'translated:upload.validation.internetShortcutNotion.action',
        href: '/notion',
      },
    });
  });

  it('says a link to any other site is a link and names the formats', async () => {
    const result = await detectInternetShortcutIssue(
      [internetShortcut('Lecture.url', 'https://example.com/lecture-4.pdf')],
      (key) => `translated:${key}`
    );
    expect(result).toEqual({
      status: 'error',
      title: 'translated:upload.validation.internetShortcutLink.title',
      body: 'translated:upload.validation.internetShortcutLink.body',
      continueLabel: '',
      code: 'internet_shortcut_link',
      blocking: true,
    });
  });

  it('does not treat a look-alike host as Notion', async () => {
    const result = await detectInternetShortcutIssue([
      internetShortcut('Page.url', 'https://notion.so.example.com/page'),
    ]);
    expect(result?.code).toBe('internet_shortcut_link');
  });

  it.each([
    ['an empty file', ''],
    ['no URL line', '[InternetShortcut]\r\nIDList=\r\n'],
    ['a URL line that is not a link', '[InternetShortcut]\r\nURL=not a link'],
  ])('leaves %s to the plain shortcut message', async (_label, text) => {
    expect(
      await detectInternetShortcutIssue([new File([text], 'Page.url')])
    ).toBeNull();
  });

  it('skips reading a file too large to be a shortcut', async () => {
    const file = internetShortcut('Page.url', 'https://www.notion.so/Page');
    Object.defineProperty(file, 'size', { value: 2 * 1024 * 1024 });
    expect(await detectInternetShortcutIssue([file])).toBeNull();
  });

  it('ignores files that are not internet shortcuts', async () => {
    expect(
      await detectInternetShortcutIssue([
        new File(['URL=https://www.notion.so/Page'], 'notes.txt'),
      ])
    ).toBeNull();
  });

  it('stays quiet when a shortcut comes with a real file', async () => {
    expect(
      await detectInternetShortcutIssue([
        internetShortcut('Page.url', 'https://www.notion.so/Page'),
        fakeFile('Notes.pdf'),
      ])
    ).toBeNull();
  });
});

describe('detectFileIssues', () => {
  it('answers a Notion shortcut with the Notion route', async () => {
    const result = await detectFileIssues([
      internetShortcut('Page.url', 'https://www.notion.so/Page'),
    ]);
    expect(result?.code).toBe('internet_shortcut_notion');
  });

  it('keeps the plain shortcut message for an unreadable shortcut', async () => {
    const result = await detectFileIssues([fakeFile('Page.url')]);
    expect(result).toMatchObject({
      code: 'internet_shortcut',
      title: 'upload.validation.internetShortcut.title',
      blocking: true,
    });
  });

  it('lets a pdf through', async () => {
    expect(await detectFileIssues([fakeFile('Notes.pdf')])).toBeNull();
  });
});
