import {
  AINoteTypeUseCase,
  NoteTypeStarterInput,
  __test__,
} from './AINoteTypeUseCase';
import { getAnthropicClient } from '../../lib/claude/ClaudeService';

jest.mock('../../lib/claude/ClaudeService', () => ({
  getAnthropicClient: jest.fn(),
}));

const { extractJsonBlock } = __test__;

describe('extractJsonBlock', () => {
  it('returns the fenced JSON content when wrapped in ```json ... ```', () => {
    const text = 'Here you go:\n```json\n{"a":1}\n```\nThat is all.';
    expect(extractJsonBlock(text)).toBe('{"a":1}');
  });

  it('returns null when no JSON-looking content is present', () => {
    expect(extractJsonBlock('no json here, just prose.')).toBeNull();
  });

  it('returns the first balanced JSON object when no fence is used', () => {
    const text = 'Reply: {"a":{"b":2},"c":[1,2,3]} and more';
    expect(extractJsonBlock(text)).toBe('{"a":{"b":2},"c":[1,2,3]}');
  });

  it('handles braces inside strings without breaking depth tracking', () => {
    const text = '{"css":"a { color: red; } b { font: \\"x\\"; }"}';
    expect(extractJsonBlock(text)).toBe(text);
  });

  it('handles a 100k blob without pathological backtracking', () => {
    const big = `\`\`\`json\n${'{"k":"' + 'x'.repeat(100_000) + '"}'}\n\`\`\``;
    const start = Date.now();
    const result = extractJsonBlock(big);
    const ms = Date.now() - start;
    expect(result).not.toBeNull();
    expect(result?.startsWith('{"k":"')).toBe(true);
    expect(ms).toBeLessThan(2000);
  });

  it('falls back to the bare JSON object if the fence is unmatched', () => {
    expect(extractJsonBlock('```json\n{"a":1}')).toBe('{"a":1}');
  });

  it('returns null when the bare object has no matching closing brace', () => {
    expect(extractJsonBlock('{"a":1')).toBeNull();
  });
});

const sampleStarter: NoteTypeStarterInput = {
  id: 'basic-clean',
  name: 'Clean Basic',
  description: 'A minimal note type',
  baseType: 'basic',
  noteType: {
    name: 'Clean Basic',
    type: 0,
    tmpls: [{ name: 'Card 1', ord: 0, qfmt: '{{Front}}', afmt: '{{Back}}' }],
    flds: [
      { name: 'Front', ord: 0 },
      { name: 'Back', ord: 1 },
    ],
    css: '.card { color: black; }',
  },
  previewData: { Front: 'Q', Back: 'A' },
  tags: [],
};

function claudeReply(starter: NoteTypeStarterInput, reply: string) {
  return {
    content: [
      {
        type: 'text',
        text: `\`\`\`json\n${JSON.stringify({ reply, starter })}\n\`\`\``,
      },
    ],
  };
}

describe('AINoteTypeUseCase.modify no-op detection', () => {
  let warnSpy: jest.SpyInstance;
  let mockCreate: jest.Mock;

  beforeEach(() => {
    mockCreate = jest.fn();
    (getAnthropicClient as jest.Mock).mockReturnValue({
      messages: { create: mockCreate },
    });
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'info').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it('logs template_ai_modify.no_op when the result fingerprint matches the input', async () => {
    mockCreate.mockResolvedValue(
      claudeReply(sampleStarter, 'No changes made.')
    );

    const useCase = new AINoteTypeUseCase();
    await useCase.modify(sampleStarter, 'make it pretty', []);

    expect(warnSpy).toHaveBeenCalledWith(
      'template_ai_modify.no_op',
      expect.objectContaining({ instructionLength: 'make it pretty'.length })
    );
  });

  it('does not log no_op when the starter genuinely changed', async () => {
    const modified: NoteTypeStarterInput = {
      ...sampleStarter,
      noteType: {
        ...sampleStarter.noteType,
        css: '.card { color: midnightblue; }',
      },
    };
    mockCreate.mockResolvedValue(
      claudeReply(modified, 'Switched the body colour to midnight blue.')
    );

    const useCase = new AINoteTypeUseCase();
    await useCase.modify(sampleStarter, 'use midnight blue', []);

    expect(warnSpy).not.toHaveBeenCalledWith(
      'template_ai_modify.no_op',
      expect.anything()
    );
  });
});

describe('AINoteTypeUseCase system prompt caching', () => {
  let mockCreate: jest.Mock;
  let infoSpy: jest.SpyInstance;

  beforeEach(() => {
    mockCreate = jest.fn().mockResolvedValue({
      ...claudeReply(sampleStarter, 'No changes made.'),
      usage: {
        input_tokens: 12,
        output_tokens: 34,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    });
    (getAnthropicClient as jest.Mock).mockReturnValue({
      messages: { create: mockCreate },
    });
    infoSpy = jest.spyOn(console, 'info').mockImplementation(() => undefined);
  });

  afterEach(() => {
    infoSpy.mockRestore();
    jest.clearAllMocks();
  });

  it('passes system as an array with a cache_control ephemeral block', async () => {
    const useCase = new AINoteTypeUseCase();
    await useCase.generate('a flashcard for the krebs cycle');

    const callArg = mockCreate.mock.calls[0][0];
    expect(Array.isArray(callArg.system)).toBe(true);
    expect(callArg.system).toHaveLength(1);
    expect(callArg.system[0]).toMatchObject({
      type: 'text',
      cache_control: { type: 'ephemeral' },
    });
  });

  it('emits a [claude-usage] log line for the note_type_ai surface', async () => {
    const useCase = new AINoteTypeUseCase();
    await useCase.generate('a flashcard for the krebs cycle');

    expect(infoSpy).toHaveBeenCalledWith(
      expect.stringContaining('[claude-usage] surface=note_type_ai')
    );
  });
});
