import { vi } from 'vitest';
import * as trackModule from '../../services/events/track';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  attachPageImageToCompactDecks,
  buildPdfPageVisionPrompt,
  generateDeckInfoFromPdfImages,
} from './generateDeckInfoFromPdfImages';
import {
  AiCreditsTrippedWithSalvage,
  EMPTY_CONTENT_UPLOAD_MESSAGE,
  expandCompactDeckInfo,
} from './ClaudeService';
import { AiCreditsExhaustedError } from './aiSpendGuard';
import { combineIntoHTML } from '../pdf/combineIntoHTML';

const mockVisionFn = vi.hoisted(() => vi.fn());
const mockStreamFn = vi.hoisted(() =>
  vi.fn((params: { max_tokens: number }) => ({
    finalMessage: () => mockVisionFn(params),
  }))
);
// The real SDK refuses a non-streaming request whose max_tokens implies more
// than ten minutes, before anything is sent.
const mockNonStreamingCreateFn = vi.hoisted(() =>
  vi.fn((params: { max_tokens: number }) =>
    (60 * 60 * params.max_tokens) / 128000 > 600
      ? Promise.reject(new Error('Streaming is required'))
      : mockVisionFn(params)
  )
);

vi.mock('@anthropic-ai/sdk', () => ({
  __esModule: true,
  default: vi.fn().mockImplementation(function () {
    return {
      messages: { create: mockNonStreamingCreateFn, stream: mockStreamFn },
    };
  }),
}));

function visionResponse(json: string, stopReason = 'end_turn') {
  return {
    model: 'claude-sonnet-5',
    content: [{ type: 'text', text: json }],
    stop_reason: stopReason,
    usage: { input_tokens: 100, output_tokens: 50 },
  };
}

