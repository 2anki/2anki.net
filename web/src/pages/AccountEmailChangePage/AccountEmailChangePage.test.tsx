import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';

const post = vi.hoisted(() => vi.fn());

vi.mock('../../lib/backend/api', () => ({ post }));
vi.mock('../../lib/analytics/track', () => ({ track: vi.fn() }));

import AccountEmailChangePage from './AccountEmailChangePage';

function refusedWith(status: number, reason: string) {
  post.mockResolvedValue(
    new Response(JSON.stringify({ reason }), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })
  );
}

function renderPage() {
  render(
    <MemoryRouter initialEntries={['/account/email-change?token=abc']}>
      <AccountEmailChangePage />
    </MemoryRouter>
  );
}

describe('AccountEmailChangePage', () => {
  it('asks a payer for an address that can receive billing email', async () => {
    refusedWith(409, 'payer_relay_address');

    renderPage();

    expect(
      await screen.findByText(
        "Use an address you can receive billing email at. Apple Hide My Email addresses can't receive receipts from our payment provider. Start a new email change from your account."
      )
    ).toBeInTheDocument();
  });

  it('says the email stayed the same when the billing record could not be updated', async () => {
    refusedWith(502, 'billing_update_failed');

    renderPage();

    expect(await screen.findByText('Email not changed.')).toBeInTheDocument();
  });

  it('keeps the taken notice for an address another account uses', async () => {
    refusedWith(409, 'email_taken');

    renderPage();

    expect(
      await screen.findByText('That email is taken.')
    ).toBeInTheDocument();
  });
});
