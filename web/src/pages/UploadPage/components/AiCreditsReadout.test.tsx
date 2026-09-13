import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import i18n from '../../../lib/i18n';
import { AiCreditsReadout } from './AiCreditsReadout';
import { AiCreditsState } from '../../../lib/hooks/useAiCredits';

const state = (over: Partial<AiCreditsState>): AiCreditsState => ({
  credits: 180,
  allowance: 300,
  windowEnd: null,
  resets: 'period',
  loading: false,
  ...over,
});

function renderReadout(credits: AiCreditsState | null) {
  return render(
    <MemoryRouter>
      <AiCreditsReadout credits={credits} />
    </MemoryRouter>
  );
}

describe('AiCreditsReadout', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('renders nothing while loading', () => {
    const { container } = renderReadout(state({ loading: true }));
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the remaining count and no add-credits link above the low threshold', () => {
    renderReadout(state({ credits: 180 }));
    expect(screen.getByText('180 AI credits left.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Add credits' })).toBeNull();
  });

  it('surfaces an add-credits link at or below 25 credits', () => {
    renderReadout(state({ credits: 20 }));
    expect(screen.getByText('20 AI credits left.')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Add credits' })
    ).toBeInTheDocument();
  });

  it('tells the user the next deck is built without AI at zero', () => {
    renderReadout(state({ credits: 0 }));
    expect(
      screen.getByText('0 AI credits left. Your next deck is built without AI.')
    ).toBeInTheDocument();
  });
});
