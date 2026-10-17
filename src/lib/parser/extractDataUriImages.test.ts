import {
  MAX_EXTRACTED_IMAGES,
  extractDataUriImages,
} from './extractDataUriImages';

const PNG_BYTES = Buffer.from('fake-png-bytes');
const PNG_B64 = PNG_BYTES.toString('base64');

function collectingWriter() {
  const written: { bytes: Buffer; extension: string }[] = [];
  const write = (bytes: Buffer, extension: string) => {
    written.push({ bytes, extension });
    return `image-${written.length}.${extension}`;
  };
  return { written, write };
}

describe('extractDataUriImages', () => {
  it('replaces an img data URI with the written file name and hands over the decoded bytes', () => {
    const { written, write } = collectingWriter();
    const html = `<p>Q</p><img src="data:image/png;base64,${PNG_B64}"><p>A</p>`;

    const result = extractDataUriImages(html, write);

    expect(result).toEqual({
      html: '<p>Q</p><img src="image-1.png"><p>A</p>',
      count: 1,
      bytes: PNG_BYTES.length,
    });
    expect(written).toEqual([{ bytes: PNG_BYTES, extension: 'png' }]);
  });

  it('keeps other attributes, single quotes and uppercase subtypes', () => {
    const { written, write } = collectingWriter();
    const html = `<img class="x" alt='a' src='data:image/JPEG;base64,${PNG_B64}' width="10">`;

    const result = extractDataUriImages(html, write);

    expect(result.html).toBe(
      `<img class="x" alt='a' src='image-1.jpg' width="10">`
    );
    expect(written[0].extension).toBe('jpg');
  });

  it('maps svg+xml to .svg and handles several images in one page', () => {
    const { write } = collectingWriter();
    const html = [
      `<img src="data:image/svg+xml;base64,${PNG_B64}">`,
      `<img src="data:image/webp;base64,${PNG_B64}">`,
    ].join('');

    const result = extractDataUriImages(html, write);

    expect(result.html).toBe('<img src="image-1.svg"><img src="image-2.webp">');
    expect(result.count).toBe(2);
    expect(result.bytes).toBe(PNG_BYTES.length * 2);
  });

  it('decodes base64 that was wrapped across lines', () => {
    const { written, write } = collectingWriter();
    const wrapped = `${PNG_B64.slice(0, 6)}\n${PNG_B64.slice(6)}`;

    extractDataUriImages(`<img src="data:image/png;base64,${wrapped}">`, write);

    expect(written[0].bytes).toEqual(PNG_BYTES);
  });

  it('leaves an image subtype it does not know, an empty payload, an entity-wrapped payload and non-img data URIs alone', () => {
    const { written, write } = collectingWriter();
    const html = [
      `<img src="data:image/x-icon;base64,${PNG_B64}">`,
      '<img src="data:image/png;base64,">',
      `<img src="data:image/png;base64,${PNG_B64.slice(0, 4)}&#10;${PNG_B64.slice(4)}">`,
      `<a href="data:image/png;base64,${PNG_B64}">link</a>`,
      '<img src="photo.png">',
    ].join('');

    const result = extractDataUriImages(html, write);

    expect(result).toEqual({ html, count: 0, bytes: 0 });
    expect(written).toEqual([]);
  });

  it('leaves a payload that runs into markup or never closes, and a data URI with extra parameters', () => {
    const { written, write } = collectingWriter();
    const html = [
      '<img src="data:image/png;base64,AAAA><p class="x">text</p>',
      `<img src="data:image/png;base64,${PNG_B64}'>`,
      `<img src="data:image/svg+xml;charset=utf-8;base64,${PNG_B64}">`,
      `<p>data:image/png;base64,${PNG_B64}</p>`,
      `<div src="data:image/png;base64,${PNG_B64}">`,
    ].join('');

    const result = extractDataUriImages(html, write);

    expect(result).toEqual({ html, count: 0, bytes: 0 });
    expect(written).toEqual([]);
  });

  it('stops after the image cap and leaves the rest inline', () => {
    const { written, write } = collectingWriter();
    const one = `<img src="data:image/png;base64,${PNG_B64}">`;
    const html = one.repeat(MAX_EXTRACTED_IMAGES + 3);

    const result = extractDataUriImages(html, write);

    expect(written).toHaveLength(MAX_EXTRACTED_IMAGES);
    expect(result.count).toBe(MAX_EXTRACTED_IMAGES);
    expect(result.html.endsWith(one.repeat(3))).toBe(true);
  });

  it('runs in linear time on a page built to stall a backtracking pattern', () => {
    const { write } = collectingWriter();
    const unclosedImgs = `data:image/ ${'<img src=x '.repeat(80000)}`;
    const mismatchedQuotes = `<img src="data:image/png;base64,AAAA' `.repeat(
      40000
    );
    const markers = 'data:image/'.repeat(100000);
    const quotedMarkers = ' src="data:image/'.repeat(100000);
    const unclosedPayload = `<img src="data:image/png;base64,${'A'.repeat(2_000_000)}`;
    const nestedImgs = `<img alt="${'<img '.repeat(100000)}" src="data:image/png;base64,${PNG_B64}">`;

    const start = Date.now();
    extractDataUriImages(unclosedImgs, write);
    extractDataUriImages(mismatchedQuotes, write);
    extractDataUriImages(markers, write);
    extractDataUriImages(quotedMarkers, write);
    extractDataUriImages(unclosedPayload, write);
    extractDataUriImages(nestedImgs, write);

    expect(Date.now() - start).toBeLessThan(1000);
  });

  it('returns the same string untouched when there is no data URI at all', () => {
    const { write } = collectingWriter();
    const html = '<p>plain</p><img src="a.png">';

    expect(extractDataUriImages(html, write).html).toBe(html);
  });
});
