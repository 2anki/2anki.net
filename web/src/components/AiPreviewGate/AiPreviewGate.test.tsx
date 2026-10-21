import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AiPreviewGate } from './AiPreviewGate';
import { track } from '../../lib/analytics/track';

const startPassCheckout = vi.fn();

vi.mock('../../lib/analytics/track', () => ({ track: vi.fn() }));
vi.mock('../../lib/backend/get2ankiApi', () => ({
  get2ankiApi: () => ({ startPassCheckout }),
}));
vi.mock('../../lib/hooks/usePassPrices', () => ({
  usePassPrices: () => ({ '24h': '$6', '7d': '$12', '120d': '$29' }),
}));

const CARDS = [
  {
    front: 'What is spaced repetition?',
    back: 'Reviewing at increasing intervals',
  },
  { front: 'What is a cloze?', back: 'A fill-in-the-blank card' },
];

function renderGate(cards = CARDS, onContinueWithoutAi = vi.fn()) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <AiPreviewGate
          cards={cards}
          onContinueWithoutAi={onContinueWithoutAi}
        />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('AiPreviewGate', () => {
  beforeEach(() => {
    vi.mocked(track).mockClear();
    startPassCheckout.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows the preview cards with their fronts and backs', () => {
    renderGate();
    expect(screen.getByText('What is spaced repetition?')).toBeInTheDocument();
    expect(
      screen.getByText('Reviewing at increasing intervals')
    ).toBeInTheDocument();
    expect(screen.getByText('A fill-in-the-blank card')).toBeInTheDocument();
  });

  it('offers the Day Pass at the live price and continue-without-AI', () => {
    renderGate();
    expect(
      screen.getByRole('button', {
        name: 'Get all the AI cards — Day Pass $6, no account',
      })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Continue without AI' })
    ).toBeInTheDocument();
  });

  it('starts an ai-preview checkout and fires the pass-clicked event', async () => {
    const location = { href: 'http://localhost/upload' };
    vi.stubGlobal('location', location);
    startPassCheckout.mockResolvedValue({ url: 'https://stripe/day' });
    renderGate();

    fireEvent.click(screen.getByRole('button', { name: /Day Pass/ }));

    await waitFor(() => expect(location.href).toBe('https://stripe/day'));
    expect(startPassCheckout).toHaveBeenCalledWith(
      '24h',
      undefined,
      'ai-preview'
    );
    expect(track).toHaveBeenCalledWith('ai_preview_pass_clicked', {
      surface: 'ai-preview',
    });
  });

  it('runs the continue-without-AI handler on the secondary button', () => {
    const onContinue = vi.fn();
    renderGate(CARDS, onContinue);

    fireEvent.click(
      screen.getByRole('button', { name: 'Continue without AI' })
    );

    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it('shows the error state and no Day Pass button when the preview is empty', () => {
    renderGate([]);
    expect(
      screen.getByText(/Couldn't make an AI preview from this file/)
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Day Pass/ })).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Continue without AI' })
    ).toBeInTheDocument();
  });
});
