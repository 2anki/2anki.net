import { test, expect, type Page } from '@playwright/test';

test.use({ viewport: { width: 375, height: 812 } });

async function mockBackend(page: Page) {
  await page.route('**/api/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
  );
  await page.route('**/api/users/debug/locals**', (route) =>
    route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'Not authenticated' }),
    })
  );
}

test('a slide-like PDF asks what to make, then makes it at 375px', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await mockBackend(page);
  const sentFallbacks: string[] = [];
  await page.route('**/api/upload/file', async (route) => {
    const body = route.request().postDataBuffer()?.toString('latin1') ?? '';
    sentFallbacks.push(
      /name="pdf-fallback"\r\n\r\n([^\r]*)/.exec(body)?.[1] ?? '(none)'
    );
    if (sentFallbacks.length === 1) {
      await route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({
          code: 'choose_pdf_mode',
          reason: 'no_text',
          page_count: 14,
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/octet-stream',
      headers: { 'X-Card-Count': '14', 'X-Pdf-Fallback': 'single' },
      body: Buffer.from('fake-apkg'),
    });
  });

  await page.goto('/upload');
  await expect(page.locator('#upload-panel-local')).toBeVisible();
  await page.locator('#pakker').setInputFiles({
    name: 'slides.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4 fake'),
  });
  await expect(
    page.getByText("We can't tell questions from answers in this PDF")
  ).toBeVisible();
  await expect(page.getByText('Two pages per card')).toBeVisible();
  await expect(
    page.getByText('One card per page', { exact: true })
  ).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth
  );
  expect(overflow).toBe(false);

  await page
    .getByRole('button', { name: 'One card per page', exact: true })
    .click();

  await expect(page.getByText('14 cards')).toBeVisible({ timeout: 10_000 });
  await expect(
    page.getByText('Each page became 1 card, as a picture of the page.')
  ).toBeVisible();
  expect(sentFallbacks).toEqual(['ask', 'single']);
  expect(
    errors.filter((text) => !/status of (400|401|404|409)/.test(text))
  ).toEqual([]);
});
