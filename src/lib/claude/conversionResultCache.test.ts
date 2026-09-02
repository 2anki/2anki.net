import {
  buildConversionCacheKey,
  withConversionResultCache,
  type ConversionCacheKeyInput,
  type ConversionResultCacheSave,
  type ConversionResultCacheStore,
} from './conversionResultCache';
import type { DeckInfo } from './ClaudeService';

function sampleDeck(front = 'q'): DeckInfo[] {
  return [
    {
      name: 'Deck',
      image: '',
      style: null,
      id: 1,
      settings: {},
      cards: [
        {
          name: front,
          back: 'a',
          tags: [],
          cloze: false,
          number: 0,
          enableInput: false,
          answer: '',
          media: [],
        },
      ],
    },
  ];
}

function baseKeyInput(): ConversionCacheKeyInput {
  return {
    content: '<h1>Cells</h1><p>The cell is the basic unit of life.</p>',
    mediaFiles: ['a.png'],
    userInstructions: undefined,
    cardStyle: undefined,
    cardSize: undefined,
    fieldMapping: undefined,
    comprehensive: false,
    isPaying: false,
    model: 'claude-sonnet-5',
    promptVersion: 'abc123',
  };
}

describe('buildConversionCacheKey', () => {
  it('returns a 64-character hex SHA-256 digest', () => {
    const key = buildConversionCacheKey(baseKeyInput());
    expect(key).toMatch(/^[a-f0-9]{64}$/);
  });

  it('is deterministic for identical input', () => {
    expect(buildConversionCacheKey(baseKeyInput())).toBe(
      buildConversionCacheKey(baseKeyInput())
    );
  });

  it('changes when the content changes', () => {
    const other = { ...baseKeyInput(), content: 'different content' };
    expect(buildConversionCacheKey(other)).not.toBe(
      buildConversionCacheKey(baseKeyInput())
    );
  });

  it('changes when the model changes', () => {
    const other = { ...baseKeyInput(), model: 'claude-opus-5' };
    expect(buildConversionCacheKey(other)).not.toBe(
      buildConversionCacheKey(baseKeyInput())
    );
  });

  it('changes when the prompt version changes', () => {
    const other = { ...baseKeyInput(), promptVersion: 'deadbeef' };
    expect(buildConversionCacheKey(other)).not.toBe(
      buildConversionCacheKey(baseKeyInput())
    );
  });

  it.each([
    ['userInstructions', { userInstructions: 'make them shorter' }],
    ['cardStyle', { cardStyle: 'heading-driven' }],
    ['cardSize', { cardSize: 'detailed' }],
    ['comprehensive', { comprehensive: true }],
    ['isPaying', { isPaying: true }],
    ['mediaFiles', { mediaFiles: ['a.png', 'b.png'] }],
    [
      'fieldMapping',
      {
        fieldMapping: {
          templateName: 'Basic',
          fields: [{ name: 'Front', instruction: 'the question' }],
        },
      },
    ],
  ])('changes when %s changes', (_label, override) => {
    const other = { ...baseKeyInput(), ...override } as ConversionCacheKeyInput;
    expect(buildConversionCacheKey(other)).not.toBe(
      buildConversionCacheKey(baseKeyInput())
    );
  });

  it('ignores CRLF vs LF line endings in the content', () => {
    const lf = { ...baseKeyInput(), content: 'line one\nline two' };
    const crlf = { ...baseKeyInput(), content: 'line one\r\nline two' };
    expect(buildConversionCacheKey(crlf)).toBe(buildConversionCacheKey(lf));
  });

  it('ignores surrounding whitespace in the content', () => {
    const trimmed = { ...baseKeyInput(), content: 'body' };
    const padded = { ...baseKeyInput(), content: '  \n body \n  ' };
    expect(buildConversionCacheKey(padded)).toBe(
      buildConversionCacheKey(trimmed)
    );
  });
});

describe('withConversionResultCache', () => {
  const keyInput = baseKeyInput();

  it('computes without touching the cache when no store is provided', async () => {
    const compute = jest.fn().mockResolvedValue(sampleDeck());
    const result = await withConversionResultCache(
      undefined,
      keyInput,
      compute
    );
    expect(compute).toHaveBeenCalledTimes(1);
    expect(result).toEqual(sampleDeck());
  });

  it('computes and saves on a cache miss', async () => {
    const saves: ConversionResultCacheSave<DeckInfo[]>[] = [];
    const store: ConversionResultCacheStore<DeckInfo[]> = {
      get: jest.fn().mockResolvedValue(undefined),
      save: jest.fn(async (entry) => {
        saves.push(entry);
      }),
    };
    const compute = jest.fn().mockResolvedValue(sampleDeck());

    const result = await withConversionResultCache(store, keyInput, compute);

    expect(compute).toHaveBeenCalledTimes(1);
    expect(store.save).toHaveBeenCalledTimes(1);
    expect(saves[0]).toMatchObject({
      key: buildConversionCacheKey(keyInput),
      model: keyInput.model,
      promptVersion: keyInput.promptVersion,
      result: sampleDeck(),
    });
    expect(result).toEqual(sampleDeck());
  });

  it('returns the cached decks without computing on a hit', async () => {
    const cached = sampleDeck('cached-front');
    const store: ConversionResultCacheStore<DeckInfo[]> = {
      get: jest.fn().mockResolvedValue(cached),
      save: jest.fn(),
    };
    const compute = jest.fn();

    const result = await withConversionResultCache(store, keyInput, compute);

    expect(compute).not.toHaveBeenCalled();
    expect(store.save).not.toHaveBeenCalled();
    expect(result).toEqual(cached);
  });

  it('falls through to a fresh conversion when the cache read throws', async () => {
    const store: ConversionResultCacheStore<DeckInfo[]> = {
      get: jest.fn().mockRejectedValue(new Error('db down')),
      save: jest.fn().mockResolvedValue(undefined),
    };
    const compute = jest.fn().mockResolvedValue(sampleDeck());

    const result = await withConversionResultCache(store, keyInput, compute);

    expect(compute).toHaveBeenCalledTimes(1);
    expect(result).toEqual(sampleDeck());
  });

  it('still returns the conversion when the cache write throws', async () => {
    const store: ConversionResultCacheStore<DeckInfo[]> = {
      get: jest.fn().mockResolvedValue(undefined),
      save: jest.fn().mockRejectedValue(new Error('write failed')),
    };
    const compute = jest.fn().mockResolvedValue(sampleDeck());

    const result = await withConversionResultCache(store, keyInput, compute);

    expect(compute).toHaveBeenCalledTimes(1);
    expect(result).toEqual(sampleDeck());
  });
});
