import { test, expect } from '@playwright/test';

const REQUIRED_SCRIPT_SRC_ORIGINS = [
  'https://accounts.google.com',
  'https://apis.google.com',
];

test.describe('CSP smoke: Google origins stay allowlisted', () => {
  test('script-src in index.html allows both accounts.google.com and apis.google.com', async ({
    page,
  }) => {
    const cspViolations: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() !== 'error') return;
      const text = msg.text();
      if (
        text.includes('Content Security Policy') ||
        text.includes('Refused to load')
      ) {
        cspViolations.push(text);
      }
    });

    await page.goto('/');

    const cspContent = await page
      .locator('meta[http-equiv="Content-Security-Policy"]')
      .first()
      .getAttribute('content');

    expect(
      cspContent,
      'meta[http-equiv="Content-Security-Policy"] must be present in web/index.html'
    ).not.toBeNull();

    const scriptSrcMatch = cspContent?.match(/script-src([^;]+)/);
    expect(
      scriptSrcMatch,
      'CSP must include a script-src directive — none was found'
    ).not.toBeNull();
    const scriptSrc = scriptSrcMatch?.[1] ?? '';

    for (const origin of REQUIRED_SCRIPT_SRC_ORIGINS) {
      expect(
        scriptSrc,
        `CSP script-src is missing ${origin}. ` +
          'PR #2306 added the Google Drive picker which loads ' +
          'apis.google.com/js/api.js and accounts.google.com/gsi/client. ' +
          'Both must stay in script-src or Google sign-in and Drive Picker ' +
          'silently break. If you intentionally removed one, also update ' +
          'this test and the matching code paths.'
      ).toContain(origin);
    }

    const offending = cspViolations.filter((text) =>
      REQUIRED_SCRIPT_SRC_ORIGINS.some((origin) =>
        text.includes(origin.replace('https://', ''))
      )
    );
    expect(
      offending,
      `Unexpected CSP violations for Google origins:\n${offending.join('\n')}`
    ).toEqual([]);
  });
});
