import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import i18n from '../../../lib/i18n';
import { AiCreditsReadout } from './AiCreditsReadout';
import { AiCreditsState } from '../../../lib/hooks/useAiCredits';

const state = (over: Partial<AiCreditsState>): AiCreditsState => ({
  credits: 180,
  used: 0,
  allowance: 300,
  usable: true,
  windowEnd: null,
  resets: 'period',
  ...over,
});

describe('AiCreditsReadout', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('renders nothing when there is no data', () => {
    const { container } = render(<AiCreditsReadout credits={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing for a user with no allowance', () => {
    const { container } = render(
      <AiCreditsReadout credits={state({ allowance: 0, credits: 0 })} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the remaining count with no buy action above the low threshold', () => {
    render(<AiCreditsReadout credits={state({ credits: 180 })} />);
    expect(screen.getByText('180 AI credits left.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Buy credits' })).toBeNull();
  });

  it('offers a compact buy action at a low balance', () => {
    render(<AiCreditsReadout credits={state({ credits: 20 })} />);
    expect(screen.getByText('20 AI credits left.')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Buy credits' })
    ).toBeInTheDocument();
  });

  it('offers a compact buy action at zero and explains the fallback', () => {
    render(<AiCreditsReadout credits={state({ credits: 0 })} />);
    expect(
      screen.getByText(
        '0 AI credits left. Your next deck builds without AI until your credits reset.'
      )
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Buy credits' })
    ).toBeInTheDocument();
  });
});
