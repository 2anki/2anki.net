import type Anthropic from '@anthropic-ai/sdk';
import { convertWithClaude, FileConversionError } from './claudeFileConversion';

const makeAnthropicMock = (responseText: string, stopReason = 'end_turn') => ({
  messages: {
    create: jest.fn().mockResolvedValue({
      content: [{ type: 'text', text: responseText }],
      stop_reason: stopReason,
    }),
  },
  beta: {
    messages: {
      create: jest.fn().mockResolvedValue({
        content: [{ type: 'text', text: responseText }],
        stop_reason: stopReason,
      }),
    },
  },
});

describe('convertWithClaude', () => {
  it('returns the text content from the API response', async () => {
    const mock = makeAnthropicMock('<ul class="toggle"><li>Q</li></ul>');
    const result = await convertWithClaude(
      mock as unknown as Anthropic,
      'system prompt',
      [{ type: 'text', text: 'user text' }]
    );
    expect(result).toBe('<ul class="toggle"><li>Q</li></ul>');
  });

  it('throws FileConversionError when the API call fails', async () => {
    const mock = {
      messages: {
        create: jest.fn().mockRejectedValue(new Error('API unavailable')),
      },
      beta: {
        messages: {
          create: jest.fn().mockRejectedValue(new Error('API unavailable')),
        },
      },
    };
    await expect(
      convertWithClaude(mock as unknown as Anthropic, 'system prompt', [
        { type: 'text', text: 'user text' },
      ])
    ).rejects.toBeInstanceOf(FileConversionError);
  });

  it('throws FileConversionError with upstream message when API fails', async () => {
    const mock = {
      messages: {
        create: jest.fn().mockRejectedValue(new Error('rate limit exceeded')),
      },
      beta: {
        messages: {
          create: jest.fn().mockRejectedValue(new Error('rate limit exceeded')),
        },
      },
    };
    await expect(
      convertWithClaude(mock as unknown as Anthropic, 'system prompt', [
        { type: 'text', text: 'user text' },
      ])
    ).rejects.toMatchObject({ message: 'rate limit exceeded' });
  });

  it('passes cache_control ephemeral on the system prompt block', async () => {
    const mock = makeAnthropicMock('<p>result</p>');
    await convertWithClaude(mock as unknown as Anthropic, 'my system prompt', [
      { type: 'text', text: 'user text' },
    ]);

    const callArg = (mock.messages.create as jest.Mock).mock.calls[0][0];
    expect(callArg.system).toEqual([
      {
        type: 'text',
        text: 'my system prompt',
        cache_control: { type: 'ephemeral' },
      },
    ]);
  });

  it('uses client.beta.messages.create with pdfs-2024-09-25 beta when pdf flag is set', async () => {
    const mock = makeAnthropicMock('<p>result</p>');
    await convertWithClaude(
      mock as unknown as Anthropic,
      'system prompt',
      [{ type: 'text', text: 'user text' }],
      { pdf: true }
    );

    expect(mock.messages.create).not.toHaveBeenCalled();
    const callArg = (mock.beta.messages.create as jest.Mock).mock.calls[0][0];
    expect(callArg.betas).toContain('pdfs-2024-09-25');
  });

  it('uses client.messages.create (not beta) when pdf flag is not set', async () => {
    const mock = makeAnthropicMock('<p>result</p>');
    await convertWithClaude(mock as unknown as Anthropic, 'system prompt', [
      { type: 'text', text: 'user text' },
    ]);

    expect(mock.messages.create).toHaveBeenCalled();
    expect(mock.beta.messages.create).not.toHaveBeenCalled();
  });

  it('uses 32768 max_tokens', async () => {
    const mock = makeAnthropicMock('<p>result</p>');
    await convertWithClaude(mock as unknown as Anthropic, 'system prompt', [
      { type: 'text', text: 'user text' },
    ]);

    const callArg = (mock.messages.create as jest.Mock).mock.calls[0][0];
    expect(callArg.max_tokens).toBe(32768);
  });

  it('throws instead of returning a silently truncated document', async () => {
    const mock = makeAnthropicMock('<p>first half of the docu', 'max_tokens');

    await expect(
      convertWithClaude(mock as unknown as Anthropic, 'system prompt', [
        { type: 'text', text: 'user text' },
      ])
    ).rejects.toThrow(/too large to convert in one pass/);
  });

  it('throws on truncation on the PDF path too', async () => {
    const mock = makeAnthropicMock('<p>first half', 'max_tokens');

    await expect(
      convertWithClaude(
        mock as unknown as Anthropic,
        'system prompt',
        [{ type: 'text', text: 'user text' }],
        { pdf: true }
      )
    ).rejects.toThrow(/too large to convert in one pass/);
  });

  it('joins every text block instead of reading only the first', async () => {
    const mock = makeAnthropicMock('');
    (mock.messages.create as jest.Mock).mockResolvedValue({
      content: [
        { type: 'text', text: '<p>part one</p>' },
        { type: 'text', text: '<p>part two</p>' },
      ],
      stop_reason: 'end_turn',
    });

    const result = await convertWithClaude(
      mock as unknown as Anthropic,
      'system prompt',
      [{ type: 'text', text: 'user text' }]
    );
    expect(result).toBe('<p>part one</p><p>part two</p>');
  });

  it('uses the default model when CLAUDE_FILE_CONVERSION_MODEL is unset', async () => {
    const mock = makeAnthropicMock('<p>result</p>');
    delete process.env.CLAUDE_FILE_CONVERSION_MODEL;
    await convertWithClaude(mock as unknown as Anthropic, 'system prompt', [
      { type: 'text', text: 'user text' },
    ]);

    const callArg = (mock.messages.create as jest.Mock).mock.calls[0][0];
    expect(callArg.model).toBe('claude-sonnet-4-6');
  });

  it('uses CLAUDE_FILE_CONVERSION_MODEL env when set', async () => {
    const mock = makeAnthropicMock('<p>result</p>');
    process.env.CLAUDE_FILE_CONVERSION_MODEL = 'claude-opus-4-5';
    await convertWithClaude(mock as unknown as Anthropic, 'system prompt', [
      { type: 'text', text: 'user text' },
    ]);
    delete process.env.CLAUDE_FILE_CONVERSION_MODEL;

    const callArg = (mock.messages.create as jest.Mock).mock.calls[0][0];
    expect(callArg.model).toBe('claude-opus-4-5');
  });
});
