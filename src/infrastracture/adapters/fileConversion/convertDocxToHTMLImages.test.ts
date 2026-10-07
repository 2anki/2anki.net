import { vi, type Mock } from 'vitest';
import { DocxImageMediaSink } from './docxImageMediaSink';

vi.mock('mammoth', () => {
  const imgElement = vi.fn((handler) => ({
    __brand: 'imgElement',
    handler,
  }));
  return {
    __esModule: true,
    default: {
      convertToHtml: vi.fn(),
      images: { imgElement },
    },
  };
});

import mammoth from 'mammoth';
import { convertDocxToHTML } from './convertDocxToHTML';

const mockedConvert = mammoth.convertToHtml as Mock;
const mockedImgElement = mammoth.images.imgElement as unknown as Mock;

describe('convertDocxToHTML image media handling', () => {
  beforeEach(() => {
    mockedConvert.mockReset();
    mockedImgElement.mockClear();
  });

  it('passes a convertImage option when a media sink is provided', async () => {
    mockedConvert.mockResolvedValue({ value: '<p>hello</p>', messages: [] });

    const sink: DocxImageMediaSink = { write: vi.fn(() => 'abc.png') };
    await convertDocxToHTML(Buffer.from('docx'), sink);

    expect(mockedConvert).toHaveBeenCalledTimes(1);
    const options = mockedConvert.mock.calls[0][1];
    expect(options).toMatchObject({ convertImage: { __brand: 'imgElement' } });
  });

  it('omits the convertImage option when no media sink is provided', async () => {
    mockedConvert.mockResolvedValue({ value: '<p>hello</p>', messages: [] });

    await convertDocxToHTML(Buffer.from('docx'));

    const options = mockedConvert.mock.calls[0][1];
    expect(options.convertImage).toBeUndefined();
    expect(options.styleMap).toEqual(['strike => del']);
  });

  it('writes bytes to the sink and emits a plain filename src, not a data URI', async () => {
    const written: { bytes: Buffer; contentType: string }[] = [];
    const sink: DocxImageMediaSink = {
      write: (bytes, contentType) => {
        written.push({ bytes, contentType });
        return 'deadbeef.png';
      },
    };

    mockedConvert.mockImplementation(async (_input, options) => {
      const attrs = await options.convertImage.handler({
        contentType: 'image/png',
        readAsBuffer: async () => Buffer.from([0x89, 0x50, 0x4e, 0x47]),
      });
      return { value: `<p><img src="${attrs.src}" /></p>`, messages: [] };
    });

    const html = await convertDocxToHTML(Buffer.from('docx'), sink);

    expect(html).toContain('<img src="deadbeef.png"');
    expect(html).not.toContain('data:image');
    expect(written).toHaveLength(1);
    expect(written[0].contentType).toBe('image/png');
    expect(written[0].bytes).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  });
});
