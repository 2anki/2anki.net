import {
  AI_CREDITS_EXHAUSTED_WARNING_CODE,
  aiCreditsShortWarningText,
  buildAiCreditsShortWarning,
  includesAiCreditsWarning,
  resolveAiCreditsShortWarning,
} from './uploadWarning';

describe('uploadWarning', () => {
  it('round-trips the short warning code with needed and available credits', () => {
    const code = buildAiCreditsShortWarning(120, 40);
    expect(code).toBe('ai-credits-short:120:40');
    expect(resolveAiCreditsShortWarning(code)).toBe(
      aiCreditsShortWarningText(120, 40)
    );
  });

  it('returns null for a code that is not a short warning', () => {
    expect(resolveAiCreditsShortWarning('markdown-heuristic')).toBeNull();
    expect(resolveAiCreditsShortWarning('ai-credits-short:x:y')).toBeNull();
  });

  it('detects both exhausted and short credit warnings in a list', () => {
    expect(includesAiCreditsWarning([AI_CREDITS_EXHAUSTED_WARNING_CODE])).toBe(
      true
    );
    expect(includesAiCreditsWarning(['ai-credits-short:10:5'])).toBe(true);
    expect(includesAiCreditsWarning(['markdown-heuristic'])).toBe(false);
    expect(includesAiCreditsWarning(undefined)).toBe(false);
  });
});
