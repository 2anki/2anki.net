import { estimateAiConversionCostUsd } from './conversionCostEstimate';

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

describe('estimateAiConversionCostUsd', () => {
  it('prices HTML/Markdown text and marks the run estimated', async () => {
    const result = await estimateAiConversionCostUsd(
      [
        {
          name: 'notes.html',
          contents: '<html><body>' + 'a'.repeat(4000) + '</body></html>',
        },
        { name: 'more.md', contents: 'b'.repeat(2000) },
      ],
      {},
      '/tmp'
    );
    expect(result.estimated).toBe(true);
    expect(result.costUsd).toBeGreaterThan(0);
  });

  it('does not count a binary file when its vision setting is off', async () => {
    const result = await estimateAiConversionCostUsd(
      [{ name: 'scan.pdf', contents: Buffer.alloc(5_000_000) }],
      {},
      '/tmp'
    );
    expect(result).toEqual({ costUsd: 0, estimated: false });
  });

  it('prices an image by its vision tokens when the image quiz is on', async () => {
    const result = await estimateAiConversionCostUsd(
      [{ name: 'photo.png', contents: PNG_1X1 }],
      { imageQuizHtmlToAnki: true },
      '/tmp'
    );
    expect(result.estimated).toBe(true);
    expect(result.costUsd).toBeGreaterThan(0);
  });

  it('ignores an image when the image quiz is off', async () => {
    const result = await estimateAiConversionCostUsd(
      [{ name: 'photo.png', contents: PNG_1X1 }],
      {},
      '/tmp'
    );
    expect(result).toEqual({ costUsd: 0, estimated: false });
  });
});
