import { mediaFilesForHtmlFile } from './mediaFilesForHtmlFile';

describe('mediaFilesForHtmlFile', () => {
  it('matches media under the Notion-style <base>/ folder', () => {
    const media = [
      'Export/Page abc123def456abc123def456abc12345/img.png',
      'Export/Other page 999999999999999999999999999999zz/other.png',
    ];
    const result = mediaFilesForHtmlFile(
      'Export/Page abc123def456abc123def456abc12345.html',
      media,
      [
        'Export/Page abc123def456abc123def456abc12345.html',
        'Export/Other page 999999999999999999999999999999zz.html',
      ]
    );
    expect(result).toEqual([
      'Export/Page abc123def456abc123def456abc12345/img.png',
    ]);
  });

  it('offers root-level images that belong to no HTML file (#3946)', () => {
    const media = ['images/photo.png', 'cover.jpg'];
    const result = mediaFilesForHtmlFile('Page.html', media, ['Page.html']);
    expect(result).toEqual(['images/photo.png', 'cover.jpg']);
  });

  it('offers unclaimed images to every HTML file, claimed ones to their own', () => {
    const media = ['A/one.png', 'shared/logo.png'];
    const htmlNames = ['A.html', 'B.html'];
    expect(mediaFilesForHtmlFile('A.html', media, htmlNames)).toEqual([
      'A/one.png',
      'shared/logo.png',
    ]);
    expect(mediaFilesForHtmlFile('B.html', media, htmlNames)).toEqual([
      'shared/logo.png',
    ]);
  });

  it('does not offer non-image unclaimed files as media', () => {
    const media = ['notes.docx', 'deck.pdf', 'images/fig.png'];
    const result = mediaFilesForHtmlFile('notes.docx.html', media, [
      'notes.docx.html',
    ]);
    expect(result).toEqual(['images/fig.png']);
  });

  it('normalizes backslash paths', () => {
    const media = ['Export\\Page\\img.png'];
    const result = mediaFilesForHtmlFile('Export\\Page.html', media, [
      'Export\\Page.html',
    ]);
    expect(result).toEqual(['Export\\Page\\img.png']);
  });
});
