import { act, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../../lib/i18n';
import { AiCreditsReadout } from './AiCreditsReadout';
import { AiCreditsState } from '../../../lib/hooks/useAiCredits';
import { formatGiftDate } from '../../../components/AiGift/formatGiftDate';

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
    expect(screen.queryByRole('button', { name: 'Top up — $5' })).toBeNull();
  });

  it('offers a compact buy action at a low balance', () => {
    render(<AiCreditsReadout credits={state({ credits: 20 })} />);
    expect(screen.getByText('20 AI credits left.')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Top up — $5' })
    ).toBeInTheDocument();
  });

  it('names no reset for a pass with no credits left, which does not refill', () => {
    render(
      <AiCreditsReadout credits={state({ credits: 0, resets: 'pass' })} />
    );
    expect(
      screen.getByText('0 AI credits left. Your next deck builds without AI.')
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
      screen.getByRole('button', { name: 'Top up — $5' })
    ).toBeInTheDocument();
  });
});

describe('AiCreditsReadout with free AI credits from the gift', () => {
  const EXPIRES = '2026-11-26T19:15:00.000Z';
  const plusLine = (count: number) =>
    `Plus ${count} free AI credits until ${formatGiftDate(EXPIRES, 'en')}.`;
  const claimed = (credits: number, expiresAt = EXPIRES) => ({
    state: 'claimed' as const,
    credits,
    expiresAt,
    feedbackDue: false,
  });

  beforeEach(async () => {
    await i18n.changeLanguage('en');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-24T19:15:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('adds the gift on its own line under the plan credits', () => {
    render(
      <AiCreditsReadout credits={state({ credits: 300 })} gift={claimed(100)} />
    );
    expect(screen.getByTestId('ai-credits')).toHaveTextContent(
      '300 AI credits left.'
    );
    expect(screen.getByTestId('ai-gift-credits')).toHaveTextContent(
      plusLine(100)
    );
  });

  it.each(['period' as const, 'pass' as const])(
    'reads plain zero, not builds without AI, once a %s plan is spent and the gift has credits',
    (resets) => {
      render(
        <AiCreditsReadout
          credits={state({ credits: 0, resets })}
          gift={claimed(40)}
        />
      );
      expect(screen.getByTestId('ai-credits')).toHaveTextContent(
        '0 AI credits.'
      );
      expect(screen.queryByText(/builds without AI/)).toBeNull();
      expect(screen.getByTestId('ai-gift-credits')).toHaveTextContent(
        plusLine(40)
      );
    }
  );

  it.each([
    ['no gift', null],
    ['an expired gift', claimed(40, '2026-11-24T19:14:00.000Z')],
  ])('says the next deck builds without AI with %s', (_name, gift) => {
    render(<AiCreditsReadout credits={state({ credits: 0 })} gift={gift} />);
    expect(screen.getByText(/builds without AI/)).toBeInTheDocument();
  });

  it('drops the gift line and the plain zero once the gift expires on an open page', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-26T19:14:00.000Z'));
    render(
      <AiCreditsReadout credits={state({ credits: 0 })} gift={claimed(40)} />
    );
    expect(screen.getByTestId('ai-gift-credits')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(60_000);
    });

    expect(screen.queryByTestId('ai-gift-credits')).toBeNull();
    expect(screen.getByText(/builds without AI/)).toBeInTheDocument();
  });

  it('renders nothing for an account with no plan, which the page covers', () => {
    const { container } = render(
      <AiCreditsReadout
        credits={state({ allowance: 0, credits: 0 })}
        gift={claimed(100)}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it.each([
    ['there is no gift', null],
    ['the flag is off', { state: 'closed' as const, feedbackDue: false }],
    ['the gift is spent', claimed(0)],
    ['the gift expired', claimed(100, '2026-11-24T19:14:00.000Z')],
  ])('shows only the plan line when %s', (_name, gift) => {
    render(<AiCreditsReadout credits={state({ credits: 300 })} gift={gift} />);
    expect(screen.getByText('300 AI credits left.')).toBeInTheDocument();
    expect(screen.queryByTestId('ai-gift-credits')).toBeNull();
  });
});
