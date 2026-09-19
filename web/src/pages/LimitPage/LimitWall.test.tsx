import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import { LimitWall, type WallOrder } from './LimitWall';

vi.mock('../../lib/analytics/track', () => ({ track: vi.fn() }));

function renderWall(order: WallOrder, passError: string | null = null) {
  return render(
    <HelmetProvider>
      <MemoryRouter>
        <LimitWall
          order={order}
          pendingPass={null}
          onPass={vi.fn()}
          passError={passError}
          unlimitedHref="/pricing?source=limit-wall"
          onUnlimitedClick={vi.fn()}
        />
      </MemoryRouter>
    </HelmetProvider>
  );
}

function appearsBefore(first: HTMLElement, second: HTMLElement) {
  return Boolean(
    first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING
  );
}

describe('LimitWall', () => {
  it('shows the passes before Unlimited when passes lead', () => {
    renderWall('passes-first');
    const passesLabel = screen.getByText('Pay once — no subscription');
    const unlimitedLabel = screen.getByText('Skip the cap for good');
    expect(appearsBefore(passesLabel, unlimitedLabel)).toBe(true);
  });

  it('shows Unlimited before the passes when Unlimited leads', () => {
    renderWall('unlimited-first');
    const passesLabel = screen.getByText('Pay once — no subscription');
    const unlimitedLabel = screen.getByText('Skip the cap for good');
    expect(appearsBefore(unlimitedLabel, passesLabel)).toBe(true);
  });

  it('announces a checkout error to assistive tech', () => {
    renderWall('passes-first', 'Checkout is unavailable right now');
    expect(screen.getByRole('alert').textContent).toBe(
      'Checkout is unavailable right now'
    );
  });

  it('disables only the pass that is redirecting', () => {
    render(
      <HelmetProvider>
        <MemoryRouter>
          <LimitWall
            order="passes-first"
            pendingPass="120d"
            onPass={vi.fn()}
            passError={null}
            unlimitedHref="/pricing?source=limit-wall"
            onUnlimitedClick={vi.fn()}
          />
        </MemoryRouter>
      </HelmetProvider>
    );
    expect(screen.getByRole('button', { name: 'Redirecting…' })).toHaveProperty(
      'disabled',
      true
    );
    expect(screen.getByRole('button', { name: 'Get Day Pass' })).toHaveProperty(
      'disabled',
      false
    );
  });
});
