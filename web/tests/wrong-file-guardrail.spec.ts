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

test('a saved link to a Notion page offers the Notion route', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  const requested: string[] = [];
  page.on('request', (request) => requested.push(request.url()));
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
    name: 'Biology.url',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from(
      '[InternetShortcut]\r\nURL=https://www.notion.so/Biology-13ad6043d0164833bcc33d2a60ed6dcc\r\n'
    ),
  });

  const panel = page.locator('#upload-panel-local');
  await expect(
    panel.getByText('That is a link to a Notion page')
  ).toBeVisible();
  const notionLink = panel.getByRole('link', { name: 'Convert from Notion' });
  await expect(notionLink).toBeVisible();
  await expect(notionLink).toHaveAttribute('href', '/notion');
  await expect(
    page.getByRole('button', { name: 'Convert anyway' })
  ).toHaveCount(0);
  expect(uploads).toBe(0);
  expect(requested.some((url) => url.includes('notion.so'))).toBe(false);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth
  );
  expect(overflow).toBe(false);
  expect(
    errors.filter((e) => !/favicon|Failed to load resource/.test(e))
  ).toEqual([]);

  const colors = () =>
    notionLink.evaluate((element) => {
      const style = getComputedStyle(element);
      return { text: style.color, background: style.backgroundColor };
    });
  const resting = await colors();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('DOM.enable');
  await cdp.send('CSS.enable');
  const { root } = await cdp.send('DOM.getDocument');
  const { nodeId } = await cdp.send('DOM.querySelector', {
    nodeId: root.nodeId,
    selector: '#upload-panel-local a[href="/notion"]',
  });
  await cdp.send('CSS.forcePseudoState', {
    nodeId,
    forcedPseudoClasses: ['hover'],
  });
  await expect
    .poll(async () => (await colors()).background)
    .not.toBe(resting.background);
  await page.waitForTimeout(300);
  const hovered = await colors();
  expect(hovered.text).not.toBe(hovered.background);
  await cdp.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: [] });

  let pickerOpened = false;
  page.on('filechooser', () => {
    pickerOpened = true;
  });
  await notionLink.click();
  await expect(page).toHaveURL(/notion/);
  expect(pickerOpened).toBe(false);
});

test('a link or button styled as the primary action keeps its label visible on hover', async ({
  page,
}) => {
  await page.route('**/api/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
  );
  await page.goto('/upload');
  await page.locator('#pakker').setInputFiles({
    name: 'Biology.url',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from(
      '[InternetShortcut]\r\nURL=https://www.notion.so/Biology-1\r\n'
    ),
  });
  const notionLink = page.getByRole('link', { name: 'Convert from Notion' });
  await expect(notionLink).toBeVisible();
  await page.evaluate(
    (className) => {
      const host = document.createElement('div');
      host.id = 'primary-action-probes';
      const anchor = document.createElement('a');
      anchor.id = 'probe-anchor';
      anchor.href = '/download/ws-1/bulk';
      anchor.className = className;
      anchor.textContent = 'Download all (zip)';
      const button = document.createElement('button');
      button.id = 'probe-button';
      button.type = 'button';
      button.className = className;
      button.textContent = 'Try again';
      host.append(anchor, button);
      document.body.append(host);
    },
    (await notionLink.getAttribute('class')) ?? ''
  );

  const cdp = await page.context().newCDPSession(page);
  await cdp.send('DOM.enable');
  await cdp.send('CSS.enable');
  const { root } = await cdp.send('DOM.getDocument');
  for (const selector of ['#probe-anchor', '#probe-button']) {
    const probe = page.locator(selector);
    const colors = () =>
      probe.evaluate((element) => {
        const style = getComputedStyle(element);
        return { text: style.color, background: style.backgroundColor };
      });
    const resting = await colors();
    const { nodeId } = await cdp.send('DOM.querySelector', {
      nodeId: root.nodeId,
      selector,
    });
    await cdp.send('CSS.forcePseudoState', {
      nodeId,
      forcedPseudoClasses: ['hover'],
    });
    await expect
      .poll(async () => (await colors()).background)
      .not.toBe(resting.background);
    await page.waitForTimeout(300);
    const hovered = await colors();
    expect(hovered.text).toBe(resting.text);
    expect(hovered.text).not.toBe(hovered.background);
  }
});

test('an icon file is named as an icon, not study material', async ({
  page,
}) => {
  await page.route('**/api/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
  );

  await page.goto('/upload');
  await expect(page.locator('#upload-panel-local')).toBeVisible();
  await page.locator('#pakker').setInputFiles({
    name: 'favicon.ico',
    mimeType: 'image/x-icon',
    buffer: Buffer.from([0, 0, 1, 0]),
  });

  const panel = page.locator('#upload-panel-local');
  await expect(
    panel.getByText('That is an icon, not your notes')
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Convert anyway' })
  ).toHaveCount(0);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth
  );
  expect(overflow).toBe(false);
});
