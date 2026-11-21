import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, expect, it, vi } from 'vitest';
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