describe('generateDeckInfoFromPdfImages', () => {
  let baseDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
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
    mockVisionFn.mockResolvedValue(
      visionResponse(
        JSON.stringify([{ deck: 'Study', cards: [{ q: 'Q1', a: 'A1' }] }])
      )
    );

    const decks = await generateDeckInfoFromPdfImages(html, {
      mediaBaseDir: baseDir,
    });

    expect(mockVisionFn).toHaveBeenCalledTimes(2);
    const firstCall = mockVisionFn.mock.calls[0][0];
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
    const promptBlock = firstCall.messages[0].content.find(
      (b: { type: string }) => b.type === 'text'
    );
    expect(promptBlock.cache_control).toEqual({ type: 'ephemeral' });
    expect(promptBlock.text).toBe(buildPdfPageVisionPrompt());
    expect(firstCall.model).toBe('claude-sonnet-5');
    expect(firstCall.max_tokens).toBe(16384);
    const totalCards = decks.reduce((sum, d) => sum + d.cards.length, 0);
    expect(totalCards).toBeGreaterThan(0);
  });

  it.each([
    '50% done.pdf',
    'Lecture%203.pdf',
    'Cell "Biology".pdf',
    'Cell\\Biology.pdf',
    'Übung 3 細胞.pdf',
  ])(
    'reads every page image the builder links for an upload named %s',
    async (name) => {
      mockVisionFn.mockResolvedValue(
        visionResponse(
          JSON.stringify([{ deck: 'Study', cards: [{ q: 'Q1', a: 'A1' }] }])
        )
      );
      const pages = [1, 2].map((page) => {
        const pagePath = path.join(
          baseDir,
          'pdf-abc',
          `${name}-page${page}-${page}.png`
        );
        fs.writeFileSync(pagePath, Buffer.from(`page ${page}`));
        return pagePath;
      });

      await generateDeckInfoFromPdfImages(
        combineIntoHTML(pages, name, baseDir),
        { mediaBaseDir: baseDir }
      );

      const sent = mockVisionFn.mock.calls.map(
        ([request]) =>
          request.messages[0].content.find(
            (block: { type: string }) => block.type === 'image'
          ).source.data
      );
      expect(sent).toEqual([
        Buffer.from('page 1').toString('base64'),
        Buffer.from('page 2').toString('base64'),
      ]);
    }
  );

  it.each([
    'Lecture%203.pdf',
    'Lecture %22final%22.pdf',
    '50% done.pdf',
    'Cell\\Biology.pdf',
    '..\\..\\escape.pdf',
  ])(
    'puts the page image on the back of each card for an upload named %s',
    async (name) => {
      mockVisionFn.mockResolvedValue(
        visionResponse(
          JSON.stringify([{ deck: 'Study', cards: [{ q: 'Q1', a: 'A1' }] }])
        )
      );
      const pagePath = path.join(baseDir, 'pdf-abc', `${name}-page1-1.png`);
      fs.writeFileSync(pagePath, Buffer.from('page 1'));

      const decks = await generateDeckInfoFromPdfImages(
        combineIntoHTML([pagePath], name, baseDir),
        { mediaBaseDir: baseDir }
      );

      const [card] = decks.flatMap((deck) => deck.cards);
      expect(card.media).toEqual([
        expect.objectContaining({ path: `pdf-abc/${name}-page1-1.png` }),
      ]);
      expect(card.back).toContain(`src="${card.media?.[0].name}"`);
    }
  );

  it('reads a page whose link was written before links were encoded, as a restarted job does', async () => {
    mockVisionFn.mockResolvedValue(
      visionResponse(
        JSON.stringify([{ deck: 'Study', cards: [{ q: 'Q1', a: 'A1' }] }])
      )
    );
    fs.writeFileSync(
      path.join(baseDir, 'pdf-abc', '50% done.pdf-page1-1.png'),
      Buffer.from('page 1')
    );
    const unencoded = `<html><body><details><summary><img src="pdf-abc/50% done.pdf-page1-1.png"/></summary></details></body></html>`;

    const decks = await generateDeckInfoFromPdfImages(unencoded, {
      mediaBaseDir: baseDir,
    });

    expect(decks.flatMap((deck) => deck.cards)[0].media).toEqual([
      expect.objectContaining({ path: 'pdf-abc/50% done.pdf-page1-1.png' }),
    ]);
  });

  it('attributes every vision usage event to the converting user', async () => {
    mockVisionFn.mockResolvedValue(
      visionResponse(
        JSON.stringify([{ deck: 'Study', cards: [{ q: 'Q1', a: 'A1' }] }])
      )
    );
    const trackSpy = vi
      .spyOn(trackModule, 'track')
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
      expect(usageCalls).toHaveLength(2);
      for (const usageCall of usageCalls) {
        expect(usageCall[1]).toMatchObject({
          userId: 77,
          props: {
            surface: 'pdf_page_vision',
            model: 'claude-sonnet-5',
            usage: { input_tokens: 100, output_tokens: 50 },
          },
        });
      }
    } finally {
      trackSpy.mockRestore();
    }
  });

  it('retries a page once at a larger token budget when the response is truncated', async () => {
    mockVisionFn
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

  it('sends every page once when the upload made one card per page', async () => {
    mockVisionFn.mockResolvedValue(
      visionResponse(
        JSON.stringify([{ deck: 'Study', cards: [{ q: 'Q1', a: 'A1' }] }])
      )
    );
    const pages = [1, 2, 3].map((page) => {
      const pagePath = path.join(baseDir, 'pdf-abc', `single-page${page}.png`);
      fs.writeFileSync(pagePath, Buffer.from(`single ${page}`));
      return pagePath;
    });

    await generateDeckInfoFromPdfImages(
      combineIntoHTML(pages, 'single.pdf', baseDir, 'single'),
      { mediaBaseDir: baseDir }
    );

    const sent = mockVisionFn.mock.calls.map(
      ([request]) =>
        request.messages[0].content.find(
          (block: { type: string }) => block.type === 'image'
        ).source.data
    );
    expect(sent.sort()).toEqual(
      [1, 2, 3].map((page) => Buffer.from(`single ${page}`).toString('base64'))
    );
    expect(mockStreamFn).toHaveBeenCalledTimes(3);
  });

  it('sends the truncation retry as a streaming request at the larger budget', async () => {
    const page1 = Buffer.from('fakepng1').toString('base64');
    const cardsFor = (q: string) =>
      visionResponse(
        JSON.stringify([{ deck: 'Study', cards: [{ q, a: 'A' }] }])
      );
    mockVisionFn.mockImplementation(
      (params: {
        max_tokens: number;
        messages: { content: { source?: { data: string } }[] }[];
      }) => {
        const isPage1 = params.messages[0].content[0].source?.data === page1;
        if (!isPage1) return Promise.resolve(cardsFor('Page 2'));
        if (params.max_tokens === 16384)
          return Promise.resolve(visionResponse('[', 'max_tokens'));
        return Promise.resolve(cardsFor('Page 1 retried'));
      }
    );

    const trackSpy = vi
      .spyOn(trackModule, 'track')
      .mockImplementation(() => undefined);

    const decks = await generateDeckInfoFromPdfImages(html, {
      mediaBaseDir: baseDir,
    });

    const usageEvents = trackSpy.mock.calls.filter(
      (call: unknown[]) => call[0] === 'ai_usage_recorded'
    );
    trackSpy.mockRestore();
    expect(usageEvents).toHaveLength(3);
    expect(mockStreamFn.mock.calls.map(([p]) => p.max_tokens)).toContain(32768);
    expect(mockStreamFn).toHaveBeenCalledTimes(3);
    expect(mockNonStreamingCreateFn).not.toHaveBeenCalled();
    expect(decks.flatMap((d) => d.cards.map((c) => c.name)).sort()).toEqual([
      'Page 1 retried',
      'Page 2',
    ]);
  });

  it('throws the empty-content message when vision finds no cards on any page', async () => {
    mockVisionFn.mockResolvedValue(visionResponse('[]'));

    await expect(
      generateDeckInfoFromPdfImages(html, { mediaBaseDir: baseDir })
    ).rejects.toThrow(EMPTY_CONTENT_UPLOAD_MESSAGE);
  });

  it('keeps cards from readable pages when one page comes back blank', async () => {
    mockVisionFn
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
    mockVisionFn
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
    mockVisionFn.mockRejectedValue(new Error('overloaded_error'));

    await expect(
      generateDeckInfoFromPdfImages(html, { mediaBaseDir: baseDir })
    ).rejects.toThrow('overloaded_error');
  });

  it('propagates a mid-run credit trip carrying the pages produced so far', async () => {
    mockVisionFn
      .mockRejectedValueOnce(new AiCreditsExhaustedError())
      .mockResolvedValue(
        visionResponse(
          JSON.stringify([{ deck: 'Study', cards: [{ q: 'Q1', a: 'A1' }] }])
        )
      );

    let thrown: unknown;
    try {
      await generateDeckInfoFromPdfImages(html, { mediaBaseDir: baseDir });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(AiCreditsTrippedWithSalvage);
    const salvaged = (thrown as AiCreditsTrippedWithSalvage).salvagedDecks;
    const totalCards = salvaged.reduce((sum, d) => sum + d.cards.length, 0);
    expect(totalCards).toBeGreaterThan(0);
  });

  it('propagates a credit trip with no salvage when every page trips', async () => {
    mockVisionFn.mockRejectedValue(new AiCreditsExhaustedError());

    let thrown: unknown;
    try {
      await generateDeckInfoFromPdfImages(html, { mediaBaseDir: baseDir });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(AiCreditsTrippedWithSalvage);
    expect((thrown as AiCreditsTrippedWithSalvage).salvagedDecks).toEqual([]);
  });

  it('attaches each page image to its cards as media and an image on the back', async () => {
    mockVisionFn.mockResolvedValue(
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
      expect(card.media[0]).toEqual({
        path: expect.stringMatching(/^pdf-abc\/page-[12]\.png$/),
        name: expect.stringMatching(/^pdf-abc_page-[12]\.png$/),
      });
      expect(card.back).toMatch(/<img[^>]+src="pdf-abc_page-[12]\.png"/);
    }
  });

  it('attributes each page its own image', async () => {
    mockVisionFn.mockImplementation((req: unknown) => {
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
    expect(pageOneCard?.media).toEqual([
      { path: 'pdf-abc/page-1.png', name: 'pdf-abc_page-1.png' },
    ]);
    expect(pageTwoCard?.media).toEqual([
      { path: 'pdf-abc/page-2.png', name: 'pdf-abc_page-2.png' },
    ]);
  });

  it('omits page images when attachPageImages is false', async () => {
    mockVisionFn.mockResolvedValue(
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
    mockVisionFn.mockResolvedValue(visionResponse('[]'));

    await expect(
      generateDeckInfoFromPdfImages(escaping, { mediaBaseDir: baseDir })
    ).rejects.toThrow(EMPTY_CONTENT_UPLOAD_MESSAGE);
    expect(mockVisionFn).not.toHaveBeenCalled();
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

    expect(result[0].cards[0].a).toContain('src="pdf-abc/a%22b.png"');
    expect(result[0].cards[0].media).toEqual(['pdf-abc/a%22b.png']);
    expect(decodeURIComponent('pdf-abc/a%22b.png')).toBe('pdf-abc/a"b.png');
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
