import path from 'node:path';
import { toSrc } from './pageImageSrc';

describe('toSrc', () => {
  it.each([
    ['50% done.pdf-page1-1.png', '50%25%20done.pdf-page1-1.png'],
    ['Cell "Biology".pdf-page1-1.png', 'Cell%20%22Biology%22.pdf-page1-1.png'],
    ['Lecture%203.pdf-page1-1.png', 'Lecture%25203.pdf-page1-1.png'],
  ])('encodes %s so decoding gives the name back', (fileName, src) => {
    const workspace = path.join('/ws');
    const imagePath = path.join(workspace, 'pdf-abc', fileName);

    expect(toSrc(imagePath, workspace)).toBe(`pdf-abc/${src}`);
    expect(decodeURIComponent(src)).toBe(fileName);
  });

  it('uses the file name alone when there is no workspace', () => {
    expect(toSrc('/ws/pdf-abc/a b.png')).toBe('a%20b.png');
  });

  it('writes a lone surrogate the way Node writes it to disk', () => {
    expect(toSrc('/ws/Lecture \uD800.png')).toBe('Lecture%20%EF%BF%BD.png');
  });
});
