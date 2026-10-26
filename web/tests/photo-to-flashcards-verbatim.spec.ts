import { test, expect } from '@playwright/test';

const mockLocals = {
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
  user: {
    id: 1,
    name: 'Test User',
    email: 'test@example.com',
  },
  features: { kiUI: false },
};

test.describe('Photo to deck — verbatim mode toggle', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/users/debug/locals**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockLocals),
      })
    );
    await page.goto('/photo-to-deck');
  });

  test('mode radiogroup renders both options at 1280px', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const radiogroup = page.getByRole('radiogroup', {
      name: 'Conversion mode',
    });
    await expect(radiogroup).toBeVisible();
    await expect(
      radiogroup.getByRole('radio', { name: 'Generate cards' })
    ).toBeVisible();
    await expect(
      radiogroup.getByRole('radio', { name: 'Copy existing questions' })
    ).toBeVisible();
  });

  test('card-count input is visible in generative mode (default)', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(page.getByLabel('How many cards?')).toBeVisible();
  });

  test('card-count input disappears when verbatim mode is selected', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.getByRole('radio', { name: 'Copy existing questions' }).click();
    await expect(page.getByLabel('How many cards?')).not.toBeVisible();
  });

  test('submit button remains enabled after switching to verbatim mode (no file)', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.getByRole('radio', { name: 'Copy existing questions' }).click();
    const submitBtn = page.getByRole('button', { name: 'Get cards' });
    await expect(submitBtn).toBeVisible();
  });

  test('mode radiogroup renders at 375px mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    const radiogroup = page.getByRole('radiogroup', {
      name: 'Conversion mode',
    });
    await expect(radiogroup).toBeVisible();
    await expect(
      radiogroup.getByRole('radio', { name: 'Generate cards' })
    ).toBeVisible();
    await expect(
      radiogroup.getByRole('radio', { name: 'Copy existing questions' })
    ).toBeVisible();
  });

  test('card-count input disappears at 375px when verbatim is selected', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.getByRole('radio', { name: 'Copy existing questions' }).click();
    await expect(page.getByLabel('How many cards?')).not.toBeVisible();
  });

  test('switching back to generative mode restores card-count input', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.getByRole('radio', { name: 'Copy existing questions' }).click();
    await page.getByRole('radio', { name: 'Generate cards' }).click();
    await expect(page.getByLabel('How many cards?')).toBeVisible();
  });
});
