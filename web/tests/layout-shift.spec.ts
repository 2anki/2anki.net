import { test, expect, type Page } from '@playwright/test';

/**
 * Layout shift on first load at desktop width. Two shifts were measured on
 * prod: the pass prices block arriving late in a short landing hero and
 * pushing the steps section down, and the footer jumping up into view on a
 * page shorter than the viewport once the loading skeleton left.
 */

test.use({ viewport: { width: 1440, height: 900 } });

const SLOW_API_MS = 600;

async function mockBackend(page: Page): Promise<void> {
  await page.route('**/api/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true }),
    })
  );
  await page.route('**/api/users/debug/locals**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ user: {}, locals: {}, features: {} }),
    })
  );
  await page.route('**/api/landing/config', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, SLOW_API_MS));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ showPassPrices: true }),
    });
  });
  await page.route('**/api/pricing', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, SLOW_API_MS));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        passes: {
          '24h': { amount: 600, currency: 'usd', display: '$6' },
          '7d': { amount: 1200, currency: 'usd', display: '$12' },
          '120d': { amount: 2900, currency: 'usd', display: '$29' },
        },
      }),
    });
  });
}

async function recordLayoutShifts(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const store = globalThis as unknown as { layoutShifts: string[] };
    store.layoutShifts = [];
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const shift = entry as unknown as {
          value: number;
          hadRecentInput: boolean;
          sources?: { node: Node | null }[];
        };
        if (shift.hadRecentInput || shift.value < 0.005) continue;
        const moved = (shift.sources ?? []).map(({ node }) => {
          const element = node instanceof Element ? node : node?.parentElement;
          return element == null
            ? 'removed node'
            : `${element.tagName.toLowerCase()}.${String(element.className)}`;
        });
        store.layoutShifts.push(
          `${shift.value.toFixed(3)} ${moved.join(', ')}`
        );
      }
    }).observe({ type: 'layout-shift', buffered: true });
  });
}

async function layoutShifts(page: Page): Promise<string[]> {
  return page.evaluate(
    () => (globalThis as unknown as { layoutShifts: string[] }).layoutShifts
  );
}

test('pass prices arriving late in a short landing hero move nothing', async ({
  page,
}) => {
  await mockBackend(page);
  await recordLayoutShifts(page);

  await page.goto('/convert/apkg-to-csv');

  await expect(
    page.getByRole('complementary', { name: /Need more than the free limit/ })
  ).toBeVisible();
  expect(await layoutShifts(page)).toEqual([]);
});

test('the footer stays below the fold on a page shorter than the viewport', async ({
  page,
}) => {
  await mockBackend(page);
  await recordLayoutShifts(page);

  await page.goto('/print');

  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  const footerTop = await page
    .locator('footer')
    .evaluate((footer) => footer.getBoundingClientRect().top);
  expect(footerTop).toBeGreaterThanOrEqual(900);
  expect(await layoutShifts(page)).toEqual([]);
});
