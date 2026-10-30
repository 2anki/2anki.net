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

  it('tells a pass holder the deck moves to My decks if they sign up within a day', () => {
    render(
      <CreateAccountNotice deckName="Pharmacology Week 3" keptForAccount />,
      {
        wrapper: MemoryRouter,
      }
    );

    expect(
      screen.getByText('Sign up within a day to keep this deck')
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Pharmacology Week 3 is kept for a day. Create a free account in this browser before then and it moves to My decks, along with every deck you convert after.'
      )
    ).toBeInTheDocument();
    expect(screen.queryByText(/as a guest/)).not.toBeInTheDocument();
  });

  it('tells a pass holder the same without a deck name', () => {
    render(<CreateAccountNotice keptForAccount />, { wrapper: MemoryRouter });

    expect(
      screen.getByText(/^This deck is kept for a day\./)
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

  it('drops to the secondary style when another action leads', () => {
    render(<CreateAccountNotice secondary />, { wrapper: MemoryRouter });

    expect(screen.getByRole('link').className).toMatch(/ctaSecondary/);
  });

  it('keeps the solid style by default', () => {
    render(<CreateAccountNotice />, { wrapper: MemoryRouter });

    expect(screen.getByRole('link').className).not.toMatch(/ctaSecondary/);
  });
});
