import PdfRenderService, { previewClip } from './PdfRenderService';
import type { PdfOptions } from '../usecases/apkg/ExportApkgToPdfUseCase';

const PUPPETEER_AVAILABLE = process.env.PUPPETEER_AVAILABLE === 'true';

function options(overrides: Partial<PdfOptions>): PdfOptions {
  return {
    backgroundColor: '#ffffff',
    paperSize: 'A4',
    orientation: 'portrait',
    margins: 'normal',
    ...overrides,
  };
}

describe('previewClip', () => {
  it('clips to one A4 portrait page by default', () => {
    expect(previewClip()).toEqual({ x: 0, y: 0, width: 794, height: 1123 });
  });

  it('swaps width and height for landscape', () => {
    expect(previewClip(options({ orientation: 'landscape' }))).toEqual({
      x: 0,
      y: 0,
      width: 1123,
      height: 794,
    });
  });

  it('matches Letter and Legal page sizes', () => {
    expect(previewClip(options({ paperSize: 'Letter' }))).toEqual({
      x: 0,
      y: 0,
      width: 816,
      height: 1056,
    });
    expect(previewClip(options({ paperSize: 'Legal' }))).toEqual({
      x: 0,
      y: 0,
      width: 816,
      height: 1344,
    });
  });
});

(PUPPETEER_AVAILABLE ? describe : describe.skip)('PdfRenderService', () => {
  it('renders simple HTML to a PDF buffer', async () => {
    const service = new PdfRenderService();
    const html = '<html><body><h1>Hello</h1></body></html>';
    const pdf = await service.renderHtml(html);

    expect(Buffer.isBuffer(pdf)).toBe(true);
    expect(pdf.length).toBeGreaterThan(0);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  }, 30_000);

  it('renders a preview screenshot as a PNG buffer', async () => {
    const service = new PdfRenderService();
    const html = '<html><head></head><body><h1>Preview</h1></body></html>';
    const png = await service.renderPreviewImage({ html });

    expect(Buffer.isBuffer(png)).toBe(true);
    expect(png.length).toBeGreaterThan(0);
    expect(png.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    );
  }, 30_000);
});
