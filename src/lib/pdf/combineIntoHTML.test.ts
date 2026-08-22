import * as cheerio from 'cheerio';
import { combineIntoHTML } from './combineIntoHTML';

const imgSrcs = (html: string): string[] => {
  const $ = cheerio.load(html);
  const srcs: string[] = [];
  $('img[src]').each((_, el) => {
    srcs.push($(el).attr('src') ?? '');
  });
  return srcs;
};

const toggleCount = (html: string): number =>
  cheerio.load(html)('details').length;

describe('combineIntoHTML', () => {
  it('keeps the only page of a one-page document', () => {
    const html = combineIntoHTML(['/ws/doc.pdf-page1-1.png'], 'doc.pdf', '/ws');

    expect(imgSrcs(html)).toEqual(['doc.pdf-page1-1.png']);
    expect(toggleCount(html)).toBe(1);
  });

  it('keeps the odd last page of a three-page document', () => {
    const html = combineIntoHTML(
      [
        '/ws/doc.pdf-page1-1.png',
        '/ws/doc.pdf-page2-2.png',
        '/ws/doc.pdf-page3-3.png',
      ],
      'doc.pdf',
      '/ws'
    );

    expect(imgSrcs(html)).toEqual([
      'doc.pdf-page1-1.png',
      'doc.pdf-page2-2.png',
      'doc.pdf-page3-3.png',
    ]);
    expect(toggleCount(html)).toBe(2);
  });

  it('pairs an even page count into front/back toggles unchanged', () => {
    const html = combineIntoHTML(
      ['/ws/doc.pdf-page1-1.png', '/ws/doc.pdf-page2-2.png'],
      'doc.pdf',
      '/ws'
    );

    const $ = cheerio.load(html);
    expect(toggleCount(html)).toBe(1);
    expect($('summary img').attr('src')).toBe('doc.pdf-page1-1.png');
    expect($('details > img').attr('src')).toBe('doc.pdf-page2-2.png');
  });

  it('falls back to basenames when no workspace location is given', () => {
    const html = combineIntoHTML(['/elsewhere/doc.pdf-page1-1.png'], 'doc.pdf');

    expect(imgSrcs(html)).toEqual(['doc.pdf-page1-1.png']);
  });
});
