import { vi, type Mock } from 'vitest';
import puppeteer, { TimeoutError } from 'puppeteer';
import PdfRenderService, { PdfRenderTimeoutError } from './PdfRenderService';

vi.mock('puppeteer', () => {
  class TimeoutError extends Error {}
  return {
    __esModule: true,
    default: { launch: vi.fn() },
    TimeoutError,
  };
});

const launchMock = puppeteer.launch as unknown as Mock;

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

describe('PdfRenderService timeouts', () => {
  beforeEach(() => {
    launchMock.mockReset();
  });

  it('throws PdfRenderTimeoutError when the MathJax wait times out', async () => {
    const close = stubBrowser({
      setContent: vi.fn().mockResolvedValue(undefined),
      waitForFunction: vi.fn().mockRejectedValue(new TimeoutError('30000ms')),
      pdf: vi.fn(),
    });

    const error = await renderError();

    expect(error).toBeInstanceOf(PdfRenderTimeoutError);
    expect(error).toMatchObject({ name: 'PdfRenderTimeoutError' });
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('throws PdfRenderTimeoutError when page.pdf times out', async () => {
    stubBrowser({
      setContent: vi.fn().mockResolvedValue(undefined),
      waitForFunction: vi.fn().mockResolvedValue(true),
      pdf: vi.fn().mockRejectedValue(new TimeoutError('30000ms')),
    });

    const error = await renderError();

    expect(error).toBeInstanceOf(PdfRenderTimeoutError);
    expect(error).toMatchObject({ name: 'PdfRenderTimeoutError' });
  });

  it('throws PdfRenderTimeoutError when loading the page times out', async () => {
    stubBrowser({
      setContent: vi.fn().mockRejectedValue(new TimeoutError('30000ms')),
      waitForFunction: vi.fn(),
      pdf: vi.fn(),
    });

    const error = await renderError();

    expect(error).toBeInstanceOf(PdfRenderTimeoutError);
    expect(error).toMatchObject({ name: 'PdfRenderTimeoutError' });
  });

  it('leaves other render failures untouched', async () => {
    const boom = new Error('Protocol error: target closed');
    stubBrowser({
      setContent: vi.fn().mockResolvedValue(undefined),
      waitForFunction: vi.fn().mockRejectedValue(boom),
      pdf: vi.fn(),
    });

    expect(await renderError()).toBe(boom);
  });
});
