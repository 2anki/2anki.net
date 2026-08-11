import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { CreateAccountNotice } from './CreateAccountNotice';

const mockTrack = vi.fn();

vi.mock('../../lib/analytics/track', () => ({
  track: (...args: unknown[]) => mockTrack(...args),
}));

describe('CreateAccountNotice', () => {
  beforeEach(() => {
    mockTrack.mockClear();
  });

  it('renders the account offer and fires account_offer_shown', () => {
    render(<CreateAccountNotice />, { wrapper: MemoryRouter });

    expect(
      screen.getByText('This deck lives only on this device')
    ).toBeInTheDocument();
    expect(mockTrack).toHaveBeenCalledWith('account_offer_shown', {
      surface: 'upload_success_signup',
    });
  });

  it('names the deck in the body when a deck name is passed', () => {
    render(<CreateAccountNotice deckName="Pharmacology Week 3" />, {
      wrapper: MemoryRouter,
    });

    expect(
      screen.getByText(/You made Pharmacology Week 3 as a guest/)
    ).toBeInTheDocument();
  });

  it('falls back to the nameless body without a deck name', () => {
    render(<CreateAccountNotice />, { wrapper: MemoryRouter });

    expect(
      screen.getByText(/You made this deck as a guest/)
    ).toBeInTheDocument();
  });

  it('links to registration and tracks the click', () => {
    render(<CreateAccountNotice />, { wrapper: MemoryRouter });

    const cta = screen.getByRole('link', { name: 'Save your decks — free' });
    expect(cta).toHaveAttribute('href', '/register?redirect=/upload');

    fireEvent.click(cta);
    expect(mockTrack).toHaveBeenCalledWith('account_offer_clicked', {
      surface: 'upload_success_signup',
    });
  });
});
