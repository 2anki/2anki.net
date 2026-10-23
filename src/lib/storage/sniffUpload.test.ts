import { nameFromContent } from './sniffUpload';

const text = (value: string) => Buffer.from(value, 'utf-8');

describe('nameFromContent', () => {
  it.each([
    ['notes.zip (1)', Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0]), 'zip'],
    ['Bio.Chapter5', text('%PDF-1.7 rest'), 'pdf'],
    ['Bio.Chapter5', text('{\\rtf1\\ansi hello}'), 'rtf'],
    ['lecture', text('first line\nsecond line'), 'txt'],
  ])('reads %s by its first bytes', (name, contents, extension) => {
    expect(nameFromContent(name, contents)).toBe(`${name}.${extension}`);
  });

  it('tells a Word file from a plain zip by the parts inside', () => {
    const docx = Buffer.concat([
      Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      text('[Content_Types].xml word/document.xml'),
    ]);
    expect(nameFromContent('thesis', docx)).toBe('thesis.docx');
  });

  it('tells a spreadsheet and a slide deck apart', () => {
    const zip = (part: string) =>
      Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), text(part)]);
    expect(nameFromContent('a', zip('xl/workbook.xml'))).toBe('a.xlsx');
    expect(nameFromContent('a', zip('ppt/presentation.xml'))).toBe('a.pptx');
  });

  it.each([
    ['notes.text', 'notes.txt'],
    ['notes.markdown', 'notes.md'],
  ])('treats %s as an alias without reading it', (name, expected) => {
    expect(nameFromContent(name, Buffer.alloc(0))).toBe(expected);
  });

  it('leaves a file with a known extension alone, even if its bytes differ', () => {
    expect(nameFromContent('deck.pdf', text('plain text'))).toBe('deck.pdf');
  });

  it('leaves shortcut and icon files with their own answer', () => {
    expect(nameFromContent('link.url', text('[InternetShortcut]'))).toBe(
      'link.url'
    );
  });

  it("keeps today's answer for a binary file with no known header", () => {
    expect(nameFromContent('mystery', Buffer.from([0, 1, 2, 3, 255]))).toBe(
      'mystery'
    );
  });

  it('keeps text whose last character is cut mid-way', () => {
    const cut = text('héllo wörld ').subarray(0, 12);
    expect(
      nameFromContent('cut', Buffer.concat([cut, text('é').subarray(0, 1)]))
    ).toBe('cut.txt');
  });
});
