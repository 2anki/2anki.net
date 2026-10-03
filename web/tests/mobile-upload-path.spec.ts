import { test, expect, type Page } from '@playwright/test';

test.use({ viewport: { width: 375, height: 812 } });

function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));
  return errors;
}

const IGNORED = ['hotjar', 'youtube', 'favicon', 'failed to load resource'];
function realErrors(errors: string[]): string[] {
  return errors.filter((e) => !IGNORED.some((n) => e.toLowerCase().includes(n)));
}

async function noOverflow(page: Page, label: string): Promise<void> {
  const w = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(w, `no horizontal overflow at 375px (${label})`).toBeLessThanOrEqual(
    376
  );
}

async function mockBackend(page: Page): Promise<void> {
  await page.route('**/api/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true }),
    })
  );
  await page.route('**/api/upload/mine**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  );
  await page.route('**/api/upload/jobs**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  );
  await page.route('**/api/users/debug/locals**', (route) =>
    route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'Not authenticated' }),
    })
  );
}

const FILES = [
  { name: 'notes.txt', mimeType: 'text/plain', guardrail: false },
  { name: 'notes.pdf', mimeType: 'application/pdf', guardrail: true },
  { name: 'export.zip', mimeType: 'application/zip', guardrail: false },
];

for (const f of FILES) {
  test(`walk upload path at 375px for ${f.name}`, async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await mockBackend(page);
    await page.route('**/api/upload/file', async (route) => {
      await new Promise((r) => setTimeout(r, 400));
      await route.fulfill({
        status: 200,
        contentType: 'application/octet-stream',
        headers: { 'X-Card-Count': '12' },
        body: Buffer.from('fake-apkg'),
      });
    });

    await page.goto('/upload');
    await expect(page.locator('#upload-panel-local')).toBeVisible();
    await noOverflow(page, 'idle');

    await page.setInputFiles('#pakker', {
      name: f.name,
      mimeType: f.mimeType,
      buffer: Buffer.from('some content for ' + f.name),
    });

    if (f.guardrail) {
      const cont = page.getByRole('button', {
        name: 'Make cards from this PDF',
        exact: true,
      });
      await expect(cont).toBeVisible();
      await noOverflow(page, 'guardrail');
      await cont.click();
    }

    await expect(page.getByText('12 cards')).toBeVisible({ timeout: 10_000 });
    await noOverflow(page, 'success');
    expect(realErrors(errors)).toEqual([]);
  });
}

test('a thin PDF deck shows the few-cards notice at 375px', async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await mockBackend(page);
  await page.route('**/api/upload/file', async (route) => {
    await new Promise((r) => setTimeout(r, 300));
    await route.fulfill({
      status: 200,
      contentType: 'application/octet-stream',
      headers: { 'X-Card-Count': '2' },
      body: Buffer.from('fake-apkg'),
    });
  });

  await page.goto('/upload');
  await expect(page.locator('#upload-panel-local')).toBeVisible();

  await page.setInputFiles('#pakker', {
    name: 'notes.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('thin pdf'),
  });

  const cont = page.getByRole('button', {
    name: 'Make cards from this PDF',
    exact: true,
  });
  await expect(cont).toBeVisible();
  await cont.click();

  await expect(
    page.getByText(
      'Only 2 cards came from this file. Claude can write more cards from it on a paid plan.'
    )
  ).toBeVisible({ timeout: 10_000 });
  await noOverflow(page, 'thin-deck-notice');
  expect(realErrors(errors)).toEqual([]);
});

test('backgrounding then a dropped connection surfaces a retry at 375px', async ({
  page,
}) => {
  const errors = collectConsoleErrors(page);
  await mockBackend(page);
  let firstAttempt = true;
  await page.route('**/api/upload/file', async (route) => {
    if (firstAttempt) {
      firstAttempt = false;
      await new Promise((r) => setTimeout(r, 300));
      await route.abort('connectionaborted');
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/octet-stream',
      headers: { 'X-Card-Count': '7' },
      body: Buffer.from('fake-apkg'),
    });
  });

  await page.goto('/upload');
  await expect(page.locator('#upload-panel-local')).toBeVisible();

  await page.setInputFiles('#pakker', {
    name: 'export.zip',
    mimeType: 'application/zip',
    buffer: Buffer.from('zip bytes'),
  });

  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', {
      value: 'hidden',
      configurable: true,
    });
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('pagehide'));
  });

  const retry = page.getByRole('button', { name: 'Try again', exact: true });
  await expect(retry).toBeVisible({ timeout: 10_000 });
  await noOverflow(page, 'network-error');

  await retry.click();
  await expect(page.getByText('7 cards')).toBeVisible({ timeout: 10_000 });
  expect(realErrors(errors)).toEqual([]);
});

test('a tab discarded mid-upload recovers the file on reload at 375px', async ({
  page,
}) => {
  const errors = collectConsoleErrors(page);
  await mockBackend(page);
  await page.route('**/api/upload/file', async () => {
    await new Promise((r) => setTimeout(r, 30_000));
  });

  await page.goto('/upload');
  await expect(page.locator('#upload-panel-local')).toBeVisible();

  await page.setInputFiles('#pakker', {
    name: 'lecture-notes.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('text content'),
  });

  await expect(page.getByText('Making your deck')).toBeVisible({
    timeout: 10_000,
  });

  await page.reload();

  const banner = page.getByText('Re-attach');
  await expect(banner).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('lecture-notes.txt')).toBeVisible();
  await noOverflow(page, 'reattach-banner');
  expect(realErrors(errors)).toEqual([]);
});
