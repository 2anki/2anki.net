import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThinDeckAiOffer } from './ThinDeckAiOffer';
import { track } from '../../../../lib/analytics/track';

vi.mock('../../../../lib/analytics/track', () => ({ track: vi.fn() }));

const previewThinDeckAi = vi.fn();
const startPassCheckout = vi.fn();

vi.mock('../../../../lib/backend/get2ankiApi', () => ({
  get2ankiApi: vi.fn(() => ({ previewThinDeckAi, startPassCheckout })),
}));

vi.mock('../../../../lib/hooks/usePassPrices', () => ({
  usePassPrices: () => ({ '24h': '$6', '7d': '$12', '120d': '$29' }),
}));

const file = new File(['text'], 'lecture.pdf', { type: 'application/pdf' });

function renderOffer(isPaying = false, onMakeFullDeck = vi.fn()) {
  const client = new QueryClient();
  render(
    <QueryClientProvider client={client}>
      <ThinDeckAiOffer
        file={file}
        cardCount={2}
        isPaying={isPaying}
        onMakeFullDeck={onMakeFullDeck}
      />
    </QueryClientProvider>
  );
  return { onMakeFullDeck };
}

describe('ThinDeckAiOffer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    previewThinDeckAi.mockResolvedValue({
      kind: 'preview',
      cards: [{ front: 'What is ATP?', back: 'Cell energy currency.' }],
    });
  });

  it('sends nothing to Claude until the button is tapped', () => {
    renderOffer();

    expect(previewThinDeckAi).not.toHaveBeenCalled();
    expect(
      screen.getByRole('button', { name: 'Preview cards Claude would write' })
    ).toBeTruthy();
    expect(screen.getByText(/sent to Claude \(Anthropic\)/)).toBeTruthy();
    expect(track).toHaveBeenCalledWith('thin_deck_ai_offer_shown', {
      cards: 2,
    });
  });

  it('shows the sample cards after the tap', async () => {
    renderOffer();

    fireEvent.click(
      screen.getByRole('button', { name: 'Preview cards Claude would write' })
    );

    expect(await screen.findByText('What is ATP?')).toBeTruthy();
    expect(previewThinDeckAi).toHaveBeenCalledWith(file);
    expect(track).toHaveBeenCalledWith('thin_deck_ai_optin_clicked', {
      cards: 2,
    });
  });

  it('says so when no preview could be made', async () => {
    previewThinDeckAi.mockResolvedValue({ kind: 'unavailable' });
    renderOffer();

    fireEvent.click(
      screen.getByRole('button', { name: 'Preview cards Claude would write' })
    );

    expect(
      await screen.findByText(/Couldn't make a preview from this file/)
    ).toBeTruthy();
  });

  it('offers a free person the Day Pass checkout from the thin deck surface', async () => {
    startPassCheckout.mockResolvedValue({ status: 'error' });
    renderOffer(false);
    fireEvent.click(
      screen.getByRole('button', { name: 'Preview cards Claude would write' })
    );

    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Get every card: Day Pass $6',
      })
    );

    await waitFor(() =>
      expect(startPassCheckout).toHaveBeenCalledWith(
        '24h',
        undefined,
        'thin-deck'
      )
    );
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(track).toHaveBeenCalledWith('thin_deck_ai_unlock_clicked', {
      plan: 'day_pass',
    });
  });

  it('lets a paying person make the full AI deck without a checkout', async () => {
    const { onMakeFullDeck } = renderOffer(true);
    fireEvent.click(
      screen.getByRole('button', { name: 'Preview cards Claude would write' })
    );

    fireEvent.click(
      await screen.findByRole('button', { name: 'Make the full AI deck' })
    );

    expect(onMakeFullDeck).toHaveBeenCalledTimes(1);
    expect(startPassCheckout).not.toHaveBeenCalled();
  });
});
