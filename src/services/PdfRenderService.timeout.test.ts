import { vi, type Mock } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import puppeteer, { ProtocolError, TimeoutError } from 'puppeteer';
import type { HTTPRequest } from 'puppeteer';
import PdfRenderService, {
  PDF_TOO_BIG_MESSAGE,
  PdfRenderCrashedError,
  PdfRenderTimeoutError,
  guardLocalFiles,
  withConnectBlock,
  isBrowserGoneError,
} from './PdfRenderService';

vi.mock('puppeteer', () => {
  class TimeoutError extends Error {}
  class ProtocolError extends Error {}
  return {
    __esModule: true,
    default: { launch: vi.fn() },
    TimeoutError,
    ProtocolError,
  };
});

const launchMock = puppeteer.launch as unknown as Mock;

function stubPage(overrides: Record<string, Mock> = {}): Record<string, Mock> {
  return {
    setRequestInterception: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
    goto: vi.fn().mockResolvedValue(null),
    waitForFunction: vi.fn().mockResolvedValue(true),
    pdf: vi.fn().mockResolvedValue(new Uint8Array([37, 80, 68, 70])),
    ...overrides,
  };
}

function stubBrowser(page: Record<string, Mock>) {
  const close = vi.fn().mockResolvedValue(undefined);
  launchMock.mockResolvedValue({
    newPage: vi.fn().mockResolvedValue(page),
    close,
  });
  return close;
}

function renderError(): Promise<unknown> {
  return new PdfRenderService().renderHtml('<p>x</p>').then(
    () => undefined,
    (error: unknown) => error
  );
}

function gotoPath(page: Record<string, Mock>): string {
  return fileURLToPath(page.goto.mock.calls[0][0] as string);
}

