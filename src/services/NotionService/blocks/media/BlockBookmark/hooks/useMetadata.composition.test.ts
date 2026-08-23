import fs from 'fs';
import path from 'path';

/**
 * Guards #4205: every metascraper-* package exports a rule FACTORY that must
 * be CALLED. Passing the factory itself makes metascraper key its output on
 * the module's helper exports (createFavicon, pickBiggerSize, ...) and
 * bookmark previews silently lose title/description/image. The real packages
 * cannot run under jest (ESM-only dependency chain — they are stubbed via
 * moduleNameMapper), which is exactly how the regression shipped green, so
 * this suite pins the contract at the source and stub level instead.
 */
describe('metascraper composition', () => {
  it('every metascraper rule package in useMetadata is invoked as a factory', () => {
    const source = fs.readFileSync(
      path.join(__dirname, 'useMetadata.ts'),
      'utf8'
    );
    const requires = source.match(/require\('metascraper-[a-z-]+'\)\(?\)?/g);
    expect(requires?.length).toBeGreaterThanOrEqual(5);
    for (const call of requires ?? []) {
      expect(call.endsWith(')()')).toBe(true);
    }
  });

  it('the jest stub keeps the factory shape of the real packages', () => {
    const plugin = require('metascraper-title');
    expect(typeof plugin).toBe('function');
    expect(typeof plugin()).toBe('object');
  });
});
