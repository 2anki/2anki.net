import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import i18n from '../../lib/i18n';
import { AiGiftFeedback } from './AiGiftFeedback';

const reply = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  redirected: false,
  json: async () => body,
});

function routeFetch(feedbackDue: boolean) {
  const posts: unknown[] = [];
  globalThis.fetch = vi.fn(
    async (url: string, init?: { method?: string; body?: string }) => {
      if (String(url).endsWith('/api/ai/gift/feedback')) {
        posts.push(JSON.parse(init?.body ?? '{}'));
        return reply(204, null);
      }
      if (String(url).endsWith('/api/ai/gift')) {
        return reply(200, {
          state: 'claimed',
          credits: 40,
          expiresAt: '2026-11-27T12:00:00.000Z',
          feedbackDue,
        });
      }
      return reply(200, {});
    }
  ) as unknown as typeof fetch;
  return posts;
}

function renderFeedback() {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MemoryRouter>
        <AiGiftFeedback />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const QUESTION = 'Did the Claude cards come out the way you wanted?';

beforeEach(async () => {
  await i18n.changeLanguage('en');
});

describe('AiGiftFeedback', () => {
  test('asks nothing until a gift-funded conversion has finished', async () => {
    routeFetch(false);
    renderFeedback();

    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    expect(screen.queryByText(QUESTION)).not.toBeInTheDocument();
  });

  test('records a yes and thanks the reader', async () => {
    const posts = routeFetch(true);
    renderFeedback();

    fireEvent.click(await screen.findByRole('button', { name: 'Yes' }));

    expect(
      await screen.findByText('Thanks. This helps us tune Claude cards.')
    ).toBeInTheDocument();
    expect(posts).toEqual([{ answer: 'yes', comment: '' }]);
  });

  test('offers an optional 500-character box on a no', async () => {
    const posts = routeFetch(true);
    renderFeedback();

    fireEvent.click(await screen.findByRole('button', { name: 'No' }));
    const box = screen.getByLabelText(
      'What should have been different? (optional)'
    );
    expect(box).toHaveFocus();
    expect(box).toHaveAttribute('maxLength', '500');
    fireEvent.change(box, { target: { value: 'Too many cards' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await screen.findByText('Thanks. This helps us tune Claude cards.');
    expect(posts).toEqual([{ answer: 'no', comment: 'Too many cards' }]);
  });

  test('records a close as the one answer and goes away', async () => {
    const posts = routeFetch(true);
    renderFeedback();

    fireEvent.click(await screen.findByRole('button', { name: 'Close' }));

    await waitFor(() =>
      expect(screen.queryByText(QUESTION)).not.toBeInTheDocument()
    );
    expect(posts).toEqual([{ answer: 'dismissed', comment: '' }]);
  });
});
