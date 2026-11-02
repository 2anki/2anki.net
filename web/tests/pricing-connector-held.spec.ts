import { test, expect, type Page } from '@playwright/test';

/**
 * The plans page a connector links to when it saved a deck on the account.
 * Walked at 375px, signed in and signed out, plus a link whose date has
 * passed, with the backend mocked at the network edge.
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

async function mockBackend(page: Page, signedIn: boolean): Promise<void> {
  await page.route('**/api/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true }),
    })
  );
  await page.route('**/api/users/debug/locals**', (route) =>
    signedIn
      ? route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            locals: { owner: 1, patreon: false, subscriber: false },
            user: { id: 1, name: 'Test User', email: 'test@example.com' },
            features: {},
          }),
        })
      : route.fulfill({
          status: 401,
          contentType: 'application/json',
          body: JSON.stringify({ message: 'Not authenticated' }),
        })
  );
}

function isoDay(offsetDays: number): string {
  const day = new Date();
  day.setUTCDate(day.getUTCDate() + offsetDays);
  return day.toISOString().slice(0, 10);
}

function longDay(iso: string): string {
  return new Intl.DateTimeFormat('en', {
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(`${iso}T00:00:00Z`));
}

async function openPricing(page: Page, heldUntil: string) {
  await page.goto(`/pricing?ref=mcp&held_until=${heldUntil}`);
  await expect(
    page.getByRole('button', { name: /^Get Day Pass · / })
  ).toBeVisible({ timeout: 10_000 });
}

async function expectNoSideScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

test('signed in, a saved deck shows the date and no "wasn\'t made" intro', async ({
  page,
}) => {
  const errors = collectConsoleErrors(page);
  await mockBackend(page, true);
  const heldUntil = isoDay(7);

  await openPricing(page, heldUntil);

  await expect(
    page.getByText(
      `is saved on your 2anki account until ${longDay(heldUntil)}. Any plan below unlocks the full deck`
    )
  ).toBeVisible();
  await expect(page.getByText(/wasn't made/)).toHaveCount(0);
  await expectNoSideScroll(page);
  expect(realErrors(errors)).toEqual([]);
});

test('signed out, a saved deck asks to sign in and a pass click goes to sign in first', async ({
  page,
}) => {
  const errors = collectConsoleErrors(page);
  await mockBackend(page, false);
  const heldUntil = isoDay(7);

  await openPricing(page, heldUntil);

  await expect(
    page.getByText(
      `is saved on your 2anki account until ${longDay(heldUntil)}. Sign in with the account you connected`
    )
  ).toBeVisible();
  await expectNoSideScroll(page);

  await page.getByRole('button', { name: /^Get Day Pass · / }).click();

  await expect(page).toHaveURL(
    `/login?redirect=${encodeURIComponent(`/pricing?ref=mcp&held_until=${heldUntil}`)}`
  );
  expect(realErrors(errors)).toEqual([]);
});

test('a link whose date has passed shows the plain connector intro', async ({
  page,
}) => {
  const errors = collectConsoleErrors(page);
  await mockBackend(page, false);

  await openPricing(page, isoDay(-2));

  await expect(page.getByText(/so it wasn't made/)).toBeVisible();
  await expect(page.getByText(/is saved on your 2anki account/)).toHaveCount(
    0
  );
  expect(realErrors(errors)).toEqual([]);
});
