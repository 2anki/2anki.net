import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  looksLikeEmptyContentExplanation,
  EMPTY_CONTENT_USER_MESSAGE,
  parseDeckResponse,
  rewriteAudioAnchors,
  normalizeTag,
  SYSTEM_PROMPT,
  buildUserMessage,
  buildUserContentBlocks,
  buildFieldMappingPromptFragment,
  dedupeIdenticalCards,
  cardDedupeKey,
  collectExistingFronts,
  buildTopUpInstruction,
  sampleEvenly,
  createCrossFileDedupState,
  absorbFileIntoCrossFileDedup,
  describeRepairFailure,
  generateDeckInfo,
  ClaudeParseError,
  ClaudeLargeSectionError,
  LARGE_SECTION_USER_MESSAGE,
  ImageOnlyContentError,
  IMAGE_ONLY_USER_MESSAGE,
  isImageOnlyContent,
  resolveFloorV1Bounds,
  type DeckInfo,
} from './ClaudeService';

const FAKE_DECK_JSON = JSON.stringify([
  { deck: 'Test Deck', cards: [{ q: 'Q1', a: 'A1' }] },
]);

const mockStreamFn = jest.fn();
const mockCreateFn = jest.fn();
const mockStream = {
  on: jest.fn().mockReturnThis(),
  finalMessage: jest.fn(),
};

jest.mock('@anthropic-ai/sdk', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    messages: { stream: mockStreamFn, create: mockCreateFn },
  })),
}));

function fakeResponse() {
  return {
    content: [{ type: 'text', text: FAKE_DECK_JSON }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 100, output_tokens: 50 },
  };
}

describe('looksLikeEmptyContentExplanation', () => {
  it('detects the reported empty-page explanation', () => {
    const cleaned =
      '{ }\n\nThe provided HTML content is a flashcard application interface template with UI elements (buttons, progress bars, card display areas) but has no actual question-and-answer content to convert into flashcards. The document consists only of structural elements like divs, buttons, and placeholder elements with IDs for dynamic content injection.';
    expect(looksLikeEmptyContentExplanation(cleaned)).toBe(true);
  });

  it('detects a variety of no-content phrasings', () => {
    const samples = [
      'I cannot find any flashcard material in this document.',
      "I couldn't find any question-and-answer pairs to extract.",
      'The page has no extractable flashcard content.',
      'Nothing to convert — the page appears to be a template.',
    ];
    for (const sample of samples) {
      expect(looksLikeEmptyContentExplanation(sample)).toBe(true);
    }
  });

  it('detects the model asking to be shown the content (prod refusal)', () => {
    const samples = [
      'I need to see the actual HTML content to convert it into Anki flashcards. The content field appears to be empty.',
      'Please provide the content you want me to turn into flashcards.',
      'Could you share the content you would like converted?',
      'No content was provided for me to convert.',
    ];
    for (const sample of samples) {
      expect(looksLikeEmptyContentExplanation(sample)).toBe(true);
    }
  });

  it('does not match a malformed but real attempt at JSON', () => {
    const truncated =
      '[{"deck":"Biology","cards":[{"q":"What is mitosis","a":"Cell div';
    expect(looksLikeEmptyContentExplanation(truncated)).toBe(false);
  });

  it('does not match an empty JSON array', () => {
    expect(looksLikeEmptyContentExplanation('[]')).toBe(false);
  });
});

