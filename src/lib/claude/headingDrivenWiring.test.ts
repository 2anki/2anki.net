import { generateDeckInfo } from './ClaudeService';

const FAKE_DECK_JSON = JSON.stringify([
  {
    deck: 'Test Deck',
    cards: [
      { q: 'Q1', a: 'A1' },
      { q: 'Q2', a: 'A2' },
    ],
  },
]);

const mockStreamFn = jest.fn();
const mockStream = {
  on: jest.fn().mockReturnThis(),
  finalMessage: jest.fn(),
};

jest.mock('@anthropic-ai/sdk', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    messages: { stream: mockStreamFn },
  })),
}));

function freshResponse() {
  return {
    content: [{ type: 'text', text: FAKE_DECK_JSON }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 100, output_tokens: 50 },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockStreamFn.mockReturnValue(mockStream);
  mockStream.on.mockReturnThis();
  mockStream.finalMessage.mockResolvedValue(freshResponse());
});

const htmlWithHeadings = `
  <h1>Polarised Lenses</h1>
  <p>Light passing through a polarised lens is filtered horizontally and reduces glare.</p>
  <h2>How They Work</h2>
  <p>The lens material contains a special polymer that absorbs horizontal light waves selectively.</p>
`;

const htmlWithoutHeadings = `
  <p>This document has no headings at all.</p>
  <p>Just plain paragraphs with no structure.</p>
`;

describe('generateDeckInfo — heading-driven wiring', () => {
  it('calls Claude with the heading-driven prompt fragment when cardStyle is heading-driven and headings exist', async () => {
    await generateDeckInfo(
      htmlWithHeadings,
      [],
      undefined,
      undefined,
      'heading-driven'
    );

    expect(mockStreamFn).toHaveBeenCalled();
    const callArgs = mockStreamFn.mock.calls[0][0];
    const userContent: string = callArgs.messages[0].content;
    expect(userContent).toContain('heading');
    expect(userContent).toContain('2–6');
  });

  it('logs heading-driven:fallback and still calls Claude when no headings are found', async () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    await generateDeckInfo(
      htmlWithoutHeadings,
      [],
      undefined,
      undefined,
      'heading-driven'
    );

    const allLoggedArgs = consoleSpy.mock.calls.flatMap((args) =>
      args.map(String)
    );
    const hasFallback = allLoggedArgs.some((s) =>
      s.includes('heading-driven:fallback')
    );
    expect(hasFallback).toBe(true);

    expect(mockStreamFn).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('does not include the heading-driven prompt fragment when cardStyle is absent', async () => {
    await generateDeckInfo(
      htmlWithHeadings,
      [],
      undefined,
      undefined,
      undefined
    );

    expect(mockStreamFn).toHaveBeenCalled();
    const callArgs = mockStreamFn.mock.calls[0][0];
    const userContent: string = callArgs.messages[0].content;
    expect(userContent).not.toContain('2–6');
  });
});

describe('generateDeckInfo — chunk output budget', () => {
  it('caps every chunk call at 32768 output tokens so Sonnet 5 answers fit', async () => {
    await generateDeckInfo(htmlWithHeadings, [], undefined, undefined);

    expect(mockStreamFn).toHaveBeenCalled();
    for (const call of mockStreamFn.mock.calls) {
      expect(call[0].max_tokens).toBe(32768);
    }
  });

  it('splits an oversized heading section into bounded chunk calls', async () => {
    const paragraphs = Array.from(
      { length: 250 },
      (_, i) => `<p>Fact ${i}: ${'lorem ipsum dolor sit amet '.repeat(20)}</p>`
    ).join('\n');
    const oversized = `<h1>Anatomy</h1>\n${paragraphs}`;
    expect(oversized.length).toBeGreaterThan(100_000);

    await generateDeckInfo(
      oversized,
      [],
      undefined,
      undefined,
      'heading-driven'
    );

    expect(mockStreamFn.mock.calls.length).toBeGreaterThan(1);
    for (const call of mockStreamFn.mock.calls) {
      const userContent: string = call[0].messages[0].content;
      expect(userContent.length).toBeLessThan(60_000);
    }
  });
});
