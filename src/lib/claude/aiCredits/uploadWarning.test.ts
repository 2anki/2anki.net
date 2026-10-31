import {
  AI_CREDITS_EXHAUSTED_WARNING_CODE,
  aiCreditsExhaustedWarningText,
  aiCreditsWarningAudience,
  builtWithoutAiOnSpentCredits,
  includesAiCreditsWarning,
} from './uploadWarning';

describe('uploadWarning', () => {
  it('detects the exhausted credit warning in a list', () => {
    expect(includesAiCreditsWarning([AI_CREDITS_EXHAUSTED_WARNING_CODE])).toBe(
      true
    );
    expect(includesAiCreditsWarning(['markdown-heuristic'])).toBe(false);
    expect(includesAiCreditsWarning(undefined)).toBe(false);
  });

  it('points a subscription plan at its own reset, never a free one', () => {
    const text = aiCreditsExhaustedWarningText('period');
    expect(text).toContain('top-up');
    expect(text).not.toContain('free');
    expect(text).toContain("Or wait for your plan's credits to reset.");
  });

  it('treats a calendar-month allowance like a plan reset', () => {
    expect(aiCreditsExhaustedWarningText('month')).toBe(
      aiCreditsExhaustedWarningText('period')
    );
  });

  it('promises a pass holder no reset and no 90-day validity', () => {
    const text = aiCreditsExhaustedWarningText('pass');
    expect(text).toContain('built without AI');
    expect(text).toContain('top-up');
    expect(text).not.toContain('free');
    expect(text).not.toContain('reset');
    expect(text).not.toContain('90 days');
  });

  it('tells a signed-out pass holder to sign in before a top-up', () => {
    const text = aiCreditsExhaustedWarningText('signed-out-pass');
    expect(text).toBe(
      "You're out of AI credits, so this deck was built without AI. Sign in " +
        'to add a one-time top-up for several more decks.'
    );
  });

  it.each([
    ['the parser built the deck on spent credits', ['parser'], true],
    ['no package recorded an engine on spent credits', [undefined], true],
    ['the guard tripped after some AI cards were made', ['claude'], false],
    ['a zip mixed a parser file with AI cards', ['parser', 'claude'], false],
  ] as const)(
    'says whether a deck was built without AI when %s',
    (_label, engines, expected) => {
      expect(
        builtWithoutAiOnSpentCredits(
          [AI_CREDITS_EXHAUSTED_WARNING_CODE],
          [...engines]
        )
      ).toBe(expected);
    }
  );

  it.each(['period', 'month', 'pass', null] as const)(
    "reads a signed-in caller's own credit window (%s)",
    async (resets) => {
      const readResets = vi.fn().mockResolvedValue(resets);

      const audience = await aiCreditsWarningAudience(
        [AI_CREDITS_EXHAUSTED_WARNING_CODE],
        42,
        readResets
      );

      expect(audience).toBe(resets);
      expect(readResets).toHaveBeenCalledWith(42);
    }
  );

  it('picks the sign-in line for a caller with no account, without a balance read', async () => {
    const readResets = vi.fn();

    const audience = await aiCreditsWarningAudience(
      [AI_CREDITS_EXHAUSTED_WARNING_CODE],
      null,
      readResets
    );

    expect(audience).toBe('signed-out-pass');
    expect(readResets).not.toHaveBeenCalled();
  });

  it('picks no audience when the credits warning is absent', async () => {
    const readResets = vi.fn();

    expect(
      await aiCreditsWarningAudience(['markdown-heuristic'], 42, readResets)
    ).toBeNull();
    expect(await aiCreditsWarningAudience(undefined, null, readResets)).toBe(
      null
    );
    expect(readResets).not.toHaveBeenCalled();
  });

  it('never calls a deck without the credits warning built without AI', () => {
    expect(
      builtWithoutAiOnSpentCredits(['markdown-heuristic'], ['parser'])
    ).toBe(false);
    expect(builtWithoutAiOnSpentCredits(undefined, ['parser'])).toBe(false);
  });

  it('falls back to the no-reset line when the balance read fails (null)', () => {
    expect(aiCreditsExhaustedWarningText(null)).toBe(
      aiCreditsExhaustedWarningText('pass')
    );
  });
});
