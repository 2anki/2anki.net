import { vi, type Mock } from 'vitest';

const { mockStreamFn, mockCreateFn, withAiBudgetSpy, assertAiBudgetSpy } =
  vi.hoisted(() => ({
    mockStreamFn: vi.fn(),
    mockCreateFn: vi.fn(),
    withAiBudgetSpy: vi.fn(),
    assertAiBudgetSpy: vi.fn(),
  }));

const mockStream = {
  on: vi.fn().mockReturnThis(),
  finalMessage: vi.fn(),
};

vi.mock('@anthropic-ai/sdk', async () => {
  const actual =
    await vi.importActual<typeof import('@anthropic-ai/sdk')>(
      '@anthropic-ai/sdk'
    );
  return {
    ...actual,
    __esModule: true,
    default: vi.fn().mockImplementation(function () {
      return { messages: { stream: mockStreamFn, create: mockCreateFn } };
    }),
  };
});

vi.mock('./aiSpendGuard', async () => {
  const actual =
    await vi.importActual<typeof import('./aiSpendGuard')>('./aiSpendGuard');
  return {
    ...actual,
    assertAiBudget: assertAiBudgetSpy,
    withAiBudget: withAiBudgetSpy,
  };
});

import { generateDeckInfo } from './ClaudeService';

const PASS_SUBJECT = { userId: null, anonymousPassId: 7 };

function deckResponse(cardCount: number, frontPrefix: string) {
  const cards = Array.from({ length: cardCount }, (_, i) => ({
    q: `${frontPrefix} ${i}`,
    a: `Answer ${i}`,
  }));
  return {
    content: [{ type: 'text', text: JSON.stringify([{ deck: 'D', cards }]) }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 1000, output_tokens: 500 },
  };
}

describe('generateDeckInfo — anonymous pass metering (floor v1 top-up)', () => {
  const sixChunkHtml = '<p>' + 'x'.repeat(40_000 * 5 + 100) + '</p>';

  beforeEach(() => {
    vi.clearAllMocks();
    mockStreamFn.mockReturnValue(mockStream);
    mockStream.on.mockReturnThis();
    assertAiBudgetSpy.mockResolvedValue(undefined);
    withAiBudgetSpy.mockImplementation(
      (_subject: unknown, run: () => Promise<unknown>) => run()
    );
    let call = 0;
    mockStream.finalMessage.mockImplementation(async () =>
      deckResponse(2, `C${call++}`)
    );
  });

  it('meters every chunk AND every top-up round against the pass, never a bare user id', async () => {
    await generateDeckInfo(
      sixChunkHtml,
      [],
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { isPaying: true, comprehensive: true, anonymousPassId: 7 }
    );

    const calls = (withAiBudgetSpy as Mock).mock.calls;
    // Six first-round chunks plus at least one top-up chunk (total 12 cards is
    // under the medium floor of 150, so the top-up loop runs).
    expect(calls.length).toBeGreaterThan(6);
    for (const [subject] of calls) {
      expect(subject).toEqual(PASS_SUBJECT);
    }
  });
});
