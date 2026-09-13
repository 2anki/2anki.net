import { estimatePromptedBytes } from './promptedBytes';

describe('estimatePromptedBytes', () => {
  it('counts HTML and Markdown text but not binary uploads', () => {
    const bytes = estimatePromptedBytes([
      { name: 'notes.html', contents: Buffer.alloc(1000) },
      { name: 'summary.md', contents: Buffer.alloc(500) },
      { name: 'scan.pdf', contents: Buffer.alloc(5_000_000) },
      { name: 'photo.png', contents: Buffer.alloc(3_000_000) },
    ]);
    expect(bytes).toBe(1500);
  });

  it('never refuses on a large binary file alone', () => {
    const bytes = estimatePromptedBytes([
      { name: 'huge.pdf', contents: Buffer.alloc(50_000_000) },
    ]);
    expect(bytes).toBe(0);
  });

  it('ignores files without contents', () => {
    const bytes = estimatePromptedBytes([
      { name: 'notes.html', contents: null },
      { name: 'more.html', contents: 'abcd' },
    ]);
    expect(bytes).toBe(4);
  });
});
