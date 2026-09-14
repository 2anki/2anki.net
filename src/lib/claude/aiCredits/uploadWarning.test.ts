import {
  AI_CREDITS_EXHAUSTED_WARNING_CODE,
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
});
