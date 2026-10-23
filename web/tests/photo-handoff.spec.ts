import { test, expect, type Page } from '@playwright/test';
import { zipSync } from 'fflate';

test.use({ viewport: { width: 375, height: 812 } });

// 1x1 transparent PNG, so the photo previews decode.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64'
);

async function mockBackend(page: Page) {
  await page.route('**/api/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
  );
  await page.route('**/api/users/debug/locals**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        user: { id: 7 },
        locals: { owner: 7, patreon: false, subscriber: false },
        linked_email: '',
      }),
    })
  );
  await page.route('**/api/upload/file', (route) =>
    route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({
        code: 'image_only_no_text',
        message: 'This upload holds only images.',
      }),
    })
  );
}

test('photos in an uploaded zip arrive in Photo to Deck without unzipping', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  let photoDeckCalls = 0;
  await mockBackend(page);
  await page.route('**/api/image-occlusion/photo-to-deck', (route) => {
    photoDeckCalls += 1;
    return route.fulfill({ status: 500, body: '' });
  });

  await page.goto('/upload');
  await expect(page.locator('#upload-panel-local')).toBeVisible();
  await page.locator('#pakker').setInputFiles({
    name: 'slides.zip',
    mimeType: 'application/zip',
    buffer: Buffer.from(
      zipSync({ 'slides/01.png': PNG, 'slides/02.png': PNG })
    ),
  });

  await page
    .getByRole('button', { name: 'Open Photo to Deck', exact: true })
    .click();

  await expect(page).toHaveURL(/\/photo-to-deck/);
  await expect(page.locator('img[src^="blob:"]')).toHaveCount(2);
  expect(photoDeckCalls).toBe(0);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth
  );
  expect(overflow).toBe(false);
  expect(
    errors.filter((text) => !/status of (400|401|404)/.test(text))
  ).toEqual([]);
});
