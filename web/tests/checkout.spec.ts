import { test, expect } from '@playwright/test';

const loggedInFreeLocals = {
  user: {
    id: 1,
    email: 'free@example.com',
    patreon: false,
    created_at: '2026-06-16T00:00:00Z',
  },
  locals: { owner: 1, patreon: false, subscriber: false },
  features: {},
  autoSyncCapReached: false,
  autoSyncActive: false,
};

const legacyPrices = {
  cohort: 'legacy',
  legacy: true,
  monthly: { cents: 600 },
  annual: { cents: 6000 },
  lockInDeadline: null,
};

const v2Prices = {
  cohort: 'v2',
  legacy: false,
  monthly: { cents: 799 },
  annual: { cents: 6400 },
  lockInDeadline: null,
};

const routePrices = (
  page: import('@playwright/test').Page,
  prices: typeof legacyPrices | typeof v2Prices
) =>
  page.route('**/api/checkout/prices', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(prices),
    })
  );

test.describe('Pro checkout', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/users/debug/locals**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(loggedInFreeLocals),
      })
    );
  });

  test('legacy prices show the monthly hero and no v2 numbers', async ({
    page,
  }) => {
    await routePrices(page, legacyPrices);
    await page.goto('/pricing');

    await expect(page.getByText('$6 billed today, then monthly')).toBeVisible();
    await expect(page.getByText('$5.33')).toBeHidden();
  });

  test('monthly is selected by default with the v2 monthly hero price', async ({
    page,
  }) => {
    await routePrices(page, v2Prices);
    await page.goto('/pricing');

    await expect(
      page.getByText('$7.99 billed today, then monthly')
    ).toBeVisible();
  });

  test('selecting yearly reveals the annual per-month upsell', async ({
    page,
  }) => {
    await routePrices(page, v2Prices);
    await page.goto('/pricing');

    await page.getByRole('radio', { name: /Yearly/ }).click();

    await expect(page.getByText('$5.33')).toBeVisible();
    await expect(
      page.getByText('$64 billed today, then yearly · save 33%')
    ).toBeVisible();
  });

  test('Get Pro starts a monthly checkout by default', async ({
    page,
  }) => {
    await routePrices(page, v2Prices);
    let checkoutBody: { interval?: string } = {};
    await page.route('**/api/checkout/unlimited', async (route) => {
      checkoutBody = JSON.parse(route.request().postData() ?? '{}');
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ url: 'https://checkout.stripe.com/c/pay/test' }),
      });
    });

    await page.goto('/pricing');
    await page
      .getByRole('button', { name: 'Get Pro — billed monthly' })
      .click();

    await expect.poll(() => checkoutBody.interval).toBe('month');
  });

  test('selecting yearly starts an annual checkout and redirects to Stripe', async ({
    page,
  }) => {
    await routePrices(page, v2Prices);
    let checkoutBody: { interval?: string } = {};
    await page.route('**/api/checkout/unlimited', async (route) => {
      checkoutBody = JSON.parse(route.request().postData() ?? '{}');
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ url: 'https://checkout.stripe.com/c/pay/test' }),
      });
    });

    await page.goto('/pricing');
    await page.getByRole('radio', { name: /Yearly/ }).click();
    await page
      .getByRole('button', { name: 'Get Pro — billed yearly' })
      .click();

    await expect.poll(() => checkoutBody.interval).toBe('year');
  });
});