describe('PdfRenderService timeouts', () => {
  beforeEach(() => {
    launchMock.mockReset();
  });

  it('throws PdfRenderTimeoutError when the MathJax wait times out', async () => {
    const close = stubBrowser(
      stubPage({
        waitForFunction: vi.fn().mockRejectedValue(new TimeoutError('30000ms')),
      })
    );

    const error = await renderError();

    expect(error).toBeInstanceOf(PdfRenderTimeoutError);
    expect(error).toMatchObject({ name: 'PdfRenderTimeoutError' });
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('throws PdfRenderTimeoutError when page.pdf times out', async () => {
    stubBrowser(
      stubPage({ pdf: vi.fn().mockRejectedValue(new TimeoutError('30000ms')) })
    );

    const error = await renderError();

    expect(error).toBeInstanceOf(PdfRenderTimeoutError);
  });

  it('throws PdfRenderTimeoutError when loading the page times out', async () => {
    stubBrowser(
      stubPage({ goto: vi.fn().mockRejectedValue(new TimeoutError('30000ms')) })
    );

    expect(await renderError()).toBeInstanceOf(PdfRenderTimeoutError);
  });

  it('throws PdfRenderTimeoutError when a DevTools call hits protocolTimeout', async () => {
    stubBrowser(
      stubPage({
        pdf: vi
          .fn()
          .mockRejectedValue(
            new ProtocolError(
              "Page.printToPDF timed out. Increase the 'protocolTimeout' setting"
            )
          ),
      })
    );

    expect(await renderError()).toBeInstanceOf(PdfRenderTimeoutError);
  });

  it('leaves unrelated render failures untouched', async () => {
    const boom = new Error('boom');
    stubBrowser(stubPage({ waitForFunction: vi.fn().mockRejectedValue(boom) }));

    expect(await renderError()).toBe(boom);
  });
});

describe('PdfRenderService browser crashes', () => {
  beforeEach(() => {
    launchMock.mockReset();
  });

  function targetClosed(): Error {
    const error = new ProtocolError(
      'Protocol error (Page.setDocumentContent): Target closed'
    );
    error.name = 'TargetCloseError';
    return error;
  }

  it('maps a TargetCloseError during load to PdfRenderCrashedError', async () => {
    const cause = targetClosed();
    const close = stubBrowser(
      stubPage({ goto: vi.fn().mockRejectedValue(cause) })
    );

    const error = await renderError();

    expect(error).toBeInstanceOf(PdfRenderCrashedError);
    expect(error).toMatchObject({
      name: 'PdfRenderCrashedError',
      message: PDF_TOO_BIG_MESSAGE,
      cause,
    });
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('maps a closed connection during printing to PdfRenderCrashedError', async () => {
    stubBrowser(
      stubPage({
        pdf: vi.fn().mockRejectedValue(new Error('Connection closed.')),
      })
    );

    expect(await renderError()).toBeInstanceOf(PdfRenderCrashedError);
  });

  it.each([
    ['a ProtocolError', new ProtocolError('Protocol error (X): boom')],
    [
      'a TargetCloseError by name',
      Object.assign(new Error('x'), { name: 'TargetCloseError' }),
    ],
    ['a page crash', new Error('Page crashed!')],
    ['a disconnected browser', new Error('Browser has disconnected!')],
  ])('isBrowserGoneError recognises %s', (_label, error) => {
    expect(isBrowserGoneError(error)).toBe(true);
  });

  it.each([
    ['a plain error', new Error('boom')],
    ['a non-error', 'Target closed'],
  ])('isBrowserGoneError ignores %s', (_label, error) => {
    expect(isBrowserGoneError(error)).toBe(false);
  });
});

describe('PdfRenderService temp-file rendering', () => {
  beforeEach(() => {
    launchMock.mockReset();
  });

  it('navigates to the HTML written to disk instead of calling setContent', async () => {
    let seenHtml = '';
    let seenAsset: Buffer | null = null;
    const page = stubPage({
      goto: vi.fn().mockImplementation(async (url: string) => {
        const htmlPath = fileURLToPath(url);
        seenHtml = readFileSync(htmlPath, 'utf8');
        seenAsset = readFileSync(
          path.join(path.dirname(htmlPath), 'media-0.png')
        );
        return null;
      }),
    });
    stubBrowser(page);

    await new PdfRenderService().renderDocument({
      html: '<img src="media-0.png">',
      assets: new Map([['media-0.png', Buffer.from('png-bytes')]]),
    });

    expect(page.goto).toHaveBeenCalledWith(
      expect.stringMatching(/^file:\/\/.*\/index\.html$/),
      expect.objectContaining({ waitUntil: 'load' })
    );
    expect(seenHtml).toBe(withConnectBlock('<img src="media-0.png">'));
    expect(seenAsset).toEqual(Buffer.from('png-bytes'));
    expect(page.setRequestInterception).toHaveBeenCalledWith(true);
    expect(page.on).toHaveBeenCalledWith('request', expect.any(Function));
  });

  it('launches Chrome without relying on /dev/shm and with a protocol timeout', async () => {
    stubBrowser(stubPage());

    await new PdfRenderService().renderHtml('<p>x</p>');

    const launchOptions = launchMock.mock.calls[0][0];
    expect(launchOptions.args).toContain('--disable-dev-shm-usage');
    expect(launchOptions.protocolTimeout).toEqual(expect.any(Number));
  });

  it('removes the temp directory after a successful render', async () => {
    const page = stubPage();
    stubBrowser(page);

    await new PdfRenderService().renderHtml('<p>x</p>');

    expect(existsSync(path.dirname(gotoPath(page)))).toBe(false);
  });

  it('removes the temp directory when the render fails', async () => {
    const page = stubPage({
      goto: vi.fn().mockRejectedValue(new Error('boom')),
    });
    stubBrowser(page);

    await renderError();

    expect(existsSync(path.dirname(gotoPath(page)))).toBe(false);
  });

  it('refuses asset names that could escape the temp directory', async () => {
    stubBrowser(stubPage());

    await expect(
      new PdfRenderService().renderDocument({
        html: '',
        assets: new Map([['../escape.png', Buffer.from('x')]]),
      })
    ).rejects.toThrow('unsafe PDF asset name');
    expect(launchMock).not.toHaveBeenCalled();
  });
});

describe('withConnectBlock', () => {
  it('puts a connect-src none CSP first in the head', () => {
    const out = withConnectBlock(
      '<!DOCTYPE html><html><head><title>x</title></head><body></body></html>'
    );
    expect(out).toMatch(
      /^<!DOCTYPE html><html><head><meta http-equiv="Content-Security-Policy" content="connect-src 'none'"><title>/
    );
  });

  it('prepends the CSP when there is no head', () => {
    expect(withConnectBlock('<p>x</p>')).toBe(
      `<meta http-equiv="Content-Security-Policy" content="connect-src 'none'"><p>x</p>`
    );
  });
});

describe('guardLocalFiles', () => {
  function request(url: string) {
    return {
      url: () => url,
      abort: vi.fn().mockResolvedValue(undefined),
      continue: vi.fn().mockResolvedValue(undefined),
    };
  }

  const guard = guardLocalFiles('file:///tmp/2anki-pdf-abc/');

  it.each([
    'file:///tmp/2anki-pdf-abc/index.html',
    'file:///tmp/2anki-pdf-abc/media-3.jpg',
    'https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-chtml.js',
    'data:image/png;base64,AAAA',
    'about:blank',
    'FILE:///tmp/2anki-pdf-abc/media-1.png',
  ])('lets %s load', (url) => {
    const req = request(url);
    guard(req as unknown as HTTPRequest);
    expect(req.continue).toHaveBeenCalled();
    expect(req.abort).not.toHaveBeenCalled();
  });

  it.each([
    'file:///etc/hosts',
    'file:///tmp/2anki-pdf-other/index.html',
    'file:///tmp/2anki-pdf-abc',
    'FILE:///etc/hosts',
    'File:///tmp/2anki-pdf-other/index.html',
    'http://169.254.169.254/latest/meta-data/',
    'http://localhost:2020/api/users/debug/locals',
    'https://example.com/tracker.png',
    'https://cdn.jsdelivr.net/npm/evil@1/x.js',
    'ftp://example.com/file',
    'file:///tmp/2anki-pdf-ABC/index.html',
    'https://cdn.jsdelivr.net/npm/mathjax@3/../evil@1/x.js',
    'https://user@cdn.jsdelivr.net/npm/mathjax@3/es5/tex-chtml.js',
    'https://cdn.jsdelivr.net.evil.com/npm/mathjax@3/es5/tex-chtml.js',
    'not a url',
    'ws://attacker.example/x',
    'wss://attacker.example/x',
  ])('blocks %s', (url) => {
    const req = request(url);
    guard(req as unknown as HTTPRequest);
    expect(req.abort).toHaveBeenCalledWith('accessdenied');
    expect(req.continue).not.toHaveBeenCalled();
  });
});
