import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 375, height: 812 } });

test('a shortcut file gets a next step instead of a failed conversion', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  let uploads = 0;
  await page.route('**/api/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
  );
  await page.route('**/api/upload/file', (route) => {
    uploads += 1;
    return route.fulfill({ status: 500, body: '' });
  });

  await page.goto('/upload');
  await expect(page.locator('#upload-panel-local')).toBeVisible();
  await page.locator('#pakker').setInputFiles({
    name: 'Biology.lnk',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from('shortcut'),
  });

  const panel = page.locator('#upload-panel-local');
  await expect(
    panel.getByText('That is a shortcut, not the file')
  ).toBeVisible();
  await expect(panel.getByText(/Choose the file it points to/)).toBeVisible();
  await expect(
    panel.getByRole('button', { name: 'Pick a different file', exact: true })
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Convert anyway' })
  ).toHaveCount(0);
  expect(uploads).toBe(0);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth
  );
  expect(overflow).toBe(false);
  expect(
    errors.filter((e) => !/favicon|Failed to load resource/.test(e))
  ).toEqual([]);
});
