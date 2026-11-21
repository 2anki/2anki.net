import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { track } from '../../lib/analytics/track';
import i18n from '../../lib/i18n';
import { LanguagePicker } from './LanguagePicker';

vi.mock('../../lib/analytics/track', () => ({
  track: vi.fn(),
}));

describe('LanguagePicker', () => {
  afterEach(() => {
    vi.clearAllMocks();
    i18n.changeLanguage('en');
    localStorage.clear();
  });

  it('renders every supported language by its native name', () => {
    render(<LanguagePicker />);
    const select = screen.getByRole('combobox', { name: 'Language' });
    const options = Array.from(select.querySelectorAll('option')).map(
      (option) => option.textContent
    );
    expect(options).toEqual([
      'English',
      'Deutsch',
      'Español',
      '日本語',
      'Français',
      'Português',
      'Русский',
      'Italiano',
      'Nederlands',
      'Polski',
    ]);
  });

  it('changes the active language to German on selection', async () => {
    render(<LanguagePicker />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Language' }), {
      target: { value: 'de' },
    });
    await waitFor(() => expect(i18n.language).toBe('de'));
  });

  it('tells the browser the page is now in the chosen language', async () => {
    render(<LanguagePicker />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Language' }), {
      target: { value: 'ja' },
    });
    await waitFor(() => expect(document.documentElement.lang).toBe('ja'));
  });

  it('tells the browser the page is English again after switching back', async () => {
    render(<LanguagePicker />);
    const picker = screen.getByRole('combobox', { name: 'Language' });
    fireEvent.change(picker, { target: { value: 'de' } });
    await waitFor(() => expect(document.documentElement.lang).toBe('de'));
    fireEvent.change(picker, { target: { value: 'en' } });
    await waitFor(() => expect(document.documentElement.lang).toBe('en'));
  });

  it('fires the language_changed event with the chosen language', () => {
    render(<LanguagePicker />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Language' }), {
      target: { value: 'de' },
    });
    expect(track).toHaveBeenCalledWith('language_changed', { language: 'de' });
  });

  it('renders a labeled row with an associated label in the labeled variant', () => {
    render(<LanguagePicker variant="labeled" />);
    expect(
      screen.getByLabelText('Language', { selector: 'select' })
    ).toBeInTheDocument();
  });
});
