import { test, expect } from '@playwright/test';

/**
 * Regression check for #4466 ("format-pill overlay blocks file-input click
 * at 375px"). Investigation: the #pakker file input is hidden via
 * `clip: rect(0,0,0,0)`, which also makes it a non-hit-testable target in
 * Chromium — clicking it *directly* (what the original Playwright repro
 * did) always gets intercepted by whatever paints at its nominal box,
 * regardless of position. That's a limitation of testing the hidden input
 * directly, not a real defect: clicking any VISIBLE content inside the
 * wrapping <label for="pakker"> (the format pills included) still opens
 * the native file chooser via the browser's label click-forwarding, which
 * doesn't depend on the input's own hit box. This test locks in that real
 * path at the 375px width the original report used.
 */

test.use({ viewport: { width: 375, height: 812 } });

async function mockBackend(page: import('@playwright/test').Page) {
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
}

test.describe('Upload dropzone @golden', () => {
  test('clicking a format pill opens the file chooser at 375px', async ({
    page,
  }) => {
    await mockBackend(page);
    await page.goto('/upload');

    const pill = page
      .locator('#upload-panel-local')
      .getByText('My Clippings.txt', { exact: true });
    const fileChooserPromise = page.waitForEvent('filechooser');
    await pill.click();
    await expect(fileChooserPromise).resolves.toBeTruthy();
  });
});
