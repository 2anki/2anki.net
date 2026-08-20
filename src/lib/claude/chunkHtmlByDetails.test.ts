import {
  CHUNK_SIZE,
  GIANT_INPUT_CHUNK_SIZE,
  GIANT_INPUT_THRESHOLD,
  chunkHtmlByDetails,
} from './ClaudeService';

const toggle = (body: string) =>
  `<details><summary>Q</summary>${body}</details>`;

function htmlOfLength(target: number): string {
  const unit = toggle('x'.repeat(180));
  return unit.repeat(Math.ceil(target / unit.length));
}

describe('chunkHtmlByDetails input tiering', () => {
  it('keeps a normal document on the standard chunk size', () => {
    const html = htmlOfLength(120_000);
    const chunks = chunkHtmlByDetails(html);
    expect(chunks).toHaveLength(Math.ceil(html.length / CHUNK_SIZE));
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(CHUNK_SIZE + 200);
    }
  });

  it('returns a single chunk for small input', () => {
    const html = htmlOfLength(10_000);
    expect(chunkHtmlByDetails(html)).toEqual([html]);
  });

  it('halves the chunk size once input crosses the giant threshold', () => {
    const html = htmlOfLength(GIANT_INPUT_THRESHOLD + 50_000);
    const chunks = chunkHtmlByDetails(html);
    expect(chunks.length).toBeGreaterThanOrEqual(
      Math.floor(html.length / GIANT_INPUT_CHUNK_SIZE)
    );
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(GIANT_INPUT_CHUNK_SIZE + 200);
    }
  });

  it('keeps a document just under the threshold on the standard size', () => {
    const html = htmlOfLength(GIANT_INPUT_THRESHOLD - 20_000);
    const chunks = chunkHtmlByDetails(html);
    expect(chunks).toHaveLength(Math.ceil(html.length / CHUNK_SIZE));
  });

  it('splits on toggle boundaries in both tiers', () => {
    for (const size of [120_000, GIANT_INPUT_THRESHOLD + 50_000]) {
      const chunks = chunkHtmlByDetails(htmlOfLength(size));
      for (const chunk of chunks.slice(0, -1)) {
        expect(chunk.endsWith('</details>')).toBe(true);
      }
    }
  });
});
