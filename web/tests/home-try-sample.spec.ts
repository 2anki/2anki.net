import { test, expect, type Page } from '@playwright/test';

/**
 * The hero "Try a sample" action lets a visitor with no file convert a bundled
 * sample deck. This drives that path at the 375px width the attestation gate
 * names, with the backend mocked at the network edge, and fails on any console
 * error or uncaught page error.
 */

test.use({ viewport: { width: 375, height: 812 } });

const IGNORED_CONSOLE = [
  'hotjar',
  'youtube',
  'favicon',
  'failed to load resource',
];

function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));
  return errors;
}

function realErrors(errors: string[]): string[] {
  return errors.filter(
    (e) => !IGNORED_CONSOLE.some((n) => e.toLowerCase().includes(n))
  );
}

async function mockBackend(page: Page) {
  await page.route('**/api/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({}),
    })
  );
  await page.route('**/api/users/debug/locals**', (route) =>
    route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'Not authenticated' }),
    })
  );
  await page.route('**/api/upload/sample', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/apkg',
      headers: {
        'X-Card-Count': '8',
        'Content-Disposition': 'attachment; filename="Sample deck.apkg"',
        'Access-Control-Expose-Headers': 'File-Name, X-Card-Count',
      },
      body: Buffer.from('FAKE-APKG'),
    })
  );
}

test.describe('Home try-a-sample @golden', () => {
  test('converts the bundled sample from the hero at 375px', async ({
    page,
  }) => {
    const errors = collectConsoleErrors(page);
    await mockBackend(page);
    await page.goto('/');

    await page
      .getByRole('button', { name: 'Try a sample', exact: true })
      .click();

    await expect(
      page.getByText('This is a sample deck. Convert your own file next.')
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Convert your own file', exact: true })
    ).toBeVisible();

    expect(realErrors(errors)).toEqual([]);
  });
});
