import { test, expect, type Page } from '@playwright/test';

test.use({ viewport: { width: 375, height: 812 } });

async function mockSignedOutBackend(page: Page) {
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
  await page.route('**/api/download/recover/**', (route) =>
    route.fulfill({ status: 404, body: '' })
  );
}

function pendingUploadSaved(page: Page): Promise<boolean> {
  return page.evaluate(async () => {
    const names = (await indexedDB.databases()).map((db) => db.name);
    if (!names.includes('2anki-pending-upload')) return false;
    return new Promise<boolean>((resolve) => {
      const open = indexedDB.open('2anki-pending-upload');
      open.onsuccess = () => {
        const db = open.result;
        if (!db.objectStoreNames.contains('upload')) {
          db.close();
          resolve(false);
          return;
        }
        const get = db
          .transaction('upload', 'readonly')
          .objectStore('upload')
          .get('current');
        get.onsuccess = () => {
          db.close();
          resolve(get.result != null);
        };
      };
      open.onerror = () => resolve(false);
    });
  });
}

test.describe('Upload resume after a reload', () => {
  test('continues a file that was still uploading when the page reloaded', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await mockSignedOutBackend(page);

    let answerUploads = false;
    let uploadedName: string | null = null;
    await page.route('**/api/upload/file', async (route) => {
      if (!answerUploads) {
        // Hold the first upload open: the page reloads while it is in flight.
        await new Promise(() => {});
        return;
      }
      const body = route.request().postDataBuffer()?.toString('latin1') ?? '';
      uploadedName = /filename="([^"]+)"/.exec(body)?.[1] ?? null;
      await route.fulfill({
        status: 200,
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Disposition': 'attachment; filename="lecture.apkg"',
          'X-Card-Count': '1',
          'File-Name': 'lecture.apkg',
        },
        body: 'APKG',
      });
    });

    await page.goto('/upload');
    await expect(page.locator('#upload-panel-local')).toBeVisible();
    await page.locator('#pakker').setInputFiles({
      name: 'lecture.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('Mitochondria :: makes ATP\n'),
    });

    await expect.poll(() => pendingUploadSaved(page)).toBe(true);
    answerUploads = true;
    await page.reload();
    await expect(page.locator('#upload-panel-local')).toBeVisible();
    await expect(
      page.getByText("lecture.txt didn't finish uploading.")
    ).toBeVisible();
    await page.getByRole('button', { name: 'Continue' }).click();

    await expect.poll(() => uploadedName).toBe('lecture.txt');
    await expect(
      page.getByText("lecture.txt didn't finish uploading.")
    ).toBeHidden();
    expect(errors.filter((text) => !/status of (401|404)/.test(text))).toEqual(
      []
    );
  });
});
