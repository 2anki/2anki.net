import { routedAwayFromClaude } from './routedAwayFromClaude';

describe('routedAwayFromClaude', () => {
  it.each([
    'deck.apkg',
    'export.xml',
    'outline.opml',
    'map.brainstorms.json',
    'My Clippings.txt',
    'book.epub',
  ])('sends %s to its own converter', (name) => {
    expect(routedAwayFromClaude(name)).toBe(true);
  });

  it.each(['lecture.html', 'notes.md', 'slides.pdf', 'export.zip', 'a.txt'])(
    'leaves %s on the content path',
    (name) => {
      expect(routedAwayFromClaude(name)).toBe(false);
    }
  );
});
