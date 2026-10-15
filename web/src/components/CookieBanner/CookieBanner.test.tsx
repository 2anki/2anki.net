import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CookieBanner } from './CookieBanner';

const gtag = vi.fn();

function renderBanner() {
  return render(
    <MemoryRouter>
      <CookieBanner />
    </MemoryRouter>
  );
}

beforeEach(() => {
  (globalThis as { gtag?: unknown }).gtag = gtag;
  document.documentElement.dataset.consentRegion = 'eea';
});

afterEach(() => {
  gtag.mockReset();
  document.cookie = 'cookie_consent=; Max-Age=0; Path=/';
  delete document.documentElement.dataset.consentRegion;
  delete (globalThis as { gtag?: unknown }).gtag;
});

describe('CookieBanner', () => {
  it('shows both choices with equal weight to an EEA visitor who has not chosen', () => {
    renderBanner();

    expect(screen.getByTestId('cookie-banner')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Accept all' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Only necessary' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Privacy policy' })
    ).toHaveAttribute('href', '/documentation/reference/privacy');
  });

  it('stays hidden outside the EEA', () => {
    document.documentElement.dataset.consentRegion = 'other';

    renderBanner();

    expect(screen.queryByTestId('cookie-banner')).not.toBeInTheDocument();
  });

  it('stays hidden once a choice is stored', () => {
    document.cookie = 'cookie_consent=denied; Path=/';

    renderBanner();

    expect(screen.queryByTestId('cookie-banner')).not.toBeInTheDocument();
  });

  it('accepting stores granted, updates gtag consent and closes', () => {
    renderBanner();

    fireEvent.click(screen.getByRole('button', { name: 'Accept all' }));

    expect(document.cookie).toContain('cookie_consent=granted');
    expect(gtag).toHaveBeenCalledWith(
      'consent',
      'update',
      expect.objectContaining({ ad_storage: 'granted' })
    );
    expect(screen.queryByTestId('cookie-banner')).not.toBeInTheDocument();
  });

  it('declining stores denied and closes', () => {
    renderBanner();

    fireEvent.click(screen.getByRole('button', { name: 'Only necessary' }));

    expect(document.cookie).toContain('cookie_consent=denied');
    expect(gtag).toHaveBeenCalledWith(
      'consent',
      'update',
      expect.objectContaining({ ad_storage: 'denied' })
    );
    expect(screen.queryByTestId('cookie-banner')).not.toBeInTheDocument();
  });

  it('is reachable by keyboard', () => {
    renderBanner();
    const decline = screen.getByRole('button', { name: 'Only necessary' });
    decline.focus();
    expect(decline).toHaveFocus();
  });
});
