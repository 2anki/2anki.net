import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ChangeEmail } from './ChangeEmail';

vi.mock('../../../lib/backend/api', () => ({
  post: vi.fn(),
}));
vi.mock('../../../lib/analytics/track', () => ({
  track: vi.fn(),
}));
vi.mock('../../../lib/hooks/useUserLocals', () => ({
  useUserLocals: vi.fn(),
}));

import { post } from '../../../lib/backend/api';
import { track } from '../../../lib/analytics/track';
import { useUserLocals } from '../../../lib/hooks/useUserLocals';

const mockPost = post as ReturnType<typeof vi.fn>;
const mockTrack = track as ReturnType<typeof vi.fn>;
const mockUseUserLocals = useUserLocals as ReturnType<typeof vi.fn>;
const refetch = vi.fn();

const TYPED_SECRET = 'secret-value';

const openForm = () => {
  fireEvent.click(screen.getByRole('button', { name: 'Change email' }));
  fireEvent.change(screen.getByLabelText('New email'), {
    target: { value: 'new@example.com' },
  });
  fireEvent.change(screen.getByLabelText('Current password'), {
    target: { value: TYPED_SECRET },
  });
};

describe('ChangeEmail', () => {
  beforeEach(() => {
    mockPost.mockReset();
    mockTrack.mockReset();
    refetch.mockReset();
    mockUseUserLocals.mockReturnValue({ data: {}, refetch });
  });

  it('shows the collapsed toggle by default', () => {
    render(<ChangeEmail />);
    expect(screen.getByRole('button', { name: 'Change email' })).toBeTruthy();
  });

  it('reveals the form fields when expanded', () => {
    render(<ChangeEmail />);
    fireEvent.click(screen.getByRole('button', { name: 'Change email' }));
    expect(screen.getByLabelText('New email')).toBeTruthy();
    expect(screen.getByLabelText('Current password')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Send confirmation link' })
    ).toBeTruthy();
  });

  it('tracks and refetches after a successful request', async () => {
    mockPost.mockResolvedValue({ ok: true });
    render(<ChangeEmail />);
    openForm();
    fireEvent.click(
      screen.getByRole('button', { name: 'Send confirmation link' })
    );

    await waitFor(() => {
      expect(mockTrack).toHaveBeenCalledWith('email_change_requested');
      expect(refetch).toHaveBeenCalled();
    });
    expect(mockPost).toHaveBeenCalledWith('/api/users/email-change/request', {
      new_email: 'new@example.com',
      password: TYPED_SECRET,
    });
  });

  it('shows the server error message in an alert', async () => {
    mockPost.mockResolvedValue({
      ok: false,
      json: async () => ({ message: 'That password is not correct.' }),
    });
    render(<ChangeEmail />);
    openForm();
    fireEvent.click(
      screen.getByRole('button', { name: 'Send confirmation link' })
    );

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain(
        'That password is not correct.'
      );
    });
  });

  it('offers a set-a-password link for OAuth-only accounts', async () => {
    mockPost.mockResolvedValue({
      ok: false,
      json: async () => ({
        reason: 'set_password_first',
        message: 'Set a password first, then change your email from here.',
      }),
    });
    render(<ChangeEmail />);
    openForm();
    fireEvent.click(
      screen.getByRole('button', { name: 'Send confirmation link' })
    );

    await waitFor(() => {
      expect(
        screen
          .getByRole('link', { name: 'Set a password' })
          .getAttribute('href')
      ).toBe('/forgot');
    });
  });

  it('renders the pending panel and cancels on request', async () => {
    mockPost.mockResolvedValue({ ok: true });
    mockUseUserLocals.mockReturnValue({
      data: {
        pending_email_change: {
          new_email: 'pending@example.com',
          requested_at: new Date().toISOString(),
        },
      },
      refetch,
    });
    render(<ChangeEmail />);

    expect(screen.getByText('Check your new inbox')).toBeTruthy();
    expect(screen.getByText(/pending@example.com/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel change' }));

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith(
        '/api/users/email-change/cancel',
        {}
      );
      expect(refetch).toHaveBeenCalled();
    });
  });
});
