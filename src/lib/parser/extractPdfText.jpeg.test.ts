import { vi } from 'vitest';
import { withJpegDisplayDecoding } from './extractPdfText';

describe('withJpegDisplayDecoding', () => {
  it('requests display decoding when given a buffer', () => {
    const getDocument = vi.fn();
    const data = Buffer.from('pdf');

    withJpegDisplayDecoding(getDocument)(data);

    expect(getDocument).toHaveBeenCalledWith({
      data,
      nativeImageDecoderSupport: 'display',
    });
  });

  it('keeps the other params of an options object', () => {
    const getDocument = vi.fn();
    const data = Buffer.from('pdf');

    withJpegDisplayDecoding(getDocument)({ data, password: 'x' });

    expect(getDocument).toHaveBeenCalledWith({
      data,
      password: 'x',
      nativeImageDecoderSupport: 'display',
    });
  });

  it('keeps a URL source', () => {
    const getDocument = vi.fn();

    withJpegDisplayDecoding(getDocument)('https://example.com/a.pdf');

    expect(getDocument).toHaveBeenCalledWith({
      url: 'https://example.com/a.pdf',
      nativeImageDecoderSupport: 'display',
    });
  });

  it('wraps only once', () => {
    const once = withJpegDisplayDecoding(vi.fn());

    expect(withJpegDisplayDecoding(once)).toBe(once);
  });

  it('is installed on the pdf.js module pdf-parse calls', () => {
    const pdfjs = require('pdf-parse/lib/pdf.js/v1.10.100/build/pdf.js');

    expect(withJpegDisplayDecoding(pdfjs.getDocument)).toBe(pdfjs.getDocument);
  });
});
