import puppeteer, { TimeoutError } from 'puppeteer';
import type { PdfOptions } from '../usecases/apkg/ExportApkgToPdfUseCase';

const PDF_TIMEOUT_MS = 30_000;
const MATHJAX_SETTLE_MS = 2_000;

const MARGIN_VALUES: Record<string, string> = {
  narrow: '0.5cm',
  normal: '1cm',
  wide: '2cm',
};

export class PdfRenderTimeoutError extends Error {
  constructor() {
    super(
      'This deck is too large to turn into a PDF in time. Split it into smaller decks in Anki and print them one at a time.'
    );
    this.name = 'PdfRenderTimeoutError';
  }
}

export default class PdfRenderService {
  async renderHtml(html: string, options?: PdfOptions): Promise<Buffer> {
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'load' });
      await page.waitForFunction(
        `new Promise(function(resolve) {
          var start = Date.now();
          function check() {
            if (window.MathJax && typeof window.MathJax.typesetPromise === 'function') {
              window.MathJax.typesetPromise().then(function() { resolve(true); }).catch(function() { resolve(true); });
            } else if (Date.now() - start > ${MATHJAX_SETTLE_MS}) {
              resolve(true);
            } else {
              setTimeout(check, 200);
            }
          }
          check();
        })`,
        { timeout: PDF_TIMEOUT_MS }
      );
      const marginValue = MARGIN_VALUES[options?.margins ?? 'normal'] ?? '1cm';
      const pdf = await page.pdf({
        format: options?.paperSize ?? 'A4',
        landscape: options?.orientation === 'landscape',
        printBackground: true,
        margin: {
          top: marginValue,
          right: marginValue,
          bottom: marginValue,
          left: marginValue,
        },
        timeout: PDF_TIMEOUT_MS,
      });
      return Buffer.from(pdf);
    } catch (error) {
      if (error instanceof TimeoutError) {
        throw new PdfRenderTimeoutError();
      }
      throw error;
    } finally {
      await browser.close();
    }
  }
}
