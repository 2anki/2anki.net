import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  OwnedPlanNotice,
  ownsOngoingAccess,
  activePassKind,
  type PricingEntitlement,
} from './OwnedPlanNotice';

const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
const past = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

describe('ownsOngoingAccess', () => {
  it.each<[string, PricingEntitlement]>([
    ['lifetime', { patreon: true }],
    ['apple', { subscriber: true, planSource: 'apple' }],
    ['stripe subscriber', { subscriber: true, planSource: 'stripe' }],
  ])('is true for %s, who has nothing to buy here', (_label, entitlement) => {
    expect(ownsOngoingAccess(entitlement)).toBe(true);
  });

  it.each<[string, PricingEntitlement | undefined]>([
    ['anonymous', undefined],
    ['free', { subscriber: false }],
    [
      'pass holder',
      { subscriber: true, passKind: '120d', passExpiresAt: future },
    ],
  ])(
    'is false for %s, who keeps the purchase options',
    (_label, entitlement) => {
      expect(ownsOngoingAccess(entitlement)).toBe(false);
    }
  );
});

describe('activePassKind', () => {
  it('reports a pass that has not run out', () => {
    expect(activePassKind({ passKind: '7d', passExpiresAt: future })).toBe(
      '7d'
    );
  });

  it('ignores a pass that already expired', () => {
    expect(activePassKind({ passKind: '7d', passExpiresAt: past })).toBeNull();
  });

  it('ignores a pass with no expiry recorded', () => {
    expect(activePassKind({ passKind: '7d' })).toBeNull();
  });
});

describe('OwnedPlanNotice', () => {
  it('tells a lifetime holder what they have instead of selling to them', () => {
    render(<OwnedPlanNotice entitlement={{ patreon: true }} />);

    expect(screen.getByText(/lifetime/i)).toBeInTheDocument();
    expect(screen.getByRole('link')).toHaveAttribute('href', '/account');
  });

  it('names the pass a pass holder bought', () => {
    render(
      <OwnedPlanNotice
        entitlement={{
          subscriber: true,
          passKind: '120d',
          passExpiresAt: future,
        }}
      />
    );

    expect(screen.getByText(/Semester Pass/)).toBeInTheDocument();
  });

  it('says a subscriber is already on Pro', () => {
    render(
      <OwnedPlanNotice
        entitlement={{ subscriber: true, planSource: 'stripe' }}
      />
    );

    expect(screen.getByText(/Pro/)).toBeInTheDocument();
  });

  it('renders nothing for someone with no entitlement', () => {
    const { container } = render(
      <OwnedPlanNotice entitlement={{ subscriber: false }} />
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing for an anonymous visitor', () => {
    const { container } = render(<OwnedPlanNotice entitlement={undefined} />);

    expect(container).toBeEmptyDOMElement();
  });
});
