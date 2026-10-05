// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { getLocalStorageValue } from './getLocalStorageValue';
import { SettingsPayload } from '../types';

describe('getLocalStorageValue', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('keeps a deliberately-saved empty string from settings', () => {
    const settings: SettingsPayload = { 'tts-manual-lang': '' };
    expect(getLocalStorageValue('tts-manual-lang', 'en-US', settings)).toBe('');
  });

  it('keeps a deliberately-saved empty string from localStorage', () => {
    localStorage.setItem('deck-name', '');
    expect(getLocalStorageValue('deck-name', 'My deck', {})).toBe('');
  });

  it('falls back to the default when the key is absent everywhere', () => {
    expect(getLocalStorageValue('missing', 'fallback', {})).toBe('fallback');
  });

  it('returns the stored non-empty value over the default', () => {
    const settings: SettingsPayload = { template: 'specialized' };
    expect(getLocalStorageValue('template', 'default-template', settings)).toBe(
      'specialized'
    );
  });
});
