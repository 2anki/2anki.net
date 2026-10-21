import PdfRenderService from './PdfRenderService';

const PUPPETEER_AVAILABLE = process.env.PUPPETEER_AVAILABLE === 'true';

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
