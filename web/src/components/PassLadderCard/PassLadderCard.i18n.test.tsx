import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import i18n from '../../lib/i18n';
import { PassLadderCard } from './PassLadderCard';

vi.mock('../../lib/hooks/useUserLocals', () => ({
  useUserLocals: () => ({ data: undefined }),
}));

vi.mock('../../lib/analytics/track', () => ({ track: vi.fn() }));

describe('PassLadderCard in German', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('de');
  });

  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('translates the headline and keeps the Unlimited price in the CTA', () => {
    render(<PassLadderCard offerOverride={{ passCount: 3, spentUsd: 12 }} />);
    expect(
      screen.getByText('Gibst du mehr für Pässe aus, als Unlimited kostet?')
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Unlimited holen — $7.99/mo' })
    ).toBeInTheDocument();
  });

  it('pluralises the pass count body', () => {
    render(<PassLadderCard offerOverride={{ passCount: 1, spentUsd: 4 }} />);
    expect(screen.getByText(/Du hast 1 Pass gekauft/i)).toBeInTheDocument();
  });
});
