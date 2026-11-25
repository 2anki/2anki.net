// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { AI_CHOICE_AT_KEY } from './aiChoice';
import {
  CLAUDE_CARDS_KEY,
  claudeCardsSwitchedOn,
  switchClaudeCardsOn,
  useClaudeCardsSwitchedOn,
} from './claudeCardsSwitch';

beforeEach(() => {
  localStorage.clear();
});

describe('the Claude cards switch', () => {
  it('turns on in the same stored setting the upload page and settings read', () => {
    localStorage.setItem(CLAUDE_CARDS_KEY, 'false');

    switchClaudeCardsOn();

    expect(localStorage.getItem('claude-ai-flashcards')).toBe('true');
    expect(claudeCardsSwitchedOn()).toBe(true);
  });

  it('records the switch as the visitor’s choice, so a saved default cannot override it', () => {
    switchClaudeCardsOn();

    expect(localStorage.getItem(AI_CHOICE_AT_KEY)).toMatch(/^\d+$/);
  });

  it('tells a mounted reader when it turns on', () => {
    const { result } = renderHook(() => useClaudeCardsSwitchedOn());
    expect(result.current).toBe(false);

    act(() => switchClaudeCardsOn());

    expect(result.current).toBe(true);
  });
});
