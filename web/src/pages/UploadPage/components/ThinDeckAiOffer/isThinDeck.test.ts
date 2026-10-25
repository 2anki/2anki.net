import { describe, expect, it } from 'vitest';
import { isPreviewableFile, isThinDeck } from './isThinDeck';

describe('isThinDeck', () => {
  it.each([
    [1, 'notes.pdf', 1000],
    [2, 'notes.txt', null],
    [2, 'page.html', 50],
  ])('flags %i cards from %s as thin', (cards, name, size) => {
    expect(isThinDeck(cards, name, size)).toBe(true);
  });

  it('flags a handful of cards from a long PDF', () => {
    expect(isThinDeck(6, 'lecture.pdf', 900 * 1024)).toBe(true);
  });

  it('flags a handful of cards from a long text file', () => {
    expect(isThinDeck(5, 'chapter.md', 60 * 1024)).toBe(true);
  });

  it('does not flag a handful of cards from a short file', () => {
    expect(isThinDeck(5, 'short.pdf', 40 * 1024)).toBe(false);
  });

  it('does not flag a healthy deck even from a long file', () => {
    expect(isThinDeck(40, 'lecture.pdf', 900 * 1024)).toBe(false);
  });

  it('does not flag an empty or unknown count', () => {
    expect(isThinDeck(0, 'notes.pdf', 1000)).toBe(false);
    expect(isThinDeck(null, 'notes.pdf', 1000)).toBe(false);
  });

  it('skips file types the preview cannot read', () => {
    expect(isThinDeck(1, 'slides.pptx', 5_000_000)).toBe(false);
    expect(isThinDeck(1, 'notes.docx', 5_000_000)).toBe(false);
  });

  it('skips a Kindle clippings file', () => {
    expect(isThinDeck(1, 'My Clippings.txt', 1000)).toBe(false);
  });

  it('recognises previewable names', () => {
    expect(isPreviewableFile('a.PDF')).toBe(true);
    expect(isPreviewableFile('a.apkg')).toBe(false);
  });
});
