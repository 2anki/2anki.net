import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { beforeEach, describe, expect, it } from 'vitest';
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

describe('AiCreditsReadout', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('renders nothing while loading', () => {
    const { container } = render(
      <AiCreditsReadout credits={state({ loading: true })} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the remaining count above the low threshold', () => {
    render(<AiCreditsReadout credits={state({ credits: 180 })} />);
    expect(screen.getByText('180 AI credits left.')).toBeInTheDocument();
  });

  it('shows the low balance without a buy link (until part 2)', () => {
    render(<AiCreditsReadout credits={state({ credits: 20 })} />);
    expect(screen.getByText('20 AI credits left.')).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('tells the user the next deck is built without AI at zero', () => {
    render(<AiCreditsReadout credits={state({ credits: 0 })} />);
    expect(
      screen.getByText('0 AI credits left. Your next deck is built without AI.')
    ).toBeInTheDocument();
  });
});
