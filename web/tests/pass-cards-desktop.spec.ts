import { test, expect, type Locator, type Page } from '@playwright/test';

/**
 * Pass and plan cards at desktop width. Narrow pass cards (desktop /limit, beside
 * the sidebar) push the title below the badge, and every card pins its button
 * row to the bottom, so a card with no benefit list leaves no gap and buttons in
 * one row line up. The 375px golden path never reaches these widths.
 */

test.use({ viewport: { width: 1280, height: 900 } });

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

function passCard(page: Page, title: string): Locator {
  return page
    .getByRole('heading', { level: 3, name: title, exact: true })
    .locator('xpath=ancestor::div[.//button][1]');
}

async function expectBadgeClearOfTitle(
  page: Page,
  title: string,
  badge: string
) {
  const card = passCard(page, title);
  const titleBox = await card
    .getByRole('heading', { level: 3, name: title, exact: true })
    .evaluate((heading) => {
      const range = document.createRange();
      range.selectNodeContents(heading);
      const rect = range.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    });
  const badgeBox = await card.getByText(badge, { exact: true }).boundingBox();
  expect(titleBox).not.toBeNull();
  expect(badgeBox).not.toBeNull();
  if (titleBox == null || badgeBox == null) return;
  const overlaps =
    badgeBox.x < titleBox.x + titleBox.width &&
    titleBox.x < badgeBox.x + badgeBox.width &&
    badgeBox.y < titleBox.y + titleBox.height &&
    titleBox.y < badgeBox.y + badgeBox.height;
  expect(overlaps, `${badge} badge overlaps the ${title} title`).toBe(false);
}

async function waitForCards(page: Page) {
  await expect(
    page.getByRole('button', { name: /^Get Day Pass · / })
  ).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(800);
}

test('signed-in /limit keeps pass badges clear of titles and lines up the buttons', async ({
  page,
}) => {
  const errors = collectConsoleErrors(page);
  await mockBackend(page, true);

  await page.goto('/limit');
  await waitForCards(page);

  await expectBadgeClearOfTitle(page, 'Day Pass', 'Most popular');
  await expectBadgeClearOfTitle(page, 'Semester Pass', 'Best value');
  const tops = await Promise.all(
    [/^Get Day Pass · /, /^Get Week Pass · /, /^Get Semester Pass · /].map(
      async (name) =>
        (await page.getByRole('button', { name }).boundingBox())?.y ?? -1
    )
  );
  expect(Math.max(...tops) - Math.min(...tops)).toBeLessThanOrEqual(24);
  expect(realErrors(errors)).toEqual([]);
});

test('/pricing keeps pass badges clear of titles', async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await mockBackend(page, false);

  await page.goto('/pricing');
  await waitForCards(page);

  await expectBadgeClearOfTitle(page, 'Day Pass', 'Most popular');
  await expectBadgeClearOfTitle(page, 'Semester Pass', 'Best value');
  expect(realErrors(errors)).toEqual([]);
});

test('/notion-marketplace plan cards keep their buttons inside the card', async ({
  page,
}) => {
  const errors = collectConsoleErrors(page);
  await mockBackend(page, true);

  await page.goto('/notion-marketplace');
  const dayPassHeading = page.getByRole('heading', {
    level: 3,
    name: 'Day Pass',
    exact: true,
  });
  await expect(dayPassHeading).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(800);

  for (const title of ['Pro', 'Day Pass']) {
    const heading = page.getByRole('heading', {
      level: 3,
      name: title,
      exact: true,
    });
    const card = heading.locator('xpath=ancestor::div[.//a][1]');
    const cardBox = await card.boundingBox();
    const linkBox = await card.getByRole('link').last().boundingBox();
    expect(cardBox).not.toBeNull();
    expect(linkBox).not.toBeNull();
    if (cardBox == null || linkBox == null) continue;
    expect(linkBox.y + linkBox.height).toBeLessThanOrEqual(
      cardBox.y + cardBox.height
    );
    expect(linkBox.y).toBeGreaterThan(cardBox.y);
  }
  expect(realErrors(errors)).toEqual([]);
});
