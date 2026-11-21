import { act, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import i18n from '../../lib/i18n';

vi.mock('../../components/FeedbackWidget/FeedbackWidget', () => ({
  FeedbackWidget: () => null,
}));

vi.mock('./changelog/index', () => ({
  changelog: [
    {
      id: '2026-05-21-shipped-one',
      date: '2026-05-21',
      type: 'feature',
      title: 'Shipped one',
    },
    {
      id: '2026-05-21-shipped-two',
      date: '2026-05-21',
      type: 'fix',
      title: 'Shipped two',
    },
  ],
}));

const renderPage = async () => {
  const { default: WhatsNewPage } = await import('./WhatsNewPage');
  render(
    <MemoryRouter>
      <WhatsNewPage />
    </MemoryRouter>
  );
};

describe('WhatsNewPage', () => {
  it('renders the shipped entries grouped by date', async () => {
    await renderPage();
    expect(screen.getByText('Shipped one')).toBeInTheDocument();
    expect(screen.getByText('Shipped two')).toBeInTheDocument();
  });

  it('marks the English entry titles as English beside translated badges', async () => {
    await i18n.changeLanguage('ja');
    try {
      await renderPage();
      expect(document.documentElement.lang).toBe('ja');
      expect(screen.getByText('Shipped one')).toHaveAttribute('lang', 'en');
      const badge = screen.getByText('Shipped one').previousElementSibling;
      expect(badge?.closest('[lang]')).toBe(document.documentElement);
    } finally {
      await i18n.changeLanguage('en');
    }
  });

  it('does not render In progress or Backlog columns', async () => {
    await renderPage();
    expect(screen.queryByText(/In progress/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Backlog/)).not.toBeInTheDocument();
  });

  describe('date headings', () => {
    const browserToLocaleDateString = Date.prototype.toLocaleDateString;
    const originalTimeZone = process.env.TZ;

    function setBrowserLocale(browserLocale: string) {
      vi.spyOn(Date.prototype, 'toLocaleDateString').mockImplementation(
        function (
          this: Date,
          locales?: Intl.LocalesArgument,
          options?: Intl.DateTimeFormatOptions
        ) {
          return browserToLocaleDateString.call(
            this,
            locales ?? browserLocale,
            options
          );
        }
      );
    }

    const dateHeading = () => screen.getByRole('heading', { level: 3 });

    afterEach(async () => {
      vi.restoreAllMocks();
      process.env.TZ = originalTimeZone;
      await i18n.changeLanguage('en');
    });

    it('keeps the English heading in the format an en-US browser shows today', async () => {
      setBrowserLocale('en-US');
      await i18n.changeLanguage('en');
      await renderPage();
      expect(dateHeading().textContent).toBe('Thursday, May 21, 2026');
    });

    it.each([
      ['ja', '2026年5月21日木曜日'],
      ['de', 'Donnerstag, 21. Mai 2026'],
      ['ru', 'четверг, 21 мая 2026 г.'],
    ])(
      'formats the heading in the app language %s on an en-US browser',
      async (language, expected) => {
        setBrowserLocale('en-US');
        await i18n.changeLanguage(language);
        await renderPage();
        expect(dateHeading().textContent).toBe(expected);
      }
    );

    it('ignores a browser locale that differs from the app language', async () => {
      setBrowserLocale('fr-FR');
      await i18n.changeLanguage('ja');
      await renderPage();
      expect(dateHeading().textContent).toBe('2026年5月21日木曜日');
    });

    it('re-renders the heading when the app language changes', async () => {
      setBrowserLocale('en-US');
      await renderPage();
      expect(dateHeading().textContent).toBe('Thursday, May 21, 2026');
      await act(async () => {
        await i18n.changeLanguage('de');
      });
      expect(dateHeading().textContent).toBe('Donnerstag, 21. Mai 2026');
    });

    it.each(['America/Los_Angeles', 'Pacific/Honolulu', 'Pacific/Kiritimati'])(
      'shows the entry date itself to a viewer in %s',
      async (timeZone) => {
        process.env.TZ = timeZone;
        await renderPage();
        expect(dateHeading().textContent).toBe('Thursday, May 21, 2026');
      }
    );
  });

  it('report an issue link points to github new issue and opens in new tab', async () => {
    await renderPage();
    const link = screen.getByRole('link', { name: /Report an issue/ });
    expect(link).toHaveAttribute(
      'href',
      'https://github.com/2anki/server/issues/new'
    );
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });
});
