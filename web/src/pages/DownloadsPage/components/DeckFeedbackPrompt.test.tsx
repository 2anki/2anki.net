import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const submitEmojiFeedback = vi.fn();
const startPassCheckout = vi.fn();

vi.mock('../../../lib/backend/get2ankiApi', () => ({
  get2ankiApi: () => ({ submitEmojiFeedback, startPassCheckout }),
}));

const mockUseUserLocals = vi.fn();

vi.mock('../../../lib/hooks/useUserLocals', () => ({
  useUserLocals: () => mockUseUserLocals(),
}));

const mockTrack = vi.fn();

vi.mock('../../../lib/analytics/track', () => ({
  track: (...args: unknown[]) => mockTrack(...args),
}));

import {
  ANSWERED_SUPPRESSION_MS,
  DeckFeedbackPrompt,
  DISMISSED_SUPPRESSION_MS,
  isDeckFeedbackSuppressed,
  tagComment,
} from './DeckFeedbackPrompt';

const SUPPRESSED_UNTIL_KEY = '2anki_deck_feedback_suppressed_until';

const freeUser = {
  data: {
    locals: { patreon: false, subscriber: false },
    user: { email: 'free@example.com' },
  },
};

beforeEach(() => {
  submitEmojiFeedback.mockReset();
  submitEmojiFeedback.mockResolvedValue(undefined);
  startPassCheckout.mockReset();
  mockTrack.mockClear();
  mockUseUserLocals.mockReturnValue(freeUser);
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

describe('DeckFeedbackPrompt', () => {
  it('shows the binary prompt by default', () => {
    render(<DeckFeedbackPrompt />);
    expect(
      screen.getByText('Did this deck come out right?')
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Yes, it worked' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Something was off' })
    ).toBeInTheDocument();
  });

  it('opens the idea textarea when the user confirms the deck worked', () => {
    render(<DeckFeedbackPrompt />);
    fireEvent.click(screen.getByRole('button', { name: 'Yes, it worked' }));
    expect(
      screen.getByLabelText(
        'Glad it came out right. Anything that would make it better?'
      )
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Skip' })).toBeInTheDocument();
  });

  it('posts rating 5 with the idea comment when the user fills the follow-up and sends', async () => {
    render(<DeckFeedbackPrompt />);
    fireEvent.click(screen.getByRole('button', { name: 'Yes, it worked' }));
    fireEvent.change(
      screen.getByLabelText(
        'Glad it came out right. Anything that would make it better?'
      ),
      { target: { value: 'add a tag to each card' } }
    );
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => {
      expect(submitEmojiFeedback).toHaveBeenCalledWith(
        5,
        'downloads/deck_done',
        'add a tag to each card'
      );
    });
    expect(await screen.findByText('Feedback received.')).toBeInTheDocument();
  });

  it('posts rating 5 with no comment when the user skips the idea follow-up', async () => {
    render(<DeckFeedbackPrompt />);
    fireEvent.click(screen.getByRole('button', { name: 'Yes, it worked' }));
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    await waitFor(() => {
      expect(submitEmojiFeedback).toHaveBeenCalledWith(
        5,
        'downloads/deck_done',
        undefined
      );
    });
    expect(await screen.findByText('Feedback received.')).toBeInTheDocument();
  });

  it('opens the follow-up textarea when the user reports a problem', () => {
    render(<DeckFeedbackPrompt />);
    fireEvent.click(screen.getByRole('button', { name: 'Something was off' }));
    expect(screen.getByLabelText('What went wrong?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Skip' })).toBeInTheDocument();
  });

  it('posts rating 1 with the comment when the user fills the follow-up and sends', async () => {
    render(<DeckFeedbackPrompt />);
    fireEvent.click(screen.getByRole('button', { name: 'Something was off' }));
    fireEvent.change(screen.getByLabelText('What went wrong?'), {
      target: { value: 'images were missing' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => {
      expect(submitEmojiFeedback).toHaveBeenCalledWith(
        1,
        'downloads/deck_done',
        'images were missing'
      );
    });
    expect(await screen.findByText('Feedback received.')).toBeInTheDocument();
  });

  it('posts rating 1 with no comment when the user skips the follow-up', async () => {
    render(<DeckFeedbackPrompt />);
    fireEvent.click(screen.getByRole('button', { name: 'Something was off' }));
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    await waitFor(() => {
      expect(submitEmojiFeedback).toHaveBeenCalledWith(
        1,
        'downloads/deck_done',
        undefined
      );
    });
    expect(await screen.findByText('Feedback received.')).toBeInTheDocument();
  });

  it('fires the ask event once when the prompt is shown', () => {
    render(<DeckFeedbackPrompt />);
    expect(mockTrack).toHaveBeenCalledTimes(1);
    expect(mockTrack).toHaveBeenCalledWith('happy_score_ask_shown');
  });

  it('tags the comment with the reason chip the user picked', async () => {
    render(<DeckFeedbackPrompt />);
    fireEvent.click(screen.getByRole('button', { name: 'Something was off' }));
    fireEvent.click(screen.getByRole('button', { name: 'Images missing' }));
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'captions vanished' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => {
      expect(submitEmojiFeedback).toHaveBeenCalledWith(
        1,
        'downloads/deck_done',
        '[images_missing] captions vanished'
      );
    });
  });

  it('sends the reason tag alone when the user picks a chip and skips the text', async () => {
    render(<DeckFeedbackPrompt />);
    fireEvent.click(screen.getByRole('button', { name: 'Something was off' }));
    const chip = screen.getByRole('button', { name: 'Too few cards' });
    fireEvent.click(chip);
    expect(chip).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    await waitFor(() => {
      expect(submitEmojiFeedback).toHaveBeenCalledWith(
        1,
        'downloads/deck_done',
        '[too_few_cards]'
      );
    });
  });

  it('shows no reason chips on the positive path', () => {
    render(<DeckFeedbackPrompt />);
    fireEvent.click(screen.getByRole('button', { name: 'Yes, it worked' }));
    expect(
      screen.queryByRole('button', { name: 'Images missing' })
    ).not.toBeInTheDocument();
  });

  it('suppresses for 90 days on dismiss and 180 days on an answer', async () => {
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const { unmount } = render(<DeckFeedbackPrompt />);
    fireEvent.click(screen.getByLabelText('Dismiss'));
    expect(localStorage.getItem(SUPPRESSED_UNTIL_KEY)).toBe(
      String(now + DISMISSED_SUPPRESSION_MS)
    );
    unmount();
    localStorage.clear();
    render(<DeckFeedbackPrompt />);
    fireEvent.click(screen.getByRole('button', { name: 'Yes, it worked' }));
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    await waitFor(() => {
      expect(localStorage.getItem(SUPPRESSED_UNTIL_KEY)).toBe(
        String(now + ANSWERED_SUPPRESSION_MS)
      );
    });
    vi.restoreAllMocks();
  });

  it('tagComment trims, caps, and prefixes', () => {
    expect(tagComment(null, '  hi  ')).toBe('hi');
    expect(tagComment('other', '')).toBe('[other]');
    expect(tagComment('wrong_cards', 'x'.repeat(2500))).toHaveLength(
      '[wrong_cards] '.length + 2000
    );
  });

  it('writes the suppression timestamp on successful submit', async () => {
    render(<DeckFeedbackPrompt />);
    fireEvent.click(screen.getByRole('button', { name: 'Yes, it worked' }));
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    await waitFor(() => {
      expect(isDeckFeedbackSuppressed()).toBe(true);
    });
  });

  it('shows a retry button when the submit fails', async () => {
    submitEmojiFeedback.mockRejectedValueOnce(new Error('network'));
    render(<DeckFeedbackPrompt />);
    fireEvent.click(screen.getByRole('button', { name: 'Yes, it worked' }));
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    expect(await screen.findByText("Couldn't send that.")).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Try again' })
    ).toBeInTheDocument();
  });

  it('isDeckFeedbackSuppressed returns false when no timestamp is stored', () => {
    expect(isDeckFeedbackSuppressed()).toBe(false);
  });

  it('isDeckFeedbackSuppressed returns false when timestamp is in the past', () => {
    localStorage.setItem(SUPPRESSED_UNTIL_KEY, String(Date.now() - 1000));
    expect(isDeckFeedbackSuppressed()).toBe(false);
  });

  it('isDeckFeedbackSuppressed returns true when timestamp is in the future', () => {
    localStorage.setItem(SUPPRESSED_UNTIL_KEY, String(Date.now() + 1000));
    expect(isDeckFeedbackSuppressed()).toBe(true);
  });
});

describe('DeckFeedbackPrompt — no upsell after feedback', () => {
  it('thanks a free user without a pass pitch after a positive rating', async () => {
    render(<DeckFeedbackPrompt />);
    fireEvent.click(screen.getByRole('button', { name: 'Yes, it worked' }));
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    expect(await screen.findByText('Feedback received.')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Get Day Pass' })
    ).not.toBeInTheDocument();
    expect(mockTrack).not.toHaveBeenCalledWith(
      'paywall_shown',
      expect.objectContaining({ surface: 'deck_feedback_sent' })
    );
  });
});
