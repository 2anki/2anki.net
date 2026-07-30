import { expect, Page, test } from '@playwright/test';

type RouteSetup = {
  rules?: unknown;
  settings?: unknown;
  favorites?: unknown[];
};

async function setupMocks(page: Page, overrides: RouteSetup = {}) {
  const state = {
    rules: overrides.rules ?? null,
    settings: overrides.settings ?? null,
    favorites: overrides.favorites ?? [],
  };

  // Playwright matches routes in reverse registration order, so the catch-all
  // goes first and the specific handlers below override it.
  await page.route('**/api/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({}),
    })
  );

  await page.route('**/api/users/debug/locals**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        locals: { owner: 1, patreon: false, subscriber: false },
        user: { id: 1, name: 'Test User', email: 'test@example.com' },
        features: {},
      }),
    })
  );

  await page.route('**/api/settings/card-options**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
    })
  );

  await page.route('**/api/rules/find/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(state.rules),
    })
  );

  await page.route('**/api/rules/create/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true }),
    })
  );

  await page.route('**/api/settings/find/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(state.settings),
    })
  );

  await page.route('**/api/settings/create/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true }),
    })
  );

  await page.route('**/api/settings/list**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items: [] }),
    })
  );

  await page.route('**/api/favorite**', (route) => {
    const method = route.request().method();
    if (method === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(state.favorites),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true }),
    });
  });

  await page.route('**/api/notion/get-notion-link**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ isConnected: true, workspace: 'Test Workspace' }),
    })
  );
}

test.describe('RulesPage', () => {
  test.beforeEach(({ page }) => setupMocks(page));

  test('renders heading, back, favorite, and action buttons', async ({
    page,
  }) => {
    await page.goto(
      '/rules/page-1?title=My%20Notion%20Page&type=page&returnTo=/search'
    );

    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Rules for My Notion Page'
    );
    await expect(page.getByRole('button', { name: '← Back' })).toBeVisible();
    await expect(
      page.getByRole('button', { name: /Save changes/ })
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Favorite this page' })
    ).toBeVisible();
  });

  test('falls back to generic title when no title param is provided', async ({
    page,
  }) => {
    await page.goto('/rules/page-1');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Rules');
  });

  test('renders the grouped option cards', async ({ page }) => {
    await page.goto('/rules/page-1?title=My%20Page');

    await expect(
      page.getByRole('heading', { name: 'Decks and sub-decks' })
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Flashcards' })
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Tags and notifications' })
    ).toBeVisible();
  });

  test('Save changes posts to both rules and settings endpoints', async ({
    page,
  }) => {
    await page.goto('/rules/page-1?title=My%20Page&type=page');
    await page.getByRole('button', { name: /Save changes/ }).waitFor();

    const rulesSave = page.waitForRequest(
      (req) =>
        req.url().includes('/api/rules/create/page-1') &&
        req.method() === 'POST'
    );
    const settingsSave = page.waitForRequest(
      (req) =>
        req.url().includes('/api/settings/create/page-1') &&
        req.method() === 'POST'
    );

    await page.getByRole('button', { name: /Save changes/ }).click();

    const [rulesRequest, settingsRequest] = await Promise.all([
      rulesSave,
      settingsSave,
    ]);

    expect(rulesRequest.method()).toBe('POST');
    expect(settingsRequest.method()).toBe('POST');
  });

  test('Save changes navigates back to returnTo', async ({ page }) => {
    await page.goto(
      '/rules/page-1?title=My%20Page&type=page&returnTo=/notion?q=hello'
    );
    await page.getByRole('button', { name: /Save changes/ }).waitFor();

    await page.getByRole('button', { name: /Save changes/ }).click();

    await page.waitForURL('**/notion?q=hello');
    expect(page.url()).toContain('/notion?q=hello');
  });

  test('Back navigates to returnTo when there are no unsaved changes', async ({
    page,
  }) => {
    await page.goto('/rules/page-1?title=My%20Page&returnTo=/notion?q=notion');
    await page.getByRole('button', { name: '← Back' }).waitFor();

    await page.getByRole('button', { name: '← Back' }).click();

    await page.waitForURL('**/notion?q=notion');
    expect(page.url()).toContain('/notion?q=notion');
  });

  test('Back prompts confirm when rules are dirty; cancelling stays on page', async ({
    page,
  }) => {
    await page.goto('/rules/page-1?title=My%20Page&returnTo=/notion');
    await page.getByRole('button', { name: /Save changes/ }).waitFor();

    // Toggle a chip to make the page dirty. `toggle` appears in both the
    // Decks-and-sub-decks card and the Flashcards card, so scope the click
    // to the first matching chip.
    await page
      .getByRole('button', { name: 'toggle', exact: true })
      .first()
      .click();

    // Cancel the native confirm so we stay on the page.
    page.once('dialog', (dialog) => {
      expect(dialog.type()).toBe('confirm');
      expect(dialog.message()).toContain('unsaved');
      dialog.dismiss();
    });

    await page.getByRole('button', { name: '← Back' }).click();

    // Still on the rules page.
    await expect(page).toHaveURL(/\/rules\/page-1/);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  test('favorite toggle posts to favorite/create when not favorited', async ({
    page,
  }) => {
    await page.goto('/rules/page-1?title=My%20Page&type=page');
    await page.getByRole('button', { name: 'Favorite this page' }).waitFor();

    const favoriteCreate = page.waitForRequest(
      (req) =>
        req.url().includes('/api/favorite/create') && req.method() === 'POST'
    );

    await page.getByRole('button', { name: 'Favorite this page' }).click();
    await favoriteCreate;

    await expect(
      page.getByRole('button', { name: 'Remove from favorites' })
    ).toBeVisible();
  });
});

test.describe('CardOptionsPage', () => {
  test.beforeEach(({ page }) => setupMocks(page));

  test('renders header on the defaults view', async ({ page }) => {
    await page.goto('/card-options');

    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Settings'
    );
  });

  test('Back returns to the provided returnTo when supplied', async ({
    page,
  }) => {
    await page.goto(
      '/card-options?pageId=page-1&title=Any&returnTo=/rules/page-1'
    );
    await page.getByRole('button', { name: '← Back' }).waitFor();

    await page.getByRole('button', { name: '← Back' }).click();
    await page.waitForURL('**/rules/page-1');

    expect(page.url()).toContain('/rules/page-1');
  });
});
