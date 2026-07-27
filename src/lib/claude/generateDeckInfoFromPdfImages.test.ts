import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildPdfPageVisionPrompt,
  generateDeckInfoFromPdfImages,
} from './generateDeckInfoFromPdfImages';
import { EMPTY_CONTENT_USER_MESSAGE } from './ClaudeService';

const mockCreateFn = jest.fn();

jest.mock('@anthropic-ai/sdk', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    messages: { create: mockCreateFn },
  })),
}));

function visionResponse(json: string, stopReason = 'end_turn') {
  return {
    content: [{ type: 'text', text: json }],
    stop_reason: stopReason,
    usage: { input_tokens: 100, output_tokens: 50 },
  };
}

describe('generateDeckInfoFromPdfImages', () => {
  let baseDir: string;

  beforeEach(() => {
    jest.clearAllMocks();
    baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdfimg-'));
    fs.mkdirSync(path.join(baseDir, 'pdf-abc'));
    fs.writeFileSync(
      path.join(baseDir, 'pdf-abc', 'page-1.png'),
      Buffer.from('fakepng1')
    );
    fs.writeFileSync(
      path.join(baseDir, 'pdf-abc', 'page-2.png'),
      Buffer.from('fakepng2')
    );
  });

  afterEach(() => {
    fs.rmSync(baseDir, { recursive: true, force: true });
  });

  const html = `<html><body>
    <details><summary><img src="pdf-abc/page-1.png"/></summary><img src="pdf-abc/page-2.png"/></details>
  </body></html>`;

  it('sends each page image to Claude vision and returns the extracted cards', async () => {
    mockCreateFn.mockResolvedValue(
      visionResponse(
        JSON.stringify([{ deck: 'Study', cards: [{ q: 'Q1', a: 'A1' }] }])
      )
    );

    const decks = await generateDeckInfoFromPdfImages(html, {
      mediaBaseDir: baseDir,
    });

    expect(mockCreateFn).toHaveBeenCalledTimes(2);
    const firstCall = mockCreateFn.mock.calls[0][0];
    const imageBlock = firstCall.messages[0].content.find(
      (b: { type: string }) => b.type === 'image'
    );
    expect(imageBlock.source).toMatchObject({
      type: 'base64',
      media_type: 'image/png',
    });
    expect(imageBlock.source.data).toBe(
      Buffer.from('fakepng1').toString('base64')
    );
    const totalCards = decks.reduce((sum, d) => sum + d.cards.length, 0);
    expect(totalCards).toBeGreaterThan(0);
  });

  it('retries a page once at a larger token budget when the response is truncated', async () => {
    mockCreateFn
      .mockResolvedValueOnce(visionResponse('[', 'max_tokens'))
      .mockResolvedValueOnce(
        visionResponse(
          JSON.stringify([{ deck: 'Study', cards: [{ q: 'Q1', a: 'A1' }] }])
        )
      )
      .mockResolvedValue(
        visionResponse(
          JSON.stringify([{ deck: 'Study', cards: [{ q: 'Q2', a: 'A2' }] }])
        )
      );

    const decks = await generateDeckInfoFromPdfImages(html, {
      mediaBaseDir: baseDir,
    });

    const totalCards = decks.reduce((sum, d) => sum + d.cards.length, 0);
    expect(totalCards).toBeGreaterThan(0);
  });

  it('throws the empty-content message when vision finds no cards on any page', async () => {
    mockCreateFn.mockResolvedValue(visionResponse('[]'));

    await expect(
      generateDeckInfoFromPdfImages(html, { mediaBaseDir: baseDir })
    ).rejects.toThrow(EMPTY_CONTENT_USER_MESSAGE);
  });

  it('keeps cards from readable pages when one page comes back blank', async () => {
    mockCreateFn
      .mockResolvedValueOnce(visionResponse('[]'))
      .mockResolvedValue(
        visionResponse(
          JSON.stringify([{ deck: 'Study', cards: [{ q: 'Q1', a: 'A1' }] }])
        )
      );

    const decks = await generateDeckInfoFromPdfImages(html, {
      mediaBaseDir: baseDir,
    });

    const totalCards = decks.reduce((sum, d) => sum + d.cards.length, 0);
    expect(totalCards).toBeGreaterThan(0);
  });

  it('keeps cards from readable pages when one page fails outright', async () => {
    mockCreateFn
      .mockRejectedValueOnce(new Error('overloaded_error'))
      .mockResolvedValue(
        visionResponse(
          JSON.stringify([{ deck: 'Study', cards: [{ q: 'Q1', a: 'A1' }] }])
        )
      );

    const decks = await generateDeckInfoFromPdfImages(html, {
      mediaBaseDir: baseDir,
    });

    const totalCards = decks.reduce((sum, d) => sum + d.cards.length, 0);
    expect(totalCards).toBe(1);
  });

  it('surfaces the page failure when every page fails', async () => {
    mockCreateFn.mockRejectedValue(new Error('overloaded_error'));

    await expect(
      generateDeckInfoFromPdfImages(html, { mediaBaseDir: baseDir })
    ).rejects.toThrow('overloaded_error');
  });

  it('ignores images whose path escapes the media base directory', async () => {
    const escaping =
      '<html><body><img src="../../etc/passwd.png"/></body></html>';
    mockCreateFn.mockResolvedValue(visionResponse('[]'));

    await expect(
      generateDeckInfoFromPdfImages(escaping, { mediaBaseDir: baseDir })
    ).rejects.toThrow(EMPTY_CONTENT_USER_MESSAGE);
    expect(mockCreateFn).not.toHaveBeenCalled();
  });
});

describe('buildPdfPageVisionPrompt', () => {
  it('asks for the compact JSON array and an empty array on blank pages', () => {
    const prompt = buildPdfPageVisionPrompt();
    expect(prompt).toContain('compact JSON array');
    expect(prompt).toContain('[]');
  });

  it('appends the user instructions when provided', () => {
    expect(buildPdfPageVisionPrompt('Focus on definitions')).toContain(
      'Focus on definitions'
    );
  });
});
