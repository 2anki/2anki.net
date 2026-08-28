import { test, expect, type Page } from '@playwright/test';

/**
 * Golden-path attestation spec.
 *
 * The browser-attestation merge gate (.claude/docs/browser-attestation.md)
 * asks every web/src change to confirm two things by hand: the golden path works
 * on localhost:3000, and there are no console errors at 375px. This spec makes
 * that confirmation a real run instead of an honor-system checkbox — it drives
 * the golden path at a 375px viewport with the backend mocked at the network
 * edge and fails on any console error or uncaught page error.
 *
 * Run it as the evidence behind the attestation checkboxes:
 *   pnpm --filter 2anki-web test:golden-path
 *
 * Deterministic: every /api/** call is fulfilled from a fixture, so no real
 * Notion/Stripe/backend and no secrets. Mocked at the edge per the testing
 * rules. It is intentionally NOT a merge blocker yet (see the rule's decision
 * note) — a flaky e2e must never wedge every web merge.
 */

// 375px — the width the attestation gate names.
test.use({ viewport: { width: 375, height: 812 } });

// Noise that is not our regression surface:
// - third-party widgets (hotjar, youtube, favicon)
// - "Failed to load resource: ... <status>" — a browser HTTP-status log, not an
//   app console.error. The anonymous landing legitimately gets 401 from the auth
//   probe (/api/users/debug/locals), which every real anon visitor hits too.
//   This sensor checks app JS health (render + no uncaught errors), not HTTP
//   status; a genuine app break still surfaces via pageerror or a real
//   console.error string.
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

const AUTHED_LOCALS = {
  locals: {
    owner: 1,
    patreon: false,
    subscriber: false,
    subscriptionInfo: {
      active: false,
      email: 'test@example.com',
      linked_email: 'test@example.com',
    },
  },
  linked_email: 'test@example.com',
  user: { id: 1, name: 'Test User', email: 'test@example.com' },
  features: {},
};

async function mockBackend(page: Page): Promise<void> {
  // Catch-all FIRST — Playwright matches routes in reverse registration order,
  // so specific mocks registered after this one take precedence (web/CLAUDE.md).
  await page.route('**/api/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true }),
    })
  );
  await page.route('**/api/upload/mine**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
    })
  );
  await page.route('**/api/upload/jobs**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
    })
  );
  await page.route('**/api/favorite/mine**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
    })
  );
}

test.describe('golden path @golden', () => {
  test('landing renders without console errors at 375px', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await mockBackend(page);
    await page.route('**/api/users/debug/locals**', (route) =>
      route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Not authenticated' }),
      })
    );

    await page.goto('/');

    await expect(page).toHaveTitle(/2anki/);
    const hero = page.locator('h1');
    await expect(hero).toBeVisible();
    await expect(hero).toContainText('Anki');

    await page.waitForLoadState('networkidle');
    expect(realErrors(errors)).toEqual([]);
  });

  test('signed-in dashboard renders without console errors at 375px', async ({
    page,
  }) => {
    const errors = collectConsoleErrors(page);
    await mockBackend(page);
    await page.route('**/api/users/debug/locals**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(AUTHED_LOCALS),
      })
    );

    await page.goto('/');

    await expect(page.locator('body')).toBeVisible({ timeout: 10_000 });
    await page.waitForLoadState('networkidle');
    expect(realErrors(errors)).toEqual([]);
  });
  test('account page for an active subscriber links the billing portal at 375px', async ({
    page,
  }) => {
    const errors = collectConsoleErrors(page);
    await mockBackend(page);
    await page.route('**/api/users/debug/locals**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ...AUTHED_LOCALS,
          locals: {
            ...AUTHED_LOCALS.locals,
            subscriber: true,
            planSource: 'stripe',
            subscriptionInfo: {
              active: true,
              email: 'test@example.com',
              linked_email: 'test@example.com',
            },
          },
        }),
      })
    );
    await page.route('**/api/users/subscription-status**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          subscriptions: [
            {
              id: 'sub_golden',
              status: 'active',
              created: 1_700_000_000,
              cancel_at_period_end: false,
              current_period_end: 1_893_456_000,
              cancel_at: null,
              canceled_at: null,
              paused_until: null,
              plan: { amount: 799, currency: 'usd', interval: 'month' },
            },
          ],
        }),
      })
    );

    await page.goto('/account');

    const portalLink = page.getByRole('link', {
      name: 'Update payment details',
    });
    await expect(portalLink).toBeVisible({ timeout: 10_000 });
    await expect(portalLink).toHaveAttribute('target', '_blank');
    await expect(
      page.getByRole('button', { name: 'Cancel subscription' })
    ).toBeVisible();
    expect(realErrors(errors)).toEqual([]);
  });

  test('account page for a past_due subscriber offers Update payment and Cancel at 375px', async ({
    page,
  }) => {
    const errors = collectConsoleErrors(page);
    await mockBackend(page);
    await page.route('**/api/users/debug/locals**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ...AUTHED_LOCALS,
          locals: {
            ...AUTHED_LOCALS.locals,
            subscriber: true,
            planSource: 'stripe',
            subscriptionInfo: {
              active: true,
              email: 'test@example.com',
              linked_email: 'test@example.com',
            },
          },
        }),
      })
    );
    await page.route('**/api/users/subscription-status**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          subscriptions: [
            {
              id: 'sub_past_due',
              status: 'past_due',
              created: 1_700_000_000,
              cancel_at_period_end: false,
              current_period_end: 1_893_456_000,
              cancel_at: null,
              canceled_at: null,
              paused_until: null,
              cancellation_reason: null,
              plan: { amount: 799, currency: 'usd', interval: 'month' },
            },
          ],
        }),
      })
    );

    await page.goto('/account');

    await expect(page.getByText("Your payment didn't go through")).toBeVisible({
      timeout: 10_000,
    });
    const portalLink = page.getByRole('link', {
      name: 'Update payment details',
    });
    await expect(portalLink).toBeVisible();
    await expect(portalLink).toHaveAttribute('target', '_blank');
    await expect(
      page.getByRole('button', { name: 'Cancel subscription' })
    ).toBeVisible();
    expect(realErrors(errors)).toEqual([]);
  });
});
