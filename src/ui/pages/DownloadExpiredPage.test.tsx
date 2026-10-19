import { DownloadExpiredPage } from './DownloadExpiredPage';

const BANNED_PATTERNS = [/✅/, /❌/, /📦/, /📄/, /Success!/, /Awesome/, /!/];

describe('DownloadExpiredPage', () => {
  const html = DownloadExpiredPage();

  it('renders an HTML document with the expired title', () => {
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('<title>Download link expired · 2anki</title>');
  });

  it('states what happened and what to do next', () => {
    expect(html).toContain('This download link has expired');
    expect(html).toContain('Convert your file again to get a fresh link.');
  });

  it('links to convert a new file and to recent downloads', () => {
    expect(html).toContain('href="/upload"');
    expect(html).toContain('href="/downloads"');
  });

  it('is excluded from search indexing', () => {
    expect(html).toContain('name="robots"');
  });

  it('contains no banned content', () => {
    for (const pattern of BANNED_PATTERNS) {
      expect(html).not.toMatch(pattern);
    }
  });
});
