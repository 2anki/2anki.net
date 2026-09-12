import { logFileLabel, summarizeFileNames } from './logFileLabel';

describe('logFileLabel', () => {
  it('keeps the extension and a stable hash, never the name', () => {
    const label = logFileLabel('Immunology Week 3/Screenshot 2026-09-08.PNG');
    expect(label).toMatch(/^png:[0-9a-f]{8}$/);
    expect(label).not.toContain('Immunology');
    expect(logFileLabel('Immunology Week 3/Screenshot 2026-09-08.PNG')).toBe(
      label
    );
  });

  it('labels extensionless and dotted-folder names as none', () => {
    expect(logFileLabel('media')).toMatch(/^none:/);
    expect(logFileLabel('v1.2/README')).toMatch(/^none:/);
  });
});

describe('summarizeFileNames', () => {
  it('reports counts per extension and a bounded sample', () => {
    const names = Array.from({ length: 12 }, (_, i) => `${i}`).concat([
      'Anatomy.html',
      'Anatomy/img.png',
    ]);
    const summary = summarizeFileNames(names);
    expect(summary.count).toBe(14);
    expect(summary.extensions).toEqual({ none: 12, html: 1, png: 1 });
    expect(summary.sample).toHaveLength(5);
    expect(JSON.stringify(summary)).not.toContain('Anatomy');
  });
});
