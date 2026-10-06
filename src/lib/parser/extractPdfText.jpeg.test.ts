import fs from 'node:fs';
import path from 'node:path';

import { extractPdfText, withJpegDisplayDecoding } from './extractPdfText';

const JPEG_PDF = path.join(__dirname, '../../test/fixtures/pdf/jpeg-image.pdf');

describe('withJpegDisplayDecoding', () => {
  it('asks pdf.js to hand JPEGs over undecoded when given a buffer', () => {
    const getDocument = jest.fn();
    const data = Buffer.from('pdf');

    withJpegDisplayDecoding(getDocument)(data);

    expect(getDocument).toHaveBeenCalledWith({
      data,
      nativeImageDecoderSupport: 'display',
    });
  });

  it('keeps the other params of an options object', () => {
    const getDocument = jest.fn();
    const data = Buffer.from('pdf');

    withJpegDisplayDecoding(getDocument)({ data, password: 'x' });

    expect(getDocument).toHaveBeenCalledWith({
      data,
      password: 'x',
      nativeImageDecoderSupport: 'display',
    });
  });

  it('keeps a URL source', () => {
    const getDocument = jest.fn();

    withJpegDisplayDecoding(getDocument)('https://example.com/a.pdf');

    expect(getDocument).toHaveBeenCalledWith({
      url: 'https://example.com/a.pdf',
      nativeImageDecoderSupport: 'display',
    });
  });

  it('wraps only once', () => {
    const once = withJpegDisplayDecoding(jest.fn());

    expect(withJpegDisplayDecoding(once)).toBe(once);
  });

  it('is installed on the pdf.js module pdf-parse calls', () => {
    const pdfjs = require('pdf-parse/lib/pdf.js/v1.10.100/build/pdf.js');

    expect(withJpegDisplayDecoding(pdfjs.getDocument)).toBe(pdfjs.getDocument);
  });
});

describe('extractPdfText on a PDF with a JPEG image', () => {
  it('still counts the image and reads the text', async () => {
    const result = await extractPdfText(fs.readFileSync(JPEG_PDF));

    expect(result.pages[0]).toMatchObject({ imagePaintCount: 1 });
    expect(result.pages[0].text).toContain('Photosynthesis');
  });
});
