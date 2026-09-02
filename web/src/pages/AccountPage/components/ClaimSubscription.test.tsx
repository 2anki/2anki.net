import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ClaimSubscription } from './ClaimSubscription';

vi.mock('../../../lib/backend/api', () => ({
  post: vi.fn(),
}));

import { post } from '../../../lib/backend/api';
const mockPost = post as ReturnType<typeof vi.fn>;

describe('ClaimSubscription', () => {
  beforeEach(() => {
    mockPost.mockReset();
  });

  it('renders the section heading', () => {
    render(<ClaimSubscription />);
    expect(screen.getByText('Link a subscription')).toBeTruthy();
  });

  it('shows the helper text and button when expanded', () => {
    render(<ClaimSubscription />);
    fireEvent.click(screen.getByText('Link a subscription'));
    expect(
      screen.getByText(/Bought a subscription or a Week or Day Pass/)
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Send confirmation email' })
    ).toBeTruthy();
  });

  it('shows success toast after successful submission', async () => {
    mockPost.mockResolvedValue({ ok: true });
    render(<ClaimSubscription />);
    fireEvent.click(screen.getByText('Link a subscription'));

    const input = screen.getByLabelText('Email you paid with');
    fireEvent.change(input, { target: { value: 'payer@example.com' } });
    fireEvent.click(
      screen.getByRole('button', { name: 'Send confirmation email' })
    );

    await waitFor(() => {
      expect(screen.getByRole('status')).toBeTruthy();
      expect(screen.getByText(/Sent\. Check that inbox/)).toBeTruthy();
    });
  });
});
