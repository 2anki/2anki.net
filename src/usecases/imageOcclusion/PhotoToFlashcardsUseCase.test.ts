import {
  PhotoToFlashcardsUseCase,
  FREE_PHOTO_QUOTA_PER_MONTH,
  buildVisionPrompt,
  buildVerbatimPrompt,
  buildHeadingDrivenVisionPrompt,
} from './PhotoToFlashcardsUseCase';
import type { IEventsRepository } from '../../data_layer/EventsRepository';

jest.mock('node:fs');
jest.mock('node:child_process');

const mockFs = jest.requireMock('node:fs') as typeof import('node:fs');
const mockChild = jest.requireMock(
  'node:child_process'
) as typeof import('node:child_process');

const STUB_CLAUDE_RESPONSE = `[{"deck":"My Photo","cards":[{"q":"What is photosynthesis?","a":"The process by which plants convert light into energy"},{"q":"What do plants need?","a":"Water, sunlight, and CO2"}]}]`;

jest.mock('../../lib/claude/ClaudeService', () => ({
  ...jest.requireActual('../../lib/claude/ClaudeService'),
  getAnthropicClient: jest.fn(),
}));

jest.mock('../../services/events/track', () => ({
  track: jest.fn(),
}));

function setupFsMocks() {
  (mockFs.mkdirSync as jest.Mock).mockImplementation(() => undefined);
  (mockFs.existsSync as jest.Mock).mockReturnValue(false);
  (mockFs.writeFileSync as jest.Mock).mockImplementation(() => undefined);
  (mockFs.rmSync as jest.Mock).mockImplementation(() => undefined);
}

function setupPythonMock(apkgPath = '/tmp/result.apkg') {
  const mockProcess = {
    stdout: { on: jest.fn() },
    stderr: { on: jest.fn() },
    on: jest.fn(),
  };
  (mockChild.spawn as jest.Mock).mockReturnValue(mockProcess);

  setTimeout(() => {
    const stdoutHandler = mockProcess.stdout.on.mock.calls.find(
      ([e]) => e === 'data'
    )?.[1];
    stdoutHandler?.(apkgPath);
    const closeHandler = mockProcess.on.mock.calls.find(
      ([e]) => e === 'close'
    )?.[1];
    closeHandler?.(0);
  }, 0);

  return mockProcess;
}

function makeEventsStub(usedThisMonth = 0): IEventsRepository {
  return {
    insertEvents: jest.fn().mockResolvedValue(undefined),
    countByName: jest.fn().mockResolvedValue(0),
    countDistinctUsers: jest.fn().mockResolvedValue(0),
    countByNameForUser: jest.fn().mockResolvedValue(usedThisMonth),
    lastEventAt: jest.fn().mockResolvedValue(null),
    groupPaywallShownByVariantAndSurface: jest.fn().mockResolvedValue([]),
    groupPaywallClicksByVariant: jest.fn().mockResolvedValue([]),
    groupUploadFunnel: jest.fn().mockResolvedValue([]),
    groupUploadFunnelByOrigin: jest.fn().mockResolvedValue([]),
    groupConversionFailedByReason: jest
      .fn()
      .mockResolvedValue({ paywall: 0, empty: 0, technical: 0 }),
  };
}

const BASE_INPUT = {
  imageBase64: 'abc123',
  mediaType: 'image/jpeg' as const,
  deckName: 'Test',
  owner: 'user@example.com',
  imageDimensions: { width: 100, height: 100 },
};

