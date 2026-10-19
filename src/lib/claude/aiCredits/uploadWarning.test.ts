import {
  AI_CREDITS_EXHAUSTED_WARNING_CODE,
  aiCreditsExhaustedWarningText,
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

  it('falls back to the no-reset line when the balance read fails (null)', () => {
    expect(aiCreditsExhaustedWarningText(null)).toBe(
      aiCreditsExhaustedWarningText('pass')
    );
  });
});
