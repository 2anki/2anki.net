import { describe, it, expect, vi } from 'vitest';
import {
  AI_PREVIEW_CARD_COUNT,
  AI_PREVIEW_MAX_INPUT_CHARS,
  AI_PREVIEW_MAX_TOKENS,
  AI_PREVIEW_SURFACE,
  AI_PREVIEW_TIMEOUT_MS,
  generateAiPreview,
} from './aiPreview';

function jsonMessage(cards: Array<{ front: string; back: string }>) {
  return {
    model: 'claude-sonnet-5',
    usage: { input_tokens: 10, output_tokens: 20 },
    content: [{ type: 'text', text: JSON.stringify(cards) }],
  };
}

function fakeClient(response: unknown) {
  const create = vi.fn().mockResolvedValue(response);
  return { create, client: { messages: { create } } };
}

describe('generateAiPreview', () => {
  it('never sends more than the input bound, whatever the file size', async () => {
    const huge = 'A'.repeat(5_000_000);
    const { create, client } = fakeClient(
      jsonMessage([{ front: 'q', back: 'a' }])
    );

    await generateAiPreview(huge, { client });

    expect(create).toHaveBeenCalledTimes(1);
    const params = create.mock.calls[0][0];
    expect(params.max_tokens).toBe(AI_PREVIEW_MAX_TOKENS);
    const sentContent = params.messages[0].content as string;
    expect(sentContent.length).toBe(AI_PREVIEW_MAX_INPUT_CHARS);
    expect(sentContent.length).toBeLessThan(huge.length);
  });

  it('cuts a hung call off with a request timeout', async () => {
    const { create, client } = fakeClient(
      jsonMessage([{ front: 'q', back: 'a' }])
    );

    await generateAiPreview('some text', { client });

    expect(create.mock.calls[0][1]).toEqual({ timeout: AI_PREVIEW_TIMEOUT_MS });
  });

  it('returns at most AI_PREVIEW_CARD_COUNT parsed cards', async () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      front: `q${i}`,
      back: `a${i}`,
    }));
    const { client } = fakeClient(jsonMessage(many));

    const cards = await generateAiPreview('some study notes', { client });

    expect(cards.length).toBe(AI_PREVIEW_CARD_COUNT);
    expect(cards[0]).toEqual({ front: 'q0', back: 'a0' });
  });

  it('records the cost under the ai_preview surface and bills no one', async () => {
    const { client } = fakeClient(jsonMessage([{ front: 'q', back: 'a' }]));
    const recordUsage = vi.fn();

    await generateAiPreview('notes', { client, recordUsage, requestId: 'r1' });

    expect(recordUsage).toHaveBeenCalledTimes(1);
    const recorded = recordUsage.mock.calls[0][0];
    expect(recorded.surface).toBe(AI_PREVIEW_SURFACE);
    expect(recorded.userId ?? null).toBeNull();
    expect(recorded.anonymousPassId ?? null).toBeNull();
    expect(recorded.requestId).toBe('r1');
  });

  it('returns no cards for empty input without calling the model', async () => {
    const { create, client } = fakeClient(jsonMessage([]));

    const cards = await generateAiPreview('   ', { client });

    expect(cards).toEqual([]);
    expect(create).not.toHaveBeenCalled();
  });

  it('returns no cards when the response is not parseable', async () => {
    const { client } = fakeClient({
      model: 'claude-sonnet-5',
      usage: { input_tokens: 1, output_tokens: 1 },
      content: [{ type: 'text', text: 'I could not find any study content.' }],
    });

    const cards = await generateAiPreview('notes', { client });

    expect(cards).toEqual([]);
  });

  it('drops malformed card entries and keeps the valid ones', async () => {
    const { client } = fakeClient(
      jsonMessage([
        { front: 'q1', back: 'a1' },
        // deliberately malformed entries below are filtered out
        { front: 'q2' } as unknown as { front: string; back: string },
        { back: 'a3' } as unknown as { front: string; back: string },
        { front: 'q4', back: 'a4' },
      ])
    );

    const cards = await generateAiPreview('notes', { client });

    expect(cards).toEqual([
      { front: 'q1', back: 'a1' },
      { front: 'q4', back: 'a4' },
    ]);
  });
});
