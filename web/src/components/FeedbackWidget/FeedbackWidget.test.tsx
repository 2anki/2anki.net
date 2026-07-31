import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FeedbackWidget } from './FeedbackWidget';

vi.mock('../../lib/hooks/useUserLocals', () => ({
  useUserLocals: vi.fn(),
}));

const submitEmojiFeedback = vi.fn().mockResolvedValue(undefined);
vi.mock('../../lib/backend/get2ankiApi', () => ({
  get2ankiApi: () => ({
    submitEmojiFeedback,
  }),
}));

import { useUserLocals } from '../../lib/hooks/useUserLocals';

const mockUseUserLocals = vi.mocked(useUserLocals);

function userLocalsWith(email: string | undefined) {
  return {
    data: email == null ? undefined : { user: { email } },
    isLoading: false,
    error: null,
    isError: false,
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof useUserLocals>;
}

function pickRating() {
  fireEvent.click(screen.getAllByRole('button')[0]);
}

describe('FeedbackWidget email prefill', () => {
  beforeEach(() => {
    submitEmojiFeedback.mockClear();
  });

  it('prefills the email input with the signed-in email', () => {
    mockUseUserLocals.mockReturnValue(userLocalsWith('a@b.com'));
    render(<FeedbackWidget page="/upload" />);

    pickRating();

    expect(screen.getByRole('textbox', { name: /email/i })).toHaveValue(
      'a@b.com'
    );
  });

  it('leaves the email input empty when logged out', () => {
    mockUseUserLocals.mockReturnValue(userLocalsWith(undefined));
    render(<FeedbackWidget page="/upload" />);

    pickRating();

    expect(screen.getByRole('textbox', { name: /email/i })).toHaveValue('');
  });

  it('submits a typed-over address instead of the prefill', async () => {
    mockUseUserLocals.mockReturnValue(userLocalsWith('a@b.com'));
    render(<FeedbackWidget page="/upload" />);

    pickRating();
    fireEvent.change(screen.getByRole('textbox', { name: /email/i }), {
      target: { value: 'typed@x.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));

    await waitFor(() =>
      expect(submitEmojiFeedback).toHaveBeenCalledWith(
        expect.any(Number),
        '/upload',
        undefined,
        'typed@x.com'
      )
    );
  });
});
