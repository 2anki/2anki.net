import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { ConfirmEmailNotice } from './ConfirmEmailNotice';

const mockTrack = vi.fn();
const mockRequestMagicLink = vi.fn();

vi.mock('../../lib/analytics/track', () => ({
  track: (...args: unknown[]) => mockTrack(...args),
}));

vi.mock('../../lib/backend/get2ankiApi', () => ({
  get2ankiApi: () => ({
    requestMagicLink: (...args: unknown[]) => mockRequestMagicLink(...args),
  }),
}));

describe('ConfirmEmailNotice', () => {
  beforeEach(() => {
    mockTrack.mockClear();
    mockRequestMagicLink.mockReset();
  });

  it('renders the confirm offer and fires account_offer_shown', () => {
    render(<ConfirmEmailNotice email="al@example.com" />);

    expect(
      screen.getByText('Get back to your decks from any device')
    ).toBeInTheDocument();
    expect(mockTrack).toHaveBeenCalledWith('account_offer_shown', {
      surface: 'upload_success_confirm_email',
    });
  });

  it('names the deck in the body when a deck name is passed', () => {
    render(
      <ConfirmEmailNotice
        email="al@example.com"
        deckName="Pharmacology Week 3"
      />
    );

    expect(
      screen.getByText(/You made Pharmacology Week 3 on this device/)
    ).toBeInTheDocument();
  });

  it('falls back to the nameless body without a deck name', () => {
    render(<ConfirmEmailNotice email="al@example.com" />);

    expect(
      screen.getByText(/This deck is saved to your account/)
    ).toBeInTheDocument();
  });

  it('sends a login magic link and swaps to the sent state', async () => {
    mockRequestMagicLink.mockResolvedValue({ ok: true });
    render(<ConfirmEmailNotice email="al@example.com" />);

    fireEvent.click(
      screen.getByRole('button', { name: 'Email me a link to sign in' })
    );

    expect(mockTrack).toHaveBeenCalledWith('account_offer_clicked', {
      surface: 'upload_success_confirm_email',
    });
    expect(mockRequestMagicLink).toHaveBeenCalledWith(
      'al@example.com',
      'login'
    );

    expect(
      await screen.findByText('Sent. Open the link in your inbox to finish.')
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Email me a link to sign in' })
    ).not.toBeInTheDocument();
  });

  it('shows the error state when the request resolves non-ok', async () => {
    mockRequestMagicLink.mockResolvedValue({ ok: false });
    render(<ConfirmEmailNotice email="al@example.com" />);

    fireEvent.click(
      screen.getByRole('button', { name: 'Email me a link to sign in' })
    );

    expect(
      await screen.findByText(
        "Couldn't send the link just now. Try again in a moment."
      )
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Email me a link to sign in' })
    ).toBeInTheDocument();
  });

  it('shows the error state when the request throws', async () => {
    mockRequestMagicLink.mockRejectedValue(new Error('network'));
    render(<ConfirmEmailNotice email="al@example.com" />);

    fireEvent.click(
      screen.getByRole('button', { name: 'Email me a link to sign in' })
    );

    await waitFor(() =>
      expect(
        screen.getByText(
          "Couldn't send the link just now. Try again in a moment."
        )
      ).toBeInTheDocument()
    );
  });
});
