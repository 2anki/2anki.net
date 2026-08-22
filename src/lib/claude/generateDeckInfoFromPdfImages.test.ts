import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  attachPageImageToCompactDecks,
  buildPdfPageVisionPrompt,
  generateDeckInfoFromPdfImages,
} from './generateDeckInfoFromPdfImages';
import {
  EMPTY_CONTENT_UPLOAD_MESSAGE,
  expandCompactDeckInfo,
} from './ClaudeService';

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

  it('attributes every vision usage event to the converting user', async () => {
    mockCreateFn.mockResolvedValue(
      visionResponse(
        JSON.stringify([{ deck: 'Study', cards: [{ q: 'Q1', a: 'A1' }] }])
      )
    );
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const trackMod = require('../../services/events/track');
    const trackSpy = jest
      .spyOn(trackMod, 'track')
      .mockImplementation(() => undefined);

    try {
      await generateDeckInfoFromPdfImages(
        html,
        { mediaBaseDir: baseDir },
        undefined,
        undefined,
        77
      );

      const usageCalls = trackSpy.mock.calls.filter(
        (call: unknown[]) => call[0] === 'ai_usage_recorded'
      );
      expect(usageCalls.length).toBeGreaterThan(0);
      for (const usageCall of usageCalls) {
        expect((usageCall[1] as { userId?: number | null }).userId).toBe(77);
      }
    } finally {
      trackSpy.mockRestore();
    }
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
    ).rejects.toThrow(EMPTY_CONTENT_UPLOAD_MESSAGE);
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

  it('attaches each page image to its cards as media and an image on the back', async () => {
    mockCreateFn.mockResolvedValue(
      visionResponse(
        JSON.stringify([{ deck: 'Study', cards: [{ q: 'Q1', a: 'A1' }] }])
      )
    );

    const decks = await generateDeckInfoFromPdfImages(html, {
      mediaBaseDir: baseDir,
    });

    const cards = decks.flatMap((d) => d.cards);
    expect(cards.length).toBeGreaterThan(0);
    for (const card of cards) {
      expect(card.media).toHaveLength(1);
      expect(card.media[0]).toMatch(/^pdf-abc\/page-[12]\.png$/);
      expect(card.back).toMatch(/<img[^>]+src="page-[12]\.png"/);
    }
  });

  it('attributes each page its own image', async () => {
    mockCreateFn.mockImplementation((req: unknown) => {
      const content = (
        req as {
          messages: {
            content: { type: string; source?: { data: string } }[];
          }[];
        }
      ).messages[0].content;
      const imageBlock = content.find((b) => b.type === 'image');
      const isPageOne =
        imageBlock?.source?.data === Buffer.from('fakepng1').toString('base64');
      const q = isPageOne ? 'from-page-1' : 'from-page-2';
      return Promise.resolve(
        visionResponse(
          JSON.stringify([{ deck: 'Study', cards: [{ q, a: 'A' }] }])
        )
      );
    });

    const decks = await generateDeckInfoFromPdfImages(html, {
      mediaBaseDir: baseDir,
    });

    const cards = decks.flatMap((d) => d.cards);
    const pageOneCard = cards.find((c) => c.name.includes('from-page-1'));
    const pageTwoCard = cards.find((c) => c.name.includes('from-page-2'));
    expect(pageOneCard?.media).toEqual(['pdf-abc/page-1.png']);
    expect(pageTwoCard?.media).toEqual(['pdf-abc/page-2.png']);
  });

  it('omits page images when attachPageImages is false', async () => {
    mockCreateFn.mockResolvedValue(
      visionResponse(
        JSON.stringify([{ deck: 'Study', cards: [{ q: 'Q1', a: 'A1' }] }])
      )
    );

    const decks = await generateDeckInfoFromPdfImages(html, {
      mediaBaseDir: baseDir,
      attachPageImages: false,
    });

    const cards = decks.flatMap((d) => d.cards);
    expect(cards.length).toBeGreaterThan(0);
    for (const card of cards) {
      expect(card.media).toEqual([]);
      expect(card.back).not.toContain('<img');
    }
  });

  it('ignores images whose path escapes the media base directory', async () => {
    const escaping =
      '<html><body><img src="../../etc/passwd.png"/></body></html>';
    mockCreateFn.mockResolvedValue(visionResponse('[]'));

    await expect(
      generateDeckInfoFromPdfImages(escaping, { mediaBaseDir: baseDir })
    ).rejects.toThrow(EMPTY_CONTENT_UPLOAD_MESSAGE);
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

describe('attachPageImageToCompactDecks', () => {
  it('sets the media and appends the image tag on every card', () => {
    const decks = [
      {
        deck: 'D',
        cards: [
          { q: 'Q1', a: 'A1' },
          { q: 'Q2', a: 'A2' },
        ],
      },
    ];

    const result = attachPageImageToCompactDecks(decks, 'pdf-abc/page-3.png');

    for (const card of result[0].cards) {
      expect(card.media).toEqual(['pdf-abc/page-3.png']);
      expect(card.a).toContain('<img src="pdf-abc/page-3.png"');
    }
  });

  it('does not mutate the input decks', () => {
    const decks = [{ deck: 'D', cards: [{ q: 'Q1', a: 'A1' }] }];

    attachPageImageToCompactDecks(decks, 'pdf-abc/page-1.png');

    expect(decks[0].cards[0].a).toBe('A1');
    expect(decks[0].cards[0]).not.toHaveProperty('media');
  });

  it('escapes the src attribute so a quote in the filename cannot break it', () => {
    const result = attachPageImageToCompactDecks(
      [{ deck: 'D', cards: [{ q: 'Q', a: 'A' }] }],
      'pdf-abc/a"b.png'
    );

    expect(result[0].cards[0].a).toContain('src="pdf-abc/a&quot;b.png"');
    expect(result[0].cards[0].media).toEqual(['pdf-abc/a"b.png']);
  });

  it('a crafted filename cannot inject a live attribute into the rendered card back', () => {
    const attached = attachPageImageToCompactDecks(
      [{ deck: 'D', cards: [{ q: 'Q', a: 'A' }] }],
      'a" onerror="alert(1)'
    );

    const expanded = expandCompactDeckInfo(
      attached,
      ['a" onerror="alert(1)'],
      null
    );

    expect(expanded[0].cards[0].back).not.toContain('onerror="alert(1)"');
  });
});
