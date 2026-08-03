import { buildMcpServer, type McpRequestContext } from './McpServerFactory';
import type { McpToolsService } from './McpToolsService';

const buildContext = (
  overrides: Partial<McpRequestContext> = {}
): McpRequestContext => ({
  owner: 'user-1',
  locals: {},
  toolsService: {} as McpToolsService,
  recordToolCall: () => {},
  recordToolResult: () => {},
  ...overrides,
});

type ToolHandler = (
  args: Record<string, unknown>
) => Promise<{ content: { type: string; text: string }[]; isError?: boolean }>;

const getHandler = (context: McpRequestContext, name: string): ToolHandler => {
  const server = buildMcpServer(context);
  const registered = (
    server as unknown as {
      _registeredTools: Record<string, { handler: ToolHandler }>;
    }
  )._registeredTools;
  return registered[name].handler;
};

describe('buildMcpServer', () => {
  it('builds a server without throwing', () => {
    expect(() => buildMcpServer(buildContext())).not.toThrow();
  });

  it('registers every tool on the real MCP server', () => {
    const server = buildMcpServer(buildContext());
    const registered = (
      server as unknown as { _registeredTools: Record<string, unknown> }
    )._registeredTools;
    expect(Object.keys(registered).sort()).toEqual([
      'convert_to_deck',
      'create_deck',
      'deck_capabilities',
      'get_deck_preview',
      'list_my_decks',
      'photo_to_deck',
    ]);
  });

  it('records the tool call and returns the note types and options for deck_capabilities', async () => {
    const calls: string[] = [];
    const server = buildMcpServer({
      ...buildContext(),
      recordToolCall: (name) => calls.push(name),
    });
    const capabilities = (
      server as unknown as {
        _registeredTools: Record<
          string,
          { handler: () => Promise<{ content: { text: string }[] }> }
        >;
      }
    )._registeredTools.deck_capabilities;

    const result = await capabilities.handler();
    const payload = JSON.parse(result.content[0].text) as {
      noteTypes: { name: string }[];
      options: { name: string }[];
    };

    expect(calls).toEqual(['deck_capabilities']);
    expect(payload.noteTypes.map((n) => n.name)).toEqual([
      'basic',
      'basic-reversed',
      'cloze',
      'input',
      'mcq',
    ]);
    expect(payload.options.map((o) => o.name)).toEqual(
      expect.arrayContaining([
        'noteType',
        'tags',
        'deckName',
        'styleTemplate',
        'tts',
      ])
    );
  });
});

describe('create_deck handler', () => {
  it('records the distinct subdeck count on the result event', async () => {
    const createDeck = jest.fn(async () => ({
      kind: 'deck' as const,
      cardCount: 3,
      filename: 'JLPT N5.apkg',
      summary: 'Deck ready: JLPT N5 — 3 cards across 2 subdecks.',
      applied: {
        noteType: 'basic' as const,
        tags: [],
        splitByHeadings: false,
        tts: { enabled: false },
        subdecks: [
          { deck: 'JLPT N5::Grammar', cards: 1 },
          { deck: 'JLPT N5::Vocabulary', cards: 2 },
        ],
      },
    }));
    const results: Array<{
      success: boolean;
      props?: Record<string, unknown>;
    }> = [];
    const handler = getHandler(
      buildContext({
        toolsService: { createDeck } as unknown as McpToolsService,
        recordToolResult: (_name, success, _code, props) =>
          results.push({ success, props }),
      }),
      'create_deck'
    );
    await handler({ cards: [{ front: 'a', back: 'b', deck: 'X' }] });
    expect(results).toEqual([{ success: true, props: { subdeckCount: 2 } }]);
  });

  it('records a subdeck count of 1 for a flat deck with no applied subdecks', async () => {
    const createDeck = jest.fn(async () => ({
      kind: 'deck' as const,
      cardCount: 2,
      filename: 'deck.apkg',
      summary: '2 cards. Ready to download.',
    }));
    const results: Array<Record<string, unknown> | undefined> = [];
    const handler = getHandler(
      buildContext({
        toolsService: { createDeck } as unknown as McpToolsService,
        recordToolResult: (_name, _success, _code, props) =>
          results.push(props),
      }),
      'create_deck'
    );
    await handler({ cards: [{ front: 'a', back: 'b' }] });
    expect(results).toEqual([{ subdeckCount: 1 }]);
  });

  it('renders a markdown card table in the text block by default', async () => {
    const createDeck = jest.fn(async () => ({
      kind: 'deck' as const,
      cardCount: 2,
      filename: 'deck.apkg',
      downloadUrl: 'https://2anki.net/api/mcp/decks/abc/download',
      summary: '2 cards. Ready to download.',
      sampleCards: [
        { front: 'water', back: '水' },
        { front: 'fire', back: '火' },
      ],
    }));
    const handler = getHandler(
      buildContext({
        toolsService: { createDeck } as unknown as McpToolsService,
      }),
      'create_deck'
    );
    const result = await handler({ cards: [{ front: 'a', back: 'b' }] });

    expect(result.content[0].text).toContain('2 cards. Ready to download.');
    expect(result.content[0].text).toContain(
      'Download: https://2anki.net/api/mcp/decks/abc/download'
    );
    expect(result.content[0].text).toContain('| # | Front | Back |');
    expect(result.content[0].text).toContain('| 1 | water | 水 |');
  });

  it('omits the card table but keeps the summary when detail is summary', async () => {
    const createDeck = jest.fn(async () => ({
      kind: 'deck' as const,
      cardCount: 2,
      filename: 'deck.apkg',
      downloadUrl: 'https://2anki.net/api/mcp/decks/abc/download',
      summary: '2 cards. Ready to download.',
      sampleCards: [{ front: 'water', back: '水' }],
    }));
    const handler = getHandler(
      buildContext({
        toolsService: { createDeck } as unknown as McpToolsService,
      }),
      'create_deck'
    );
    const result = await handler({
      cards: [{ front: 'a', back: 'b' }],
      detail: 'summary',
    });

    expect(result.content[0].text).toContain('2 cards. Ready to download.');
    expect(result.content[0].text).not.toContain('| # | Front | Back |');
  });
});

