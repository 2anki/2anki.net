import { test, expect, type Page } from '@playwright/test';

test.use({ viewport: { width: 375, height: 812 } });

async function mockBackend(page: Page) {
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
        user: { id: 7 },
        locals: { owner: 7, patreon: false, subscriber: false },
        linked_email: '',
        freePrintAvailable: true,
      }),
    })
  );
  await page.route('**/api/upload/file', (route) =>
    route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({
        code: 'unsupported_format',
        message:
          "This zip contains an Anki package, so it's already an Anki deck. 2anki converts source files like Notion HTML exports, not existing decks.",
      }),
    })
  );
}

test('a deck saved as .zip goes from Upload to a print preview without picking it again', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await mockBackend(page);
  let previewedName: string | null = null;
  await page.route('**/api/apkg/pdf/preview', async (route) => {
    const body = route.request().postDataBuffer()?.toString('latin1') ?? '';
    previewedName = /filename="([^"]+)"/.exec(body)?.[1] ?? null;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ image: null, totalCards: 0, previewedCards: 0 }),
    });
  });

  await page.goto('/upload');
  await expect(page.locator('#upload-panel-local')).toBeVisible();
  await page.locator('#pakker').setInputFiles({
    name: 'Biology.zip',
    mimeType: 'application/zip',
    buffer: Buffer.from('PK'),
  });

  await page
    .getByRole('button', { name: 'Print it as a PDF', exact: true })
    .click();

  await expect(page).toHaveURL(/\/print/);
  await expect.poll(() => previewedName).toBe('Biology.zip');
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth
  );
  expect(overflow).toBe(false);
  expect(
    errors.filter((text) => !/status of (400|401|404)/.test(text))
  ).toEqual([]);
});