describe('parseDeckResponse', () => {
  const deck = [{ deck: 'Test', cards: [{ q: 'Q', a: 'A' }] }];
  const deckJson = JSON.stringify(deck);

  it('parses clean JSON', () => {
    expect(parseDeckResponse(deckJson, deckJson, 0)).toEqual(deck);
  });

  it('parses JSON followed by Claude explanation prose (the prod failure pattern)', () => {
    const cleaned = `${deckJson}\n\nI've created flashcards for all key concepts.`;
    expect(parseDeckResponse(cleaned, cleaned, 0)).toEqual(deck);
  });

  it('parses [] followed by explanation text as an empty deck (downstream no-cards error handles it)', () => {
    const cleaned =
      '[]\n\nThe document appears to be a course overview with no actual Q&A content to convert. I cannot find any flashcard material.';
    expect(parseDeckResponse(cleaned, cleaned, 0)).toEqual([]);
  });

  it('throws ClaudeLargeSectionError for truncated/invalid JSON', () => {
    const cleaned = '[{"deck":"Bio","cards":[{"q":"What is';
    expect(() => parseDeckResponse(cleaned, cleaned, 0)).toThrow(
      ClaudeLargeSectionError
    );
  });

  it('throws ClaudeLargeSectionError when there is no ] at all', () => {
    expect(() => parseDeckResponse('not json', 'not json', 0)).toThrow(
      ClaudeLargeSectionError
    );
  });

  it('recovers a card whose value contains an unescaped ASCII " (the German-quote prod failure)', () => {
    // Claude emits raw ASCII " when source HTML has „kaputt macht" (German low/high quotes).
    // The premature " closes the string and JSON.parse dies on the following character.
    const broken =
      '[{"deck":"Corporate Finance","cards":[{"q":"Erkläre","a":"Linie „kaputt macht".</p> mehr text"}]}]';
    expect(() => JSON.parse(broken)).toThrow();
    const parsed = parseDeckResponse(broken, broken, 0);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].deck).toBe('Corporate Finance');
    expect(parsed[0].cards).toHaveLength(1);
    expect(parsed[0].cards[0].q).toBe('Erkläre');
    expect(parsed[0].cards[0].a).toContain('kaputt macht');
  });

  it('recovers a card where prose after an unescaped inner " contains a colon (the „Dreieck" prod failure)', () => {
    // jsonrepair alone survives a simple inner quote, but when the prose after
    // the quote contains a colon or parenthesis it mis-tokenizes and throws.
    const broken =
      '[{"deck":"Stadt","cards":[{"q":"Wofür ist der Bericht „Der Umzug" (2016) relevant?","a":"Drei Orte bilden das „Dreieck der Wissenschaft": <b>Campus</b> und mehr."}]}]';
    expect(describeRepairFailure(broken)).toBe('recoverable');
    const parsed = parseDeckResponse(broken, broken, 0);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].cards).toHaveLength(1);
    expect(parsed[0].cards[0].q).toContain('Der Umzug');
    expect(parsed[0].cards[0].q).toContain('(2016) relevant?');
    expect(parsed[0].cards[0].a).toContain('Dreieck der Wissenschaft');
    expect(parsed[0].cards[0].a).toContain('<b>Campus</b>');
  });

  it('throws the actionable large-section error when a repaired chunk yields no usable card', () => {
    const unrepairable = '[{"deck":"X","cards":[{"q":"a","a"';
    expect(describeRepairFailure(unrepairable)).toBe('no-usable-card');
    expect(() => parseDeckResponse(unrepairable, unrepairable, 0)).toThrow(
      ClaudeLargeSectionError
    );
  });

  it('gives a large multi-chunk response that jsonrepair throws on its own actionable message, not claude_parse_failed', () => {
    const cards = Array.from(
      { length: 60 },
      (_, i) =>
        `{"q":"Synthetic question number ${i}","a":"Synthetic answer number ${i}"}`
    ).join(',');
    const bigChunk = `[{"deck":"Chapter","cards":[${cards}]}] } } { ]`;
    expect(describeRepairFailure(bigChunk)).toBe('jsonrepair-threw');
    expect(looksLikeEmptyContentExplanation(bigChunk)).toBe(false);
    let caught: unknown;
    try {
      parseDeckResponse(bigChunk, bigChunk, 2);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ClaudeLargeSectionError);
    expect((caught as Error).message).toBe(LARGE_SECTION_USER_MESSAGE);
    expect((caught as Error).message).not.toBe('claude_parse_failed');
  });

  it.each([
    ['SOH 0x01', 0x01],
    ['BEL 0x07', 0x07],
    ['VT 0x0b', 0x0b],
    ['ESC 0x1b', 0x1b],
    ['US 0x1f', 0x1f],
  ])(
    'recovers a card whose value contains a stray %s control char (PDF-extraction prod failure)',
    (_label, code) => {
      const ctrl = String.fromCharCode(code);
      const broken = `[{"deck":"Politisches System","cards":[{"q":"Was ist${ctrl}Gewaltenteilung?","a":"Die Trennung der Gewalten"}]}]`;
      expect(() => JSON.parse(broken)).toThrow();
      const parsed = parseDeckResponse(broken, broken, 0);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].cards).toHaveLength(1);
      expect(parsed[0].cards[0].q).toContain('Gewaltenteilung');
      expect(parsed[0].cards[0].a).toBe('Die Trennung der Gewalten');
    }
  );

  it('preserves legal newlines and tabs while escaping stray control chars', () => {
    const ctrl = String.fromCharCode(0x0b);
    const broken = `[{"deck":"D","cards":[{"q":"Line one\nLine${ctrl}two","a":"Tab\there"}]}]`;
    expect(() => JSON.parse(broken)).toThrow();
    const parsed = parseDeckResponse(broken, broken, 0);
    expect(parsed[0].cards[0].q).toContain('Line one\nLine');
    expect(parsed[0].cards[0].a).toBe('Tab\there');
  });

  it('logs the full raw response body on unrecoverable parse failure for reproducibility', () => {
    const errorSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    try {
      const raw = '[{"deck":"X","cards":[{"q":"a","a"';
      try {
        parseDeckResponse(raw, raw, 0);
      } catch {
        // expected
      }
      const fullDump = errorSpy.mock.calls.find(
        ([msg]) =>
          msg === '[Claude] Unrecoverable parse failure — full response'
      );
      expect(fullDump).toBeDefined();
      const payload = fullDump![1] as { chunkIndex: number };
      expect(payload.chunkIndex).toBe(0);
      // raw goes as its own string argument: util.inspect truncates strings
      // inside objects at 10k chars, which silently dropped most of the dump.
      expect(fullDump![2]).toBe(raw);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('recovers a cloze-only deck where every card has a: "" (cloze cards legitimately have no answer field)', () => {
    const broken =
      '[{"deck":"Cloze Test","cards":[{"q":"{{c1::Paris}} is the capital of France","a":"","cloze":true}]}]';
    expect(() => JSON.parse(broken)).not.toThrow();
    const withRepair = broken.slice(0, -2);
    expect(() => JSON.parse(withRepair)).toThrow();
    const clozeOnly =
      '[{"deck":"Cloze Test","cards":[{"q":"The {{c1::mitochondria}} is the powerhouse","a":"","cloze":true}]}';
    const parsed = parseDeckResponse(clozeOnly, clozeOnly, 0);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].deck).toBe('Cloze Test');
    expect(parsed[0].cards).toHaveLength(1);
    expect(parsed[0].cards[0].q).toContain('mitochondria');
    expect(parsed[0].cards[0].cloze).toBe(true);
  });

  it('tolerates leading, interior, and trailing whitespace inside the JSON portion', () => {
    const padded = `  \n\t${deckJson}   \n  `;
    expect(parseDeckResponse(padded, padded, 0)).toEqual(deck);
  });

  it('preserves literal backticks inside card content (nested-fence robustness)', () => {
    const withBackticks =
      '[{"deck":"Shell","cards":[{"q":"List files","a":"Run `ls -la` to see hidden files"}]}]';
    const parsed = parseDeckResponse(withBackticks, withBackticks, 0);
    expect(parsed[0].cards[0].a).toBe('Run `ls -la` to see hidden files');
  });

  it('emits a structured warning when trailing prose is stripped (model-drift signal)', () => {
    const warnSpy = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    try {
      const cleaned = `${deckJson}\n\nI've created flashcards for all key concepts.`;
      parseDeckResponse(cleaned, cleaned, 7);
      expect(warnSpy).toHaveBeenCalledWith(
        '[Claude] Trailing prose stripped',
        expect.objectContaining({
          chunkIndex: 7,
          strippedBytes: expect.any(Number),
        })
      );
      const callArg = warnSpy.mock.calls.find(
        ([msg]) => msg === '[Claude] Trailing prose stripped'
      )![1] as { strippedBytes: number };
      expect(callArg.strippedBytes).toBeGreaterThan(0);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('does not warn about trailing prose when JSON parses cleanly with no trailing content', () => {
    const warnSpy = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    try {
      parseDeckResponse(deckJson, deckJson, 0);
      expect(warnSpy).not.toHaveBeenCalledWith(
        '[Claude] Trailing prose stripped',
        expect.anything()
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('recovers a fenced response with ```json prefix (prod fence failure pattern)', () => {
    const fenced = '```json\n' + deckJson + '\n```';
    const cleaned = fenced.replace(/^```json\n?|^```\n?|```\s*$/gm, '').trim();
    expect(parseDeckResponse(cleaned, fenced, 0)).toEqual(deck);
  });

  it('recovers a fenced response with leading prose before the opening fence', () => {
    const withProse =
      'Here are your flashcards:\n\n```json\n' + deckJson + '\n```';
    const cleaned = withProse
      .replace(/^```json\n?|^```\n?|```\s*$/gm, '')
      .trim();
    expect(parseDeckResponse(cleaned, withProse, 0)).toEqual(deck);
  });

  it('recovers a fenced response with trailing prose after the closing fence', () => {
    const withTrailing =
      '```json\n' + deckJson + '\n```\n\nI hope these are helpful.';
    const cleaned = withTrailing
      .replace(/^```json\n?|^```\n?|```\s*$/gm, '')
      .trim();
    expect(parseDeckResponse(cleaned, withTrailing, 0)).toEqual(deck);
  });

  it('preserves backticks inside a card answer field after fence stripping', () => {
    const cardWithBacktick =
      '[{"deck":"Shell","cards":[{"q":"List files","a":"Run `ls -la` to see all files"}]}]';
    const fenced = '```json\n' + cardWithBacktick + '\n```';
    const cleaned = fenced.replace(/^```json\n?|^```\n?|```\s*$/gm, '').trim();
    const parsed = parseDeckResponse(cleaned, fenced, 0);
    expect(parsed[0].cards[0].a).toBe('Run `ls -la` to see all files');
  });

  it('throws the actionable large-section error when a chunk cannot be parsed or repaired', () => {
    const errorSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    try {
      expect(() =>
        parseDeckResponse('no json here at all', 'no json here at all', 0)
      ).toThrow(
        expect.objectContaining({
          message: LARGE_SECTION_USER_MESSAGE,
          name: 'ClaudeLargeSectionError',
        })
      );
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('throws ClaudeParseError with message "claude_parse_failed" for valid JSON that is not a deck array', () => {
    const errorSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    try {
      expect(() =>
        parseDeckResponse('{"not":"an array"}', '{"not":"an array"}', 0)
      ).toThrow(
        expect.objectContaining({
          message: 'claude_parse_failed',
          name: 'ClaudeParseError',
        })
      );
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('thrown error message does not contain any substring of the input payload', () => {
    const payload =
      '[{"deck":"Secret","cards":[{"q":"sensitive question","a":"sensitive answer"}';
    const errorSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    try {
      let caughtMessage = '';
      try {
        parseDeckResponse(payload, payload, 0);
      } catch (e) {
        caughtMessage = e instanceof Error ? e.message : String(e);
      }
      expect(caughtMessage).not.toContain('[{');
      expect(caughtMessage).not.toContain('```');
      expect(caughtMessage).not.toContain('Secret');
      expect(caughtMessage).not.toContain('sensitive');
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('emits a redacted payload-shape summary (no raw content in that line) on parse failure', () => {
    const errorSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    try {
      try {
        parseDeckResponse('not valid json at all', 'not valid json at all', 3);
      } catch {
        // expected
      }
      const summary = errorSpy.mock.calls.find(
        ([msg]) => msg === '[Claude] Failed to parse response as JSON'
      );
      expect(summary).toBeDefined();
      const loggedObj = summary![1] as Record<string, unknown>;
      expect(loggedObj).toMatchObject({
        chunkIndex: 3,
        raw: expect.objectContaining({
          length: expect.any(Number),
          prefix: expect.any(String),
          sha256_prefix: expect.any(String),
        }),
        cleaned: expect.objectContaining({
          length: expect.any(Number),
          prefix: expect.any(String),
          sha256_prefix: expect.any(String),
        }),
        toParse: expect.objectContaining({
          length: expect.any(Number),
          prefix: expect.any(String),
          sha256_prefix: expect.any(String),
        }),
      });
      const rawVal = loggedObj.raw as Record<string, unknown>;
      expect(typeof rawVal.raw).toBe('undefined');
    } finally {
      errorSpy.mockRestore();
    }
  });
});

describe('describeRepairFailure', () => {
  it('reports prose that repairs to a non-array value', () => {
    expect(describeRepairFailure('I need to see the actual content')).toBe(
      'not-array'
    );
  });

  it('reports a repaired structure that yields no usable card', () => {
    expect(describeRepairFailure('[{"deck":"D","cards":[]}]')).toBe(
      'no-usable-card'
    );
  });

  it('reports recoverable input as recoverable', () => {
    const truncated =
      '[{"deck":"D","cards":[{"q":"Q1","a":"A1","tags":["x"]},{"q":"Q2","a":"part';
    expect(describeRepairFailure(truncated)).toBe('recoverable');
  });
});

const FIXTURES_DIR = path.join(__dirname, '__fixtures__');

function loadFixture(name: string): string {
  return fs.readFileSync(path.join(FIXTURES_DIR, name), 'utf-8');
}

function applyFenceStrip(raw: string): string {
  return raw.replace(/^```json\n?|^```\n?|```\s*$/gm, '').trim();
}

describe('parseDeckResponse — prod fixture recovery', () => {
  it.each([
    'failure-1.txt',
    'failure-2.txt',
    'failure-3.txt',
    'failure-4.txt',
    'failure-5.txt',
  ])('fixture %s parses to a non-empty deck array', (fixtureName) => {
    const raw = loadFixture(fixtureName);
    const cleaned = applyFenceStrip(raw);
    const result = parseDeckResponse(cleaned, raw, 0);
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].cards.length).toBeGreaterThan(0);
  });
});

describe('rewriteAudioAnchors', () => {
  it('replaces an mp3 anchor with a [sound:] token and lists the filename', () => {
    const { back, audioFilenames } = rewriteAudioAnchors(
      '<p>Listen: <a href="pronunciation.mp3">play</a></p>'
    );
    expect(audioFilenames).toEqual(['pronunciation.mp3']);
    expect(back).toContain('[sound:pronunciation.mp3]');
    expect(back).not.toContain('<a href');
  });

  it('strips the wrapping <figure> when present', () => {
    const { back } = rewriteAudioAnchors(
      '<figure><a href="word.ogg">🔊</a><figcaption>word</figcaption></figure>'
    );
    expect(back).not.toContain('<figure');
    expect(back).not.toContain('<a');
    expect(back).toContain('[sound:word.ogg]');
  });

  it('deduplicates if the same file is referenced twice on one card', () => {
    const { audioFilenames, back } = rewriteAudioAnchors(
      '<a href="a.mp3">x</a><a href="a.mp3">y</a>'
    );
    expect(audioFilenames).toEqual(['a.mp3']);
    expect(back.match(/\[sound:a\.mp3\]/g)).toHaveLength(1);
  });

  it('leaves http(s) audio links alone', () => {
    const input = '<a href="https://example.com/hello.mp3">play</a>';
    const { back, audioFilenames } = rewriteAudioAnchors(input);
    expect(audioFilenames).toEqual([]);
    expect(back).toContain(input);
  });

  it('decodes URL-encoded filenames before emitting the sound token', () => {
    const { back, audioFilenames } = rewriteAudioAnchors(
      '<a href="my%20word.m4a">play</a>'
    );
    expect(audioFilenames).toEqual(['my word.m4a']);
    expect(back).toContain('[sound:my word.m4a]');
  });

  it('supports ogg, wav, flac, m4a, aac, opus', () => {
    const exts = ['ogg', 'wav', 'flac', 'm4a', 'aac', 'opus'];
    for (const ext of exts) {
      const { audioFilenames } = rewriteAudioAnchors(
        `<a href="clip.${ext}">x</a>`
      );
      expect(audioFilenames).toEqual([`clip.${ext}`]);
    }
  });

  it('does nothing when the card has no audio links', () => {
    const input = '<p>No audio here</p><img src="x.png"/>';
    const { back, audioFilenames } = rewriteAudioAnchors(input);
    expect(audioFilenames).toEqual([]);
    expect(back).toBe(input);
  });
});

describe('normalizeTag', () => {
  it('lowercases an uppercase tag', () => {
    expect(normalizeTag('Enzymes')).toBe('enzymes');
  });

  it('replaces spaces with underscores', () => {
    expect(normalizeTag('michaelis menten')).toBe('michaelis_menten');
  });

  it('strips characters outside [a-z0-9_]', () => {
    expect(normalizeTag('cell-biology!')).toBe('cellbiology');
  });

  it('caps the tag at 32 characters', () => {
    const long = 'a'.repeat(40);
    expect(normalizeTag(long)).toHaveLength(32);
  });

  it('converts a mixed-case tag with spaces into normalized form', () => {
    expect(normalizeTag('Michaelis Menten Kinetics')).toBe(
      'michaelis_menten_kinetics'
    );
  });

  it('returns an empty string for a tag that is all punctuation', () => {
    expect(normalizeTag('!!!')).toBe('');
  });
});

describe('parseDeckResponse — tags', () => {
  it('carries tags from a Claude response through to the parsed deck', () => {
    const raw = JSON.stringify([
      {
        deck: 'Biochemistry',
        cards: [
          {
            q: 'What is an enzyme?',
            a: 'A biological catalyst',
            tags: ['enzymes', 'kinetics'],
          },
          { q: 'What is ATP?', a: 'Adenosine triphosphate' },
        ],
      },
    ]);
    const parsed = parseDeckResponse(raw, raw, 0);
    expect(parsed[0].cards[0].tags).toEqual(['enzymes', 'kinetics']);
    expect(parsed[0].cards[1].tags).toBeUndefined();
  });
});

describe('EMPTY_CONTENT_USER_MESSAGE', () => {
  it('is friendly and free of technical jargon', () => {
    expect(EMPTY_CONTENT_USER_MESSAGE).toMatch(/Claude/);
    expect(EMPTY_CONTENT_USER_MESSAGE.toLowerCase()).not.toMatch(
      /html|<div|dom|dynamic content injection/
    );
    expect(EMPTY_CONTENT_USER_MESSAGE.toLowerCase()).toContain('notion page');
    expect(EMPTY_CONTENT_USER_MESSAGE.toLowerCase()).toMatch(
      /empty|layout element/
    );
  });
});

describe('LARGE_SECTION_USER_MESSAGE', () => {
  it('tells the user what happened and what to do next, without jargon', () => {
    expect(LARGE_SECTION_USER_MESSAGE.toLowerCase()).toContain('smaller');
    expect(LARGE_SECTION_USER_MESSAGE.toLowerCase()).toContain('split');
    expect(LARGE_SECTION_USER_MESSAGE.toLowerCase()).not.toMatch(
      /json|jsonrepair|parse|token|chunk/
    );
    expect(LARGE_SECTION_USER_MESSAGE).not.toBe('claude_parse_failed');
  });
});

describe('isImageOnlyContent', () => {
  it('detects HTML whose only content is images', () => {
    const html = '<div><img src="a.png"><img src="b.png"></div>';
    expect(isImageOnlyContent(html)).toBe(true);
  });

  it('detects images wrapped in figures with empty captions', () => {
    const html =
      '<figure><img src="screenshot.png"><figcaption>   </figcaption></figure>';
    expect(isImageOnlyContent(html)).toBe(true);
  });

  it('returns false when meaningful text accompanies the images', () => {
    const html =
      '<h1>Photosynthesis</h1><p>Plants convert light into energy.</p><img src="diagram.png">';
    expect(isImageOnlyContent(html)).toBe(false);
  });

  it('returns false for text-only HTML with no images', () => {
    const html = '<p>Just some notes with no pictures at all.</p>';
    expect(isImageOnlyContent(html)).toBe(false);
  });

  it('returns false for empty HTML with no images', () => {
    expect(isImageOnlyContent('<div></div>')).toBe(false);
  });
});

describe('IMAGE_ONLY_USER_MESSAGE', () => {
  it('says what happened and what to do, free of jargon', () => {
    expect(IMAGE_ONLY_USER_MESSAGE.toLowerCase()).toContain('image');
    expect(IMAGE_ONLY_USER_MESSAGE.toLowerCase()).toContain('text');
    expect(IMAGE_ONLY_USER_MESSAGE.toLowerCase()).not.toMatch(
      /<img|html|dom|parse/
    );
  });
});

describe('generateDeckInfo — image-only input', () => {
  const imageOnlyHtml =
    '<html><body><div><img src="a.png"><img src="b.png"></div></body></html>';
  const textHtml =
    '<html><body><h1>Cells</h1><p>The cell is the basic unit of life.</p><img src="c.png"></body></html>';

  beforeEach(() => {
    jest.clearAllMocks();
    mockStreamFn.mockReturnValue(mockStream);
    mockStream.on.mockReturnThis();
    mockStream.finalMessage.mockResolvedValue(fakeResponse());
  });

  it('rejects with the friendly message and never calls Claude', async () => {
    await expect(generateDeckInfo(imageOnlyHtml, [])).rejects.toBeInstanceOf(
      ImageOnlyContentError
    );
    expect(mockStreamFn).not.toHaveBeenCalled();
  });

  it('carries the user-facing message on the error', async () => {
    await expect(generateDeckInfo(imageOnlyHtml, [])).rejects.toThrow(
      IMAGE_ONLY_USER_MESSAGE
    );
  });

  it('proceeds normally when text accompanies images', async () => {
    const result = await generateDeckInfo(textHtml, []);
    expect(result.length).toBeGreaterThan(0);
    expect(mockStreamFn).toHaveBeenCalled();
  });
});

describe('generateDeckInfo — PDF image fallback', () => {
  let baseDir: string;
  const fallbackHtml =
    '<html><body><details><summary><img src="page-1.png"/></summary></details></body></html>';

  beforeEach(() => {
    jest.clearAllMocks();
    mockStreamFn.mockReturnValue(mockStream);
    mockStream.on.mockReturnThis();
    mockStream.finalMessage.mockResolvedValue(fakeResponse());
    baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gdi-pdfimg-'));
    fs.writeFileSync(path.join(baseDir, 'page-1.png'), Buffer.from('pngbytes'));
  });

  afterEach(() => {
    fs.rmSync(baseDir, { recursive: true, force: true });
  });

  it('routes page images to Claude vision instead of throwing ImageOnlyContentError', async () => {
    mockCreateFn.mockResolvedValue({
      content: [{ type: 'text', text: FAKE_DECK_JSON }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 1, output_tokens: 1 },
    });

    const result = await generateDeckInfo(
      fallbackHtml,
      [],
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { pdfImageFallback: { mediaBaseDir: baseDir } }
    );

    expect(result.length).toBeGreaterThan(0);
    expect(mockCreateFn).toHaveBeenCalled();
    expect(mockStreamFn).not.toHaveBeenCalled();
  });

  it('still rejects a genuine image-only upload when no fallback flag is set', async () => {
    await expect(generateDeckInfo(fallbackHtml, [])).rejects.toBeInstanceOf(
      ImageOnlyContentError
    );
    expect(mockCreateFn).not.toHaveBeenCalled();
  });
});

describe('generateDeckInfo — transient chunk retry', () => {
  const { APIConnectionError } = jest.requireActual('@anthropic-ai/sdk');
  const textHtml =
    '<html><body><h1>Cells</h1><p>The cell is the basic unit of life.</p></body></html>';

  beforeEach(() => {
    jest.clearAllMocks();
    mockStreamFn.mockReturnValue(mockStream);
    mockStream.on.mockReturnThis();
  });

  it('re-issues the stream once when a chunk drops mid-flight, then succeeds', async () => {
    mockStream.finalMessage
      .mockRejectedValueOnce(
        new APIConnectionError({ message: 'socket hang up' })
      )
      .mockResolvedValueOnce(fakeResponse());

    const result = await generateDeckInfo(textHtml, []);

    expect(result.length).toBeGreaterThan(0);
    expect(mockStream.finalMessage).toHaveBeenCalledTimes(2);
  });

  it('does not retry a non-transient error and surfaces it', async () => {
    mockStream.finalMessage.mockRejectedValue(new Error('boom'));

    await expect(generateDeckInfo(textHtml, [])).rejects.toThrow('boom');
    expect(mockStream.finalMessage).toHaveBeenCalledTimes(1);
  });
});

describe('SYSTEM_PROMPT — Anki math conventions', () => {
  it('specifies \\(...\\) for inline math', () => {
    expect(SYSTEM_PROMPT).toContain('\\(...\\)');
  });

  it('specifies \\[...\\] for display math', () => {
    expect(SYSTEM_PROMPT).toContain('\\[...\\]');
  });

  it('forbids $...$ inline delimiter', () => {
    expect(SYSTEM_PROMPT).toMatch(/NEVER\s+\$\.\.\.\$/);
  });

  it('forbids $$...$$ display delimiter', () => {
    expect(SYSTEM_PROMPT).toMatch(/NEVER\s+\$\$\.\.\.\$\$/);
  });

  it('includes a chemistry example using \\ce{}', () => {
    expect(SYSTEM_PROMPT).toContain('\\ce{');
  });
});

describe('buildFieldMappingPromptFragment', () => {
  it('returns empty string when fieldMapping is undefined', () => {
    expect(buildFieldMappingPromptFragment(undefined)).toBe('');
  });

  it('returns empty string when fields array is empty', () => {
    expect(
      buildFieldMappingPromptFragment({ templateName: 'n2a-basic', fields: [] })
    ).toBe('');
  });

  it('includes each field name and instruction', () => {
    const fragment = buildFieldMappingPromptFragment({
      templateName: 'n2a-basic',
      fields: [
        { name: 'Front', instruction: 'The question or term' },
        { name: 'Back', instruction: 'The answer or definition' },
      ],
    });
    expect(fragment).toContain('Front');
    expect(fragment).toContain('The question or term');
    expect(fragment).toContain('Back');
    expect(fragment).toContain('The answer or definition');
  });

  it('includes the template name', () => {
    const fragment = buildFieldMappingPromptFragment({
      templateName: 'n2a-cloze',
      fields: [{ name: 'Text', instruction: 'Cloze sentence' }],
    });
    expect(fragment).toContain('n2a-cloze');
  });
});

describe('buildUserMessage — field mapping', () => {
  const content = '<p>Test</p>';
  const noMedia: string[] = [];

  it('appends field mapping section when fieldMapping is provided', () => {
    const msg = buildUserMessage(content, noMedia, undefined, '', undefined, {
      templateName: 'n2a-basic',
      fields: [
        { name: 'Front', instruction: 'The question or term' },
        { name: 'Back', instruction: 'The answer or definition' },
      ],
    });
    expect(msg).toContain('Field mapping');
    expect(msg).toContain('Front');
    expect(msg).toContain('Back');
  });

  it('omits field mapping section when fieldMapping is undefined', () => {
    const msg = buildUserMessage(
      content,
      noMedia,
      undefined,
      '',
      undefined,
      undefined
    );
    expect(msg).not.toContain('Field mapping');
  });

  it('places field mapping after additional instructions when both are present', () => {
    const msg = buildUserMessage(
      content,
      noMedia,
      'Custom rule.',
      '',
      undefined,
      {
        templateName: 'n2a-basic',
        fields: [
          { name: 'Front', instruction: 'term' },
          { name: 'Back', instruction: 'def' },
        ],
      }
    );
    const instrIdx = msg.indexOf('Additional instructions:');
    const mappingIdx = msg.indexOf('Field mapping');
    expect(instrIdx).toBeGreaterThan(-1);
    expect(mappingIdx).toBeGreaterThan(instrIdx);
  });
});

describe('buildUserMessage — card size suffix', () => {
  const content = '<p>Test</p>';
  const noMedia: string[] = [];

  it('appends short size instruction when cardSize is short', () => {
    const msg = buildUserMessage(content, noMedia, undefined, '', 'short');
    expect(msg).toContain('1 fact per card');
    expect(msg).toContain('80 characters');
  });

  it('appends medium size instruction when cardSize is medium', () => {
    const msg = buildUserMessage(content, noMedia, undefined, '', 'medium');
    expect(msg).toContain('1-2 facts per card');
    expect(msg).toContain('160 characters');
  });

  it('appends detailed size instruction when cardSize is detailed', () => {
    const msg = buildUserMessage(content, noMedia, undefined, '', 'detailed');
    expect(msg).toContain('3-4 facts per card');
    expect(msg).toContain('320 characters');
  });

  it('omits size section when cardSize is undefined', () => {
    const msg = buildUserMessage(content, noMedia, undefined, '', undefined);
    expect(msg).not.toContain('Card size:');
  });

  it('includes size section after additional instructions', () => {
    const msg = buildUserMessage(content, noMedia, 'Extra rule.', '', 'short');
    const instrIdx = msg.indexOf('Additional instructions:');
    const sizeIdx = msg.indexOf('Card size:');
    expect(instrIdx).toBeGreaterThan(-1);
    expect(sizeIdx).toBeGreaterThan(instrIdx);
  });
});

function truncatedResponse() {
  return {
    content: [{ type: 'text', text: FAKE_DECK_JSON.slice(0, 20) }],
    stop_reason: 'max_tokens',
    usage: { input_tokens: 100, output_tokens: 50 },
  };
}

describe('generateDeckInfo — partial chunk success (default)', () => {
  const htmlTwoChunks = '<p>' + 'x'.repeat(39_990) + '</p><p>y</p>';

  beforeEach(() => {
    jest.clearAllMocks();
    mockStreamFn.mockReturnValue(mockStream);
    mockStream.on.mockReturnThis();
  });

  it('one chunk fails to parse → call resolves with the succeeded chunks and logs the failure', async () => {
    mockStream.finalMessage
      .mockResolvedValueOnce(fakeResponse())
      .mockRejectedValueOnce(new Error('chunk 1 parse error'));

    const infoSpy = jest
      .spyOn(console, 'info')
      .mockImplementation(() => undefined);
    try {
      const result = await generateDeckInfo(htmlTwoChunks, []);
      expect(result.length).toBeGreaterThan(0);
      expect(result[0].cards.length).toBeGreaterThan(0);
      expect(infoSpy).toHaveBeenCalledWith(
        '[Claude] Some chunks failed; continuing with the rest',
        expect.objectContaining({ ok: 1, total: 2 })
      );
      const callArg = infoSpy.mock.calls.find(
        ([msg]) =>
          msg === '[Claude] Some chunks failed; continuing with the rest'
      )![1] as { failures: Array<{ chunkIndex: number; reason: string }> };
      expect(callArg.failures).toHaveLength(1);
      expect(callArg.failures[0].reason).toBe('chunk 1 parse error');
    } finally {
      infoSpy.mockRestore();
    }
  });

  it('all chunks fail → call rejects with the first failure reason', async () => {
    mockStream.finalMessage
      .mockRejectedValueOnce(new Error('chunk 0 failed'))
      .mockRejectedValueOnce(new Error('chunk 1 failed'));

    await expect(generateDeckInfo(htmlTwoChunks, [])).rejects.toThrow(
      'chunk 0 failed'
    );
  });
});

describe('generateDeckInfo — truncated chunk retry', () => {
  const htmlOneChunk =
    '<details>' +
    'x'.repeat(10_000) +
    '</details><details>' +
    'y'.repeat(10_000) +
    '</details>';

  beforeEach(() => {
    jest.clearAllMocks();
    mockStreamFn.mockReturnValue(mockStream);
    mockStream.on.mockReturnThis();
  });

  it('stop_reason max_tokens → splits the chunk in half and retries, then succeeds', async () => {
    mockStream.finalMessage
      .mockResolvedValueOnce(truncatedResponse())
      .mockResolvedValueOnce(fakeResponse())
      .mockResolvedValueOnce(fakeResponse());

    const result = await generateDeckInfo(htmlOneChunk, []);

    expect(mockStream.finalMessage).toHaveBeenCalledTimes(3);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].cards.length).toBeGreaterThan(0);
  });

  it('one retried half truncates again → the half that parsed is kept', async () => {
    mockStream.finalMessage
      .mockResolvedValueOnce(truncatedResponse())
      .mockResolvedValueOnce(fakeResponse())
      .mockResolvedValueOnce(truncatedResponse());

    const infoSpy = jest
      .spyOn(console, 'info')
      .mockImplementation(() => undefined);
    try {
      const result = await generateDeckInfo(htmlOneChunk, []);
      expect(result[0].cards.length).toBeGreaterThan(0);
    } finally {
      infoSpy.mockRestore();
    }
  });

  it('retried halves still truncate → chunk is dropped, sibling chunk survives', async () => {
    const htmlTwoChunks =
      '<p>' +
      'a'.repeat(39_990) +
      '</p>' +
      '<details>' +
      'b'.repeat(10_000) +
      '</details><details>' +
      'c'.repeat(10_000) +
      '</details>';

    mockStream.finalMessage
      .mockResolvedValueOnce(fakeResponse())
      .mockResolvedValueOnce(truncatedResponse())
      .mockResolvedValueOnce(truncatedResponse())
      .mockResolvedValueOnce(truncatedResponse());

    const infoSpy = jest
      .spyOn(console, 'info')
      .mockImplementation(() => undefined);
    try {
      const result = await generateDeckInfo(htmlTwoChunks, []);
      expect(result.length).toBeGreaterThan(0);
      expect(result[0].cards.length).toBeGreaterThan(0);
    } finally {
      infoSpy.mockRestore();
    }
  });
});

function makeDeck(
  name: string,
  cards: Array<{ name: string; back: string }>
): DeckInfo {
  return {
    name,
    image: '',
    style: null,
    id: 1,
    settings: {},
    cards: cards.map((c) => ({
      name: c.name,
      back: c.back,
      tags: [],
      cloze: false,
      number: 0,
      enableInput: false,
      answer: '',
      media: [],
    })),
  };
}

describe('dedupeIdenticalCards', () => {
  it('removes a card identical in front and back to an earlier card', () => {
    const deck = makeDeck('Biology', [
      { name: 'What is mitosis?', back: 'Cell division' },
      { name: '  What is mitosis?  ', back: 'Cell division' },
    ]);
    const result = dedupeIdenticalCards([deck]);
    expect(result[0].cards).toHaveLength(1);
    expect(result[0].cards[0].back).toBe('Cell division');
  });

  it('keeps two cards that share a front but carry different backs', () => {
    // A table row emitting one card per column: the fronts collide on the
    // row's key term, the backs are the distinct facts. Front-only dedup
    // dropped every column after the first (#3849).
    const deck = makeDeck('Elements', [
      { name: 'Sodium', back: 'Symbol: Na' },
      { name: 'Sodium', back: 'Atomic number: 11' },
      { name: 'Sodium', back: 'Group: 1' },
    ]);
    const result = dedupeIdenticalCards([deck]);
    expect(result[0].cards).toHaveLength(3);
    expect(result[0].cards.map((c) => c.back)).toEqual([
      'Symbol: Na',
      'Atomic number: 11',
      'Group: 1',
    ]);
  });

  it('normalizes by lowercasing before comparing', () => {
    const deck = makeDeck('Biochemistry', [
      { name: 'What is ATP?', back: 'Adenosine triphosphate' },
      { name: 'WHAT IS ATP?', back: 'adenosine triphosphate' },
    ]);
    const result = dedupeIdenticalCards([deck]);
    expect(result[0].cards).toHaveLength(1);
    expect(result[0].cards[0].back).toBe('Adenosine triphosphate');
  });

  it('collapses internal whitespace and markup before comparing', () => {
    const deck = makeDeck('Chemistry', [
      { name: 'What is H2O?', back: 'Water' },
      { name: 'What  is  H2O?', back: '<p>Water</p>' },
    ]);
    const result = dedupeIdenticalCards([deck]);
    expect(result[0].cards).toHaveLength(1);
  });

  it('keeps cards with distinct fronts intact', () => {
    const deck = makeDeck('Physics', [
      { name: 'What is velocity?', back: 'Speed with direction' },
      { name: 'What is acceleration?', back: 'Rate of change of velocity' },
    ]);
    const result = dedupeIdenticalCards([deck]);
    expect(result[0].cards).toHaveLength(2);
  });

  it('dedupes per-deck independently — same card in two different decks is kept in each', () => {
    const deckA = makeDeck('DeckA', [
      { name: 'Shared front', back: 'Same answer' },
    ]);
    const deckB = makeDeck('DeckB', [
      { name: 'Shared front', back: 'Same answer' },
    ]);
    const result = dedupeIdenticalCards([deckA, deckB]);
    expect(result).toHaveLength(2);
    expect(result[0].cards).toHaveLength(1);
    expect(result[1].cards).toHaveLength(1);
  });

  it('handles an empty deck without throwing', () => {
    const deck = makeDeck('Empty', []);
    const result = dedupeIdenticalCards([deck]);
    expect(result[0].cards).toHaveLength(0);
  });

  it('logs the number of removed duplicates when dedup occurs', () => {
    const warnSpy = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    try {
      const deck = makeDeck('Bio', [
        { name: 'What is a cell?', back: 'Basic unit of life' },
        { name: 'What is a cell?', back: 'Basic unit of life' },
      ]);
      dedupeIdenticalCards([deck]);
      expect(warnSpy).toHaveBeenCalledWith(
        '[Claude] dedupeIdenticalCards',
        expect.objectContaining({ deckName: 'Bio', removed: 1 })
      );
    } finally {
      warnSpy.mockRestore();
    }
  });
});

describe('collectExistingFronts', () => {
  it('flattens every card front across decks in order', () => {
    const fronts = collectExistingFronts([
      makeDeck('A', [
        { name: 'Front 1', back: 'B1' },
        { name: 'Front 2', back: 'B2' },
      ]),
      makeDeck('B', [{ name: 'Front 3', back: 'B3' }]),
    ]);
    expect(fronts).toEqual(['Front 1', 'Front 2', 'Front 3']);
  });
});

describe('buildTopUpInstruction', () => {
  it('lists the existing fronts under a do-not-repeat directive', () => {
    const instruction = buildTopUpInstruction(
      ['Mitochondria role', 'Ribosome role'],
      'medium'
    );
    expect(instruction).toContain('Do NOT repeat any of these fronts');
    expect(instruction).toContain('- Mitochondria role');
    expect(instruction).toContain('- Ribosome role');
    expect(instruction).toContain('Return only net-new cards');
  });

  it('caps the listed fronts at 80 but samples across the whole accumulated list', () => {
    const fronts = Array.from({ length: 200 }, (_, i) => `Front ${i}`);
    const instruction = buildTopUpInstruction(fronts, 'medium');
    const listed = instruction
      .split('\n')
      .filter((line) => line.startsWith('- Front '));
    expect(listed).toHaveLength(80);
    // Every earlier file is represented: fronts from both the early and late
    // ranges appear, not just the first 80.
    expect(instruction).toContain('- Front 0');
    expect(instruction).toContain('- Front 197');
    expect(instruction).not.toContain('- Front 79\n- Front 80');
  });
});

describe('sampleEvenly', () => {
  it('returns the list unchanged when at or under the cap', () => {
    expect(sampleEvenly([1, 2, 3], 5)).toEqual([1, 2, 3]);
  });

  it('spreads the sample deterministically across the whole list', () => {
    const items = Array.from({ length: 10 }, (_, i) => i);
    expect(sampleEvenly(items, 5)).toEqual([0, 2, 4, 6, 8]);
  });
});

describe('cardDedupeKey', () => {
  it('joins normalized front and back with a NUL, not a space', () => {
    expect(cardDedupeKey({ name: 'Front', back: 'Back' })).toBe('front\0back');
  });

  it('keeps a boundary-shifted split distinct (NUL separator)', () => {
    const a = cardDedupeKey({ name: 'Krebs cycle', back: 'produces ATP' });
    const b = cardDedupeKey({ name: 'Krebs', back: 'cycle produces ATP' });
    expect(a).not.toBe(b);
  });
});

describe('cross-file dedup accumulator', () => {
  it('keeps every card of the first file and records its fronts', () => {
    const state = createCrossFileDedupState();
    const kept = absorbFileIntoCrossFileDedup(state, [
      makeDeck('Chapter', [
        { name: 'What is glycolysis?', back: 'Glucose breakdown' },
        { name: 'Where does it occur?', back: 'Cytoplasm' },
      ]),
    ]);
    expect(kept[0].cards).toHaveLength(2);
    expect(state.suppressed).toBe(0);
    expect(state.filesProcessed).toBe(1);
    expect(state.fronts).toEqual([
      'What is glycolysis?',
      'Where does it occur?',
    ]);
  });

  it('suppresses a later file card whose normalized front+back matched an earlier file', () => {
    const state = createCrossFileDedupState();
    absorbFileIntoCrossFileDedup(state, [
      makeDeck('Chapter', [
        { name: 'What is glycolysis?', back: 'Glucose breakdown' },
      ]),
    ]);
    const secondFile = absorbFileIntoCrossFileDedup(state, [
      makeDeck('Transcript', [
        { name: '  WHAT is  glycolysis? ', back: '<p>Glucose breakdown</p>' },
        { name: 'What is the net ATP yield?', back: 'Two ATP' },
      ]),
    ]);
    expect(secondFile[0].cards.map((c) => c.name)).toEqual([
      'What is the net ATP yield?',
    ]);
    expect(state.suppressed).toBe(1);
    expect(state.filesProcessed).toBe(2);
  });

  it('keeps a same-front card from a later file when the back differs', () => {
    const state = createCrossFileDedupState();
    absorbFileIntoCrossFileDedup(state, [
      makeDeck('Chapter', [{ name: 'Sodium', back: 'Symbol: Na' }]),
    ]);
    const secondFile = absorbFileIntoCrossFileDedup(state, [
      makeDeck('Slides', [{ name: 'Sodium', back: 'Atomic number: 11' }]),
    ]);
    expect(secondFile[0].cards).toHaveLength(1);
    expect(state.suppressed).toBe(0);
  });

  it('keeps an identical card repeated across two sub-decks of the SAME file', () => {
    // Review sections legitimately repeat content; dedupeIdenticalCards scopes
    // per-deck, and the first file must convert identically alone or batched.
    const state = createCrossFileDedupState();
    const firstFile = absorbFileIntoCrossFileDedup(state, [
      makeDeck('Chapter 3', [{ name: 'What is osmosis?', back: 'Diffusion' }]),
      makeDeck('Chapter 3 Review', [
        { name: 'What is osmosis?', back: 'Diffusion' },
      ]),
    ]);
    expect(firstFile[0].cards).toHaveLength(1);
    expect(firstFile[1].cards).toHaveLength(1);
    expect(state.suppressed).toBe(0);
  });

  it('suppresses a later file card only after the whole earlier file is absorbed', () => {
    const state = createCrossFileDedupState();
    absorbFileIntoCrossFileDedup(state, [
      makeDeck('A', [{ name: 'What is osmosis?', back: 'Diffusion' }]),
      makeDeck('A Review', [{ name: 'What is osmosis?', back: 'Diffusion' }]),
    ]);
    const secondFile = absorbFileIntoCrossFileDedup(state, [
      makeDeck('B', [{ name: 'What is osmosis?', back: 'Diffusion' }]),
    ]);
    expect(secondFile[0].cards).toHaveLength(0);
    expect(state.suppressed).toBe(1);
  });

  it('does not collide boundary-shifted front/back splits across files (NUL key)', () => {
    const state = createCrossFileDedupState();
    absorbFileIntoCrossFileDedup(state, [
      makeDeck('Chapter', [{ name: 'Krebs cycle', back: 'produces ATP' }]),
    ]);
    const secondFile = absorbFileIntoCrossFileDedup(state, [
      makeDeck('Transcript', [{ name: 'Krebs', back: 'cycle produces ATP' }]),
    ]);
    expect(secondFile[0].cards).toHaveLength(1);
    expect(state.suppressed).toBe(0);
  });
});

describe('generateDeckInfo — floor v1 (comprehensive CardOption)', () => {
  const sixChunkHtml = '<p>' + 'x'.repeat(40_000 * 5 + 100) + '</p>';

  function deckResponse(
    cardCount: number,
    frontPrefix = 'Card',
    deckName = 'Test Deck'
  ) {
    const cards = Array.from({ length: cardCount }, (_, i) => ({
      q: `${frontPrefix} ${i}`,
      a: `Answer ${i}`,
    }));
    return {
      content: [
        { type: 'text', text: JSON.stringify([{ deck: deckName, cards }]) },
      ],
      stop_reason: 'end_turn',
      usage: { input_tokens: 1000, output_tokens: 500 },
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    mockStreamFn.mockReturnValue(mockStream);
    mockStream.on.mockReturnThis();
  });

  it('comprehensive off — existing behavior preserved: no top-up, no provenance stamps', async () => {
    let call = 0;
    mockStream.finalMessage.mockImplementation(async () =>
      deckResponse(5, `C${call++}`)
    );

    const result = await generateDeckInfo(sixChunkHtml, []);

    expect(mockStream.finalMessage).toHaveBeenCalledTimes(6);
    expect(result[0].cards.length).toBe(30);
    expect(
      result[0].cards.every(
        (c) => (c as { chunkIndex?: number }).chunkIndex === undefined
      )
    ).toBe(true);
  });

  it('stamps the request id on every chunk usage line', async () => {
    let call = 0;
    mockStream.finalMessage.mockImplementation(async () =>
      deckResponse(5, `C${call++}`)
    );
    const info = jest
      .spyOn(console, 'info')
      .mockImplementation(() => undefined);

    await generateDeckInfo(
      sixChunkHtml,
      [],
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { userId: 42, requestId: 'req-0f1e2d3c' }
    );

    const usageLines = info.mock.calls
      .map((args) => String(args[0]))
      .filter((line) => line.startsWith('[claude-usage]'));
    expect(usageLines).toHaveLength(6);
    for (const line of usageLines) {
      expect(line).toContain('user=42 request=req-0f1e2d3c ');
    }
    info.mockRestore();
  });

  it('comprehensive on — caps in-flight calls at 4 (semaphore)', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    let call = 0;
    mockStream.finalMessage.mockImplementation(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setImmediate(r));
      inFlight -= 1;
      return deckResponse(60, `C${call++}`);
    });

    await generateDeckInfo(
      sixChunkHtml,
      [],
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        isPaying: true,
        userId: 42,
        comprehensive: true,
      }
    );

    expect(maxInFlight).toBeLessThanOrEqual(4);
    expect(mockStream.finalMessage).toHaveBeenCalledTimes(6);
  });

  it('comprehensive on — stamps chunkIndex provenance on every card', async () => {
    let call = 0;
    mockStream.finalMessage.mockImplementation(async () =>
      deckResponse(60, `C${call++}`)
    );

    const result = await generateDeckInfo(
      sixChunkHtml,
      [],
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        isPaying: true,
        userId: 42,
        comprehensive: true,
      }
    );

    for (const card of result[0].cards) {
      expect(typeof (card as { chunkIndex?: number }).chunkIndex).toBe(
        'number'
      );
    }
  });

  it('comprehensive on — total ≥ floor after first round skips top-up', async () => {
    let call = 0;
    mockStream.finalMessage.mockImplementation(async () =>
      deckResponse(60, `C${call++}`)
    );

    await generateDeckInfo(
      sixChunkHtml,
      [],
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        isPaying: true,
        userId: 42,
        comprehensive: true,
      }
    );

    expect(mockStream.finalMessage).toHaveBeenCalledTimes(6);
  });

  it('comprehensive on — total < floor triggers a top-up round', async () => {
    let call = 0;
    mockStream.finalMessage.mockImplementation(async () => {
      const c = call++;
      if (c < 6) return deckResponse(20, `Initial${c}`);
      return deckResponse(50, `Topup${c}`);
    });

    await generateDeckInfo(
      sixChunkHtml,
      [],
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        isPaying: true,
        userId: 42,
        comprehensive: true,
      }
    );

    expect(mockStream.finalMessage.mock.calls.length).toBeGreaterThan(6);
    expect(mockStream.finalMessage.mock.calls.length).toBeLessThanOrEqual(
      6 + 6 + 6
    );
  });

  it('comprehensive on — top-up loop runs at most 2 rounds even when never reaching floor', async () => {
    let call = 0;
    mockStream.finalMessage.mockImplementation(async () =>
      deckResponse(5, `Round${call++}`)
    );

    await generateDeckInfo(
      sixChunkHtml,
      [],
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        isPaying: true,
        userId: 42,
        comprehensive: true,
      }
    );

    expect(mockStream.finalMessage.mock.calls.length).toBeLessThanOrEqual(
      6 + 6 + 6
    );
  });

  it('comprehensive on but isPaying=false — no top-up, no floor enforcement', async () => {
    let call = 0;
    mockStream.finalMessage.mockImplementation(async () =>
      deckResponse(5, `C${call++}`)
    );

    await generateDeckInfo(
      sixChunkHtml,
      [],
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        isPaying: false,
        userId: 42,
        comprehensive: true,
      }
    );

    expect(mockStream.finalMessage).toHaveBeenCalledTimes(6);
  });

  it('isPaying=true but comprehensive off — no top-up, no floor enforcement', async () => {
    let call = 0;
    mockStream.finalMessage.mockImplementation(async () =>
      deckResponse(5, `C${call++}`)
    );

    await generateDeckInfo(
      sixChunkHtml,
      [],
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        isPaying: true,
        userId: 42,
        comprehensive: false,
      }
    );

    expect(mockStream.finalMessage).toHaveBeenCalledTimes(6);
  });

  it('comprehensive on — emits ai_conversion_completed event with required fields including comprehensive', async () => {
    let call = 0;
    mockStream.finalMessage.mockImplementation(async () =>
      deckResponse(50, `C${call++}`)
    );

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const trackMod = require('../../services/events/track');
    const trackSpy = jest
      .spyOn(trackMod, 'track')
      .mockImplementation(() => undefined);

    try {
      await generateDeckInfo(
        sixChunkHtml,
        [],
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        {
          isPaying: true,
          userId: 42,
          comprehensive: true,
        }
      );

      const completedCall = trackSpy.mock.calls.find(
        (call: unknown[]) => call[0] === 'ai_conversion_completed'
      );
      expect(completedCall).toBeDefined();
      const props = (completedCall![1] as { props?: Record<string, unknown> })
        .props;
      expect(props).toMatchObject({
        card_count: expect.any(Number),
        chunks: expect.any(Number),
        top_up_rounds: expect.any(Number),
        cost_usd: expect.any(Number),
        elapsed_ms: expect.any(Number),
        comprehensive: true,
      });
    } finally {
      trackSpy.mockRestore();
    }
  });

  it('attributes every ai_usage_recorded event to the converting user', async () => {
    let call = 0;
    mockStream.finalMessage.mockImplementation(async () =>
      deckResponse(50, `C${call++}`)
    );

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const trackMod = require('../../services/events/track');
    const trackSpy = jest
      .spyOn(trackMod, 'track')
      .mockImplementation(() => undefined);

    try {
      await generateDeckInfo(
        sixChunkHtml,
        [],
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        {
          isPaying: true,
          userId: 42,
          comprehensive: true,
        }
      );

      const usageCalls = trackSpy.mock.calls.filter(
        (call: unknown[]) => call[0] === 'ai_usage_recorded'
      );
      expect(usageCalls.length).toBeGreaterThan(0);
      for (const usageCall of usageCalls) {
        expect((usageCall[1] as { userId?: number | null }).userId).toBe(42);
      }
    } finally {
      trackSpy.mockRestore();
    }
  });

  it('comprehensive off — does NOT emit ai_conversion_completed event', async () => {
    let call = 0;
    mockStream.finalMessage.mockImplementation(async () =>
      deckResponse(5, `C${call++}`)
    );

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const trackMod = require('../../services/events/track');
    const trackSpy = jest
      .spyOn(trackMod, 'track')
      .mockImplementation(() => undefined);

    try {
      await generateDeckInfo(sixChunkHtml, []);

      const completedCall = trackSpy.mock.calls.find(
        (call: unknown[]) => call[0] === 'ai_conversion_completed'
      );
      expect(completedCall).toBeUndefined();
    } finally {
      trackSpy.mockRestore();
    }
  });

  it('comprehensive on — top-up stops early when a round yields zero net-new cards', async () => {
    let call = 0;
    mockStream.finalMessage.mockImplementation(async () => {
      const c = call++;
      if (c < 6) return deckResponse(10, `Initial${c}`);
      return deckResponse(10, 'Initial0');
    });

    await generateDeckInfo(
      sixChunkHtml,
      [],
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        isPaying: true,
        userId: 42,
        comprehensive: true,
      }
    );

    expect(mockStream.finalMessage.mock.calls.length).toBeLessThan(6 + 6 + 6);
  });
});

describe('floor v1 — card-size scaled bounds', () => {
  const sixChunkHtml = '<p>' + 'x'.repeat(40_000 * 5 + 100) + '</p>';
  const comprehensiveOpts = { isPaying: true, userId: 42, comprehensive: true };

  function deckResponse(cardCount: number, frontPrefix = 'Card') {
    const cards = Array.from({ length: cardCount }, (_, i) => ({
      q: `${frontPrefix} ${i}`,
      a: `Answer ${i}`,
    }));
    return {
      content: [
        { type: 'text', text: JSON.stringify([{ deck: 'Test Deck', cards }]) },
      ],
      stop_reason: 'end_turn',
      usage: { input_tokens: 1000, output_tokens: 500 },
    };
  }

  function convertWithSize(size: string | undefined) {
    return generateDeckInfo(
      sixChunkHtml,
      [],
      undefined,
      undefined,
      undefined,
      size,
      undefined,
      comprehensiveOpts
    );
  }

  function sentUserMessages(): string[] {
    return mockStreamFn.mock.calls.map((c) => {
      const content = (
        c[0] as {
          messages: Array<{ content: string | Array<{ text: string }> }>;
        }
      ).messages[0].content;
      return typeof content === 'string'
        ? content
        : content.map((b) => b.text).join('');
    });
  }

  beforeEach(() => {
    jest.clearAllMocks();
    mockStreamFn.mockReturnValue(mockStream);
    mockStream.on.mockReturnThis();
  });

  it('resolveFloorV1Bounds maps each size and defaults junk to medium', () => {
    expect(resolveFloorV1Bounds('short')).toEqual({ floor: 200, ceiling: 500 });
    expect(resolveFloorV1Bounds('medium')).toEqual({
      floor: 150,
      ceiling: 400,
    });
    expect(resolveFloorV1Bounds('detailed')).toEqual({
      floor: 80,
      ceiling: 250,
    });
    expect(resolveFloorV1Bounds(undefined)).toEqual({
      floor: 150,
      ceiling: 400,
    });
    expect(resolveFloorV1Bounds('nonsense')).toEqual({
      floor: 150,
      ceiling: 400,
    });
  });

  it('detailed run above its 80-card floor skips top-up where short would top up', async () => {
    let call = 0;
    mockStream.finalMessage.mockImplementation(async () =>
      deckResponse(20, `D${call++}`)
    );
    await convertWithSize('detailed');
    expect(mockStream.finalMessage).toHaveBeenCalledTimes(6);

    jest.clearAllMocks();
    mockStreamFn.mockReturnValue(mockStream);
    mockStream.on.mockReturnThis();
    let call2 = 0;
    mockStream.finalMessage.mockImplementation(async () =>
      deckResponse(20, `S${call2++}`)
    );
    await convertWithSize('short');
    expect(mockStream.finalMessage.mock.calls.length).toBeGreaterThan(6);
  });

  it('detailed run clamps the total at its 250-card ceiling', async () => {
    let call = 0;
    mockStream.finalMessage.mockImplementation(async () =>
      deckResponse(60, `D${call++}`)
    );
    const result = await convertWithSize('detailed');
    const total = result.reduce((sum, d) => sum + d.cards.length, 0);
    expect(total).toBe(250);
  });

  it('emits clamped_from on ai_conversion_completed only when the ceiling clamped', async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const trackMod = require('../../services/events/track');
    const trackSpy = jest
      .spyOn(trackMod, 'track')
      .mockImplementation(() => undefined);
    try {
      let call = 0;
      mockStream.finalMessage.mockImplementation(async () =>
        deckResponse(60, `D${call++}`)
      );
      await convertWithSize('detailed');
      const clampedCall = trackSpy.mock.calls.find(
        (c: unknown[]) => c[0] === 'ai_conversion_completed'
      );
      expect(
        (clampedCall![1] as { props: Record<string, unknown> }).props
      ).toMatchObject({ card_count: 250, clamped_from: 360 });

      trackSpy.mockClear();
      jest.clearAllMocks();
      mockStreamFn.mockReturnValue(mockStream);
      mockStream.on.mockReturnThis();
      let call2 = 0;
      mockStream.finalMessage.mockImplementation(async () =>
        deckResponse(20, `E${call2++}`)
      );
      await convertWithSize('detailed');
      const unclampedCall = trackSpy.mock.calls.find(
        (c: unknown[]) => c[0] === 'ai_conversion_completed'
      );
      const props = (unclampedCall![1] as { props: Record<string, unknown> })
        .props;
      expect(props.clamped_from).toBeUndefined();
    } finally {
      trackSpy.mockRestore();
    }
  });

  it('detailed top-up rounds ask for multi-fact cards, not single-fact ones', async () => {
    let call = 0;
    mockStream.finalMessage.mockImplementation(async () =>
      deckResponse(10, `D${call++}`)
    );
    await convertWithSize('detailed');
    const topUpMessages = sentUserMessages().filter((m) =>
      m.includes('Do NOT repeat any of these fronts')
    );
    expect(topUpMessages.length).toBeGreaterThan(0);
    for (const message of topUpMessages) {
      expect(message).toContain('keeping 3-4 related facts per card');
      expect(message).not.toContain('single-fact');
    }
  });

  it('medium top-up rounds keep the single-fact wording', async () => {
    let call = 0;
    mockStream.finalMessage.mockImplementation(async () =>
      deckResponse(10, `M${call++}`)
    );
    await convertWithSize('medium');
    const topUpMessages = sentUserMessages().filter((m) =>
      m.includes('Do NOT repeat any of these fronts')
    );
    expect(topUpMessages.length).toBeGreaterThan(0);
    for (const message of topUpMessages) {
      expect(message).toContain('single-fact');
    }
  });

  it('SYSTEM_PROMPT keeps list cloze deletions on one card unless instructed otherwise', () => {
    expect(SYSTEM_PROMPT).toContain('one card per list, not one card per item');
    expect(SYSTEM_PROMPT).toContain(
      "unless the user's instructions ask for separate cards"
    );
  });

  it('SYSTEM_PROMPT defers min-info and density rules to the Card size directive', () => {
    expect(SYSTEM_PROMPT).toContain(
      'The Card size directive in the user message overrides these rules the same way'
    );
    expect(SYSTEM_PROMPT).toContain(
      'when density and card size conflict, prefer fuller cards over more cards'
    );
  });
});

describe('generateDeckInfo — card with a missing answer field', () => {
  const textHtml =
    '<html><body><h1>Cells</h1><p>The cell is the basic unit of life.</p></body></html>';

  function responseWith(cards: Array<Record<string, unknown>>) {
    return {
      content: [
        { type: 'text', text: JSON.stringify([{ deck: 'Biology', cards }]) },
      ],
      stop_reason: 'end_turn',
      usage: { input_tokens: 100, output_tokens: 50 },
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    mockStreamFn.mockReturnValue(mockStream);
    mockStream.on.mockReturnThis();
  });

  it('converts a cloze card that omits the answer field instead of failing the chunk', async () => {
    mockStream.finalMessage.mockResolvedValue(
      responseWith([
        { q: 'The {{c1::cell}} is the basic unit of life', cloze: true },
      ])
    );

    const result = await generateDeckInfo(textHtml, []);

    const cards = result.flatMap((deck) => deck.cards);
    expect(cards).toHaveLength(1);
    expect(cards[0].cloze).toBe(true);
    expect(cards[0].back).toBe('');
  });

  it('converts a basic card whose answer is undefined instead of throwing', async () => {
    mockStream.finalMessage.mockResolvedValue(
      responseWith([{ q: 'What is the basic unit of life?' }])
    );

    const result = await generateDeckInfo(textHtml, []);

    const cards = result.flatMap((deck) => deck.cards);
    expect(cards).toHaveLength(1);
    expect(cards[0].back).toBe('');
  });
});

describe('generateDeckInfo — card with a missing front field', () => {
  const textHtml =
    '<html><body><h1>Cells</h1><p>The cell is the basic unit of life.</p></body></html>';

  function responseWith(cards: Array<Record<string, unknown>>) {
    return {
      content: [
        { type: 'text', text: JSON.stringify([{ deck: 'Biology', cards }]) },
      ],
      stop_reason: 'end_turn',
      usage: { input_tokens: 100, output_tokens: 50 },
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    mockStreamFn.mockReturnValue(mockStream);
    mockStream.on.mockReturnThis();
  });

  it('keeps the other cards when one card has no front field', async () => {
    mockStream.finalMessage.mockResolvedValue(
      responseWith([
        { a: 'An answer with no question' },
        { q: 'What is the basic unit of life?', a: 'The cell' },
      ])
    );

    const result = await generateDeckInfo(textHtml, []);

    const cards = result.flatMap((deck) => deck.cards);
    expect(cards).toHaveLength(1);
    expect(cards[0].name).toBe('What is the basic unit of life?');
    expect(cards[0].back).toBe('The cell');
  });

  it('skips cards whose front is not a string or is blank', async () => {
    mockStream.finalMessage.mockResolvedValue(
      responseWith([
        { q: 42, a: 'Numeric front' },
        { q: '   ', a: 'Blank front' },
        { q: 'Kept card?', a: 'Yes' },
      ])
    );

    const result = await generateDeckInfo(textHtml, []);

    const cards = result.flatMap((deck) => deck.cards);
    expect(cards).toHaveLength(1);
    expect(cards[0].name).toBe('Kept card?');
  });

  it('keeps other decks when one deck has a malformed cards value', async () => {
    mockStream.finalMessage.mockResolvedValue({
      content: [
        {
          type: 'text',
          text: JSON.stringify([
            { deck: 'Broken', cards: 'not-an-array' },
            { deck: 'Biology', cards: [{ q: 'Kept card?', a: 'Yes' }] },
          ]),
        },
      ],
      stop_reason: 'end_turn',
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    const result = await generateDeckInfo(textHtml, []);

    const cards = result.flatMap((deck) => deck.cards);
    expect(cards).toHaveLength(1);
    expect(cards[0].name).toBe('Kept card?');
  });
});

describe('buildUserContentBlocks — cache-safe split', () => {
  const content = '<details><summary>Q</summary>A</details>';
  const media = ['diagram.png', 'photo.jpg'];

  it('concatenates back to exactly the single-string prompt', () => {
    const blocks = buildUserContentBlocks(
      content,
      media,
      'Focus on definitions',
      'heading-driven fragment',
      'detailed',
      {
        templateName: 'n2a-basic',
        fields: [{ name: 'Front', instruction: 'the term' }],
      }
    );
    const joined = blocks.map((b) => b.text).join('');
    expect(joined).toBe(
      buildUserMessage(
        content,
        media,
        'Focus on definitions',
        'heading-driven fragment',
        'detailed',
        {
          templateName: 'n2a-basic',
          fields: [{ name: 'Front', instruction: 'the term' }],
        }
      )
    );
  });

  it('marks only the content prefix for caching', () => {
    const blocks = buildUserContentBlocks(
      content,
      media,
      'Focus on definitions',
      '',
      undefined,
      undefined
    );
    expect(blocks).toHaveLength(2);
    expect(blocks[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(blocks[0].text).toContain(content);
    expect(blocks[0].text).toContain('diagram.png');
    expect(blocks[1].cache_control).toBeUndefined();
    expect(blocks[1].text).toContain('Focus on definitions');
  });

  it('returns a single cached block when there are no trailing sections', () => {
    const blocks = buildUserContentBlocks(content, [], undefined, '');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(blocks[0].text).toBe(buildUserMessage(content, [], undefined, ''));
  });
});
