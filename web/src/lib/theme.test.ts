// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getStoredTheme, applyTheme, initTheme } from './theme';

describe('theme', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  afterEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  describe('getStoredTheme', () => {
    it('returns light when nothing is stored', () => {
      expect(getStoredTheme()).toBe('light');
    });

    it('returns the stored theme', () => {
      localStorage.setItem('2anki-theme', 'dark');
      expect(getStoredTheme()).toBe('dark');
    });

    it('returns light for invalid stored values', () => {
      localStorage.setItem('2anki-theme', 'neon');
      expect(getStoredTheme()).toBe('light');
    });

    it('accepts purple as a valid theme', () => {
      localStorage.setItem('2anki-theme', 'purple');
      expect(getStoredTheme()).toBe('purple');
    });

    it('accepts hotpink as a valid theme', () => {
      localStorage.setItem('2anki-theme', 'hotpink');
      expect(getStoredTheme()).toBe('hotpink');
    });
  });

  describe('applyTheme', () => {
    it('removes data-theme attribute for light', () => {
      document.documentElement.setAttribute('data-theme', 'dark');
      applyTheme('light');
      expect(document.documentElement.getAttribute('data-theme')).toBeNull();
    });

    it('sets data-theme to dark', () => {
      applyTheme('dark');
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    });

    it('sets data-theme to gold', () => {
      applyTheme('gold');
      expect(document.documentElement.getAttribute('data-theme')).toBe('gold');
    });

    it('sets data-theme to purple', () => {
      applyTheme('purple');
      expect(document.documentElement.getAttribute('data-theme')).toBe(
        'purple'
      );
    });

    it('sets data-theme to hotpink', () => {
      applyTheme('hotpink');
      expect(document.documentElement.getAttribute('data-theme')).toBe(
        'hotpink'
      );
    });

    it('persists the choice to localStorage', () => {
      applyTheme('purple');
      expect(localStorage.getItem('2anki-theme')).toBe('purple');
    });
  });

  describe('initTheme', () => {
    it('applies the stored theme on init', () => {
      localStorage.setItem('2anki-theme', 'gold');
      initTheme();
      expect(document.documentElement.getAttribute('data-theme')).toBe('gold');
    });

    it('defaults to light when nothing stored', () => {
      initTheme();
      expect(document.documentElement.getAttribute('data-theme')).toBeNull();
    });
  });
});
