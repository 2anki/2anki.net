import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import SearchObjectEntry from './index';

const mockNavigate = vi.fn();
const mockConvert = vi.fn();

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock('../../../../lib/backend/get2ankiApi', () => ({
  get2ankiApi: () => ({ convert: mockConvert }),
}));

const mockRedirectToLogin = vi.fn();
vi.mock('../../../../lib/backend/api', () => ({
  redirectToLogin: () => mockRedirectToLogin(),
}));

function renderEntry(
  overrides: Partial<Parameters<typeof SearchObjectEntry>[0]> = {}
) {
  const defaults = {
    isFavorite: false,
    title: 'Organic Chemistry',
    icon: undefined,
    url: 'https://notion.so/page-abc',
    id: 'page-abc',
    type: 'page',
    setFavorites: vi.fn(),
    setError: vi.fn(),
  };
  return render(
    <MemoryRouter initialEntries={['/notion']}>
      <SearchObjectEntry {...defaults} {...overrides} />
    </MemoryRouter>
  );
}

describe('SearchObjectEntry rules link', () => {
  beforeEach(() => {
    mockNavigate.mockClear();
    mockConvert.mockClear();
  });

  it('encodes page title into returnTo so /notion is pre-filled on return', () => {
    renderEntry({ title: 'Organic Chemistry', id: 'page-abc' });

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Configure rules for Organic Chemistry',
      })
    );

    expect(mockNavigate).toHaveBeenCalledOnce();
    const destination: string = mockNavigate.mock.calls[0][0];
    expect(destination).toContain('/rules/page-abc');
    expect(destination).toContain(
      'returnTo=%2Fnotion%3Fq%3DOrganic%2BChemistry'
    );
  });

  it('encodes special characters in title correctly', () => {
    renderEntry({ title: 'Med & Law 101', id: 'page-xyz' });

    fireEvent.click(
      screen.getByRole('button', { name: 'Configure rules for Med & Law 101' })
    );

    const destination: string = mockNavigate.mock.calls[0][0];
    expect(destination).toContain('returnTo=%2Fnotion%3Fq%3D');
    expect(destination).not.toContain('returnTo=/notion');
  });
});

describe('SearchObjectEntry convert button', () => {
  beforeEach(() => {
    mockNavigate.mockClear();
    mockConvert.mockClear();
  });

  it('shows idle label "Convert" with accessible name "Convert to Anki" initially', () => {
    renderEntry();
    expect(
      screen.getByRole('button', { name: 'Convert to Anki' })
    ).toBeInTheDocument();
  });

  it('on 401: redirects to login instead of showing an error card', async () => {
    const setError = vi.fn();
    mockConvert.mockResolvedValue({ status: 401 });

    renderEntry({ setError });
    fireEvent.click(screen.getByRole('button', { name: 'Convert to Anki' }));

    await waitFor(() => {
      expect(mockRedirectToLogin).toHaveBeenCalled();
    });
    expect(setError).not.toHaveBeenCalled();
    expect(
      screen.getByRole('button', { name: 'Convert to Anki' })
    ).toBeInTheDocument();
  });

  it('on 202: button becomes "In progress" (disabled) and shows downloads link', async () => {
    mockConvert.mockResolvedValue({
      status: 202,
      json: async () => ({ jobId: 5, restarted: false }),
    });

    renderEntry();
    fireEvent.click(screen.getByRole('button', { name: 'Convert to Anki' }));

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'In progress' })
      ).toBeInTheDocument();
    });

    expect(screen.getByText(/Added to My decks/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'view' })).toHaveAttribute(
      'href',
      '/downloads'
    );
  });

  it('on 202 with restarted: true: shows "Re-making your deck" copy instead', async () => {
    mockConvert.mockResolvedValue({
      status: 202,
      json: async () => ({ jobId: 5, restarted: true }),
    });

    renderEntry();
    fireEvent.click(screen.getByRole('button', { name: 'Convert to Anki' }));

    await waitFor(() => {
      expect(screen.getByText(/Re-making your deck/)).toBeInTheDocument();
    });

    expect(screen.queryByText(/Added to My decks/)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'view' })).toHaveAttribute(
      'href',
      '/downloads'
    );
  });

  it('on 402: shows paywall copy with Upgrade link to /pricing', async () => {
    mockConvert.mockResolvedValue({
      status: 402,
      json: async () => ({ reason: 'free_plan_one_at_a_time' }),
    });

    renderEntry();
    fireEvent.click(screen.getByRole('button', { name: 'Convert to Anki' }));

    await waitFor(() => {
      expect(
        screen.getByText(/Free plan — one conversion at a time\./)
      ).toBeInTheDocument();
    });

    expect(screen.getByRole('link', { name: 'Upgrade' })).toHaveAttribute(
      'href',
      '/pricing'
    );
    expect(
      screen.queryByRole('link', { name: 'Auto Sync' })
    ).not.toBeInTheDocument();
  });

  it('on a monthly limit 402: says how many cards were made and when the limit resets', async () => {
    mockConvert.mockResolvedValue({
      status: 402,
      json: async () => ({
        reason: 'monthly_limit',
        code: 'monthly_limit',
        cards_used: 100,
        limit: 100,
        reset_on: '2026-12-01T00:00:00.000Z',
      }),
    });

    renderEntry();
    fireEvent.click(screen.getByRole('button', { name: 'Convert to Anki' }));

    const status = await screen.findByText(
      /You've used your 100 free cards this month\./
    );
    expect(status).toHaveTextContent(
      "You've used your 100 free cards this month. You've made 100 of 100. The limit resets on 1 December 2026. See plans"
    );
    expect(screen.getByRole('link', { name: 'See plans' })).toHaveAttribute(
      'href',
      '/pricing'
    );
    expect(
      screen.queryByText(/one conversion at a time/)
    ).not.toBeInTheDocument();
  });

  it('on a monthly limit 402 without usage: keeps the paywall copy', async () => {
    mockConvert.mockResolvedValue({
      status: 402,
      json: async () => ({ reason: 'monthly_limit', code: 'monthly_limit' }),
    });

    renderEntry();
    fireEvent.click(screen.getByRole('button', { name: 'Convert to Anki' }));

    expect(
      await screen.findByText(/Free plan — one conversion at a time\./)
    ).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/undefined|NaN/);
  });

  it('on 409: shows already-converting copy', async () => {
    mockConvert.mockResolvedValue({
      status: 409,
      json: async () => ({ reason: 'already_in_progress' }),
    });

    renderEntry();
    fireEvent.click(screen.getByRole('button', { name: 'Convert to Anki' }));

    await waitFor(() => {
      expect(
        screen.getByText('Already converting this page.')
      ).toBeInTheDocument();
    });
  });

  it('on other failure: shows generic error copy', async () => {
    mockConvert.mockResolvedValue({ status: 500, text: async () => '' });

    renderEntry();
    fireEvent.click(screen.getByRole('button', { name: 'Convert to Anki' }));

    await waitFor(() => {
      expect(
        screen.getByText("Couldn't queue this page. Try again.")
      ).toBeInTheDocument();
    });
  });
});
