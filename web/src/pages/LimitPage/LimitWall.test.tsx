import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import { LimitWall } from './LimitWall';
import type { PassKind } from './LimitWall';

interface WallOverrides {
  passError?: string | null;
  pendingPass?: PassKind | null;
  unlimitedPrice?: string;
  notice?: React.ReactNode;
  onUnlimitedClick?: () => void;
}

function renderWall(overrides: WallOverrides = {}) {
  return render(
    <HelmetProvider>
      <MemoryRouter>
        <LimitWall
          pendingPass={overrides.pendingPass ?? null}
          onPass={vi.fn()}
          passError={overrides.passError ?? null}
          unlimitedHref="/pricing?source=limit-wall"
          unlimitedPrice={overrides.unlimitedPrice}
          onUnlimitedClick={overrides.onUnlimitedClick ?? vi.fn()}
          notice={overrides.notice}
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
  it('heads the wall with the monthly limit in its protected wording', () => {
    renderWall();
    expect(
      screen.getByRole('heading', {
        level: 1,
        name: "You've reached your monthly limit",
      })
    ).toBeTruthy();
    expect(
      screen.getByText(
        'Your monthly limit: 100 cards. Get a pass to keep converting now.'
      )
    ).toBeTruthy();
  });

  it('leads with the passes and puts Pro after them', () => {
    renderWall();
    const passesLabel = screen.getByText('Pay once — no subscription');
    const proLine = screen.getByText(/Converting every month\?/);
    expect(appearsBefore(passesLabel, proLine)).toBe(true);
    expect(
      appearsBefore(
        screen.getByRole('button', { name: /^Get Semester Pass/ }),
        proLine
      )
    ).toBe(true);
  });

  it('lists what every pass includes once, not on each card', () => {
    renderWall();
    const shared = screen.getByRole('list', { name: 'Every pass includes' });
    expect(
      within(shared).getByText('Unlimited cards and conversions')
    ).toBeTruthy();
    expect(
      within(shared).getByText('Image occlusion with up to 20 images at a time')
    ).toBeTruthy();
    expect(screen.getAllByText('Unlimited cards and conversions')).toHaveLength(
      1
    );
    expect(screen.queryByText('No subscription')).toBeNull();
  });

  it('sells Pro in one line with its monthly price', () => {
    renderWall({ unlimitedPrice: '$4.50' });
    expect(
      screen.getByText('Converting every month? Pro is $4.50/month.')
    ).toBeTruthy();
    const upgrade = screen.getByRole('link', { name: 'Upgrade to Pro' });
    expect(upgrade.getAttribute('href')).toBe('/pricing?source=limit-wall');
  });

  it('sells Pro in one line without a price when none is given', () => {
    renderWall();
    expect(
      screen.getByText('Converting every month? Pro has no card limit.')
    ).toBeTruthy();
    expect(screen.queryByText(/\/month/)).toBeNull();
  });

  it('reports the Pro click', () => {
    const onUnlimitedClick = vi.fn();
    renderWall({ onUnlimitedClick });
    fireEvent.click(screen.getByRole('link', { name: 'Upgrade to Pro' }));
    expect(onUnlimitedClick).toHaveBeenCalledOnce();
  });

  it('announces a checkout error to assistive tech', () => {
    renderWall({ passError: 'Checkout is unavailable right now' });
    expect(screen.getByRole('alert').textContent).toBe(
      'Checkout is unavailable right now'
    );
  });

  it('shows a checkout error above the passes so it stays near the buttons', () => {
    renderWall({ passError: 'Checkout is unavailable right now' });
    const alert = screen.getByRole('alert');
    const dayPass = screen.getByRole('button', { name: 'Get Day Pass · $6' });
    expect(appearsBefore(alert, dayPass)).toBe(true);
  });

  it('scrolls a checkout error into view', () => {
    const scrollIntoView = vi.fn();
    const original = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = scrollIntoView;
    renderWall({ passError: 'Checkout is unavailable right now' });
    HTMLElement.prototype.scrollIntoView = original;
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });
  });

  it('disables only the pass that is redirecting', () => {
    renderWall({ pendingPass: '120d' });
    expect(
      screen.getByRole('button', { name: 'Starting checkout' })
    ).toHaveProperty('disabled', true);
    expect(
      screen.getByRole('button', { name: 'Get Day Pass · $6' })
    ).toHaveProperty('disabled', false);
  });

  it('puts a notice above every offer when one is given', () => {
    renderWall({ notice: <p>Your payment didn't go through</p> });
    const notice = screen.getByText("Your payment didn't go through");
    const firstOffer = screen.getByText('Pay once — no subscription');
    expect(appearsBefore(notice, firstOffer)).toBe(true);
  });
});
