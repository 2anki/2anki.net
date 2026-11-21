import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter } from 'react-router-dom';
import { CONVERT_LANDING_PAGES } from '../ConvertLandingPage/convertLandingConfig';
import ConvertHubPage from './ConvertHubPage';
import i18n from '../../lib/i18n';

function renderHub() {
  return render(
    <MemoryRouter initialEntries={['/convert']}>
      <HelmetProvider>
        <ConvertHubPage />
      </HelmetProvider>
    </MemoryRouter>
  );
}

describe('ConvertHubPage', () => {
  it('renders the hub H1', () => {
    renderHub();
    expect(
      screen.getByRole('heading', {
        level: 1,
        name: /convert anything to anki/i,
      })
    ).toBeInTheDocument();
  });

  it('marks the English converter names and blurbs as English under another app language', async () => {
    await i18n.changeLanguage('ja');
    try {
      renderHub();
      const firstList = document.querySelector('ul');
      expect(firstList).toHaveAttribute('lang', 'en');
    } finally {
      await i18n.changeLanguage('en');
    }
  });

  it('links to every converter in CONVERT_LANDING_PAGES', () => {
    renderHub();
    const hrefs = Array.from(screen.getAllByRole('link')).map((link) =>
      link.getAttribute('href')
    );
    for (const copy of Array.from(CONVERT_LANDING_PAGES.values())) {
      expect(hrefs).toContain(copy.pathname);
    }
  });

  it('uses descriptive anchors, never "click here"', () => {
    renderHub();
    for (const link of screen.getAllByRole('link')) {
      expect(link.textContent?.toLowerCase()).not.toContain('click here');
    }
  });
});