describe('get_deck_preview handler', () => {
  it('passes a jobId through to getDeckPreview and returns the preview', async () => {
    const getDeckPreview = jest.fn(async () => ({
      cardCount: 3,
      deckCount: 1,
      decks: [],
      sampleCards: [],
    }));
    const handler = getHandler(
      buildContext({
        owner: 'user-1',
        toolsService: { getDeckPreview } as unknown as McpToolsService,
      }),
      'get_deck_preview'
    );
    const result = await handler({ jobId: 'job-1' });
    expect(getDeckPreview).toHaveBeenCalledWith('user-1', 'job-1', 0, 20);
    expect(result.isError).toBeUndefined();
  });

  it('renders the full page of cards as a markdown table, not truncated to a teaser', async () => {
    const sampleCards = Array.from({ length: 20 }, (_, i) => ({
      front: `f${i}`,
      back: `b${i}`,
    }));
    const getDeckPreview = jest.fn(async () => ({
      cardCount: 34,
      deckCount: 1,
      decks: [],
      sampleCards,
      note: 'Showing cards 1–20 of 34. Pass page (0-based) and pageSize for more.',
    }));
    const handler = getHandler(
      buildContext({
        owner: 'user-1',
        toolsService: { getDeckPreview } as unknown as McpToolsService,
      }),
      'get_deck_preview'
    );
    const result = await handler({ jobId: 'job-1' });

    expect(result.content[0].text).toContain('**34 cards**');
    expect(result.content[0].text.match(/^\| \d+ \|/gm)).toHaveLength(20);
    expect(result.content[0].text).toContain(
      'Showing cards 1–20 of 34. Pass page (0-based) and pageSize for more.'
    );
  });

  it('falls back to the key param when jobId is absent', async () => {
    const getDeckPreview = jest.fn(async () => ({
      cardCount: 1,
      deckCount: 1,
      decks: [],
      sampleCards: [],
    }));
    const handler = getHandler(
      buildContext({
        owner: 'user-1',
        toolsService: { getDeckPreview } as unknown as McpToolsService,
      }),
      'get_deck_preview'
    );
    await handler({ key: 'deck.apkg' });
    expect(getDeckPreview).toHaveBeenCalledWith('user-1', 'deck.apkg', 0, 20);
  });

  it('returns a clean error when neither jobId nor key is given', async () => {
    const getDeckPreview = jest.fn();
    const handler = getHandler(
      buildContext({
        toolsService: { getDeckPreview } as unknown as McpToolsService,
      }),
      'get_deck_preview'
    );
    const result = await handler({});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe(
      'Provide a jobId (from list_my_decks) or a deck key.'
    );
    expect(getDeckPreview).not.toHaveBeenCalled();
  });

  it('logs and surfaces the real error message on failure', async () => {
    const getDeckPreview = jest.fn(async () => {
      throw new Error('Deck not found.');
    });
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const handler = getHandler(
      buildContext({
        toolsService: { getDeckPreview } as unknown as McpToolsService,
      }),
      'get_deck_preview'
    );
    const result = await handler({ jobId: 'missing' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe('Deck not found.');
    expect(errorSpy).toHaveBeenCalledWith(
      '[mcp] get_deck_preview failed for missing: Deck not found.'
    );
    errorSpy.mockRestore();
  });
});

describe('tool result metric', () => {
  type ResultCall = [string, boolean, string?];

  it('records a successful convert_to_deck result', async () => {
    const calls: ResultCall[] = [];
    const convertToDeck = jest.fn(async () => ({
      kind: 'deck' as const,
      cardCount: 3,
      filename: 'deck.apkg',
      summary: 'ready',
    }));
    const handler = getHandler(
      buildContext({
        toolsService: { convertToDeck } as unknown as McpToolsService,
        recordToolResult: (tool, success, errorCode) =>
          calls.push([tool, success, errorCode]),
      }),
      'convert_to_deck'
    );
    await handler({ text: 'Q :: A' });
    expect(calls).toEqual([['convert_to_deck', true, undefined]]);
  });

  it('records a failed convert_to_deck result with its error code', async () => {
    const calls: ResultCall[] = [];
    const convertToDeck = jest.fn(async () => ({
      kind: 'error' as const,
      message: 'No cards found in this text.',
      code: 'empty_export',
    }));
    const handler = getHandler(
      buildContext({
        toolsService: { convertToDeck } as unknown as McpToolsService,
        recordToolResult: (tool, success, errorCode) =>
          calls.push([tool, success, errorCode]),
      }),
      'convert_to_deck'
    );
    await handler({ text: 'a table' });
    expect(calls).toEqual([['convert_to_deck', false, 'empty_export']]);
  });

  // A CSV pasted into text has to be distinguishable from a Markdown one, or
  // there is no way to read whether assistants take the text path for a
  // spreadsheet at all.
  it.each([
    [
      { text: 'front,back\n水,water', filename: 'n5.csv' },
      { inputSource: 'text', inputFormat: 'csv' },
    ],
    [{ text: 'Q :: A' }, { inputSource: 'text', inputFormat: 'none' }],
    [
      { text: '# hi', filename: 'notes.md' },
      { inputSource: 'text', inputFormat: 'md' },
    ],
    [
      { url: 'https://example.com/vocab.csv?sig=1' },
      { inputSource: 'url', inputFormat: 'csv' },
    ],
    [
      { text: 'x', filename: 'weird.qqq' },
      { inputSource: 'text', inputFormat: 'other' },
    ],
  ])('records the input source and format for %j', async (input, expected) => {
    const props: Array<Record<string, unknown> | undefined> = [];
    const convertToDeck = jest.fn(async () => ({
      kind: 'deck' as const,
      cardCount: 3,
      filename: 'deck.apkg',
      summary: 'ready',
    }));
    const handler = getHandler(
      buildContext({
        toolsService: { convertToDeck } as unknown as McpToolsService,
        recordToolResult: (_tool, _success, _code, extra) => props.push(extra),
      }),
      'convert_to_deck'
    );
    await handler(input);
    expect(props).toEqual([expected]);
  });

  it('records create_deck success and failure results', async () => {
    const successCalls: ResultCall[] = [];
    const successHandler = getHandler(
      buildContext({
        toolsService: {
          createDeck: jest.fn(async () => ({
            kind: 'deck' as const,
            cardCount: 2,
            filename: 'deck.apkg',
            summary: 'ready',
          })),
        } as unknown as McpToolsService,
        recordToolResult: (tool, success, errorCode) =>
          successCalls.push([tool, success, errorCode]),
      }),
      'create_deck'
    );
    await successHandler({ cards: [{ front: 'Q', back: 'A' }] });
    expect(successCalls).toEqual([['create_deck', true, undefined]]);

    const failCalls: ResultCall[] = [];
    const failHandler = getHandler(
      buildContext({
        toolsService: {
          createDeck: jest.fn(async () => ({
            kind: 'error' as const,
            message: 'Some cards have an empty back.',
            code: 'empty_export',
          })),
        } as unknown as McpToolsService,
        recordToolResult: (tool, success, errorCode) =>
          failCalls.push([tool, success, errorCode]),
      }),
      'create_deck'
    );
    await failHandler({ cards: [{ front: 'Q', back: '' }] });
    expect(failCalls).toEqual([['create_deck', false, 'empty_export']]);
  });
});
