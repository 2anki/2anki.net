import puppeteer, { TimeoutError } from 'puppeteer';
import PdfRenderService, { PdfRenderTimeoutError } from './PdfRenderService';

jest.mock('puppeteer', () => {
  class TimeoutError extends Error {}
  return {
    __esModule: true,
    default: { launch: jest.fn() },
    TimeoutError,
  };
});

const launchMock = puppeteer.launch as unknown as jest.Mock;

function stubBrowser(page: Record<string, jest.Mock>) {
  const close = jest.fn().mockResolvedValue(undefined);
  launchMock.mockResolvedValue({
    newPage: jest.fn().mockResolvedValue(page),
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
      setContent: jest.fn().mockResolvedValue(undefined),
      waitForFunction: jest.fn().mockRejectedValue(new TimeoutError('30000ms')),
      pdf: jest.fn(),
    });

    const error = await renderError();

    expect(error).toBeInstanceOf(PdfRenderTimeoutError);
    expect(error).toMatchObject({ name: 'PdfRenderTimeoutError' });
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('throws PdfRenderTimeoutError when page.pdf times out', async () => {
    stubBrowser({
      setContent: jest.fn().mockResolvedValue(undefined),
      waitForFunction: jest.fn().mockResolvedValue(true),
      pdf: jest.fn().mockRejectedValue(new TimeoutError('30000ms')),
    });

    const error = await renderError();

    expect(error).toBeInstanceOf(PdfRenderTimeoutError);
    expect(error).toMatchObject({ name: 'PdfRenderTimeoutError' });
  });

  it('throws PdfRenderTimeoutError when loading the page times out', async () => {
    stubBrowser({
      setContent: jest.fn().mockRejectedValue(new TimeoutError('30000ms')),
      waitForFunction: jest.fn(),
      pdf: jest.fn(),
    });

    const error = await renderError();

    expect(error).toBeInstanceOf(PdfRenderTimeoutError);
    expect(error).toMatchObject({ name: 'PdfRenderTimeoutError' });
  });

  it('leaves other render failures untouched', async () => {
    const boom = new Error('Protocol error: target closed');
    stubBrowser({
      setContent: jest.fn().mockResolvedValue(undefined),
      waitForFunction: jest.fn().mockRejectedValue(boom),
      pdf: jest.fn(),
    });

    expect(await renderError()).toBe(boom);
  });
});
