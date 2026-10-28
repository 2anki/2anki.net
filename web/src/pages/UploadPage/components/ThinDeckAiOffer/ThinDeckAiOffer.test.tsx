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

function renderOffer(
  isPaying = false,
  onMakeFullDeck = vi.fn(),
  onBeforeCheckout = vi.fn().mockResolvedValue(undefined),
  busy = false
) {
  const client = new QueryClient();
  render(
    <QueryClientProvider client={client}>
      <ThinDeckAiOffer
        file={file}
        cardCount={2}
        isPaying={isPaying}
        busy={busy}
        onMakeFullDeck={onMakeFullDeck}
        onBeforeCheckout={onBeforeCheckout}
      />
    </QueryClientProvider>
  );
  return { onMakeFullDeck, onBeforeCheckout };
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

  it('keeps the file for the return before it leaves for checkout', async () => {
    startPassCheckout.mockResolvedValue({ status: 'error' });
    const order: string[] = [];
    const onBeforeCheckout = vi.fn().mockImplementation(async () => {
      order.push('saved');
    });
    startPassCheckout.mockImplementation(async () => {
      order.push('checkout');
      return { status: 'error' };
    });
    renderOffer(false, vi.fn(), onBeforeCheckout);
    fireEvent.click(
      screen.getByRole('button', { name: 'Preview cards Claude would write' })
    );

    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Get every card: Day Pass $6',
      })
    );

    await waitFor(() => expect(order).toEqual(['saved', 'checkout']));
  });

  it('lets a paying person make the full AI deck without a checkout', async () => {
    const { onMakeFullDeck, onBeforeCheckout } = renderOffer(true);
    fireEvent.click(
      screen.getByRole('button', { name: 'Preview cards Claude would write' })
    );

    fireEvent.click(
      await screen.findByRole('button', { name: 'Make the full AI deck' })
    );

    expect(onMakeFullDeck).toHaveBeenCalledTimes(1);
    expect(startPassCheckout).not.toHaveBeenCalled();
    expect(onBeforeCheckout).not.toHaveBeenCalled();
  });

  it("leaves a paying person's tap for the page to record once the file goes out", async () => {
    renderOffer(true);
    fireEvent.click(
      screen.getByRole('button', { name: 'Preview cards Claude would write' })
    );

    fireEvent.click(
      await screen.findByRole('button', { name: 'Make the full AI deck' })
    );

    expect(track).not.toHaveBeenCalledWith(
      'thin_deck_ai_unlock_clicked',
      expect.anything()
    );
  });

  it('says it is checking the account on the full AI deck while busy, and holds it', async () => {
    const { onMakeFullDeck } = renderOffer(
      true,
      vi.fn(),
      vi.fn().mockResolvedValue(undefined),
      true
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Preview cards Claude would write' })
    );

    const checking = await screen.findByRole('button', {
      name: 'Checking your account',
    });
    fireEvent.click(checking);

    expect(checking).toBeDisabled();
    expect(checking).toHaveAttribute('aria-busy', 'true');
    expect(onMakeFullDeck).not.toHaveBeenCalled();
  });
});