describe('PhotoToFlashcardsUseCase', () => {
  const mockMessageCreate = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    const { getAnthropicClient } = jest.requireMock(
      '../../lib/claude/ClaudeService'
    ) as { getAnthropicClient: jest.Mock };
    getAnthropicClient.mockReturnValue({
      messages: { create: mockMessageCreate },
    });
    mockMessageCreate.mockResolvedValue({
      content: [{ type: 'text', text: STUB_CLAUDE_RESPONSE }],
      usage: { input_tokens: 100, output_tokens: 50 },
    });
    setupFsMocks();
    setupPythonMock();
  });

  describe('free quota', () => {
    it('blocks a free user at the monthly limit with status 429', async () => {
      const events = makeEventsStub(FREE_PHOTO_QUOTA_PER_MONTH);
      const useCase = new PhotoToFlashcardsUseCase(events);
      await expect(
        useCase.execute({ ...BASE_INPUT, isPaying: false })
      ).rejects.toMatchObject({
        status: 429,
        used: FREE_PHOTO_QUOTA_PER_MONTH,
        limit: FREE_PHOTO_QUOTA_PER_MONTH,
      });
      expect(mockMessageCreate).not.toHaveBeenCalled();
    });

    it('lets a free user through when under the limit', async () => {
      const events = makeEventsStub(FREE_PHOTO_QUOTA_PER_MONTH - 1);
      const useCase = new PhotoToFlashcardsUseCase(events);
      const result = await useCase.execute({ ...BASE_INPUT, isPaying: false });
      expect(result.cardCount).toBe(2);
    });

    it('skips the count check entirely for paying users', async () => {
      const events = makeEventsStub(FREE_PHOTO_QUOTA_PER_MONTH * 10);
      const useCase = new PhotoToFlashcardsUseCase(events);
      const result = await useCase.execute({ ...BASE_INPUT, isPaying: true });
      expect(result.cardCount).toBe(2);
      expect(events.countByNameForUser).not.toHaveBeenCalled();
    });

    it('tracks a vision_photo_converted event on success', async () => {
      const events = makeEventsStub(0);
      const useCase = new PhotoToFlashcardsUseCase(events);
      await useCase.execute({ ...BASE_INPUT, isPaying: false });
      const { track } = jest.requireMock('../../services/events/track') as {
        track: jest.Mock;
      };
      expect(track).toHaveBeenCalledWith(
        'vision_photo_converted',
        expect.objectContaining({
          props: expect.objectContaining({ card_count: 2 }),
        })
      );
    });
  });

  describe('token ceiling', () => {
    it('throws 413 when estimated tokens exceed the ceiling', async () => {
      const useCase = new PhotoToFlashcardsUseCase(makeEventsStub());
      await expect(
        useCase.execute({
          ...BASE_INPUT,
          isPaying: true,
          tokenCeilingOverride: 1,
        })
      ).rejects.toMatchObject({ status: 413 });
      expect(mockMessageCreate).not.toHaveBeenCalled();
    });
  });

  describe('card extraction', () => {
    it('returns the correct card count from Claude response', async () => {
      const useCase = new PhotoToFlashcardsUseCase(makeEventsStub());
      const result = await useCase.execute({ ...BASE_INPUT, isPaying: true });
      expect(result.cardCount).toBe(2);
    });

    it('returns an apkg file path ending in .apkg', async () => {
      const useCase = new PhotoToFlashcardsUseCase(makeEventsStub());
      const result = await useCase.execute({ ...BASE_INPUT, isPaying: true });
      expect(result.apkgPath).toMatch(/\.apkg$/);
    });

    it('calls Claude Vision API with base64 image block', async () => {
      const useCase = new PhotoToFlashcardsUseCase(makeEventsStub());
      await useCase.execute({ ...BASE_INPUT, isPaying: true });
      expect(mockMessageCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({
              content: expect.arrayContaining([
                expect.objectContaining({
                  type: 'image',
                  source: expect.objectContaining({
                    type: 'base64',
                    data: 'abc123',
                  }),
                }),
              ]),
            }),
          ]),
        })
      );
    });
  });

  describe('max_tokens truncation retry', () => {
    const TRUNCATED_RESPONSE = STUB_CLAUDE_RESPONSE.slice(0, 40);

    it('retries once with a higher max_tokens and succeeds on a complete response', async () => {
      mockMessageCreate
        .mockResolvedValueOnce({
          stop_reason: 'max_tokens',
          content: [{ type: 'text', text: TRUNCATED_RESPONSE }],
          usage: { input_tokens: 100, output_tokens: 4096 },
        })
        .mockResolvedValueOnce({
          stop_reason: 'end_turn',
          content: [{ type: 'text', text: STUB_CLAUDE_RESPONSE }],
          usage: { input_tokens: 100, output_tokens: 200 },
        });
      const useCase = new PhotoToFlashcardsUseCase(makeEventsStub());
      const result = await useCase.execute({ ...BASE_INPUT, isPaying: true });
      expect(result.cardCount).toBe(2);
      expect(mockMessageCreate).toHaveBeenCalledTimes(2);
      expect(mockMessageCreate.mock.calls[0][0].max_tokens).toBe(4096);
      expect(mockMessageCreate.mock.calls[1][0].max_tokens).toBe(8192);
    });

    it('throws 422 when the retry is also truncated mid-JSON', async () => {
      mockMessageCreate.mockResolvedValue({
        stop_reason: 'max_tokens',
        content: [{ type: 'text', text: TRUNCATED_RESPONSE }],
        usage: { input_tokens: 100, output_tokens: 8192 },
      });
      const useCase = new PhotoToFlashcardsUseCase(makeEventsStub());
      await expect(
        useCase.execute({ ...BASE_INPUT, isPaying: true })
      ).rejects.toMatchObject({
        status: 422,
        message:
          "Couldn't read the cards from this photo. Try a clearer or less dense image.",
      });
      expect(mockMessageCreate).toHaveBeenCalledTimes(2);
    });
  });

  describe('tag plumbing', () => {
    it('writes tags from Claude Vision response into deck_info.json', async () => {
      mockMessageCreate.mockResolvedValueOnce({
        content: [
          {
            type: 'text',
            text: JSON.stringify([
              {
                deck: 'Tagged Photo',
                cards: [
                  {
                    q: 'What is an enzyme?',
                    a: 'A catalyst',
                    tags: ['enzymes', 'biochemistry'],
                  },
                  { q: 'What is ATP?', a: 'Energy currency' },
                ],
              },
            ]),
          },
        ],
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      const useCase = new PhotoToFlashcardsUseCase(makeEventsStub());
      await useCase.execute({ ...BASE_INPUT, isPaying: true });

      const writeCall = (mockFs.writeFileSync as jest.Mock).mock.calls.find(
        ([p]) => typeof p === 'string' && p.endsWith('deck_info.json')
      );
      expect(writeCall).toBeDefined();
      const payload = JSON.parse(writeCall![1] as string) as Array<{
        cards: Array<{ tags: string[] }>;
      }>;
      expect(payload[0].cards[0].tags).toEqual(['enzymes', 'biochemistry']);
      expect(payload[0].cards[1].tags).toEqual([]);
    });

    it('normalizes malformed tags from Claude Vision response', async () => {
      mockMessageCreate.mockResolvedValueOnce({
        content: [
          {
            type: 'text',
            text: JSON.stringify([
              {
                deck: 'Tagged Photo',
                cards: [
                  { q: 'Q', a: 'A', tags: ['Cell Biology', 'KINETICS!'] },
                ],
              },
            ]),
          },
        ],
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      const useCase = new PhotoToFlashcardsUseCase(makeEventsStub());
      await useCase.execute({ ...BASE_INPUT, isPaying: true });

      const writeCall = (mockFs.writeFileSync as jest.Mock).mock.calls.find(
        ([p]) => typeof p === 'string' && p.endsWith('deck_info.json')
      );
      const payload = JSON.parse(writeCall![1] as string) as Array<{
        cards: Array<{ tags: string[] }>;
      }>;
      expect(payload[0].cards[0].tags).toEqual(['cell_biology', 'kinetics']);
    });
  });

  describe('source image media bundling', () => {
    it('writes the source image bytes to workspaceDir', async () => {
      const useCase = new PhotoToFlashcardsUseCase(makeEventsStub());
      await useCase.execute({ ...BASE_INPUT, isPaying: true });

      const imageWriteCall = (
        mockFs.writeFileSync as jest.Mock
      ).mock.calls.find(
        ([p]: [string]) =>
          typeof p === 'string' && !p.endsWith('deck_info.json')
      );
      expect(imageWriteCall).toBeDefined();
      const writtenBytes = imageWriteCall![1];
      expect(Buffer.isBuffer(writtenBytes)).toBe(true);
      expect(writtenBytes).toEqual(Buffer.from('abc123', 'base64'));
    });

    it('sets media on every card in deck_info.json', async () => {
      const useCase = new PhotoToFlashcardsUseCase(makeEventsStub());
      await useCase.execute({ ...BASE_INPUT, isPaying: true });

      const writeCall = (mockFs.writeFileSync as jest.Mock).mock.calls.find(
        ([p]: [string]) => typeof p === 'string' && p.endsWith('deck_info.json')
      );
      expect(writeCall).toBeDefined();
      const payload = JSON.parse(writeCall![1] as string) as Array<{
        cards: Array<{ media: string[]; back: string }>;
      }>;
      for (const card of payload[0].cards) {
        expect(card.media).toHaveLength(1);
        expect(card.media[0]).toMatch(/^source-[0-9a-f-]+\.jpg$/);
      }
    });

    it('appends the source image tag to each card back', async () => {
      const useCase = new PhotoToFlashcardsUseCase(makeEventsStub());
      await useCase.execute({ ...BASE_INPUT, isPaying: true });

      const writeCall = (mockFs.writeFileSync as jest.Mock).mock.calls.find(
        ([p]: [string]) => typeof p === 'string' && p.endsWith('deck_info.json')
      );
      const payload = JSON.parse(writeCall![1] as string) as Array<{
        cards: Array<{ media: string[]; back: string }>;
      }>;
      for (const card of payload[0].cards) {
        expect(card.back).toContain('<img src="');
        expect(card.back).toContain('style="max-width:100%;height:auto;"');
      }
    });

    it('uses the correct extension for png media type', async () => {
      const useCase = new PhotoToFlashcardsUseCase(makeEventsStub());
      await useCase.execute({
        ...BASE_INPUT,
        mediaType: 'image/png',
        isPaying: true,
      });

      const writeCall = (mockFs.writeFileSync as jest.Mock).mock.calls.find(
        ([p]: [string]) => typeof p === 'string' && p.endsWith('deck_info.json')
      );
      const payload = JSON.parse(writeCall![1] as string) as Array<{
        cards: Array<{ media: string[] }>;
      }>;
      expect(payload[0].cards[0].media[0]).toMatch(/\.png$/);
    });

    describe('includeSourceImage: false', () => {
      it('does not write the source image file to disk', async () => {
        const useCase = new PhotoToFlashcardsUseCase(makeEventsStub());
        await useCase.execute({
          ...BASE_INPUT,
          isPaying: true,
          includeSourceImage: false,
        });

        const imageWriteCall = (
          mockFs.writeFileSync as jest.Mock
        ).mock.calls.find(
          ([p]: [string]) =>
            typeof p === 'string' && !p.endsWith('deck_info.json')
        );
        expect(imageWriteCall).toBeUndefined();
      });

      it('sets media to empty array on every card in deck_info.json', async () => {
        const useCase = new PhotoToFlashcardsUseCase(makeEventsStub());
        await useCase.execute({
          ...BASE_INPUT,
          isPaying: true,
          includeSourceImage: false,
        });

        const writeCall = (mockFs.writeFileSync as jest.Mock).mock.calls.find(
          ([p]: [string]) =>
            typeof p === 'string' && p.endsWith('deck_info.json')
        );
        expect(writeCall).toBeDefined();
        const payload = JSON.parse(writeCall![1] as string) as Array<{
          cards: Array<{ media: string[]; back: string }>;
        }>;
        for (const card of payload[0].cards) {
          expect(card.media).toEqual([]);
          expect(card.back).not.toContain('<img src=');
        }
      });
    });
  });

  describe('vision prompt', () => {
    it('requests 1–3 topic tags per card', () => {
      expect(buildVisionPrompt('balanced')).toMatch(/tag/i);
    });
  });

  describe('Anki math conventions in prompts', () => {
    it('buildVisionPrompt contains the inline math delimiter \\(...\\)', () => {
      expect(buildVisionPrompt('balanced')).toContain('\\(...\\)');
    });

    it('buildVisionPrompt contains the display math delimiter \\[...\\]', () => {
      expect(buildVisionPrompt('balanced')).toContain('\\[...\\]');
    });

    it('buildVisionPrompt forbids $...$ delimiter', () => {
      expect(buildVisionPrompt('balanced')).toMatch(/NEVER\s+\$\.\.\.\$/);
    });

    it('buildVisionPrompt forbids $$...$$ delimiter', () => {
      expect(buildVisionPrompt('balanced')).toMatch(/NEVER\s+\$\$\.\.\.\$\$/);
    });

    it('buildVisionPrompt includes a chemistry example using \\ce{}', () => {
      expect(buildVisionPrompt('balanced')).toContain('\\ce{');
    });

    it('buildVerbatimPrompt contains the inline math delimiter \\(...\\)', () => {
      expect(buildVerbatimPrompt()).toContain('\\(...\\)');
    });

    it('buildVerbatimPrompt contains the display math delimiter \\[...\\]', () => {
      expect(buildVerbatimPrompt()).toContain('\\[...\\]');
    });

    it('buildVerbatimPrompt forbids $...$ delimiter', () => {
      expect(buildVerbatimPrompt()).toMatch(/NEVER\s+\$\.\.\.\$/);
    });

    it('buildVerbatimPrompt forbids $$...$$ delimiter', () => {
      expect(buildVerbatimPrompt()).toMatch(/NEVER\s+\$\$\.\.\.\$\$/);
    });

    it('buildVerbatimPrompt includes a chemistry example using \\ce{}', () => {
      expect(buildVerbatimPrompt()).toContain('\\ce{');
    });
  });

  describe('density control', () => {
    it('uses the balanced rule line when no density is provided', async () => {
      const useCase = new PhotoToFlashcardsUseCase(makeEventsStub());
      await useCase.execute({ ...BASE_INPUT, isPaying: true });
      const [callArgs] = mockMessageCreate.mock.calls[0];
      const text = (
        callArgs.messages[0].content as Array<{ type: string; text?: string }>
      ).find((b) => b.type === 'text')?.text;
      expect(text).toContain('6 to 10 cards');
    });

    it.each([
      ['sparse', '3 to 5 cards'],
      ['balanced', '6 to 10 cards'],
      ['dense', '12 to 20 cards'],
    ] as const)(
      'passes the %s rule line to Claude',
      async (density, expectedSnippet) => {
        const useCase = new PhotoToFlashcardsUseCase(makeEventsStub());
        await useCase.execute({ ...BASE_INPUT, isPaying: true, density });
        const [callArgs] = mockMessageCreate.mock.calls[0];
        const text = (
          callArgs.messages[0].content as Array<{ type: string; text?: string }>
        ).find((b) => b.type === 'text')?.text;
        expect(text).toContain(expectedSnippet);
      }
    );

    it('buildVisionPrompt returns distinct text per tier', () => {
      const sparse = buildVisionPrompt('sparse');
      const balanced = buildVisionPrompt('balanced');
      const dense = buildVisionPrompt('dense');
      expect(sparse).not.toEqual(balanced);
      expect(balanced).not.toEqual(dense);
      expect(sparse).toContain('3 to 5');
      expect(dense).toContain('12 to 20');
    });
  });

  describe('verbatim mode', () => {
    it('buildVerbatimPrompt contains the verbatim contract text', () => {
      const prompt = buildVerbatimPrompt();
      expect(prompt).toContain('exactly as written');
      expect(prompt).toContain('Do not paraphrase');
      expect(prompt).toContain('[illegible]');
    });

    it('buildVerbatimPrompt is distinct from buildVisionPrompt', () => {
      expect(buildVerbatimPrompt()).not.toEqual(buildVisionPrompt('balanced'));
    });

    it('sends the verbatim prompt to Claude when mode is verbatim', async () => {
      const useCase = new PhotoToFlashcardsUseCase(makeEventsStub());
      await useCase.execute({
        ...BASE_INPUT,
        isPaying: true,
        mode: 'verbatim',
      });
      const [callArgs] = mockMessageCreate.mock.calls[0];
      const text = (
        callArgs.messages[0].content as Array<{ type: string; text?: string }>
      ).find((b) => b.type === 'text')?.text;
      expect(text).toContain('exactly as written');
      expect(text).not.toContain('6 to 10 cards');
    });

    it('sends the generative prompt when mode is generative', async () => {
      const useCase = new PhotoToFlashcardsUseCase(makeEventsStub());
      await useCase.execute({
        ...BASE_INPUT,
        isPaying: true,
        mode: 'generative',
      });
      const [callArgs] = mockMessageCreate.mock.calls[0];
      const text = (
        callArgs.messages[0].content as Array<{ type: string; text?: string }>
      ).find((b) => b.type === 'text')?.text;
      expect(text).toContain('6 to 10 cards');
      expect(text).not.toContain('exactly as written');
    });

    it('uses the generative prompt when mode is absent', async () => {
      const useCase = new PhotoToFlashcardsUseCase(makeEventsStub());
      await useCase.execute({ ...BASE_INPUT, isPaying: true });
      const [callArgs] = mockMessageCreate.mock.calls[0];
      const text = (
        callArgs.messages[0].content as Array<{ type: string; text?: string }>
      ).find((b) => b.type === 'text')?.text;
      expect(text).toContain('6 to 10 cards');
    });

    it('tracks source_mode: verbatim in the analytics event', async () => {
      const events = makeEventsStub(0);
      const useCase = new PhotoToFlashcardsUseCase(events);
      await useCase.execute({
        ...BASE_INPUT,
        isPaying: false,
        mode: 'verbatim',
      });
      const { track } = jest.requireMock('../../services/events/track') as {
        track: jest.Mock;
      };
      expect(track).toHaveBeenCalledWith(
        'vision_photo_converted',
        expect.objectContaining({
          props: expect.objectContaining({ source_mode: 'verbatim' }),
        })
      );
    });

    it('tracks source_mode: generative when mode is absent', async () => {
      const events = makeEventsStub(0);
      const useCase = new PhotoToFlashcardsUseCase(events);
      await useCase.execute({ ...BASE_INPUT, isPaying: false });
      const { track } = jest.requireMock('../../services/events/track') as {
        track: jest.Mock;
      };
      expect(track).toHaveBeenCalledWith(
        'vision_photo_converted',
        expect.objectContaining({
          props: expect.objectContaining({ source_mode: 'generative' }),
        })
      );
    });

    describe('hierarchy preservation', () => {
      it('buildVerbatimPrompt instructs Claude to use nested ul/li HTML for hierarchical content', () => {
        const prompt = buildVerbatimPrompt();
        expect(prompt).toContain('<ul>');
        expect(prompt).toContain('<li>');
      });

      it('buildVerbatimPrompt instructs Claude not to flatten nested items with > separators', () => {
        const prompt = buildVerbatimPrompt();
        expect(prompt).toContain('Do not flatten');
        expect(prompt).toContain('hierarchy');
      });

      it('buildVerbatimPrompt instructs Claude to keep single-line sources as plain text', () => {
        const prompt = buildVerbatimPrompt();
        expect(prompt).toContain('no visible hierarchy');
      });

      it('sends verbatim prompt with hierarchy instructions to Claude when mode is verbatim', async () => {
        const useCase = new PhotoToFlashcardsUseCase(makeEventsStub());
        await useCase.execute({
          ...BASE_INPUT,
          isPaying: true,
          mode: 'verbatim',
        });
        const [callArgs] = mockMessageCreate.mock.calls[0];
        const text = (
          callArgs.messages[0].content as Array<{ type: string; text?: string }>
        ).find((b) => b.type === 'text')?.text;
        expect(text).toContain('<ul>');
        expect(text).toContain('<li>');
        expect(text).toContain('hierarchy');
      });
    });
  });

  describe('heading-driven card style', () => {
    it('buildHeadingDrivenVisionPrompt contains slide-title detection instruction', () => {
      const prompt = buildHeadingDrivenVisionPrompt();
      expect(prompt).toMatch(/slide|heading|title/i);
    });

    it('buildHeadingDrivenVisionPrompt is distinct from buildVisionPrompt', () => {
      expect(buildHeadingDrivenVisionPrompt()).not.toEqual(
        buildVisionPrompt('balanced')
      );
    });

    it('buildHeadingDrivenVisionPrompt is distinct from buildVerbatimPrompt', () => {
      expect(buildHeadingDrivenVisionPrompt()).not.toEqual(
        buildVerbatimPrompt()
      );
    });

    it('sends the heading-driven prompt to Claude when cardStyle is heading-driven', async () => {
      const useCase = new PhotoToFlashcardsUseCase(makeEventsStub());
      await useCase.execute({
        ...BASE_INPUT,
        isPaying: true,
        cardStyle: 'heading-driven',
      });
      const [callArgs] = mockMessageCreate.mock.calls[0];
      const text = (
        callArgs.messages[0].content as Array<{ type: string; text?: string }>
      ).find((b) => b.type === 'text')?.text;
      expect(text).toMatch(/slide|heading|title/i);
      expect(text).not.toContain('6 to 10 cards');
      expect(text).not.toContain('exactly as written');
    });

    it('sends the generative prompt (not heading-driven) when cardStyle is absent', async () => {
      const useCase = new PhotoToFlashcardsUseCase(makeEventsStub());
      await useCase.execute({ ...BASE_INPUT, isPaying: true });
      const [callArgs] = mockMessageCreate.mock.calls[0];
      const text = (
        callArgs.messages[0].content as Array<{ type: string; text?: string }>
      ).find((b) => b.type === 'text')?.text;
      expect(text).toContain('6 to 10 cards');
    });

    it('tracks card_style: heading-driven in the analytics event', async () => {
      const events = makeEventsStub(0);
      const useCase = new PhotoToFlashcardsUseCase(events);
      await useCase.execute({
        ...BASE_INPUT,
        isPaying: false,
        cardStyle: 'heading-driven',
      });
      const { track } = jest.requireMock('../../services/events/track') as {
        track: jest.Mock;
      };
      expect(track).toHaveBeenCalledWith(
        'vision_photo_converted',
        expect.objectContaining({
          props: expect.objectContaining({ card_style: 'heading-driven' }),
        })
      );
    });

    it('tracks card_style: generative when cardStyle is absent', async () => {
      const events = makeEventsStub(0);
      const useCase = new PhotoToFlashcardsUseCase(events);
      await useCase.execute({ ...BASE_INPUT, isPaying: false });
      const { track } = jest.requireMock('../../services/events/track') as {
        track: jest.Mock;
      };
      expect(track).toHaveBeenCalledWith(
        'vision_photo_converted',
        expect.objectContaining({
          props: expect.objectContaining({ card_style: 'generative' }),
        })
      );
    });

    it('tracks the requested density in the analytics event', async () => {
      const events = makeEventsStub(0);
      const useCase = new PhotoToFlashcardsUseCase(events);
      await useCase.execute({
        ...BASE_INPUT,
        isPaying: true,
        density: 'dense',
      });
      const { track } = jest.requireMock('../../services/events/track') as {
        track: jest.Mock;
      };
      expect(track).toHaveBeenCalledWith(
        'vision_photo_converted',
        expect.objectContaining({
          props: expect.objectContaining({ density: 'dense' }),
        })
      );
    });

    it('tracks density: balanced when density is absent', async () => {
      const events = makeEventsStub(0);
      const useCase = new PhotoToFlashcardsUseCase(events);
      await useCase.execute({ ...BASE_INPUT, isPaying: false });
      const { track } = jest.requireMock('../../services/events/track') as {
        track: jest.Mock;
      };
      expect(track).toHaveBeenCalledWith(
        'vision_photo_converted',
        expect.objectContaining({
          props: expect.objectContaining({ density: 'balanced' }),
        })
      );
    });
  });

  describe('MCQ emission', () => {
    const MCQ_RESPONSE = JSON.stringify([
      {
        deck: 'Quiz',
        cards: [
          {
            q: 'Which enzyme breaks down starch?',
            a: 'Amylase',
            options: ['Lipase', 'Amylase', 'Protease', 'Lactase'],
            correct_index: 1,
            rationale: 'Amylase hydrolyses starch into maltose.',
          },
          { q: 'Plain question?', a: 'Plain answer' },
        ],
      },
    ]);

    const MALFORMED_MCQ_RESPONSE = JSON.stringify([
      {
        deck: 'Quiz',
        cards: [
          {
            q: 'Three options?',
            a: 'Wrong',
            options: ['A', 'B', 'C'],
            correct_index: 0,
          },
          {
            q: 'Missing correct?',
            a: 'Wrong',
            options: ['A', 'B', 'C', 'D'],
          },
          {
            q: 'Out of range?',
            a: 'Wrong',
            options: ['A', 'B', 'C', 'D'],
            correct_index: 9,
          },
          {
            q: 'Good one?',
            a: 'Right',
            options: ['A', 'B', 'C', 'D'],
            correct_index: 2,
            rationale: 'Because.',
          },
        ],
      },
    ]);

    function readDeckPayload(): Array<{
      cards: Array<{
        mcq?: boolean;
        options?: string[];
        correctIndices?: number[];
        back?: string;
        name?: string;
      }>;
    }> {
      const writeCall = (mockFs.writeFileSync as jest.Mock).mock.calls.find(
        ([p]) =>
          typeof p === 'string' && (p as string).endsWith('deck_info.json')
      );
      return JSON.parse(writeCall![1] as string);
    }

    it('emits mcq:true with options and correctIndices when mcqEnabled and user pays', async () => {
      mockMessageCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: MCQ_RESPONSE }],
        usage: { input_tokens: 100, output_tokens: 50 },
      });
      const useCase = new PhotoToFlashcardsUseCase(makeEventsStub());
      const result = await useCase.execute({
        ...BASE_INPUT,
        isPaying: true,
        mcqEnabled: true,
      });
      const payload = readDeckPayload();
      const mcqCard = payload[0].cards[0];
      expect(mcqCard.mcq).toBe(true);
      expect(mcqCard.options).toEqual([
        'Lipase',
        'Amylase',
        'Protease',
        'Lactase',
      ]);
      expect(mcqCard.correctIndices).toEqual([1]);
      expect(mcqCard.back).toContain('Amylase hydrolyses');
      expect(payload[0].cards[1].mcq).toBeFalsy();
      expect(result.mcqCount).toBe(1);
      expect(result.mcqSkippedCount).toBe(0);
    });

    it('drops malformed MCQs to basic and increments mcqSkippedCount', async () => {
      mockMessageCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: MALFORMED_MCQ_RESPONSE }],
        usage: { input_tokens: 100, output_tokens: 50 },
      });
      const useCase = new PhotoToFlashcardsUseCase(makeEventsStub());
      const result = await useCase.execute({
        ...BASE_INPUT,
        isPaying: true,
        mcqEnabled: true,
      });
      const payload = readDeckPayload();
      expect(payload[0].cards).toHaveLength(4);
      expect(payload[0].cards[0].mcq).toBeFalsy();
      expect(payload[0].cards[1].mcq).toBeFalsy();
      expect(payload[0].cards[2].mcq).toBeFalsy();
      expect(payload[0].cards[3].mcq).toBe(true);
      expect(result.mcqCount).toBe(1);
      expect(result.mcqSkippedCount).toBe(3);
    });

    it('does not emit MCQ when mcqEnabled is false, even for paying users', async () => {
      mockMessageCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: MCQ_RESPONSE }],
        usage: { input_tokens: 100, output_tokens: 50 },
      });
      const useCase = new PhotoToFlashcardsUseCase(makeEventsStub());
      const result = await useCase.execute({
        ...BASE_INPUT,
        isPaying: true,
        mcqEnabled: false,
      });
      const payload = readDeckPayload();
      expect(payload[0].cards[0].mcq).toBeFalsy();
      expect(result.mcqCount).toBe(0);
      expect(result.mcqSkippedCount).toBe(0);
    });

    it('does not emit MCQ when mcqEnabled is omitted', async () => {
      mockMessageCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: MCQ_RESPONSE }],
        usage: { input_tokens: 100, output_tokens: 50 },
      });
      const useCase = new PhotoToFlashcardsUseCase(makeEventsStub());
      const result = await useCase.execute({ ...BASE_INPUT, isPaying: true });
      expect(result.mcqCount).toBe(0);
    });

    it('does not emit MCQ for free users even when mcqEnabled is true (server-side gate)', async () => {
      mockMessageCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: MCQ_RESPONSE }],
        usage: { input_tokens: 100, output_tokens: 50 },
      });
      const useCase = new PhotoToFlashcardsUseCase(makeEventsStub());
      const result = await useCase.execute({
        ...BASE_INPUT,
        isPaying: false,
        mcqEnabled: true,
      });
      const payload = readDeckPayload();
      expect(payload[0].cards[0].mcq).toBeFalsy();
      expect(result.mcqCount).toBe(0);
    });

    it('adds MCQ instructions to the generative prompt when the gate is open', async () => {
      const useCase = new PhotoToFlashcardsUseCase(makeEventsStub());
      await useCase.execute({
        ...BASE_INPUT,
        isPaying: true,
        mcqEnabled: true,
      });
      const [callArgs] = mockMessageCreate.mock.calls[0];
      const text = (
        callArgs.messages[0].content as Array<{ type: string; text?: string }>
      ).find((b) => b.type === 'text')?.text;
      expect(text).toMatch(/options/i);
      expect(text).toMatch(/correct_index/);
    });

    it('omits MCQ instructions when mcqEnabled is false', async () => {
      const useCase = new PhotoToFlashcardsUseCase(makeEventsStub());
      await useCase.execute({
        ...BASE_INPUT,
        isPaying: true,
        mcqEnabled: false,
      });
      const [callArgs] = mockMessageCreate.mock.calls[0];
      const text = (
        callArgs.messages[0].content as Array<{ type: string; text?: string }>
      ).find((b) => b.type === 'text')?.text;
      expect(text).not.toMatch(/correct_index/);
    });
  });

  describe('verbatim template auto-detect', () => {
    const VERBATIM_MIX_RESPONSE = JSON.stringify([
      {
        deck: 'Study sheet',
        cards: [
          {
            q: 'Which enzyme breaks down starch?',
            options: ['Lipase', 'Amylase', 'Protease', 'Lactase'],
            correct_index: 1,
          },
          { q: 'The capital of France is {{c1::Paris}}', a: '' },
          { q: 'What is ATP?', a: 'Energy currency' },
        ],
      },
    ]);

    function readDeckPayload(): Array<{
      cards: Array<{
        mcq?: boolean;
        cloze?: boolean;
        back?: string;
        options?: string[];
        correctIndices?: number[];
      }>;
    }> {
      const writeCall = (mockFs.writeFileSync as jest.Mock).mock.calls.find(
        ([p]) =>
          typeof p === 'string' && (p as string).endsWith('deck_info.json')
      );
      return JSON.parse(writeCall![1] as string);
    }

    it('routes MCQ, cloze, and Q&A verbatim cards into their matching templates', async () => {
      mockMessageCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: VERBATIM_MIX_RESPONSE }],
        usage: { input_tokens: 100, output_tokens: 50 },
      });
      const useCase = new PhotoToFlashcardsUseCase(makeEventsStub());
      const result = await useCase.execute({
        ...BASE_INPUT,
        isPaying: true,
        mode: 'verbatim',
        includeSourceImage: false,
      });

      const cards = readDeckPayload()[0].cards;
      expect(cards[0].mcq).toBe(true);
      expect(cards[0].options).toEqual([
        'Lipase',
        'Amylase',
        'Protease',
        'Lactase',
      ]);
      expect(cards[0].correctIndices).toEqual([1]);
      expect(cards[0].back).toBe('');
      expect(cards[1].mcq).toBeFalsy();
      expect(cards[1].cloze).toBe(true);
      expect(cards[2].mcq).toBeFalsy();
      expect(cards[2].cloze).toBe(false);
      expect(result.mcqCount).toBe(1);
      expect(result.mcqSkippedCount).toBe(0);
    });

    it('emits a verbatim MCQ card without the generative mcqEnabled toggle', async () => {
      mockMessageCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: VERBATIM_MIX_RESPONSE }],
        usage: { input_tokens: 100, output_tokens: 50 },
      });
      const useCase = new PhotoToFlashcardsUseCase(makeEventsStub());
      await useCase.execute({
        ...BASE_INPUT,
        isPaying: true,
        mode: 'verbatim',
        mcqEnabled: false,
      });
      expect(readDeckPayload()[0].cards[0].mcq).toBe(true);
    });

    it('falls back to a basic card when a verbatim MCQ fails strict validation', async () => {
      mockMessageCreate.mockResolvedValueOnce({
        content: [
          {
            type: 'text',
            text: JSON.stringify([
              {
                deck: 'Study sheet',
                cards: [
                  {
                    q: 'Pick one',
                    a: 'B',
                    options: ['A', 'B', 'C'],
                    correct_index: 1,
                  },
                ],
              },
            ]),
          },
        ],
        usage: { input_tokens: 100, output_tokens: 50 },
      });
      const useCase = new PhotoToFlashcardsUseCase(makeEventsStub());
      const result = await useCase.execute({
        ...BASE_INPUT,
        isPaying: true,
        mode: 'verbatim',
      });
      const card = readDeckPayload()[0].cards[0];
      expect(card.mcq).toBeFalsy();
      expect(card.cloze).toBe(false);
      expect(result.mcqCount).toBe(0);
      expect(result.mcqSkippedCount).toBe(1);
    });

    it('leaves the back empty when a rejected MCQ carries no answer text', async () => {
      mockMessageCreate.mockResolvedValueOnce({
        content: [
          {
            type: 'text',
            text: JSON.stringify([
              {
                deck: 'Study sheet',
                cards: [
                  {
                    q: 'Pick one',
                    options: ['A', 'B', 'C'],
                    correct_index: 1,
                  },
                ],
              },
            ]),
          },
        ],
        usage: { input_tokens: 100, output_tokens: 50 },
      });
      const useCase = new PhotoToFlashcardsUseCase(makeEventsStub());
      await useCase.execute({
        ...BASE_INPUT,
        isPaying: true,
        mode: 'verbatim',
        includeSourceImage: false,
      });
      expect(readDeckPayload()[0].cards[0].back).toBe('');
    });

    it('keeps the rationale on the back of a generative MCQ card', async () => {
      mockMessageCreate.mockResolvedValueOnce({
        content: [
          {
            type: 'text',
            text: JSON.stringify([
              {
                deck: 'Study sheet',
                cards: [
                  {
                    q: 'Which enzyme breaks down starch?',
                    options: ['Lipase', 'Amylase', 'Protease', 'Lactase'],
                    correct_index: 1,
                    rationale: 'Amylase hydrolyses starch into maltose.',
                  },
                ],
              },
            ]),
          },
        ],
        usage: { input_tokens: 100, output_tokens: 50 },
      });
      const useCase = new PhotoToFlashcardsUseCase(makeEventsStub());
      await useCase.execute({
        ...BASE_INPUT,
        isPaying: true,
        mcqEnabled: true,
        includeSourceImage: false,
      });
      expect(readDeckPayload()[0].cards[0].back).toBe(
        'Amylase hydrolyses starch into maltose.'
      );
    });

    it('leaves the generative path on plain basic cards (no verbatim routing)', async () => {
      mockMessageCreate.mockResolvedValueOnce({
        content: [
          {
            type: 'text',
            text: JSON.stringify([
              {
                deck: 'Study sheet',
                cards: [{ q: 'Cloze {{c1::leak}}?', a: 'no' }],
              },
            ]),
          },
        ],
        usage: { input_tokens: 100, output_tokens: 50 },
      });
      const useCase = new PhotoToFlashcardsUseCase(makeEventsStub());
      await useCase.execute({
        ...BASE_INPUT,
        isPaying: true,
        mode: 'generative',
      });
      const card = readDeckPayload()[0].cards[0];
      expect(card.cloze).toBe(false);
      expect(card.mcq).toBeFalsy();
    });
  });

  describe('malformed Claude Vision response', () => {
    it('throws a 422 conversion-failure error when the JSON is truncated', async () => {
      mockMessageCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: '[{"deck":"X","cards":[{"q":' }],
        usage: { input_tokens: 100, output_tokens: 50 },
      });
      const useCase = new PhotoToFlashcardsUseCase(makeEventsStub());
      await expect(
        useCase.execute({ ...BASE_INPUT, isPaying: true })
      ).rejects.toMatchObject({ status: 422 });
    });

    it('throws a 422 conversion-failure error when the response is not an array', async () => {
      mockMessageCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: '{"deck":"X","cards":[]}' }],
        usage: { input_tokens: 100, output_tokens: 50 },
      });
      const useCase = new PhotoToFlashcardsUseCase(makeEventsStub());
      await expect(
        useCase.execute({ ...BASE_INPUT, isPaying: true })
      ).rejects.toMatchObject({ status: 422 });
    });

    it('converts a response that opens with a sentence of prose', async () => {
      mockMessageCreate.mockResolvedValueOnce({
        content: [
          {
            type: 'text',
            text:
              'Here are the flashcards from your photo:\n\n' +
              JSON.stringify([
                { deck: 'Study', cards: [{ q: 'Q1', a: 'A1' }] },
              ]),
          },
        ],
        usage: { input_tokens: 100, output_tokens: 50 },
      });
      const useCase = new PhotoToFlashcardsUseCase(makeEventsStub());
      const result = await useCase.execute({ ...BASE_INPUT, isPaying: true });
      expect(result.cardCount).toBe(1);
    });

    it('fails as a 422, not a TypeError, when the array holds bare cards', async () => {
      mockMessageCreate.mockResolvedValueOnce({
        content: [
          { type: 'text', text: JSON.stringify([{ q: 'Q1', a: 'A1' }]) },
        ],
        usage: { input_tokens: 100, output_tokens: 50 },
      });
      const useCase = new PhotoToFlashcardsUseCase(makeEventsStub());
      await expect(
        useCase.execute({ ...BASE_INPUT, isPaying: true })
      ).rejects.toMatchObject({ status: 422 });
    });

    it('keeps the MCQ fields through parsing', async () => {
      mockMessageCreate.mockResolvedValueOnce({
        content: [
          {
            type: 'text',
            text: JSON.stringify([
              {
                deck: 'Study',
                cards: [
                  {
                    q: 'Which enzyme breaks down starch?',
                    options: ['Lipase', 'Amylase', 'Protease', 'Lactase'],
                    correct_index: 1,
                    rationale: 'Amylase hydrolyses starch.',
                  },
                ],
              },
            ]),
          },
        ],
        usage: { input_tokens: 100, output_tokens: 50 },
      });
      const useCase = new PhotoToFlashcardsUseCase(makeEventsStub());
      const result = await useCase.execute({
        ...BASE_INPUT,
        isPaying: true,
        mode: 'verbatim',
      });
      expect(result.mcqCount).toBe(1);
    });

    it('does not leak the raw model text in the thrown error message', async () => {
      mockMessageCreate.mockResolvedValueOnce({
        content: [
          { type: 'text', text: '[{"deck":"Secret Deck Name","cards":[{"q":' },
        ],
        usage: { input_tokens: 100, output_tokens: 50 },
      });
      const useCase = new PhotoToFlashcardsUseCase(makeEventsStub());
      await expect(
        useCase.execute({ ...BASE_INPUT, isPaying: true })
      ).rejects.toMatchObject({
        message: expect.not.stringContaining('Secret Deck Name'),
      });
    });
  });

  describe('deck builder invocation', () => {
    it('spawns create_deck.py with deck_info.json and a trailing-slashed template dir', async () => {
      const useCase = new PhotoToFlashcardsUseCase(makeEventsStub());
      await useCase.execute({ ...BASE_INPUT, isPaying: true });
      expect(mockChild.spawn).toHaveBeenCalledTimes(1);
      const [, argv] = (mockChild.spawn as jest.Mock).mock.calls[0];
      expect(argv).toHaveLength(3);
      expect(argv[0]).toMatch(/create_deck\.py$/);
      expect(argv[1]).toMatch(/deck_info\.json$/);
      expect(argv[2]).toMatch(/templates[\\/]$/);
    });

    it('writes a deck_info.json with deck.name (not deck.deck) so the Python script can read it', async () => {
      const useCase = new PhotoToFlashcardsUseCase(makeEventsStub());
      await useCase.execute({ ...BASE_INPUT, isPaying: true });
      const writeCall = (mockFs.writeFileSync as jest.Mock).mock.calls.find(
        ([p]) => typeof p === 'string' && p.endsWith('deck_info.json')
      );
      expect(writeCall).toBeDefined();
      const payload = JSON.parse(writeCall![1] as string) as Array<{
        name?: string;
        deck?: string;
      }>;
      expect(payload[0]).toHaveProperty('name');
      expect(payload[0]).not.toHaveProperty('deck');
    });
  });
});
