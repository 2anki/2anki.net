import { setupTests } from '../../test/configure-jest';
import { getRelevantFiles } from './getRelevantFiles';

beforeEach(() => setupTests());

test('matches image files when HTML has Notion ID but image folder does not', () => {
  const htmlName = 'Shared/My Topic ab12cd34ef56ab12cd34ef56ab12cd34.html';
  const allFiles = [
    { name: htmlName, contents: '<html></html>' },
    {
      name: 'Shared/My Topic/screenshot_1.png',
      contents: 'fake-image',
    },
    {
      name: 'Shared/My Topic/image.png',
      contents: 'fake-image',
    },
    { name: 'Other Page/unrelated.png', contents: 'fake-image' },
  ];

  const result = getRelevantFiles(htmlName, allFiles);

  expect(result.length).toBe(3);
  expect(result.map((f) => f.name)).toContain(htmlName);
  expect(result.map((f) => f.name)).toContain(
    'Shared/My Topic/screenshot_1.png'
  );
  expect(result.map((f) => f.name)).toContain('Shared/My Topic/image.png');
  expect(result.map((f) => f.name)).not.toContain('Other Page/unrelated.png');
});

test('still works when HTML has no Notion ID', () => {
  const htmlName = 'My Deck.html';
  const allFiles = [
    { name: htmlName, contents: '<html></html>' },
    { name: 'My Deck/image.png', contents: 'fake' },
  ];

  const result = getRelevantFiles(htmlName, allFiles);

  expect(result.length).toBe(2);
});

test('includes sibling image files for markdown in flat zip structure', () => {
  const mdName = 'Arealentwicklung 33f3ff2470bd80bb90f4e6cee34619a9.md';
  const allFiles = [
    { name: mdName, contents: '# Title' },
    { name: 'image.png', contents: 'fake-image' },
    { name: 'image 1.png', contents: 'fake-image' },
  ];

  const result = getRelevantFiles(mdName, allFiles);

  expect(result.length).toBe(3);
});

test('does not treat extensionless root entries as sibling images', () => {
  const mdName = 'Notes.md';
  const allFiles = [
    { name: mdName, contents: '# Title' },
    { name: 'image.png', contents: 'fake-image' },
    { name: 'photo.webp', contents: 'fake-image' },
    { name: '0', contents: 'binary' },
    { name: 'media', contents: '{}' },
  ];

  const result = getRelevantFiles(mdName, allFiles);

  expect(result.map((f) => f.name)).toEqual([
    mdName,
    'image.png',
    'photo.webp',
  ]);
});
