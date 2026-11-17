import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import i18n from '../../../lib/i18n';
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

  describe('pass end', () => {
    const NOW = new Date('2027-01-08T12:00:00.000Z');
    let originalZone: string | undefined;

    beforeEach(() => {
      originalZone = process.env.TZ;
      process.env.TZ = 'Europe/Berlin';
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(NOW);
    });

    afterEach(async () => {
      vi.useRealTimers();
      process.env.TZ = originalZone;
      await i18n.changeLanguage('en');
    });

    it.each([
      ['en', 'January 11, 2027 at 12:30 AM'],
      ['de', '11. Januar 2027 um 0:30'],
    ])(
      'writes the end with its time in the chosen language (%s), as the account page does',
      async (language, expected) => {
        await i18n.changeLanguage(language);

        render(
          <OwnedPlanNotice
            entitlement={{
              subscriber: true,
              passKind: '120d',
              passExpiresAt: '2027-01-10T23:30:00.000Z',
            }}
          />
        );

        expect(screen.getByRole('status')).toHaveTextContent(expected);
      }
    );
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
